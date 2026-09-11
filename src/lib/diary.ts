// Серверный клей дневника (тикет 08): один индексный запрос записей дня +
// агрегация/прогресс в чистом ядре /core/diary. Тонкий слой без своего теста
// (spec.md, Testing Decisions) — как src/lib/track.ts делегирует в /core/pantry.
import "server-only";
import { Prisma, type DiaryEntry as DiaryEntryRow } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  summarize,
  remaining,
  resolveAmount,
  suggestNextMeal,
  logDecision,
  type DiaryEntry,
  type DiarySource,
  type DayProgress,
  type SlotSummary,
  type DiaryNutrients,
  type LoggedAmount,
  type SuggestedMeal,
  type SuggestCandidate,
  type SuggestFilters,
} from "@/core/diary";
import type { FoodNutrients } from "@/core/nutrition";
import type { Slot } from "@/core/generator";
import { hashString } from "@/core/generator";
import {
  activeNorm,
  dayTargetFromNorm,
  loadSuggestionContext,
  regenerateDiaryRemainder,
  type DisplayDay,
} from "@/lib/generator";
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

// ── «Что поесть сейчас»: подсказки + лог в один тап (тикет 10) ────────────────

/** Фильтр усилий из UI-чипсов. */
export type EffortFilter = "quick" | "cook" | "nocook";

/** Порог «быстро», мин — совпадает с временем приёма-перекуса раскладки. */
const QUICK_MAX_TIME_MIN = 15;

/** Чипс усилий → фильтр ядра (время/техника). «готовить» — без ограничений. */
function filtersForEffort(effort: EffortFilter): SuggestFilters {
  if (effort === "quick") return { maxTimeMin: QUICK_MAX_TIME_MIN };
  if (effort === "nocook") return { mustNotCook: true };
  return {};
}

/** Следующий незаполненный приём дня, иначе перекус (как дефолт слота в UI). */
function nextEmptySlot(perSlot: SlotSummary[]): Slot {
  return perSlot.find((s) => s.entries.length === 0)?.slot ?? "snack";
}

/** Остаток «добрать» по 5 нутриентам (из прогресса; знак сохраняется). */
function remainingFrom(progress: DayProgress): DiaryNutrients {
  return {
    kcal: progress.kcal.remaining,
    protein: progress.protein.remaining,
    fat: progress.fat.remaining,
    carb: progress.carb.remaining,
    fiber: progress.fiber.remaining,
  };
}

/** Масштаб нормировки скоринга — дневная цель по каждому нутриенту. */
function scaleFrom(progress: DayProgress): DiaryNutrients {
  return {
    kcal: progress.kcal.target,
    protein: progress.protein.target,
    fat: progress.fat.target,
    carb: progress.carb.target,
    fiber: progress.fiber.target,
  };
}

/** Блок «Что поесть сейчас»: целевой приём + его варианты. */
export interface SuggestionBlock {
  /** Приём, под который подобраны варианты (для лога в один тап). */
  slot: Slot;
  meals: SuggestedMeal[];
}

/**
 * Подсказки «Что поесть сейчас» под остаток текущего приёма дня. Считает остаток
 * из `getDayLog` (+ цель из активной нормы), собирает кандидатов существующим
 * контекстом генерации (`loadSuggestionContext`) и зовёт чистое ядро
 * `suggestNextMeal`. Уже залогированные из подсказок рецепты исключаются
 * (удаление записи вернёт их в блок). Seed детерминирован по (userId|date|slot) —
 * блок стабилен между перезагрузками. Пустой список вариантов — нет активной нормы
 * или пустая база; слот возвращаем всегда (для лога/идемпотентности).
 */
export async function getSuggestions(
  userId: string,
  date: string,
  effort: EffortFilter = "cook",
): Promise<SuggestionBlock> {
  const [day, ctx] = await Promise.all([
    getDayLog(userId, date),
    loadSuggestionContext(userId),
  ]);

  const slot = nextEmptySlot(day.perSlot);
  if (!day.progress || !ctx) return { slot, meals: [] };

  const candidates: SuggestCandidate[] = ctx.candidates.map((c) => ({
    ...c,
    name: ctx.names.get(c.id) ?? "Блюдо",
  }));
  // Уже залогированные из подсказок рецепты — чтобы не предлагать съеденное.
  const excludeRecipeIds = day.entries
    .map((e) => e.suggestedRecipeId)
    .filter((id): id is string => id !== null);

  const meals = suggestNextMeal({
    remaining: remainingFrom(day.progress),
    laggingMacro: day.progress.laggingMacro,
    slot,
    candidates,
    scale: scaleFrom(day.progress),
    filters: filtersForEffort(effort),
    constraints: ctx.constraints,
    preferences: ctx.preferences,
    excludeRecipeIds,
    seed: hashString(`${userId}|${date}|${slot}`),
  });
  return { slot, meals };
}

