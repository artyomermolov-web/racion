// Серверный клей трекинга «съел» и списания кладовки (тикет 20, решение 07).
// Доступ к данным + запись; бизнес-логика (FIFO-списание, guard, разворот приёма)
// живёт в ядре /core/pantry. Списание применяется РОВНО один раз на приём —
// уникальность MealWriteOff по (userId, mealKey) и есть guard от двойного вычитания.
// Снятие отметки «съел» возвращает списанное обратно в лоты (обратимо).
import "server-only";
import { prisma } from "@/lib/db";
import { writeOffMeal, type TrackedMeal, type WriteOffRecipe } from "@/core/pantry";
import { saleQuantity } from "@/core/shopping";
import { computeRecipeNutrition, type FoodNutrients } from "@/core/nutrition";
import { toRecipeComponents } from "@/lib/foodNutrients";
import { realLotsForUser } from "@/lib/pantry";
import type { Slot } from "@/core/generator";

/** ISO-дата (yyyy-mm-dd) → DateTime в UTC, либо null. */
function toDate(iso: string | null): Date | null {
  return iso ? new Date(iso + "T00:00:00.000Z") : null;
}

/**
 * Состав рецепта в единице продажи (граммы→шт переводит saleQuantity) — вход
 * разворота приёма в потребность. Только базовые и свои рецепты пользователя.
 * Кастом-ПРОДУКТ рецептом не является → null (списывать нечего).
 */
