// Серверный клей генератора дня (тикет 14): читает активную норму и пул рецептов
// из БД, приводит их ко входу чистого ядра /core/generator, собирает день и
// обогащает приёмы данными для UI (название, время). Бизнес-логика подбора —
// в ядре; здесь только доступ к данным и проекция.
import "server-only";
import { prisma } from "@/lib/db";
import { computeRecipeNutrition, type FoodNutrients } from "@/core/nutrition";
import {
  generateDay,
  replaceDish,
  generateWeek,
  regenerateDay,
  regenerateDayRemainder,
  replaceMealInWeek,
  scalePortion,
  sumNutrients,
  hashString,
  recipeKeywords,
  resolvePersonalization,
  productCandidates,
  DEFAULT_DAY_LAYOUT,
  type GeneratorRecipe,
  type CustomProduct,
  type DayTarget,
  type MealSlot,
  type NutrientRanges,
  type GeneratorConstraints,
  type Preferences,
  type PlanItem,
  type GeneratedWeek,
  type Slot,
  type Allergen,
} from "@/core/generator";
import { loadPreferences, type LoadedPreferences } from "@/lib/preferences";
import { pantryStockIdsForUser } from "@/lib/pantry";
import { per100ToNutrients, toRecipeComponents } from "@/lib/foodNutrients";

/** Приём дня, готовый к показу: КБЖУ + название и время рецепта. */
export interface DayMeal {
  slot: Slot;
  recipeId: string;
  name: string;
  timeMin: number;
  portion: number;
  nutrients: FoodNutrients;
  /**
   * Что за приём: рецепт или кастом-продукт (recurring). Нужно дневнику (тикет 09):
   * «съел» по рецепту списывает кладовку, по продукту — нет; у продукта нет «заменить».
   */
  source: "recipe" | "ingredient";
}

/** Собранный день для UI: приёмы, сумма за день и цель, под которую собирали. */
export interface DisplayDay {
  meals: DayMeal[];
  totals: FoodNutrients;
  target: DayTarget;
}

/** Минимум для пересборки дня на сервере (не доверяем КБЖУ с клиента). */
export interface MealRef {
  slot: Slot;
  recipeId: string;
  portion: number;
}

/** Один день недели для UI: приёмы + сумма КБЖУ за день. */
export interface DisplayWeekDay {
  meals: DayMeal[];
  totals: FoodNutrients;
}

/** Собранная неделя для UI: дни, недельное среднее, диапазоны, флаг компромисса. */
export interface DisplayWeek {
  days: DisplayWeekDay[];
  weeklyAverage: FoodNutrients;
  ranges: NutrientRanges;
  dayTarget: DayTarget;
  /** true — средние не удалось загнать в диапазоны (честный компромисс). */
  compromised: boolean;
}

type NormRecord = {
  kcalMin: number;
  kcalMax: number;
  proteinMin: number;
  proteinMax: number;
  fatMin: number;
  fatMax: number;
  carbMin: number;
  carbMax: number;
  fiberMin: number;
};

const mid = (a: number, b: number) => Math.round((a + b) / 2);

/** Цель дня из нормы: середины диапазонов КБЖУ, клетчатка — минимум нормы. */
export function dayTargetFromNorm(norm: NormRecord): DayTarget {
  return {
    kcal: mid(norm.kcalMin, norm.kcalMax),
    protein: mid(norm.proteinMin, norm.proteinMax),
    fat: mid(norm.fatMin, norm.fatMax),
    carb: mid(norm.carbMin, norm.carbMax),
    fiber: norm.fiberMin,
  };
}

/** Диапазоны недельного среднего из нормы (тикет 15): те же min/max, что в норме. */
export function nutrientRangesFromNorm(norm: NormRecord): NutrientRanges {
  return {
    kcalMin: norm.kcalMin,
    kcalMax: norm.kcalMax,
    proteinMin: norm.proteinMin,
    proteinMax: norm.proteinMax,
    fatMin: norm.fatMin,
    fatMax: norm.fatMax,
    carbMin: norm.carbMin,
    carbMax: norm.carbMax,
    fiberMin: norm.fiberMin,
  };
}

interface RecipeMeta {
  name: string;
  timeMin: number;
  source: "recipe" | "ingredient";
}