/** Параметры лога подсказки (тап «съел» по карточке «Что поесть сейчас»). */
export interface LogSuggestionInput {
  /** Локальная дата пользователя, YYYY-MM-DD. */
  date: string;
  slot: Slot;
  /** Рецепт-подсказка (он же refId и пометка происхождения). */
  recipeId: string;
  /** Подобранная ядром порция. */
  portion: number;
  /** Текущий фильтр усилий — для обновлённого блока в ответе. */
  effort?: EffortFilter;
}

/** Ответ лога подсказки: обновлённый день + обновлённый блок подсказок. */
export interface LogSuggestionResult {
  day: DayLogResult;
  suggestions: SuggestionBlock;
}

/**
 * Логирует подсказку в один тап (тикет 10). Идемпотентность: чистый `logDecision`
 * по набору записей дня (ключ date|slot|suggestedRecipeId) решает «создать или
 * no-op», а БД-`@@unique([userId, date, slot, suggestedRecipeId])` — backstop от
 * гонки (повторный тап не создаёт дубль). Снапшот КБЖУ считается из текущих данных
 * рецепта (как у ручного лога). Возвращает свежий день и обновлённый блок.
 */
export async function logSuggestion(
  userId: string,
  input: LogSuggestionInput,
): Promise<LogSuggestionResult> {
  const rows = await prisma.diaryEntry.findMany({
    where: { userId, date: input.date },
  });
  const decision = logDecision({
    existing: rows.map(toEntry),
    date: input.date,
    slot: input.slot,
    suggestedRecipeId: input.recipeId,
  });

  if (decision.create) {
    const food = await getAmountFood("recipe", input.recipeId, userId);
    if (!food) throw new Error("Рецепт не найден или недоступен");
    const { servings, nutrients } = resolveAmount(food, {
      kind: "servings",
      servings: input.portion,
    });
    try {
      await prisma.diaryEntry.create({
        data: {
          userId,
          date: input.date,
          slot: input.slot,
          source: "recipe",
          refId: input.recipeId,
          grams: null,
          servings,
          kcal: nutrients.kcal,
          protein: nutrients.protein,
          fat: nutrients.fat,
          carb: nutrients.carb,
          fiber: nutrients.fiber,
          suggestedRecipeId: input.recipeId,
        },
      });
    } catch (e) {
      // Гонка двойного тапа: уникальный индекс уже поймал дубль — это и есть
      // идемпотентность, не ошибка (как guard двойного списания кладовки).
      if (
        !(e instanceof Prisma.PrismaClientKnownRequestError) ||
        e.code !== "P2002"
      ) {
        throw e;
      }
    }
  }

  const [day, suggestions] = await Promise.all([
    getDayLog(userId, input.date),
    getSuggestions(userId, input.date, input.effort ?? "cook"),
  ]);
  return { day, suggestions };
}

/**
 * Вторичная «пересобрать остаток дня» (тикет 10): свежий набор приёмов под
 * остаток текущего дня. Переиспользует `regenerateDiaryRemainder` (ядро
 * генератора не меняем), передавая ему ТОЧНУЮ сумму съеденного по факту дневника
 * (снапшоты, включая продукты) как consumedBaseline и рецепты лога — чтобы их не
 * повторять. null — нет активной нормы.
 */
export async function regenerateRemainder(
  userId: string,
  date: string,
  seed: number,
): Promise<DisplayDay | null> {
  const day = await getDayLog(userId, date);
  if (!day.progress) return null;

  // День отслеживает 5 нутриентов; натрий генератору не нужен (в подсказках не участвует).
  const consumed: FoodNutrients = { ...day.totals, sodium: 0 };
  const consumedRecipeIds = day.entries
    .filter((e) => e.source === "recipe")
    .map((e) => e.refId);

  return regenerateDiaryRemainder(userId, consumed, consumedRecipeIds, seed);
}
