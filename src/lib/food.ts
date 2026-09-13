// Серверный клей базы продуктов и рецептов (тикет 13): чтение из БД + расчёт
// КБЖУ рецептов из состава. Бизнес-логику расчёта держим в /core/nutrition;
// здесь только доступ к данным и приведение к сериализуемым формам для UI.
import "server-only";
import { prisma } from "@/lib/db";
import { computeRecipeNutrition, type FoodNutrients } from "@/core/nutrition";
import type { AmountFood, DiarySource } from "@/core/diary";
import { per100ToNutrients, toRecipeComponents } from "@/lib/foodNutrients";

export interface IngredientRow {
  id: string;
  name: string;
  group: string;
  unit: string;
  /** КБЖУ + клетчатка на 100 г, натрий (мг) на 100 г. */
  per100: FoodNutrients;
  allergens: string[];
  /** Кастом-продукт пользователя (тикет 17) — для пометки «Своё» в базе. */
  own: boolean;
  /** Масса одной штуки, г — только у штучных продуктов; иначе null (тикет 09:
   *  штучный ввод в дневнике доступен только при заданном грамм-эквиваленте). */
  gramsPerPiece: number | null;
  /** Провенанс (тикет 01): "seed" (фолбэк) | "vkusvill" (настоящие КБЖУ/цена). */
  source: string;
  /** Цена ВВ, ₽ за пачку (по source="vkusvill" — настоящая; иначе ориентир). */
  pricePerPack: number;
  /** Старая цена ₽ до скидки — только для бейджа «Акция» (null — нет). */
  vvPriceOld: number | null;
  /** % скидки ВВ — для бейджа (null — нет). */
  vvDiscountPct: number | null;
}

export interface RecipeRow {
  id: string;
  name: string;
  timeMin: number;
  difficulty: number;
  servings: number;
  slots: string[];
  diet: string[];
  /** КБЖУ на одну порцию (посчитано из состава). */
  perServing: FoodNutrients;
  /** Свой рецепт пользователя (кастом/персонализация) — пометка «Своё». */
  own: boolean;
}

export interface RecipeIngredientRow {
  name: string;
  grams: number;
  unit: string;
}

export interface RecipeDetail extends RecipeRow {
  steps: string[];
  equipment: string[];
  ingredients: RecipeIngredientRow[];
  /** Аллергены блюда — объединение аллергенов ингредиентов. */
  allergens: string[];
  /** КБЖУ всего блюда (на все порции). */
  total: FoodNutrients;
  /** Владелец рецепта (null = базовый) — для показа «Персонализировать»/«Своё». */
  ownerUserId: string | null;
  /** id базового рецепта, если это персонализация (иначе null). */
  baseRecipeId: string | null;
}

/**
 * Продукты базы: базовые (ownerUserId = null) и кастом-продукты пользователя
 * (тикет 17), отсортированы по имени. Свои помечены own.
 */
export async function getIngredients(userId: string): Promise<IngredientRow[]> {
  const rows = await prisma.ingredient.findMany({
    where: { OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
    include: { allergens: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    group: r.group,
    unit: r.unit,
    per100: per100ToNutrients(r),
    allergens: r.allergens.map((a) => a.allergen),
    own: r.ownerUserId === userId,
    gramsPerPiece: r.gramsPerPiece,
    source: r.source,
    pricePerPack: r.pricePerPack,
    vvPriceOld: r.vvPriceOld,
    vvDiscountPct: r.vvDiscountPct,
  }));
}

/**
 * Рецепты базы с посчитанным КБЖУ на порцию: базовые и свои рецепты пользователя
 * (тикет 17), отсортированы по имени. Свои помечены own.
 */
export async function getRecipes(userId: string): Promise<RecipeRow[]> {
  const rows = await prisma.recipe.findMany({
    where: { OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
    include: {
      ingredients: { include: { ingredient: true } },
      slots: true,
      dietTags: true,
    },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => {
    const { perServing } = computeRecipeNutrition(
      toRecipeComponents(r.ingredients),
      r.servings,
    );
    return {
      id: r.id,
      name: r.name,
      timeMin: r.timeMin,
      difficulty: r.difficulty,
      servings: r.servings,
      slots: r.slots.map((s) => s.slot),
      diet: r.dietTags.map((d) => d.tag),
      perServing,
      own: r.ownerUserId === userId,
    };
  });
}

/** Полная карточка рецепта: состав, шаги, аллергены, КБЖУ на порцию и на блюдо. */
export async function getRecipeDetail(
  id: string,
  userId?: string,
): Promise<RecipeDetail | null> {
  const r = await prisma.recipe.findUnique({
    where: { id },
    include: {
      ingredients: {
        include: { ingredient: { include: { allergens: true } } },
        orderBy: { grams: "desc" },
      },
      slots: true,
      dietTags: true,
      equipment: true,
    },
  });
  if (!r) return null;

  const { total, perServing } = computeRecipeNutrition(
    toRecipeComponents(r.ingredients),
    r.servings,
  );
  // Аллергены блюда — объединение аллергенов ингредиентов (без повторов).
  const allergens = [
    ...new Set(
      r.ingredients.flatMap((ri) => ri.ingredient.allergens.map((a) => a.allergen)),
    ),
  ];
  return {
    id: r.id,
    name: r.name,
    timeMin: r.timeMin,
    difficulty: r.difficulty,
    servings: r.servings,
    slots: r.slots.map((s) => s.slot),
    diet: r.dietTags.map((d) => d.tag),
    equipment: r.equipment.map((e) => e.equipment),
    steps: r.steps.split("\n").filter((s) => s.trim().length > 0),
    ingredients: r.ingredients.map((ri) => ({
      name: ri.ingredient.name,
      grams: ri.grams,
      unit: ri.ingredient.unit,
    })),
    allergens,
    perServing,
    total,
    ownerUserId: r.ownerUserId,
    baseRecipeId: r.baseRecipeId,
    own: r.ownerUserId != null && r.ownerUserId === userId,
  };
}

/**
 * Данные еды для расчёта количества дневника (тикет 09): продукт → нутриенты на
 * 100 г + грамм-эквивалент штуки; рецепт → нутриенты на порцию (пересчитаны из
 * состава на текущий момент — снапшот записи всегда берётся из свежих данных).
 * Доступ ограничен базовыми и своими сущностями пользователя. null — не найдено.
 */
export async function getAmountFood(
  source: DiarySource,
  refId: string,
  userId: string,
): Promise<AmountFood | null> {
  if (source === "ingredient") {
    const i = await prisma.ingredient.findFirst({
      where: { id: refId, OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
    });
    if (!i) return null;
    return {
      source: "ingredient",
      per100: per100ToNutrients(i),
      gramsPerPiece: i.gramsPerPiece,
    };
  }
  const r = await prisma.recipe.findFirst({
    where: { id: refId, OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
    include: { ingredients: { include: { ingredient: true } } },
  });
  if (!r) return null;
  const { perServing } = computeRecipeNutrition(
    toRecipeComponents(r.ingredients),
    r.servings,
  );
  return { source: "recipe", perServing };
}