interface RecipePool {
  /**
   * Кандидаты-рецепты (база + свои), персонализация уже применена: базовый
   * рецепт вытеснен своей версией (тикет 17). Кастом-ПРОДУКТЫ сюда не входят —
   * генератор сам их не берёт; они добавляются только как recurring в
   * `poolForGeneration`.
   */
  recipes: GeneratorRecipe[];
  /** Кастом-продукты пользователя — для recurring-подмешивания в пул. */
  customProducts: CustomProduct[];
  meta: Map<string, RecipeMeta>;
  byId: Map<string, GeneratorRecipe>;
}

/**
 * Пул кандидатов генератора: базовые рецепты (ownerUserId = null) + свои рецепты
 * пользователя (кастом-рецепты и персонализации). Приводит состав к КБЖУ порции
 * (ядром nutrition), собирает аллергены, слоты, технику и время. Персонализация
 * применяется здесь (`resolvePersonalization`): своя версия вытесняет базовый
 * рецепт из кандидатов. Кастом-продукты грузятся отдельно (генератор сам их не
 * берёт) и подмешиваются как recurring в `poolForGeneration`.
 */
async function loadRecipePool(userId: string): Promise<RecipePool> {
  const [rows, productRows] = await Promise.all([
    prisma.recipe.findMany({
      where: { OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
      include: {
        ingredients: { include: { ingredient: { include: { allergens: true } } } },
        slots: true,
        equipment: true,
      },
    }),
    prisma.ingredient.findMany({
      where: { isCustom: true, ownerUserId: userId },
      include: { allergens: true },
    }),
  ]);

  const merged: GeneratorRecipe[] = [];
  const meta = new Map<string, RecipeMeta>();
  const byId = new Map<string, GeneratorRecipe>();

  for (const r of rows) {
    const { perServing } = computeRecipeNutrition(
      toRecipeComponents(r.ingredients),
      r.servings,
    );
    const allergens = [
      ...new Set(
        r.ingredients.flatMap((ri) => ri.ingredient.allergens.map((a) => a.allergen)),
      ),
    ] as Allergen[];

    // Ключевые слова для keyword-фильтра (тикет 16): название + названия
    // ингредиентов + группы продуктов. Синонимы разворачиваются на входе фильтра.
    const keywords = recipeKeywords(
      r.name,
      r.ingredients.map((ri) => ri.ingredient.name),
      r.ingredients.map((ri) => ri.ingredient.group),
    );

    const gr: GeneratorRecipe = {
      id: r.id,
      slots: r.slots.map((s) => s.slot) as Slot[],
      timeMin: r.timeMin,
      equipment: r.equipment.map((e) => e.equipment) as GeneratorRecipe["equipment"],
      allergens,
      perServing,
      keywords,
      // Ингредиенты — для бонуса кладовки (тикет 19): чем больше продуктов уже
      // дома, тем сильнее нудж к блюду.
      ingredientIds: r.ingredients.map((ri) => ri.ingredientId),
      // Персонализация базового рецепта (тикет 17): baseRecipeId → вытеснение.
      ...(r.baseRecipeId ? { baseRecipeId: r.baseRecipeId } : {}),
    };
    merged.push(gr);
    byId.set(r.id, gr);
    meta.set(r.id, { name: r.name, timeMin: r.timeMin, source: "recipe" });
  }

  // Своя версия вытесняет базовый рецепт из кандидатов (тикет 17).
  const recipes = resolvePersonalization(merged);

  // Кастом-продукты: кандидаты для recurring-подмешивания. В byId/meta кладём их
  // тоже (все), чтобы восстановление плана и показ по id работали, даже если
  // конкретный продукт попал в план как recurring.
  const customProducts: CustomProduct[] = productRows.map((p) => ({
    id: p.id,
    perServing: per100ToNutrients(p),
    allergens: p.allergens.map((a) => a.allergen) as Allergen[],
    keywords: recipeKeywords(p.name, [p.name], [p.group]),
  }));
  for (const pc of productCandidates(customProducts, customProducts.map((p) => p.id))) {
    byId.set(pc.id, pc);
  }
  for (const p of productRows)
    meta.set(p.id, { name: p.name, timeMin: 0, source: "ingredient" });

  return { recipes, customProducts, meta, byId };
}

/** id всех recurring-предпочтений (often ∪ always) — включая кастом-продукты. */
function recurringIds(prefs: LoadedPreferences): string[] {
  return [
    ...(prefs.preferences.recurringOftenIds ?? []),
    ...(prefs.preferences.recurringAlwaysIds ?? []),
  ];
}

/**
 * Финальный пул для генерации: рецепты (база + свои, персонализация применена)
 * плюс кастом-продукты, отмеченные recurring. Не-recurring продукты не попадают —
 * «генератор сам их не берёт» (тикет 17).
 */
function poolForGeneration(pool: RecipePool, prefs: LoadedPreferences): GeneratorRecipe[] {
  return [...pool.recipes, ...productCandidates(pool.customProducts, recurringIds(prefs))];
}

/** Обогащает приём ядра (PlanItem) данными для показа. */
function toDayMeal(item: PlanItem, meta: Map<string, RecipeMeta>): DayMeal {
  const m = meta.get(item.recipeId);
  return {
    slot: item.slot,
    recipeId: item.recipeId,
    name: m?.name ?? "Блюдо",
    timeMin: m?.timeMin ?? 0,
    portion: item.portion,
    nutrients: item.nutrients,
    source: m?.source ?? "recipe",
  };
}

/**
 * Аллергены пользователя, которые генератор обязан исключать. Персональных
 * аллергенов ещё нет в схеме (свой тикет) — пока пусто. Ядро уже умеет их
 * отсекать и покрыто тестами «на утечки».
 */
function excludedAllergensFor(_userId: string): Allergen[] {
  return [];
}

/** Жёсткие ограничения генератора из аллергенов + предпочтений (блок/keyword). */
function constraintsFrom(
  userId: string,
  prefs: LoadedPreferences,
): GeneratorConstraints {
  return {
    excludedAllergens: excludedAllergensFor(userId),
    blockedRecipeIds: prefs.blockedRecipeIds,
    keywordFilter: prefs.keywordFilter,
  };
}

/** Раскладка дня с режимом «только recurring» для настроенных слотов (тикет 16). */
function layoutFor(onlyRecurringSlots: Set<Slot>): MealSlot[] {
  if (onlyRecurringSlots.size === 0) return DEFAULT_DAY_LAYOUT;
  return DEFAULT_DAY_LAYOUT.map((s) =>
    onlyRecurringSlots.has(s.slot) ? { ...s, onlyRecurring: true } : s,
  );
}

/** Собирает день под норму пользователя. null — если норма ещё не рассчитана. */
export async function buildDay(
  userId: string,
  seed: number,
): Promise<DisplayDay | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const [pool, prefs, pantryStockIds] = await Promise.all([
    loadRecipePool(userId),
    loadPreferences(userId),
    pantryStockIdsForUser(userId),
  ]);
  const target = dayTargetFromNorm(norm);

  const day = generateDay({
    recipes: poolForGeneration(pool, prefs),
    slots: layoutFor(prefs.onlyRecurringSlots),
    target,
    constraints: constraintsFrom(userId, prefs),
    preferences: prefs.preferences,
    pantryStockIds,
    seed,
  });

  return {
    meals: day.items.map((it) => toDayMeal(it, pool.meta)),
    totals: day.totals,
    target,
  };
}

