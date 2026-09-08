// «Приготовить из того, что дома» (тикет 19). Чистый детерминированный модуль.
//
// Из real-запаса кладовки находим рецепты, которые можно приготовить целиком
// (все ингредиенты покрыты), и считаем максимум целых порций. Pending не
// учитывается — готовить можно только из того, что физически дома (realOnHand).
// Рецепт описываем тем же типом, что и список покупок (ShoppingRecipe): состав
// на `servings` порций в единице продажи — перевод из грамм делает слой данных.

import type { CookableRecipe, PantryLot } from "./types";
import type { ShoppingRecipe } from "../shopping";
import { realOnHand } from "./lots";

// Тот же допуск, что в /core/shopping: гасит ошибку плавающей точки при делении
// количества на порции, чтобы «ровно на N порций» не срезалось до N−1.
const EPS = 1e-9;

export interface CookableInput {
  recipes: ShoppingRecipe[];
  /** Лоты кладовки; готовим только из real (pending отфильтровывается внутри). */
  realLots: PantryLot[];
}

/**
 * Рецепты, которые можно приготовить из домашнего запаса, с максимумом целых
 * порций. Рецепт годится, только если КАЖДЫЙ его ингредиент покрыт запасом хотя
 * бы на одну порцию; порций = ⌊min по ингредиентам (запас / расход на порцию)⌋.
 * Рецепты без состава пропускаются. Сортировка детерминированная: больше порций
 * выше, при равенстве — по recipeId.
 */
export function cookableFromPantry(input: CookableInput): CookableRecipe[] {
  const onHand = realOnHand(input.realLots);
  const out: CookableRecipe[] = [];

  for (const recipe of input.recipes) {
    if (recipe.ingredients.length === 0) continue; // «ничего» не готовим
    const servingsOf = recipe.servings >= 1 ? recipe.servings : 1;

    let maxServings = Infinity;
    for (const ri of recipe.ingredients) {
      const perServing = ri.quantity / servingsOf;
      if (perServing <= 0) continue; // ингредиент без расхода не ограничивает
      const have = onHand[ri.ingredientId] ?? 0;
      const possible = Math.floor(have / perServing + EPS);
      if (possible < maxServings) maxServings = possible;
      if (maxServings < 1) break; // не хватает даже на порцию — рецепт выбывает
    }

    if (maxServings >= 1 && maxServings !== Infinity) {
      out.push({ recipeId: recipe.id, servings: maxServings });
    }
  }

  out.sort((a, b) => b.servings - a.servings || (a.recipeId < b.recipeId ? -1 : 1));
  return out;
}
