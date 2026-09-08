"use server";

// Действия трекинга «съел» и списания кладовки (тикет 20, решение 07). Отметка
// списывает кладовку по факту (FIFO по сроку) РОВНО один раз на приём; снятие
// возвращает списанное. Перегенерация пересобирает несъеденные приёмы под остаток
// целей. Бизнес-логика — в ядре /core/pantry и /core/generator; здесь тонкий слой.
import { requireUser } from "@/lib/auth";
import {
  markMealEaten,
  unmarkMealEaten,
  searchRecipesForLog,
  type MarkEatenResult,
  type FoodSearchResult,
} from "@/lib/track";
import {
  regenerateDayRemainderForUser,
  type DisplayDay,
  type LayoutMealRef,
  type ExtraMealRef,
} from "@/lib/generator";
import type { TrackedMeal } from "@/core/pantry";

/** Отметить приём съеденным: списать кладовку по факту (идемпотентно по ключу). */
export async function markEatenAction(meal: TrackedMeal): Promise<MarkEatenResult> {
  const user = await requireUser();
  return markMealEaten(user.id, meal);
}

/** Снять отметку «съел»: вернуть списанное в лоты и удалить запись списания. */
export async function unmarkEatenAction(mealKey: string): Promise<{ restored: boolean }> {
  const user = await requireUser();
  return unmarkMealEaten(user.id, mealKey);
}

/** Поиск рецептов по названию для «добавить съеденное». */
export async function searchFoodAction(query: string): Promise<FoodSearchResult[]> {
  const user = await requireUser();
  return searchRecipesForLog(user.id, query);
}

/** Перегенерировать несъеденные приёмы дня под остаточные цели. */
export async function regenerateRemainderAction(
  layout: LayoutMealRef[],
  extras: ExtraMealRef[],
  seed: number,
): Promise<DisplayDay | null> {
  const user = await requireUser();
  return regenerateDayRemainderForUser(user.id, layout, extras, seed);
}
