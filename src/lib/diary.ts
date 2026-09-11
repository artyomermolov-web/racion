// Серверный клей дневника (тикет 08): один индексный запрос записей дня +
// агрегация/прогресс в чистом ядре /core/diary. Тонкий слой без своего теста
// (spec.md, Testing Decisions) — как src/lib/track.ts делегирует в /core/pantry.
import "server-only";
import { Prisma, type DiaryEntry as DiaryEntryRow } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  summarize,
  nextEmptySlot,
  remaining,
  resolveAmount,
  suggestNextMeal,
  logDecision,
  recentRefs,
  frequentIngredientRefs,
  favoriteRefs,
  type DiaryEntry,
  type DiarySource,
  type DayProgress,
  type SlotSummary,
  type DiaryNutrients,
  type LoggedAmount,
  type SuggestedMeal,
  type SuggestCandidate,
  type SuggestFilters,
  type SegmentRef,
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
import { markMealEaten, unmarkMealEaten } from "@/lib/track";

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
  /**
   * Пустой список — по причине «нечего предложить в принципе» (пустая база
   * рецептов или всё отсеяно жёсткими ограничениями), а не текущим фильтром
   * усилий. Разводит два честных текста в UI (тикет 12): «наполните базу /
   * ослабьте ограничения» vs «смените чипсы усилий». При непустом `meals` —
   * всегда false.
   */
  baseEmpty: boolean;
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
  // Защитный инвариант: без активной нормы остаток считать не от чего. UI сюда не
  // доходит — блок подсказок монтируется только при `data.progress` (DiaryScreen),
  // а «заполни профиль» показывает родитель (US 36). `baseEmpty: true` здесь —
  // просто «предлагать нечего», не путь для честного текста про базу.
  if (!day.progress || !ctx) return { slot, meals: [], baseEmpty: true };

  const candidates: SuggestCandidate[] = ctx.candidates.map((c) => ({
    ...c,
    name: ctx.names.get(c.id) ?? "Блюдо",
  }));
  // Уже залогированные из подсказок рецепты — чтобы не предлагать съеденное.
  const excludeRecipeIds = day.entries
    .map((e) => e.suggestedRecipeId)
    .filter((id): id is string => id !== null);

  const base = {
    remaining: remainingFrom(day.progress),
    laggingMacro: day.progress.laggingMacro,
    slot,
    candidates,
    scale: scaleFrom(day.progress),
    constraints: ctx.constraints,
    preferences: ctx.preferences,
    excludeRecipeIds,
    seed: hashString(`${userId}|${date}|${slot}`),
  };

  const meals = suggestNextMeal({ ...base, filters: filtersForEffort(effort) });
  // Пусто под текущим фильтром — проверяем, есть ли вообще что предложить без
  // фильтра усилий. Если и без него пусто → база пуста или всё под жёсткими
  // ограничениями (честный текст), иначе — лишь фильтр усилий ничего не оставил.
  const baseEmpty =
    meals.length === 0 &&
    suggestNextMeal({ ...base, filters: {}, limit: 1 }).length === 0;

  return { slot, meals, baseEmpty };
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
}

/**
 * Логирует подсказку в один тап (тикет 10). Идемпотентность: чистый `logDecision`
 * по набору записей дня (ключ date|slot|suggestedRecipeId) решает «создать или
 * no-op», а БД-`@@unique([userId, date, slot, suggestedRecipeId])` — backstop от
 * гонки (повторный тап не создаёт дубль). Снапшот КБЖУ считается из текущих данных
 * рецепта (как у ручного лога). Возвращает свежий день; блок подсказок клиент
 * перезапрашивает сам по сдвигу остатка (refreshToken), поэтому здесь его не
 * считаем — это была лишняя серверная работа на каждый тап.
 */
export async function logSuggestion(
  userId: string,
  input: LogSuggestionInput,
): Promise<DayLogResult> {
  await logFoodOnce(userId, {
    date: input.date,
    slot: input.slot,
    source: "recipe",
    refId: input.recipeId,
    amount: { kind: "servings", servings: input.portion },
  });
  return getDayLog(userId, input.date);
}

