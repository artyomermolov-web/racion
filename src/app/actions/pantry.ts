"use server";

// Действия кладовки (тикет 19). Подтверждение покупки переносит купленное в
// real-лоты (со сроком годности из карточки продукта) и промотирует pending→real;
// удаление лота убирает запас (израсходован/испортился). Бизнес-логика — в ядре
// /core/pantry; здесь доступ к данным, запись лотов и обновлённая проекция для UI.
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  confirmPurchase,
  type PurchaseLineInput,
  type PurchaseSnapshot,
} from "@/core/pantry";
import {
  loadPantryView,
  cookFromPantry,
  pendingLotsForUser,
  type PantryView,
  type CookableView,
} from "@/lib/pantry";
import { shoppingListForCurrentWeek } from "@/lib/shopping";
import type { ShoppingList } from "@/core/shopping";

/** Обновлённое состояние экрана после изменения кладовки. */
export interface PantryRefresh {
  pantry: PantryView[];
  cookable: CookableView[];
  /** Список покупок, пересобранный с учётом нового запаса (real вычтен). */
  list: ShoppingList | null;
}

/**
 * Сегодняшняя дата (yyyy-mm-dd, UTC) для срока годности и confirmedAt. UTC-срез —
 * тот же идиом, что на главной и в списке покупок (единая «дата дня» в приложении).
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Собирает обновлённое состояние экрана из БД (кладовка + приготовить + список). */
async function refresh(userId: string): Promise<PantryRefresh> {
  const [pantry, cookable, list] = await Promise.all([
    loadPantryView(userId),
    cookFromPantry(userId),
    shoppingListForCurrentWeek(userId),
  ]);
  return { pantry, cookable, list };
}

/**
 * Подтверждает покупку: строит замороженный снапшот, пишет купленное real-лотами
 * (срок годности = сегодня + shelfLifeDays продукта) и промотирует pending-лоты
 * купленных ингредиентов в real. Возвращает снапшот и обновлённое состояние
 * экрана. Строки с 0 пачек игнорируются ядром.
 */
export async function confirmPurchaseAction(
  lines: PurchaseLineInput[],
): Promise<{ snapshot: PurchaseSnapshot; refresh: PantryRefresh }> {
  const user = await requireUser();
  const purchasedAt = today();

  const boughtIds = [...new Set(lines.filter((l) => l.packsBought > 0).map((l) => l.ingredientId))];

  // Срок годности покупаемых продуктов и текущие pending-лоты — вход ядра.
  const [ingredients, pendingLots] = await Promise.all([
    prisma.ingredient.findMany({
      where: { id: { in: boughtIds } },
      select: { id: true, shelfLifeDays: true },
    }),
    pendingLotsForUser(user.id),
  ]);

  const shelfLifeDays: Record<string, number> = {};
  for (const i of ingredients) shelfLifeDays[i.id] = i.shelfLifeDays;

  const { snapshot, newRealLots, promotedPendingIds } = confirmPurchase({
    lines,
    purchasedAt,
    shelfLifeDays,
    pendingLots,
  });

  // Пишем купленное real-лотами и промотируем pending→real одной транзакцией:
  // real и pending остаются строго раздельны (промоушен меняет kind, не создаёт
  // дубль).
  await prisma.$transaction([
    ...newRealLots.map((lot) =>
      prisma.pantryLot.create({
        data: {
          userId: user.id,
          ingredientId: lot.ingredientId,
          qty: lot.qty,
          kind: "real",
          expiresAt: lot.expiresAt ? new Date(lot.expiresAt + "T00:00:00.000Z") : null,
          source: "purchase",
        },
      }),
    ),
    ...(promotedPendingIds.length > 0
      ? [
          prisma.pantryLot.updateMany({
            where: { id: { in: promotedPendingIds }, userId: user.id },
            data: { kind: "real" },
          }),
        ]
      : []),
  ]);

  return { snapshot, refresh: await refresh(user.id) };
}

/** Удаляет лот кладовки (израсходован/испортился). Возвращает обновлённый экран. */
export async function removePantryLotAction(lotId: string): Promise<PantryRefresh> {
  const user = await requireUser();
  // deleteMany с userId — чужой лот удалить нельзя (не бросает на 0 совпадений).
  await prisma.pantryLot.deleteMany({ where: { id: lotId, userId: user.id } });
  return refresh(user.id);
}
