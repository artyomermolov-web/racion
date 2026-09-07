// Единая проекция нутриентов продукта (на 100 г/мл/шт) в FoodNutrients и сборка
// компонентов рецепта из состава. Чистый модуль (без Prisma/Next) — общий для
// food.ts / customFood.ts / generator.ts, чтобы маппинг «поля строки → нутриенты»
// жил в одном месте (тикет 17, устранение дубля).
import type { FoodNutrients, RecipeComponent } from "@/core/nutrition";

/** Поля «на 100 г/мл/шт» из строки Ingredient. */
export interface Per100Fields {
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbPer100: number;
  fiberPer100: number;
  sodiumPer100: number;
}

/** Проекция строки продукта в нутриенты на 100 (натрий в мг). */
export function per100ToNutrients(r: Per100Fields): FoodNutrients {
  return {
    kcal: r.kcalPer100,
    protein: r.proteinPer100,
    fat: r.fatPer100,
    carb: r.carbPer100,
    fiber: r.fiberPer100,
    sodium: r.sodiumPer100,
  };
}

/** Компоненты для ядра nutrition из состава рецепта (масса + нутриенты на 100). */
export function toRecipeComponents(
  ingredients: { grams: number; ingredient: Per100Fields }[],
): RecipeComponent[] {
  return ingredients.map((ri) => ({
    grams: ri.grams,
    per100: per100ToNutrients(ri.ingredient),
  }));
}
