"use server";

// Действия плана дня (тикет 14): перегенерация дня и замена одного блюда. Оба
// запускаются ТОЛЬКО по кнопке — изменение настроек/профиля план не трогает
// (тикет 06 шаг 9). Персистентности плана в «тонком» слое нет: день живёт в
// состоянии клиента, а действия возвращают свежий результат под текущую норму.
import { requireUser } from "@/lib/auth";
import { buildDay, replaceMeal, type DisplayDay, type DayMeal, type MealRef } from "@/lib/generator";
import type { Slot } from "@/core/generator";

/** Перегенерировать день: новый seed → свежий вариант под норму пользователя. */
export async function regenerateDayAction(seed: number): Promise<DisplayDay | null> {
  const user = await requireUser();
  return buildDay(user.id, seed);
}

/** Заменить блюдо в приёме: подбор под остаток дня с учётом прочих приёмов. */
export async function replaceMealAction(
  current: MealRef[],
  slot: Slot,
  seed: number,
): Promise<DayMeal | null> {
  const user = await requireUser();
  return replaceMeal(user.id, current, slot, seed);
}
