// Серверный клей дневника (тикет 08): один индексный запрос записей дня +
// агрегация/прогресс в чистом ядре /core/diary. Тонкий слой без своего теста
// (spec.md, Testing Decisions) — как src/lib/track.ts делегирует в /core/pantry.
import "server-only";
import type { DiaryEntry as DiaryEntryRow } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  summarize,
  remaining,
  resolveAmount,
  type DiaryEntry,
  type DiarySource,
  type DayProgress,
  type SlotSummary,
  type DiaryNutrients,
  type LoggedAmount,
} from "@/core/diary";
import type { Slot } from "@/core/generator";
import { activeNorm, dayTargetFromNorm } from "@/lib/generator";
import { getAmountFood } from "@/lib/food";

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

/** Параметры новой записи дневника (ручной лог, тикет 09). */
export interface AddEntryInput {
  /** Локальная дата пользователя, YYYY-MM-DD. */
  date: string;
  slot: Slot;
  source: DiarySource;
  /** Ingredient.id или Recipe.id. */
  refId: string;
  amount: LoggedAmount;
  /** Пометка происхождения из подсказки (тикет 10); по умолчанию null. */
  suggestedRecipeId?: string | null;
}

/**
 * Добавить запись дневника: снапшот КБЖУ считается из текущих данных еды на
 * момент записи (правка продукта в базе задним числом прошлые записи не меняет).
 * Штуки резолвятся в граммы в ядре. Бросает, если еда не найдена/недоступна.
 * Возвращает обновлённый день (для отрисовки без второго запроса).
 */
export async function addEntry(
  userId: string,
  input: AddEntryInput,
): Promise<DayLogResult> {
  const food = await getAmountFood(input.source, input.refId, userId);
  if (!food) throw new Error("Еда не найдена или недоступна");

  const { grams, servings, nutrients } = resolveAmount(food, input.amount);
  await prisma.diaryEntry.create({
    data: {
      userId,
      date: input.date,
      slot: input.slot,
      source: input.source,
      refId: input.refId,
      grams,
      servings,
      kcal: nutrients.kcal,
      protein: nutrients.protein,
      fat: nutrients.fat,
      carb: nutrients.carb,
      fiber: nutrients.fiber,
      suggestedRecipeId: input.suggestedRecipeId ?? null,
    },
  });

  return getDayLog(userId, input.date);
}

/**
 * Поправить количество записи: снапшот пересчитывается из ТЕКУЩИХ данных еды
 * (item 3). Слот/еда не меняются — только количество. Доступ ограничен владельцем.
 * Бросает, если запись/еда не найдены. Возвращает обновлённый день записи.
 */
export async function updateEntry(
  userId: string,
  id: string,
  amount: LoggedAmount,
): Promise<DayLogResult> {
  const row = await prisma.diaryEntry.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Запись не найдена");

  const food = await getAmountFood(row.source as DiarySource, row.refId, userId);
  if (!food) throw new Error("Еда не найдена или недоступна");

  const { grams, servings, nutrients } = resolveAmount(food, amount);
  await prisma.diaryEntry.update({
    where: { id: row.id },
    data: {
      grams,
      servings,
      kcal: nutrients.kcal,
      protein: nutrients.protein,
      fat: nutrients.fat,
      carb: nutrients.carb,
      fiber: nutrients.fiber,
    },
  });

  return getDayLog(userId, row.date);
}

/**
 * Удалить запись (свайп). Доступ ограничен владельцем; удаление чужой записи —
 * no-op. Возвращает обновлённый день (дата берётся из удалённой записи).
 */
export async function deleteEntry(
  userId: string,
  id: string,
): Promise<DayLogResult> {
  const row = await prisma.diaryEntry.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Запись не найдена");
  await prisma.diaryEntry.delete({ where: { id: row.id } });
  return getDayLog(userId, row.date);
}