/** Параметры идемпотентного лога предложения/подсказки (общий скелет). */
interface LogFoodOnceInput {
  date: string;
  slot: Slot;
  source: DiarySource;
  /** Recipe.id / Ingredient.id — он же пометка происхождения `suggestedRecipeId`. */
  refId: string;
  amount: LoggedAmount;
}

/**
 * Идемпотентно создаёт запись дневника из предложения/подсказки (общий код лога в
 * один тап для `logSuggestion` и `eatPlanMeal`). Ключ идемпотентности —
 * date|slot|suggestedRecipeId=refId: чистый `logDecision` решает «создать или
 * no-op», а БД-`@@unique([userId,date,slot,suggestedRecipeId])` — backstop от гонки
 * (повторный тап → P2002, не ошибка). Снапшот КБЖУ — из текущих данных еды (рецепт
 * → порции, продукт → граммы). Возвращает true, если запись создана в этом вызове.
 */
async function logFoodOnce(
  userId: string,
  input: LogFoodOnceInput,
): Promise<boolean> {
  const rows = await prisma.diaryEntry.findMany({
    where: { userId, date: input.date },
  });
  const decision = logDecision({
    existing: rows.map(toEntry),
    date: input.date,
    slot: input.slot,
    suggestedRecipeId: input.refId,
  });
  if (!decision.create) return false;

  const food = await getAmountFood(input.source, input.refId, userId);
  if (!food) throw new Error("Еда не найдена или недоступна");
  const { grams, servings, nutrients } = resolveAmount(food, input.amount);
  try {
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
        suggestedRecipeId: input.refId,
      },
    });
    return true;
  } catch (e) {
    // Гонка двойного тапа: уникальный индекс уже поймал дубль — это и есть
    // идемпотентность, не ошибка (как guard двойного списания кладовки).
    if (
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== "P2002"
    ) {
      throw e;
    }
    return false;
  }
}

// ── Единая лента: слияние двух «съел» (тикет 09, spec решение 01) ────────────

/** Параметры тапа «съел» по предложенному приёму ленты дня. */
export interface EatPlanMealInput {
  /** Локальная дата пользователя, YYYY-MM-DD. */
  date: string;
  slot: Slot;
  /** Рецепт или кастом-продукт приёма. */
  source: DiarySource;
  /** Recipe.id (source=recipe) или Ingredient.id (source=ingredient). */
  refId: string;
  /** Порция приёма: порции рецепта или кратность 100 г для продукта. */
  portion: number;
  /** Стабильный ключ приёма для идемпотентного списания кладовки (lib/mealKey). */
  mealKey: string;
}

/** Результат «съел»: обновлённый день + флаг «кладовки не хватило» (для рецепта). */
export interface EatPlanMealResult {
  day: DayLogResult;
  /** true — запас не покрыл потребность; списали что было (spec US 29). */
  shortfall: boolean;
}

/**
 * Тап «съел» по предложенному приёму — две ортогональные стороны одной операции
 * (spec решение 01): (1) запись `DiaryEntry` (питание/остаток дня) и (2) списание
 * кладовки `markMealEaten` (только рецепт — у продукта нет состава). Идемпотентность
 * обеих держат существующие уникальные индексы: `DiaryEntry(userId,date,slot,
 * suggestedRecipeId)` и `MealWriteOff(userId,mealKey)` — повторный тап не задваивает
 * ни запись, ни списание. Снапшот КБЖУ — из текущих данных еды (как ручной лог):
 * рецепт → `portion` порций, продукт → `portion`×100 г. `suggestedRecipeId=refId`
 * связывает запись с предложением, чтобы лента показала приём как `eaten`.
 */
export async function eatPlanMeal(
  userId: string,
  input: EatPlanMealInput,
): Promise<EatPlanMealResult> {
  // Сторона питания: идемпотентная запись `DiaryEntry`. Количество зависит от вида
  // еды — рецепт в порциях, продукт в граммах (порция продукта = кратность 100 г).
  const amount: LoggedAmount =
    input.source === "recipe"
      ? { kind: "servings", servings: input.portion }
      : { kind: "grams", grams: input.portion * 100 };
  await logFoodOnce(userId, {
    date: input.date,
    slot: input.slot,
    source: input.source,
    refId: input.refId,
    amount,
  });

  // Сторона кладовки: списываем только под рецепт (у продукта нет состава).
  // markMealEaten идемпотентен по mealKey — повторный тап не вычитает лоты дважды.
  let shortfall = false;
  if (input.source === "recipe") {
    const res = await markMealEaten(userId, {
      key: input.mealKey,
      recipeId: input.refId,
      portion: input.portion,
    });
    shortfall = Object.keys(res.shortfall).length > 0;
  }

  return { day: await getDayLog(userId, input.date), shortfall };
}

