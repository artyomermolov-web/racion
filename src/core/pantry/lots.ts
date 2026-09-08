// Запас кладовки из лотов (тикет 19, решение 07). Чистый модуль.
//
// Ключевое правило: запас дома — это ТОЛЬКО real-лоты. Pending-лоты (прогноз
// неподтверждённой покупки) в запас не входят — иначе двойной счёт со списком
// покупок (список и так покупает недостающее). Разделение real/pending живёт
// здесь, в одном месте.

import type { PantryLot } from "./types";

/**
 * Запас дома по ingredientId — сумма количеств ТОЛЬКО real-лотов. Pending
 * игнорируются полностью. Результат идёт в `onHand` списка покупок (/core/shopping)
 * и в вычет для генератора. Единица — продажи (г/мл/шт), как у лотов.
 */
export function realOnHand(lots: readonly PantryLot[]): Record<string, number> {
  const onHand: Record<string, number> = {};
  for (const lot of lots) {
    if (lot.kind !== "real") continue; // pending — не запас
    if (lot.qty <= 0) continue;
    onHand[lot.ingredientId] = (onHand[lot.ingredientId] ?? 0) + lot.qty;
  }
  return onHand;
}

/**
 * Ингредиенты с положительным real-запасом — для бонуса генератора «приоритет
 * кладовки» (тикет 06 шаг 4). Только real: pending генератор своим не считает.
 */
export function pantryStockIds(lots: readonly PantryLot[]): string[] {
  const onHand = realOnHand(lots);
  return Object.keys(onHand);
}
