// Тест-фикстура: сид-набор рецептов, приведённый к GeneratorRecipe через ядро
// nutrition. Общая для тестов дневного (generate.test.ts) и недельного
// (week.test.ts) генераторов — чтобы тесты «на утечки» шли на тех же данных,
// что и приложение, без дублирования загрузчика. Не тест сам по себе (имя не
// *.test.ts), в бандл приложения не попадает (импортируется только тестами).

import type { FoodNutrients } from "@/core/nutrition";
import { computeRecipeNutrition } from "@/core/nutrition";
import { INGREDIENTS, RECIPES } from "../../../prisma/seed-data";
import type { GeneratorRecipe, Slot, Equipment, Allergen } from "./types";

const bySlug = new Map(INGREDIENTS.map((i) => [i.slug, i]));

/** Приводит сид-рецепт к GeneratorRecipe (КБЖУ на порцию — из состава). */
export function toGeneratorRecipe(slug: string): GeneratorRecipe {
  const r = RECIPES.find((x) => x.slug === slug)!;
  const components = r.items.map((it) => {
    const ing = bySlug.get(it.ingredient)!;
    return {
      grams: it.grams,
      per100: {
        kcal: ing.kcal,
        protein: ing.protein,
        fat: ing.fat,
        carb: ing.carb,
        fiber: ing.fiber,
        sodium: ing.sodium,
      } as FoodNutrients,
    };
  });
  const { perServing } = computeRecipeNutrition(components, r.servings);
  // Аллергены блюда — объединение аллергенов ингредиентов.
  const allergens = [
    ...new Set(r.items.flatMap((it) => bySlug.get(it.ingredient)!.allergens)),
  ] as Allergen[];
  return {
    id: r.slug,
    slots: r.slots as Slot[],
    timeMin: r.timeMin,
    equipment: r.equipment as Equipment[],
    allergens,
    perServing,
  };
}

/** Весь сид-набор как кандидаты генератора. */
export const SEED_RECIPES: GeneratorRecipe[] = RECIPES.map((r) =>
  toGeneratorRecipe(r.slug),
);
