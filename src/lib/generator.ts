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
  generateWeek,
  regenerateDay,
  replaceMealInWeek,
  scalePortion,
  DEFAULT_DAY_LAYOUT,
  type GeneratorRecipe,
  type DayTarget,
  type NutrientRanges,
  type PlanItem,
  type GeneratedWeek,
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

/** Один день недели для UI: приёмы + сумма КБЖУ за день. */
export interface DisplayWeekDay {
  meals: DayMeal[];
  totals: FoodNutrients;
}

/** Собранная неделя для UI: дни, недельное среднее, диапазоны, флаг компромисса. */
export interface DisplayWeek {
  days: DisplayWeekDay[];
  weeklyAverage: FoodNutrients;
  ranges: NutrientRanges;
  dayTarget: DayTarget;
  /** true — средние не удалось загнать в диапазоны (честный компромисс). */
  compromised: boolean;
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

/** Диапазоны недельного среднего из нормы (тикет 15): те же min/max, что в норме. */
export function nutrientRangesFromNorm(norm: NormRecord): NutrientRanges {
  return {
    kcalMin: norm.kcalMin,
    kcalMax: norm.kcalMax,
    proteinMin: norm.proteinMin,
    proteinMax: norm.proteinMax,
    fatMin: norm.fatMin,
    fatMax: norm.fatMax,
    carbMin: norm.carbMin,
    carbMax: norm.carbMax,
    fiberMin: norm.fiberMin,
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
  const norm = await activeNorm(userId);
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
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const { recipes, meta, byId } = await loadRecipePool();
  const target = dayTargetFromNorm(norm);

  // Восстанавливаем PlanItem'ы с КБЖУ из пула (не с клиента); неизвестные id
  // отбрасываем.
  const items = rebuildItems(current, byId);

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

// ── Уровень недели (тикет 15) ────────────────────────────────────────────────

const WEEK_DAYS = 7;

/** Восстанавливает PlanItem'ы из клиентских ссылок с КБЖУ из пула (не с клиента). */
function rebuildItems(
  refs: MealRef[],
  byId: Map<string, GeneratorRecipe>,
): PlanItem[] {
  return refs
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
}

/** Проекция собранной недели ядра в форму для UI. */
function toDisplayWeek(
  week: GeneratedWeek,
  meta: Map<string, RecipeMeta>,
  dayTarget: DayTarget,
): DisplayWeek {
  return {
    days: week.days.map((d) => ({
      meals: d.items.map((it) => toDayMeal(it, meta)),
      totals: d.totals,
    })),
    weeklyAverage: week.weeklyAverage,
    ranges: week.ranges,
    dayTarget,
    compromised: week.compromised,
  };
}

/** Активная норма пользователя или null. */
async function activeNorm(userId: string) {
  return prisma.nutritionProfile.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Собирает неделю под норму пользователя. null — если норма ещё не рассчитана. */
export async function buildWeek(
  userId: string,
  seed: number,
): Promise<DisplayWeek | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const { recipes, meta } = await loadRecipePool();
  const dayTarget = dayTargetFromNorm(norm);

  const week = generateWeek({
    recipes,
    slots: DEFAULT_DAY_LAYOUT,
    days: WEEK_DAYS,
    ranges: nutrientRangesFromNorm(norm),
    dayTarget,
    constraints: { excludedAllergens: excludedAllergensFor(userId) },
    seed,
  });

  return toDisplayWeek(week, meta, dayTarget);
}

/**
 * Перегенерация одного дня недели под остаток целей (недельное среднее держится
 * в диапазонах, прочие дни не трогаются). КБЖУ прочих дней пересчитываем из
 * (recipeId, portion) на сервере — клиенту не доверяем.
 */
export async function regenerateWeekDay(
  userId: string,
  current: MealRef[][],
  dayIndex: number,
  seed: number,
): Promise<DisplayWeek | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const { recipes, meta, byId } = await loadRecipePool();
  const dayTarget = dayTargetFromNorm(norm);
  const days = current.map((refs) => rebuildItems(refs, byId));

  const week = regenerateDay({
    recipes,
    slots: DEFAULT_DAY_LAYOUT,
    days: WEEK_DAYS,
    ranges: nutrientRangesFromNorm(norm),
    dayTarget,
    constraints: { excludedAllergens: excludedAllergensFor(userId) },
    seed,
    current: days,
    dayIndex,
  });

  return toDisplayWeek(week, meta, dayTarget);
}

/**
 * Замена одного приёма (блюда) в конкретном дне недели под остаток дня. Возвращает
 * всю пересобранную неделю или null (нет нормы/кандидатов).
 */
export async function replaceWeekMeal(
  userId: string,
  current: MealRef[][],
  dayIndex: number,
  slot: Slot,
  seed: number,
): Promise<DisplayWeek | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const { recipes, meta, byId } = await loadRecipePool();
  const dayTarget = dayTargetFromNorm(norm);
  const days = current.map((refs) => rebuildItems(refs, byId));

  const week = replaceMealInWeek({
    recipes,
    slots: DEFAULT_DAY_LAYOUT,
    days: WEEK_DAYS,
    ranges: nutrientRangesFromNorm(norm),
    dayTarget,
    constraints: { excludedAllergens: excludedAllergensFor(userId) },
    seed,
    current: days,
    dayIndex,
    slot,
  });
  if (!week) return null;

  return toDisplayWeek(week, meta, dayTarget);
}
