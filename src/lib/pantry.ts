// Серверный клей кладовки (тикет 19): доступ к лотам PantryLot и проекция ко
// входу чистого ядра /core/pantry. Бизнес-логика (разделение real/pending,
// снапшот подтверждения, «приготовить из дома») — в ядре; здесь только доступ к
// данным и проекция для UI/списка/генератора.
import "server-only";
import { prisma } from "@/lib/db";
import {
  realOnHand,
  pantryStockIds as pantryStockIdsCore,
  cookableFromPantry,
  type PantryLot,
} from "@/core/pantry";
import { saleQuantity, type ShoppingRecipe } from "@/core/shopping";

/** ISO-дата (yyyy-mm-dd) из DateTime БД или null. */
function isoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Лоты пользователя в форме ядра (единица продажи, срок — ISO-дата). */
async function loadLots(userId: string): Promise<PantryLot[]> {
  const rows = await prisma.pantryLot.findMany({
    where: { userId },
    orderBy: [{ ingredientId: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    ingredientId: r.ingredientId,
    qty: r.qty,
    kind: r.kind === "pending" ? "pending" : "real",
    expiresAt: isoDate(r.expiresAt),
  }));
}

/** Запас дома по ingredientId (только real) — для вычета в списке покупок. */
export async function realOnHandForUser(userId: string): Promise<Record<string, number>> {
  return realOnHand(await loadLots(userId));
}

/** Pending-лоты пользователя в форме ядра — вход промоушена pending→real. */
export async function pendingLotsForUser(userId: string): Promise<PantryLot[]> {
  return (await loadLots(userId)).filter((l) => l.kind === "pending");
}

/** id продуктов с real-запасом — для бонуса кладовки генератора (тикет 19). */
export async function pantryStockIdsForUser(userId: string): Promise<string[]> {
  return pantryStockIdsCore(await loadLots(userId));
}

/** Строка кладовки для UI: лот с названием продукта, единицей и сроком годности. */
export interface PantryView {
  id: string;
  ingredientId: string;
  name: string;
  group: string;
  unit: string;
  qty: number;
  kind: "real" | "pending";
  expiresAt: string | null;
}

/**
 * Лоты кладовки для экрана: обогащены названием/группой/единицей продукта.
 * Возвращает и real, и pending (UI различает по kind); отсортированы по группе,
 * затем по названию — как список покупок.
 */
export async function loadPantryView(userId: string): Promise<PantryView[]> {
  const lots = await loadLots(userId);
  if (lots.length === 0) return [];

  const ids = [...new Set(lots.map((l) => l.ingredientId))];
  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, group: true, unit: true },
  });
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  const view = lots
    .map((l) => {
      const ing = byId.get(l.ingredientId);
      if (!ing) return null; // продукт удалён — лот-сирота не показываем
      return {
        id: l.id,
        ingredientId: l.ingredientId,
        name: ing.name,
        group: ing.group,
        unit: ing.unit,
        qty: l.qty,
        kind: l.kind,
        expiresAt: l.expiresAt,
      } satisfies PantryView;
    })
    .filter((x): x is PantryView => x !== null);

  view.sort(
    (a, b) => a.group.localeCompare(b.group, "ru") || a.name.localeCompare(b.name, "ru"),
  );
  return view;
}

/** Рецепт, который можно приготовить из дома: id, название, доступные порции. */
export interface CookableView {
  recipeId: string;
  name: string;
  timeMin: number;
  servings: number;
}

/**
 * Рецепты, которые можно приготовить из real-запаса кладовки (тикет 19). Берём
 * пул рецептов пользователя (базовые + свои), разворачиваем состав в единицу
 * продажи и зовём ядро; обогащаем названием и временем для UI.
 */
export async function cookFromPantry(userId: string): Promise<CookableView[]> {
  const lots = await loadLots(userId);
  if (lots.length === 0) return [];

  const rows = await prisma.recipe.findMany({
    where: { OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
    include: { ingredients: { include: { ingredient: true } } },
  });

  const recipes: ShoppingRecipe[] = rows.map((r) => ({
    id: r.id,
    servings: r.servings,
    ingredients: r.ingredients.map((ri) => ({
      ingredientId: ri.ingredientId,
      quantity: saleQuantity(ri.grams, ri.ingredient.unit, ri.ingredient.gramsPerPiece),
    })),
  }));
  const meta = new Map(rows.map((r) => [r.id, { name: r.name, timeMin: r.timeMin }]));

  return cookableFromPantry({ recipes, realLots: lots }).map((c) => ({
    recipeId: c.recipeId,
    name: meta.get(c.recipeId)?.name ?? "Блюдо",
    timeMin: meta.get(c.recipeId)?.timeMin ?? 0,
    servings: c.servings,
  }));
}