/** Параметры снятия «съел» по приёму ленты (обратимо: запись + возврат лотов). */
export interface UneatPlanMealInput {
  date: string;
  slot: Slot;
  /** Происхождение записи (оно же refId предложения). */
  suggestedRecipeId: string;
  /** Ключ приёма для возврата лотов (должен совпадать с ключом списания). */
  mealKey: string;
  source: DiarySource;
}

/**
 * Снятие «съел» по предложенному приёму — зеркало `eatPlanMeal`: удаляет запись
 * `DiaryEntry` (по связке date|slot|suggestedRecipeId) и возвращает списанную
 * кладовку `unmarkMealEaten` (только рецепт). Нет записи/списания по ключу → no-op
 * на соответствующей стороне. Возвращает обновлённый день.
 */
export async function uneatPlanMeal(
  userId: string,
  input: UneatPlanMealInput,
): Promise<DayLogResult> {
  const row = await prisma.diaryEntry.findFirst({
    where: {
      userId,
      date: input.date,
      slot: input.slot,
      suggestedRecipeId: input.suggestedRecipeId,
    },
  });
  if (row) await prisma.diaryEntry.delete({ where: { id: row.id } });
  if (input.source === "recipe") await unmarkMealEaten(userId, input.mealKey);
  return getDayLog(userId, input.date);
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

// ── Сегменты потока добавления: Недавнее / Избранное / Своё (тикет 11) ─────────

/** Окно последних записей для агрегатов Недавнего/частых (ограничение выборки). */
const SEGMENT_SCAN = 500;

/**
 * Ссылки сегментов шита добавления (кроме Поиска — он работает по уже загруженной
 * базе еды). Возвращаем именно ссылки (source+refId): имя/КБЖУ/пометку «Своё» UI
 * берёт из уже загруженных продуктов/рецептов (getIngredients/getRecipes), снапшот
 * дубля данных не нужен. Упорядочивание (новизна/частота) — в чистом ядре.
 * - Недавнее: уникальная залогированная еда, свежая первой.
 * - Избранное: избранные рецепты (FavoriteRecipe) + частые продукты из лога.
 * - Своё: кастом-еда пользователя (isCustom+ownerUserId), свежая первой.
 */
export interface LogSegments {
  recent: SegmentRef[];
  favorites: SegmentRef[];
  own: SegmentRef[];
}

export async function getLogSegments(userId: string): Promise<LogSegments> {
  const [entries, favorites, ownIngredients, ownRecipes] = await Promise.all([
    prisma.diaryEntry.findMany({
      where: { userId },
      select: { source: true, refId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: SEGMENT_SCAN,
    }),
    prisma.favoriteRecipe.findMany({
      where: { userId },
      select: { recipeId: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ingredient.findMany({
      where: { isCustom: true, ownerUserId: userId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.recipe.findMany({
      where: { isCustom: true, ownerUserId: userId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const logged = entries.map((e) => ({
    source: e.source as DiarySource,
    refId: e.refId,
    at: e.createdAt.getTime(),
  }));

  const recent = recentRefs(logged);
  const frequentProducts = frequentIngredientRefs(logged);
  const favoriteList = favoriteRefs(
    favorites.map((f) => f.recipeId),
    frequentProducts,
  );
  // Кастом-рецепты перед кастом-продуктами; внутри — свежие первыми (orderBy выше).
  const own: SegmentRef[] = [
    ...ownRecipes.map((r) => ({ source: "recipe" as const, refId: r.id })),
    ...ownIngredients.map((i) => ({
      source: "ingredient" as const,
      refId: i.id,
    })),
  ];

  return { recent, favorites: favoriteList, own };
}
