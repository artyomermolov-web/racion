// Серверный клей дневника (тикет 08): один индексный запрос записей дня +
// агрегация/прогресс в чистом ядре /core/diary. Тонкий слой без своего теста
// (spec.md, Testing Decisions) — как src/lib/track.ts делегирует в /core/pantry.
import "server-only";
import type { DiaryEntry as DiaryEntryRow } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  summarize,
  remaining,
  type DiaryEntry,
  type DiarySource,
  type DayProgress,
  type SlotSummary,
  type DiaryNutrients,
} from "@/core/diary";
import type { Slot } from "@/core/generator";
import { activeNorm, dayTargetFromNorm } from "@/lib/generator";

/** День дневника для UI: записи, разбивка по приёмам, сумма и прогресс. */
export interface DayLogResult {
  entries: DiaryEntry[];
  perSlot: SlotSummary[];
  totals: DiaryNutrients;
  /** Прогресс против цели; null — нет активной нормы («заполни профиль»). */
  progress: DayProgress | null;
}

/** Строка БД → доменная запись ядра (снапшот КБЖУ уже посчитан при записи). */
function toEntry(row: DiaryEntryRow): DiaryEntry {
  return {
    id: row.id,
    date: row.date,
    slot: row.slot as Slot,
    source: row.source as DiarySource,
    refId: row.refId,
    grams: row.grams,
    servings: row.servings,
    nutrients: {
      kcal: row.kcal,
      protein: row.protein,
      fat: row.fat,
      carb: row.carb,
      fiber: row.fiber,
    },
    suggestedRecipeId: row.suggestedRecipeId,
  };
}

/**
 * День дневника: записи по (userId, date) одним индексным запросом → агрегация в
 * ядре. Прогресс считается против цели из активной нормы (`dayTargetFromNorm`);
 * без активной нормы прогресс = null (UI показывает «заполни профиль»).
 * `date` — локальная дата пользователя (YYYY-MM-DD), сервер её не трогает.
 */
export async function getDayLog(
  userId: string,
  date: string,
): Promise<DayLogResult> {
  const [rows, norm] = await Promise.all([
    prisma.diaryEntry.findMany({
      where: { userId, date },
      orderBy: { createdAt: "asc" },
    }),
    activeNorm(userId),
  ]);

  const entries = rows.map(toEntry);
  const { perSlot, totals } = summarize(entries);
  const progress = norm ? remaining(dayTargetFromNorm(norm), totals) : null;

  return { entries, perSlot, totals, progress };
}
