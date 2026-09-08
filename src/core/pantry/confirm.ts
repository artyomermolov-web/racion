// Подтверждение покупки: снапшот + перенос купленного в real-лоты (тикет 19,
// решение 07). Чистый детерминированный модуль без Prisma/Next.
//
// Что происходит при подтверждении (решение 07):
//  1. Снапшот — замороженное состояние списка: строки с числом купленных пачек,
//     ценой и стоимостью НА МОМЕНТ покупки. Смена `pricePerPack` в базе после
//     этого не пересчитывает сумму снапшота (это просто сохранённые числа).
//  2. Каждая купленная строка (packsBought > 0) → новый real-лот: qty =
//     packsBought · packSize, срок годности = дата покупки + shelfLifeDays.
//  3. Pending-лоты купленных ингредиентов промотятся в real (прогноз стал фактом);
//     чужие pending не трогаются. Так real и pending остаются строго раздельны.

import type {
  ConfirmPurchaseInput,
  ConfirmPurchaseResult,
  PantryLot,
  PurchaseSnapshotLine,
} from "./types";

/** Прибавляет `days` к ISO-дате (yyyy-mm-dd) в UTC и возвращает ISO-дату. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Срок годности лота: дата покупки + shelfLifeDays, либо null (срок неизвестен). */
function expiryFor(
  ingredientId: string,
  purchasedAt: string,
  shelfLifeDays: Record<string, number>,
): string | null {
  const days = shelfLifeDays[ingredientId];
  if (days === undefined || days === null) return null;
  return addDays(purchasedAt, days);
}

/**
 * Подтверждает покупку: строит замороженный снапшот, создаёт real-лоты из
 * купленных строк и промотирует pending-лоты купленных ингредиентов в real.
 * Строки с packsBought ≤ 0 не попадают ни в снапшот, ни в лоты.
 */
export function confirmPurchase(input: ConfirmPurchaseInput): ConfirmPurchaseResult {
  const { lines, purchasedAt, shelfLifeDays, pendingLots = [] } = input;
  const makeLotId = input.makeLotId ?? ((seq: number) => `lot-${purchasedAt}-${seq}`);

  const bought = lines.filter((l) => l.packsBought > 0);

  // 1. Снапшот — замороженные строки и сумма (цены на момент покупки).
  const snapshotLines: PurchaseSnapshotLine[] = bought.map((l) => ({
    ingredientId: l.ingredientId,
    name: l.name,
    packsBought: l.packsBought,
    packSize: l.packSize,
    pricePerPack: l.pricePerPack,
    qty: l.packsBought * l.packSize,
    lineCost: l.packsBought * l.pricePerPack,
  }));
  const totalCost = snapshotLines.reduce((sum, l) => sum + l.lineCost, 0);

  // 2. Новые real-лоты из купленного.
  const newRealLots: PantryLot[] = bought.map((l, i) => ({
    id: makeLotId(i),
    ingredientId: l.ingredientId,
    qty: l.packsBought * l.packSize,
    kind: "real",
    expiresAt: expiryFor(l.ingredientId, purchasedAt, shelfLifeDays),
  }));

  // 3. Промоушен pending → real только для купленных ингредиентов.
  //
  // Осторожно (задел): в «тонком» слое pending-лоты пока НИКТО не создаёт (нет
  // персистентного списка-прогноза), поэтому promotedPendingIds на практике пуст,
  // а «купленное» приходит только как newRealLots. Когда появится писатель
  // pending (прогноз из неподтверждённого списка), тикет-автор обязан развести две
  // операции, чтобы один и тот же купленный товар не удвоился: свежий real-лот из
  // packsBought И промоушен старого pending той же покупки. Здесь честно делаем обе
  // операции, как просит решение 07; согласование — за писателем pending.
  const boughtIds = new Set(bought.map((l) => l.ingredientId));
  const promotedLots: PantryLot[] = [];
  const promotedPendingIds: string[] = [];
  for (const lot of pendingLots) {
    if (lot.kind !== "pending") continue; // на всякий: промотируем только pending
    if (!boughtIds.has(lot.ingredientId)) continue; // чужой прогноз не трогаем
    promotedPendingIds.push(lot.id);
    promotedLots.push({ ...lot, kind: "real" });
  }

  return {
    snapshot: { confirmedAt: purchasedAt, lines: snapshotLines, totalCost },
    newRealLots,
    promotedPendingIds,
    promotedLots,
  };
}
