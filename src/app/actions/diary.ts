"use server";

// Действия дневника (тикеты 08–10): чтение дня + ручной лог/правка/удаление +
// подсказки «Что поесть сейчас» (блок, лог в один тап, пересборка остатка).
// Тонкий слой — requireUser() → src/lib/diary.ts; вся логика и снапшоты в lib/ядре.
import { requireUser } from "@/lib/auth";
import {
  getDayLog,
  addEntry,
  updateEntry,
  deleteEntry,
  getSuggestions,
  logSuggestion,
  regenerateRemainder,
  getLogSegments,
  eatPlanMeal,
  uneatPlanMeal,
  type DayLogResult,
  type AddEntryInput,
  type EffortFilter,
  type LogSuggestionInput,
  type SuggestionBlock,
  type LogSegments,
  type EatPlanMealInput,
  type EatPlanMealResult,
  type UneatPlanMealInput,
} from "@/lib/diary";
import type { LoggedAmount } from "@/core/diary";
import { buildDayForDate, type DisplayDay } from "@/lib/generator";

/**
 * День дневника по локальной дате пользователя (YYYY-MM-DD). Дату определяет
 * клиент (без UTC-дрейфа) и передаёт сюда; сервер её не переинтерпретирует.
 */
export async function getDayLogAction(date: string): Promise<DayLogResult> {
  const user = await requireUser();
  return getDayLog(user.id, date);
}

/** Добавить запись в дневник; возвращает обновлённый день. */
export async function addEntryAction(
  input: AddEntryInput,
): Promise<DayLogResult> {
  const user = await requireUser();
  return addEntry(user.id, input);
}

/** Поправить количество записи; возвращает обновлённый день. */
export async function updateEntryAction(
  id: string,
  amount: LoggedAmount,
): Promise<DayLogResult> {
  const user = await requireUser();
  return updateEntry(user.id, id, amount);
}

/** Удалить запись; возвращает обновлённый день. */
export async function deleteEntryAction(id: string): Promise<DayLogResult> {
  const user = await requireUser();
  return deleteEntry(user.id, id);
}

/** Ссылки сегментов шита добавления: Недавнее / Избранное / Своё (тикет 11). */
export async function getLogSegmentsAction(): Promise<LogSegments> {
  const user = await requireUser();
  return getLogSegments(user.id);
}

// ── Единая лента дня: план + слияние «съел» (тикет 09) ───────────────────────

/** Предложенный план дня (детерминирован по дате) — предложенные приёмы ленты. */
export async function getDayPlanAction(date: string): Promise<DisplayDay | null> {
  const user = await requireUser();
  return buildDayForDate(user.id, date);
}

/** Тап «съел» по предложенному приёму: запись + списание кладовки одной операцией. */
export async function eatPlanMealAction(
  input: EatPlanMealInput,
): Promise<EatPlanMealResult> {
  const user = await requireUser();
  return eatPlanMeal(user.id, input);
}

/** Снять «съел» по приёму: удалить запись + вернуть списанную кладовку. */
export async function uneatPlanMealAction(
  input: UneatPlanMealInput,
): Promise<DayLogResult> {
  const user = await requireUser();
  return uneatPlanMeal(user.id, input);
}

// ── «Что поесть сейчас» (тикет 10) ───────────────────────────────────────────

/** Подсказки под остаток текущего приёма дня, с учётом фильтра усилий. */
export async function getSuggestionsAction(
  date: string,
  effort: EffortFilter = "cook",
): Promise<SuggestionBlock> {
  const user = await requireUser();
  return getSuggestions(user.id, date, effort);
}

/** Лог подсказки в один тап (идемпотентно); возвращает обновлённый день. */
export async function logSuggestionAction(
  input: LogSuggestionInput,
): Promise<DayLogResult> {
  const user = await requireUser();
  return logSuggestion(user.id, input);
}

/** Пересобрать остаток дня: свежий набор приёмов под текущий остаток. */
export async function regenerateRemainderAction(
  date: string,
  seed: number,
): Promise<DisplayDay | null> {
  const user = await requireUser();
  return regenerateRemainder(user.id, date, seed);
}