async function loadWriteOffRecipe(
  recipeId: string,
  userId: string,
): Promise<WriteOffRecipe | null> {
  const r = await prisma.recipe.findFirst({
    where: { id: recipeId, OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
    include: { ingredients: { include: { ingredient: true } } },
  });
  if (!r) return null;
  return {
    id: r.id,
    servings: r.servings,
    ingredients: r.ingredients.map((ri) => ({
      ingredientId: ri.ingredientId,
      quantity: saleQuantity(ri.grams, ri.ingredient.unit, ri.ingredient.gramsPerPiece),
    })),
  };
}

/** Найденный рецепт для «добавить съеденное»: минимум для приёма дня. */
export interface FoodSearchResult {
  recipeId: string;
  name: string;
  timeMin: number;
  servings: number;
  slots: Slot[];
  /** КБЖУ одной порции (из состава). */
  perServing: FoodNutrients;
}

/**
 * Поиск рецептов по названию (подстрока, без учёта регистра) для лога съеденного:
 * базовые + свои рецепты пользователя. Пустой запрос → пусто. Ограничение — 20
 * результатов (лог, не каталог).
 */
export async function searchRecipesForLog(
  userId: string,
  query: string,
): Promise<FoodSearchResult[]> {
  const q = query.trim().toLocaleLowerCase("ru");
  if (q.length === 0) return [];

  // SQLite `contains` регистрозависим и не знает регистра кириллицы — фильтруем в
  // JS без учёта регистра. База небольшая (лог, не каталог), поэтому это дёшево.
  const rows = await prisma.recipe.findMany({
    where: { OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
    include: { ingredients: { include: { ingredient: true } }, slots: true },
    orderBy: { name: "asc" },
  });

  return rows
    .filter((r) => r.name.toLocaleLowerCase("ru").includes(q))
    .slice(0, 20)
    .map((r) => {
    const { perServing } = computeRecipeNutrition(
      toRecipeComponents(r.ingredients),
      r.servings,
    );
    return {
      recipeId: r.id,
      name: r.name,
      timeMin: r.timeMin,
      servings: r.servings,
      slots: r.slots.map((s) => s.slot) as Slot[],
      perServing,
    };
  });
}

/** Ключи приёмов пользователя, чьё списание уже применено — для восстановления отметок. */
export async function eatenKeysForUser(userId: string): Promise<string[]> {
  const rows = await prisma.mealWriteOff.findMany({
    where: { userId },
    select: { mealKey: true },
  });
  return rows.map((r) => r.mealKey);
}

export interface MarkEatenResult {
  /** true — приём помечен съеденным (списание применено либо уже было применено). */
  eaten: boolean;
  /** Непокрытая потребность по ingredientId (кладовки не хватило), > 0. */
  shortfall: Record<string, number>;
}

/**
 * Отмечает приём съеденным и списывает кладовку по факту (FIFO по сроку). Guard:
 * если приём с этим ключом уже списан — повторно НЕ вычитаем (решение 07),
 * возвращаем eaten=true. Списание и запись отметки — одной транзакцией. Недостача
 * запаса не мешает отметке (списываем сколько есть, остаток в shortfall).
 */
export async function markMealEaten(
  userId: string,
  meal: TrackedMeal,
): Promise<MarkEatenResult> {
  // Guard: уже списано? Настоящий инвариант держит уникальный индекс
  // (userId, mealKey) в БД — при гонке двух отметок второй create нарушит его и
  // ОТКАТИТ свою транзакцию целиком (вместе со своими decrement'ами), поэтому
  // списание применяется ровно один раз даже без блокировок. Эта ранняя проверка —
  // лишь быстрый путь без лишней работы в обычном (не гоночном) случае.
  const existing = await prisma.mealWriteOff.findUnique({
    where: { userId_mealKey: { userId, mealKey: meal.key } },
    select: { id: true },
  });
  if (existing) return { eaten: true, shortfall: {} };

  const recipe = await loadWriteOffRecipe(meal.recipeId, userId);
  if (!recipe) return { eaten: false, shortfall: {} }; // нет разложимого состава

  const realLots = await realLotsForUser(userId);
  const res = writeOffMeal({ meal, alreadyApplied: false, recipe, realLots });
  if (!res.apply) return { eaten: false, shortfall: {} };

  // Списываем лоты и фиксируем отметку одной транзакцией: запись MealWriteOff (с
  // отборами) — это и есть «флаг списание применено» (решение 07).
  await prisma.$transaction([
    ...res.draws.map((d) =>
      prisma.pantryLot.update({
        where: { id: d.lotId },
        data: { qty: { decrement: d.qty } },
      }),
    ),
    prisma.mealWriteOff.create({
      data: {
        userId,
        mealKey: meal.key,
        recipeId: meal.recipeId,
        portion: meal.portion,
        people: meal.people ?? 1,
        draws: {
          create: res.draws.map((d) => ({
            lotId: d.lotId,
            ingredientId: d.ingredientId,
            qty: d.qty,
            expiresAt: toDate(d.expiresAt),
          })),
        },
      },
    }),
  ]);

  return { eaten: true, shortfall: res.shortfall };
}

/**
 * Снимает отметку «съел»: возвращает списанное РОВНО в те же лоты (обратимость) и
 * удаляет запись MealWriteOff. Если исходный лот удалён вручную — пересоздаём его
 * с сохранённым сроком годности. Нет записи по ключу → ничего не делаем.
 */
export async function unmarkMealEaten(
  userId: string,
  mealKey: string,
): Promise<{ restored: boolean }> {
  const wo = await prisma.mealWriteOff.findUnique({
    where: { userId_mealKey: { userId, mealKey } },
    include: { draws: true },
  });
  if (!wo) return { restored: false };

  const lotIds = wo.draws.map((d) => d.lotId);
  const existing = await prisma.pantryLot.findMany({
    where: { id: { in: lotIds }, userId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((l) => l.id));

  await prisma.$transaction([
    ...wo.draws.map((d) =>
      existingIds.has(d.lotId)
        ? prisma.pantryLot.update({
            where: { id: d.lotId },
            data: { qty: { increment: d.qty } },
          })
        : prisma.pantryLot.create({
            data: {
              id: d.lotId, // тот же id — исходный лот был удалён, id свободен
              userId,
              ingredientId: d.ingredientId,
              qty: d.qty,
              kind: "real",
              expiresAt: d.expiresAt,
              source: "restore",
            },
          }),
    ),
    prisma.mealWriteOff.delete({ where: { id: wo.id } }), // draws каскадом
  ]);

  return { restored: true };
}