/**
 * Предложенный план дня для Дневника (тикет 09). План не персистится, но должен
 * быть СТАБИЛЕН между перезагрузками одного дня, иначе связка «предложение ↔
 * запись» (suggestedRecipeId) рвётся и съеденный приём из `eaten` стал бы `extra`.
 * Поэтому seed детерминирован по (userId|date) — тот же день каждый раз. Замена/
 * удаление/перегенерация остатка живут в состоянии клиента (как на /home), при
 * перезагрузке лента возвращается к этому плану, а съеденное берётся из записей.
 */
export async function buildDayForDate(
  userId: string,
  date: string,
): Promise<DisplayDay | null> {
  return buildDay(userId, hashString(`${userId}|${date}`));
}

/**
 * Заменяет блюдо в одном приёме под остаток дня. КБЖУ прочих приёмов пересчитываем
 * из (recipeId, portion) на сервере — клиенту в этой части не доверяем. Возвращает
 * новый приём или null (нет активной нормы либо кандидатов на замену).
 */
export async function replaceMeal(
  userId: string,
  current: MealRef[],
  slot: Slot,
  seed: number,
): Promise<DayMeal | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const [pool, prefs, pantryStockIds] = await Promise.all([
    loadRecipePool(userId),
    loadPreferences(userId),
    pantryStockIdsForUser(userId),
  ]);
  const target = dayTargetFromNorm(norm);

  // Восстанавливаем PlanItem'ы с КБЖУ из пула (не с клиента); неизвестные id
  // отбрасываем.
  const items = rebuildItems(current, pool.byId);

  const replaced = replaceDish({
    recipes: poolForGeneration(pool, prefs),
    slots: layoutFor(prefs.onlyRecurringSlots),
    target,
    constraints: constraintsFrom(userId, prefs),
    preferences: prefs.preferences,
    pantryStockIds,
    seed,
    current: items,
    slot,
  });
  if (!replaced) return null;
  return toDayMeal(replaced, pool.meta);
}

