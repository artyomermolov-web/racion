// Трекинг «съел» → списание кладовки по факту (тикет 20, решение 07). Чистый
// детерминированный модуль без Prisma/Next.
//
// Здесь живёт guard от двойного вычитания (решение 07): списание приёма
// применяется РОВНО один раз. Признак «уже применено» приходит из слоя данных
// (таблица MealWriteOff по клиентскому ключу приёма) — ядро остаётся чистым.
// Разворот рецепта в потребность повторяет формулу /core/shopping (порция / порций
// рецепта × едоки), чтобы «сколько списать» и «сколько купить» считались одинаково.

import type {
  ConsumeDemand,
  WriteOffMealInput,
  WriteOffMealResult,
  WriteOffRecipe,
} from "./types";
import { itemFactor } from "../shopping";
import { consumeFromLots } from "./consume";

/**
 * Потребность одного приёма в единице продажи: для каждого ингредиента рецепта
 * количество × (порция / порций рецепта) × едоки. Та же формула, что в списке
 * покупок (itemFactor). Ингредиенты с нулевым/отрицательным итогом отбрасываются.
 */
export function mealDemand(
  recipe: WriteOffRecipe,
  portion: number,
  people?: number,
): ConsumeDemand[] {
  const factor = itemFactor(portion, recipe.servings, people);

  const byId = new Map<string, number>();
  for (const ri of recipe.ingredients) {
    const qty = ri.quantity * factor;
    if (qty <= 0) continue;
    byId.set(ri.ingredientId, (byId.get(ri.ingredientId) ?? 0) + qty);
  }
  return [...byId.entries()].map(([ingredientId, qty]) => ({ ingredientId, qty }));
}

/**
 * Списывает кладовку по факту съеденного приёма. Guard: если списание этого
 * приёма уже применено (`alreadyApplied`) — НИЧЕГО не делаем (apply=false), чтобы
 * повторная отметка не вычитала запас дважды (решение 07). Иначе разворачиваем
 * рецепт в потребность и списываем из real-лотов по FIFO. Списывать нечего (пустой
 * состав или нулевая потребность) → apply=false. Недостача запаса не блокирует:
 * возвращается в shortfall, а apply=true (факт съедения зафиксирован).
 */
export function writeOffMeal(input: WriteOffMealInput): WriteOffMealResult {
  const { meal, alreadyApplied, recipe, realLots } = input;

  // Guard от двойного списания — раньше любых расчётов.
  if (alreadyApplied) return { apply: false, draws: [], shortfall: {} };

  const demand = mealDemand(recipe, meal.portion, meal.people);
  if (demand.length === 0) return { apply: false, draws: [], shortfall: {} };

  const { draws, shortfall } = consumeFromLots(realLots, demand);
  return { apply: true, draws, shortfall };
}
