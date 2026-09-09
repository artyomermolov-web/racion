"use server";

// Действия дневника (тикеты 08–09): чтение дня + ручной лог/правка/удаление.
// Тонкий слой — requireUser() → src/lib/diary.ts; вся логика и снапшоты в lib/ядре.
import { requireUser } from "@/lib/auth";
import {
  getDayLog,
  addEntry,
  updateEntry,
  deleteEntry,
  type DayLogResult,
  type AddEntryInput,
} from "@/lib/diary";
import type { LoggedAmount } from "@/core/diary";

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