/** Приём раскладки с флагом «съеден» — вход перегенерации остатка (тикет 20). */
export interface LayoutMealRef extends MealRef {
  /** Съеден: слот фиксируется, списание кладовки уже применено. */
  eaten: boolean;
}

/** Добавленный из поиска приём (всегда съеден) — вне раскладки. */
export interface ExtraMealRef {
  recipeId: string;
  portion: number;
  people?: number;
}

/**
 * Перегенерирует несъеденные приёмы дня под ОСТАТОЧНЫЕ цели (тикет 20): съеденные
 * приёмы раскладки фиксируются, съеденное вне раскладки (из поиска) входит в
 * остаток как уже потреблённое (baseline) и не повторяется. Возвращает приёмы
 * раскладки (съеденные — без изменений, прочие — свежие) для показа; клиент
 * до-мёржит свои дополнительные приёмы и пересчитывает сумму. null — нет нормы.
 * КБЖУ восстанавливаем из пула (не с клиента).
 */
export async function regenerateDayRemainderForUser(
  userId: string,
  layout: LayoutMealRef[],
  extras: ExtraMealRef[],
  seed: number,
): Promise<DisplayDay | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const [pool, prefs, pantryStockIds] = await Promise.all([
    loadRecipePool(userId),
    loadPreferences(userId),
    pantryStockIdsForUser(userId),
  ]);
  const target = dayTargetFromNorm(norm);

  const current = rebuildItems(layout, pool.byId);
  const lockedSlots = layout.filter((m) => m.eaten).map((m) => m.slot);

  // Съеденное вне раскладки: КБЖУ как baseline остатка + рецепты, чтобы не повторять.
  const extraItems = rebuildItems(
    extras.map((e) => ({ slot: "snack" as Slot, recipeId: e.recipeId, portion: e.portion })),
    pool.byId,
  );
  const consumedBaseline = sumNutrients(extraItems);
  const consumedRecipeIds = extraItems.map((it) => it.recipeId);

  const day = regenerateDayRemainder({
    recipes: poolForGeneration(pool, prefs),
    slots: layoutFor(prefs.onlyRecurringSlots),
    target,
    constraints: constraintsFrom(userId, prefs),
    preferences: prefs.preferences,
    pantryStockIds,
    seed,
    current,
    lockedSlots,
    consumedBaseline,
    consumedRecipeIds,
  });

  return {
    meals: day.items.map((it) => toDayMeal(it, pool.meta)),
    totals: day.totals,
    target,
  };
}

// ── Контекст подсказок «Что поесть сейчас» (тикет 10) ────────────────────────

/** Готовый контекст для движка подсказок дневника (кандидаты + ограничения + цель). */
export interface SuggestionContext {
  /** Кандидаты генерации (база + свои, персонализация применена, recurring-продукты). */
  candidates: GeneratorRecipe[];
  /** Имена рецептов/продуктов по id — для карточек подсказок. */
  names: Map<string, string>;
  constraints: GeneratorConstraints;
  preferences: Preferences;
  /** Дневная цель (середины нормы) — и остаток, и масштаб скоринга. */
  target: DayTarget;
}

/**
 * Загружает контекст для подсказок дневника (тикет 10): тот же пул кандидатов и
 * ограничения, что и у генератора (переиспуем `loadRecipePool`/`poolForGeneration`/
 * `loadPreferences`/`constraintsFrom`). null — нет активной нормы (остаток считать
 * не от чего, UI показывает «заполни профиль»).
 */
