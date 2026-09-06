// Серверный клей базы продуктов и рецептов (тикет 13): чтение из БД + расчёт
// КБЖУ рецептов из состава. Бизнес-логику расчёта держим в /core/nutrition;
// здесь только доступ к данным и приведение к сериализуемым формам для UI.
import "server-only";
import { prisma } from "@/lib/db";
import {
  computeRecipeNutrition,
  type FoodNutrients,
  type RecipeComponent,
} from "@/core/nutrition";

export interface IngredientRow {
  id: string;
  name: string;
  group: string;
  unit: string;
  /** КБЖУ + клетчатка на 100 г, натрий (мг) на 100 г. */
  per100: FoodNutrients;
  allergens: string[];
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
}

/** Поля «на 100 г» из строки Ingredient. Общий вход для проекции нутриентов. */
type Per100Fields = {
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbPer100: number;
  fiberPer100: number;
  sodiumPer100: number;
};

/** Проекция строки продукта в нутриенты на 100 г (единая точка маппинга). */
function rowToNutrients(r: Per100Fields): FoodNutrients {
  return {
    kcal: r.kcalPer100,
    protein: r.proteinPer100,
    fat: r.fatPer100,
    carb: r.carbPer100,
    fiber: r.fiberPer100,
    sodium: r.sodiumPer100,
  };
}

/** Все базовые продукты (ownerUserId = null), отсортированы по имени. */
export async function getIngredients(): Promise<IngredientRow[]> {
  const rows = await prisma.ingredient.findMany({
    where: { ownerUserId: null },
    include: { allergens: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    group: r.group,
    unit: r.unit,
    per100: rowToNutrients(r),
    allergens: r.allergens.map((a) => a.allergen),
  }));
}

/** Составляет компоненты для ядра из состава рецепта. */
function toComponents(
  ingredients: { grams: number; ingredient: Per100Fields }[],
): RecipeComponent[] {
  return ingredients.map((ri) => ({
    grams: ri.grams,
    per100: rowToNutrients(ri.ingredient),
  }));
}

/** Все базовые рецепты с посчитанным КБЖУ на порцию, отсортированы по имени. */
export async function getRecipes(): Promise<RecipeRow[]> {
  const rows = await prisma.recipe.findMany({
    where: { ownerUserId: null },
    include: {
      ingredients: { include: { ingredient: true } },
      slots: true,
      dietTags: true,
    },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => {
    const { perServing } = computeRecipeNutrition(
      toComponents(r.ingredients),
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
    };
  });
}

/** Полная карточка рецепта: состав, шаги, аллергены, КБЖУ на порцию и на блюдо. */
export async function getRecipeDetail(id: string): Promise<RecipeDetail | null> {
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
    toComponents(r.ingredients),
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
  };
}
