// Серверный клей генератора дня (тикет 14): читает активную норму и пул рецептов
// из БД, приводит их ко входу чистого ядра /core/generator, собирает день и
// обогащает приёмы данными для UI (название, время). Бизнес-логика подбора —
// в ядре; здесь только доступ к данным и проекция.
import "server-only";
import { prisma } from "@/lib/db";
import { computeRecipeNutrition, type FoodNutrients } from "@/core/nutrition";
import {
  generateDay,
  replaceDish,
  scalePortion,
  DEFAULT_DAY_LAYOUT,
  type GeneratorRecipe,
  type DayTarget,
  type PlanItem,
  type Slot,
  type Allergen,
} from "@/core/generator";

/** Приём дня, готовый к показу: КБЖУ + название и время рецепта. */
export interface DayMeal {
  slot: Slot;
  recipeId: string;
  name: string;
  timeMin: number;
  portion: number;
  nutrients: FoodNutrients;
}

/** Собранный день для UI: приёмы, сумма за день и цель, под которую собирали. */
export interface DisplayDay {
  meals: DayMeal[];
  totals: FoodNutrients;
  target: DayTarget;
}

/** Минимум для пересборки дня на сервере (не доверяем КБЖУ с клиента). */
export interface MealRef {
  slot: Slot;
  recipeId: string;
  portion: number;
}

type NormRecord = {
  kcalMin: number;
  kcalMax: number;
  proteinMin: number;
  proteinMax: number;
  fatMin: number;
  fatMax: number;
  carbMin: number;
  carbMax: number;
  fiberMin: number;
};

const mid = (a: number, b: number) => Math.round((a + b) / 2);

/** Цель дня из нормы: середины диапазонов КБЖУ, клетчатка — минимум нормы. */
export function dayTargetFromNorm(norm: NormRecord): DayTarget {
  return {
    kcal: mid(norm.kcalMin, norm.kcalMax),
    protein: mid(norm.proteinMin, norm.proteinMax),
    fat: mid(norm.fatMin, norm.fatMax),
    carb: mid(norm.carbMin, norm.carbMax),
    fiber: norm.fiberMin,
  };
}

interface RecipeMeta {
  name: string;
  timeMin: number;
}

interface RecipePool {
  recipes: GeneratorRecipe[];
  meta: Map<string, RecipeMeta>;
  byId: Map<string, GeneratorRecipe>;
}

/**
 * Пул кандидатов генератора из базовых рецептов: приводит состав к КБЖУ порции
 * (ядром nutrition), собирает аллергены (объединение аллергенов ингредиентов),
 * слоты, технику и время. Название/время отдельно — для показа.
 */
async function loadRecipePool(): Promise<RecipePool> {
  const rows = await prisma.recipe.findMany({
    where: { ownerUserId: null },
    include: {
      ingredients: { include: { ingredient: { include: { allergens: true } } } },
      slots: true,
      equipment: true,
    },
  });

  const recipes: GeneratorRecipe[] = [];
  const meta = new Map<string, RecipeMeta>();
  const byId = new Map<string, GeneratorRecipe>();

  for (const r of rows) {
    const components = r.ingredients.map((ri) => ({
      grams: ri.grams,
      per100: {
        kcal: ri.ingredient.kcalPer100,
        protein: ri.ingredient.proteinPer100,
        fat: ri.ingredient.fatPer100,
        carb: ri.ingredient.carbPer100,
        fiber: ri.ingredient.fiberPer100,
        sodium: ri.ingredient.sodiumPer100,
      },
    }));
    const { perServing } = computeRecipeNutrition(components, r.servings);
    const allergens = [
      ...new Set(
        r.ingredients.flatMap((ri) => ri.ingredient.allergens.map((a) => a.allergen)),
      ),
    ] as Allergen[];

    const gr: GeneratorRecipe = {
      id: r.id,
      slots: r.slots.map((s) => s.slot) as Slot[],
      timeMin: r.timeMin,
      equipment: r.equipment.map((e) => e.equipment) as GeneratorRecipe["equipment"],
      allergens,
      perServing,
    };
    recipes.push(gr);
    byId.set(r.id, gr);
    meta.set(r.id, { name: r.name, timeMin: r.timeMin });
  }

  return { recipes, meta, byId };
}

/** Обогащает приём ядра (PlanItem) данными для показа. */
function toDayMeal(item: PlanItem, meta: Map<string, RecipeMeta>): DayMeal {
  const m = meta.get(item.recipeId);
  return {
    slot: item.slot,
    recipeId: item.recipeId,
    name: m?.name ?? "Блюдо",
    timeMin: m?.timeMin ?? 0,
    portion: item.portion,
    nutrients: item.nutrients,
  };
}

/**
 * Аллергены пользователя, которые генератор обязан исключать. В «тонком» слое
 * персональных предпочтений ещё нет в схеме (тикет 16) — пока пусто. Ядро уже
 * умеет их отсекать и покрыто тестами «на утечки»; проводка UI появится позже.
 */
function excludedAllergensFor(_userId: string): Allergen[] {
  return [];
}

/** Собирает день под норму пользователя. null — если норма ещё не рассчитана. */
export async function buildDay(
  userId: string,
  seed: number,
): Promise<DisplayDay | null> {
  const norm = await prisma.nutritionProfile.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (!norm) return null;

  const { recipes, meta } = await loadRecipePool();
  const target = dayTargetFromNorm(norm);

  const day = generateDay({
    recipes,
    slots: DEFAULT_DAY_LAYOUT,
    target,
    constraints: { excludedAllergens: excludedAllergensFor(userId) },
    seed,
  });

  return {
    meals: day.items.map((it) => toDayMeal(it, meta)),
    totals: day.totals,
    target,
  };
}

/**
 * Заменяет блюдо в одном приёме под остаток дня. КБЖУ прочих приёмов пересчитываем
 * из (recipeId, portion) на сервере — клиенту в этой части не доверяем. Возвращает
 * новый приём или null (нет активной нормы либо кандидатов на замену).
 */
export async function replaceMeal(
  userId: string,
  current: MealRef[],
  slot: Slot,
  seed: number,
): Promise<DayMeal | null> {
  const norm = await prisma.nutritionProfile.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
  if (!norm) return null;

  const { recipes, meta, byId } = await loadRecipePool();
  const target = dayTargetFromNorm(norm);

  // Восстанавливаем PlanItem'ы с КБЖУ из пула (не с клиента); неизвестные id
  // отбрасываем.
  const items: PlanItem[] = current
    .map((ref) => {
      const gr = byId.get(ref.recipeId);
      if (!gr) return null;
      return {
        slot: ref.slot,
        recipeId: ref.recipeId,
        portion: ref.portion,
        nutrients: scalePortion(gr.perServing, ref.portion),
      } satisfies PlanItem;
    })
    .filter((x): x is PlanItem => x !== null);

  const replaced = replaceDish({
    recipes,
    slots: DEFAULT_DAY_LAYOUT,
    target,
    constraints: { excludedAllergens: excludedAllergensFor(userId) },
    seed,
    current: items,
    slot,
  });
  if (!replaced) return null;
  return toDayMeal(replaced, meta);
}
