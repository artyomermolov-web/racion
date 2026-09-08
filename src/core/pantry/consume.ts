// FIFO-списание кладовки по факту «съел» (тикет 20, решение 07). Чистый
// детерминированный модуль без Prisma/Next.
//
// Правила (решение 07):
//  • списываем ТОЛЬКО из real-лотов (pending — прогноз, не запас);
//  • порядок FIFO по сроку годности: раньше истекает — раньше расходуется
//    (меньше порчи); лоты без срока — в конец; при равном сроке — по id (детерминизм);
//  • «по факту»: берём сколько есть, недостачу возвращаем в shortfall (она НЕ
//    блокирует отметку — факт съедения от запаса не зависит).

import type { ConsumeDemand, ConsumeResult, LotDraw, PantryLot } from "./types";

// Допуск против ошибки плавающей точки (как в /core/shopping): «ровно хватило»
// не должно оставлять микроскопический остаток или недостачу.
const EPS = 1e-9;

/**
 * Порядок расхода real-лотов одного продукта: FIFO по сроку годности. Раньше
 * истекает — раньше берём; null (без срока) — в конец; при равенстве — по id.
 */
function fifoOrder(a: PantryLot, b: PantryLot): number {
  if (a.expiresAt !== b.expiresAt) {
    if (a.expiresAt === null) return 1; // без срока — позже
    if (b.expiresAt === null) return -1;
    return a.expiresAt < b.expiresAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}

/**
 * Списывает потребность из real-лотов по FIFO (сроку годности). Возвращает отборы
 * по лотам (для применения к запасу и обратимости снятия отметки) и непокрытый
 * остаток по продуктам. Pending-лоты и лоты с qty ≤ 0 игнорируются.
 */
export function consumeFromLots(
  realLots: readonly PantryLot[],
  demand: readonly ConsumeDemand[],
): ConsumeResult {
  // Лоты по продукту, только real с положительным запасом, в порядке FIFO.
  const byIngredient = new Map<string, PantryLot[]>();
  for (const lot of realLots) {
    if (lot.kind !== "real" || lot.qty <= 0) continue;
    const list = byIngredient.get(lot.ingredientId) ?? [];
    list.push(lot);
    byIngredient.set(lot.ingredientId, list);
  }
  for (const list of byIngredient.values()) list.sort(fifoOrder);

  const draws: LotDraw[] = [];
  const shortfall: Record<string, number> = {};

  for (const d of demand) {
    if (d.qty <= 0) continue;
    let need = d.qty;
    const lots = byIngredient.get(d.ingredientId) ?? [];
    for (const lot of lots) {
      if (need <= EPS) break;
      const take = Math.min(lot.qty, need);
      if (take <= 0) continue;
      draws.push({
        lotId: lot.id,
        ingredientId: lot.ingredientId,
        qty: take,
        expiresAt: lot.expiresAt,
      });
      need -= take;
    }
    if (need > EPS) shortfall[d.ingredientId] = (shortfall[d.ingredientId] ?? 0) + need;
  }

  return { draws, shortfall };
}
