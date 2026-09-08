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
  replaceMealInWeek,
  scalePortion,
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
    meta.set(r.id, { name: r.name, timeMin: r.timeMin });
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
  for (const p of productRows) meta.set(p.id, { name: p.name, timeMin: 0 });

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
async function activeNorm(userId: string) {
  return prisma.nutritionProfile.findFirst({
    where: { userId, isActive: true },
    orderBy: { createdAt: "desc" },
  });
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