export async function loadSuggestionContext(
  userId: string,
): Promise<SuggestionContext | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const [pool, prefs] = await Promise.all([
    loadRecipePool(userId),
    loadPreferences(userId),
  ]);

  const names = new Map<string, string>(
    [...pool.meta].map(([id, m]) => [id, m.name]),
  );

  // Кандидаты подсказок — только РЕЦЕПТЫ (pool.recipes, персонализация уже
  // применена), не poolForGeneration: тот подмешивает recurring кастом-ПРОДУКТЫ
  // (id ингредиента), а у продукта нет карточки рецепта («показать рецепт») и
  // пути лога в один тап (logSuggestion пишет source=recipe). Бонусы избранного/
  // recurring для рецептов сохраняются — они применяются в скоринге по preferences.
  return {
    candidates: pool.recipes,
    names,
    constraints: constraintsFrom(userId, prefs),
    preferences: prefs.preferences,
    target: dayTargetFromNorm(norm),
  };
}

/** Плейсхолдер-слот при перегенерации остатка дневника (см. ниже). */
const DIARY_PLACEHOLDER_ID = "__diary_remainder_placeholder__";

/**
 * Свежий план ОСТАТКА дня для дневника (тикет 10, вторичная «пересобрать остаток
 * дня»). Переиспользует ядро `regenerateDayRemainder` — НОВОЙ логики генерации не
 * пишем: съеденное по факту дневника входит как `consumedBaseline` (точная сумма
 * снапшотов, включая продукты), уже залогированные рецепты не повторяются, а слоты
 * не залочены (в дневнике «плана» нет — все приёмы предлагаются свежими под
 * остаточную цель). Плейсхолдер-приёмы нужны лишь чтобы ядро заполнило каждый слот;
 * их содержимое для незалоченных слотов не используется, а слоты без кандидата
 * (ядро вернуло плейсхолдер) отфильтровываются. null — нет активной нормы.
 */
export async function regenerateDiaryRemainder(
  userId: string,
  consumed: FoodNutrients,
  consumedRecipeIds: string[],
  seed: number,
): Promise<DisplayDay | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const [pool, prefs, pantryStockIds] = await Promise.all([
    loadRecipePool(userId),
    loadPreferences(userId),
    pantryStockIdsForUser(userId),
  ]);
  const target = dayTargetFromNorm(norm);
  const slots = layoutFor(prefs.onlyRecurringSlots);

  const current: PlanItem[] = slots.map((s) => ({
    slot: s.slot,
    recipeId: DIARY_PLACEHOLDER_ID,
    portion: 1,
    nutrients: sumNutrients([]),
  }));

  const day = regenerateDayRemainder({
    recipes: poolForGeneration(pool, prefs),
    slots,
    target,
    constraints: constraintsFrom(userId, prefs),
    preferences: prefs.preferences,
    pantryStockIds,
    seed,
    current,
    lockedSlots: [],
    consumedBaseline: consumed,
    consumedRecipeIds,
  });

  const meals = day.items
    .filter((it) => it.recipeId !== DIARY_PLACEHOLDER_ID)
    .map((it) => toDayMeal(it, pool.meta));
  return { meals, totals: sumNutrients(meals), target };
}

// ── Уровень недели (тикет 15) ────────────────────────────────────────────────

const WEEK_DAYS = 7;

/** Восстанавливает PlanItem'ы из клиентских ссылок с КБЖУ из пула (не с клиента). */
function rebuildItems(
  refs: MealRef[],
  byId: Map<string, GeneratorRecipe>,
): PlanItem[] {
  return refs
    .map((ref) => {
      const gr = byId.get(ref.recipeId);
      if (!gr) return null;
      return {
        slot: ref.slot,
        recipeId: ref.recipeId,
        portion: ref.portion,
        nutrients: scalePortion(gr.perServing, ref.portion),
      } satisfies PlanItem;
    })
    .filter((x): x is PlanItem => x !== null);
}

/** Проекция собранной недели ядра в форму для UI. */
function toDisplayWeek(
  week: GeneratedWeek,
  meta: Map<string, RecipeMeta>,
  dayTarget: DayTarget,
): DisplayWeek {
  return {
    days: week.days.map((d) => ({
      meals: d.items.map((it) => toDayMeal(it, meta)),
      totals: d.totals,
    })),
    weeklyAverage: week.weeklyAverage,
    ranges: week.ranges,
    dayTarget,
    compromised: week.compromised,
  };
}

