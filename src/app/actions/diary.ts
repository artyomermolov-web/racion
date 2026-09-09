"use server";

// Действия дневника (тикет 08). Пока только чтение дня — ручной лог/правка/удаление
// приходят в тикете 09. Тонкий слой: requireUser() → src/lib/diary.ts.
import { requireUser } from "@/lib/auth";
import { getDayLog, type DayLogResult } from "@/lib/diary";

/**
 * День дневника по локальной дате пользователя (YYYY-MM-DD). Дату определяет
 * клиент (без UTC-дрейфа) и передаёт сюда; сервер её не переинтерпретирует.
 */
export async function getDayLogAction(date: string): Promise<DayLogResult> {
  const user = await requireUser();
  return getDayLog(user.id, date);
}