/** Активная норма пользователя или null. */
export async function activeNorm(userId: string) {
  return prisma.nutritionProfile.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Стабильный seed недели пользователя (userId + дата + "week"): экран недели,
 * список покупок и любой другой потребитель берут ОДНУ И ТУ ЖЕ неделю. Seed не
 * меняется при перезагрузках — перегенерация только явной кнопкой. Дата берётся
 * в UTC (ISO), как исторически на бывшей «Меню», чтобы неделя совпадала у всех
 * потребителей.
 */
export function currentWeekSeed(userId: string): number {
  const dateKey = new Date().toISOString().slice(0, 10);
  return hashString(userId + dateKey + "week");
}

/** Собирает неделю под норму пользователя. null — если норма ещё не рассчитана. */
export async function buildWeek(
  userId: string,
  seed: number,
): Promise<DisplayWeek | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const [pool, prefs, pantryStockIds] = await Promise.all([
    loadRecipePool(userId),
    loadPreferences(userId),
    pantryStockIdsForUser(userId),
  ]);
  const dayTarget = dayTargetFromNorm(norm);

  const week = generateWeek({
    recipes: poolForGeneration(pool, prefs),
    slots: layoutFor(prefs.onlyRecurringSlots),
    days: WEEK_DAYS,
    ranges: nutrientRangesFromNorm(norm),
    dayTarget,
    constraints: constraintsFrom(userId, prefs),
    preferences: prefs.preferences,
    pantryStockIds,
    seed,
  });

  return toDisplayWeek(week, pool.meta, dayTarget);
}

/**
 * Перегенерация одного дня недели под остаток целей (недельное среднее держится
 * в диапазонах, прочие дни не трогаются). КБЖУ прочих дней пересчитываем из
 * (recipeId, portion) на сервере — клиенту не доверяем.
 */
export async function regenerateWeekDay(
  userId: string,
  current: MealRef[][],
  dayIndex: number,
  seed: number,
): Promise<DisplayWeek | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const [pool, prefs, pantryStockIds] = await Promise.all([
    loadRecipePool(userId),
    loadPreferences(userId),
    pantryStockIdsForUser(userId),
  ]);
  const dayTarget = dayTargetFromNorm(norm);
  const days = current.map((refs) => rebuildItems(refs, pool.byId));

  const week = regenerateDay({
    recipes: poolForGeneration(pool, prefs),
    slots: layoutFor(prefs.onlyRecurringSlots),
    days: WEEK_DAYS,
    ranges: nutrientRangesFromNorm(norm),
    dayTarget,
    constraints: constraintsFrom(userId, prefs),
    preferences: prefs.preferences,
    pantryStockIds,
    seed,
    current: days,
    dayIndex,
  });

  return toDisplayWeek(week, pool.meta, dayTarget);
}

/**
 * Замена одного приёма (блюда) в конкретном дне недели под остаток дня. Возвращает
 * всю пересобранную неделю или null (нет нормы/кандидатов).
 */
export async function replaceWeekMeal(
  userId: string,
  current: MealRef[][],
  dayIndex: number,
  slot: Slot,
  seed: number,
): Promise<DisplayWeek | null> {
  const norm = await activeNorm(userId);
  if (!norm) return null;

  const [pool, prefs, pantryStockIds] = await Promise.all([
    loadRecipePool(userId),
    loadPreferences(userId),
    pantryStockIdsForUser(userId),
  ]);
  const dayTarget = dayTargetFromNorm(norm);
  const days = current.map((refs) => rebuildItems(refs, pool.byId));

  const week = replaceMealInWeek({
    recipes: poolForGeneration(pool, prefs),
    slots: layoutFor(prefs.onlyRecurringSlots),
    days: WEEK_DAYS,
    ranges: nutrientRangesFromNorm(norm),
    dayTarget,
    constraints: constraintsFrom(userId, prefs),
    preferences: prefs.preferences,
    pantryStockIds,
    seed,
    current: days,
    dayIndex,
    slot,
  });
  if (!week) return null;

  return toDisplayWeek(week, pool.meta, dayTarget);
}
