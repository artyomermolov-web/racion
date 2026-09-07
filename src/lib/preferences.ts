// Серверный клей вкусов и предпочтений (тикет 16): чтение предпочтений
// пользователя из БД и приведение их ко входу чистого ядра /core/generator
// (Preferences + жёсткие ограничения блок/keyword + режим слота «только
// recurring»). Разворачивание синонимов keyword-фильтра — ядром keywords.ts.
import "server-only";
import { prisma } from "@/lib/db";
import { expandFilterTerms } from "@/core/generator";
import type { Preferences, Slot } from "@/core/generator";

export type RecurringFrequency = "often" | "always";

const RECURRING_FREQUENCIES: RecurringFrequency[] = ["often", "always"];

/**
 * Ставит/снимает recurring по строковому id — тумблер (повтор того же режима
 * снимает). Общая точка для рецептов (карточка блюда) и кастом-продуктов (тикет
 * 17): в схеме recurring живёт в одной таблице по строковому id без FK. При
 * `unblock` установка снимает блок (взаимоисключение для рецептов; продукты блок
 * не используют). Возвращает новый режим. Ревалидацию/проверку прав делает
 * вызывающий — здесь только запись.
 */
export async function applyRecurring(
  userId: string,
  id: string,
  frequency: RecurringFrequency | null,
  opts: { unblock?: boolean } = {},
): Promise<RecurringFrequency | null> {
  if (frequency !== null && !RECURRING_FREQUENCIES.includes(frequency)) {
    throw new Error(`Недопустимая частота recurring: ${frequency}`);
  }
  const current = await prisma.recurringRecipe.findUnique({
    where: { userId_recipeId: { userId, recipeId: id } },
    select: { frequency: true },
  });
  // Повторный клик по текущему режиму снимает recurring.
  const target = current?.frequency === frequency ? null : frequency;

  if (target === null) {
    await prisma.recurringRecipe.deleteMany({ where: { userId, recipeId: id } });
    return null;
  }
  const upsert = prisma.recurringRecipe.upsert({
    where: { userId_recipeId: { userId, recipeId: id } },
    create: { userId, recipeId: id, frequency: target },
    update: { frequency: target },
  });
  if (opts.unblock) {
    await prisma.$transaction([
      prisma.blockedRecipe.deleteMany({ where: { userId, recipeId: id } }),
      upsert,
    ]);
  } else {
    await upsert;
  }
  return target;
}

/** Предпочтения пользователя, готовые ко входу генератора. */
export interface LoadedPreferences {
  /** Мягкие предпочтения (избранное/recurring) для скоринга ядра. */
  preferences: Preferences;
  /** Стоп-лист рецептов (жёсткое ограничение). */
  blockedRecipeIds: string[];
  /** Keyword-фильтр с уже развёрнутыми синонимами (жёсткое ограничение). */
  keywordFilter: string[];
  /** Слоты в режиме «только recurring». */
  onlyRecurringSlots: Set<Slot>;
}

/** Загружает все предпочтения пользователя и приводит их ко входу ядра. */
export async function loadPreferences(userId: string): Promise<LoadedPreferences> {
  const [favorites, blocks, recurring, filters, slotSettings] = await Promise.all([
    prisma.favoriteRecipe.findMany({ where: { userId }, select: { recipeId: true } }),
    prisma.blockedRecipe.findMany({ where: { userId }, select: { recipeId: true } }),
    prisma.recurringRecipe.findMany({
      where: { userId },
      select: { recipeId: true, frequency: true },
    }),
    prisma.keywordFilter.findMany({ where: { userId }, select: { term: true } }),
    prisma.mealSlotSetting.findMany({
      where: { userId, onlyRecurring: true },
      select: { slot: true },
    }),
  ]);

  const recurringOftenIds = recurring
    .filter((r) => r.frequency === "often")
    .map((r) => r.recipeId);
  const recurringAlwaysIds = recurring
    .filter((r) => r.frequency === "always")
    .map((r) => r.recipeId);

  return {
    preferences: {
      favoriteIds: favorites.map((f) => f.recipeId),
      recurringOftenIds,
      recurringAlwaysIds,
    },
    blockedRecipeIds: blocks.map((b) => b.recipeId),
    keywordFilter: expandFilterTerms(filters.map((f) => f.term)),
    onlyRecurringSlots: new Set(slotSettings.map((s) => s.slot as Slot)),
  };
}

/** Состояние предпочтений одного рецепта — для действий на карточке блюда. */
export interface RecipePreferenceState {
  favorite: boolean;
  blocked: boolean;
  recurring: RecurringFrequency | null;
}

/** Рецепт в списке предпочтений: id + название для показа. */
export interface NamedRecipe {
  recipeId: string;
  name: string;
}

/** Recurring-рецепт с частотой — для экрана вкусов. */
export interface NamedRecurring extends NamedRecipe {
  frequency: RecurringFrequency;
}

/** Полная сводка предпочтений для экрана «Вкусы». */
export interface PreferencesOverview {
  keywordTerms: string[];
  favorites: NamedRecipe[];
  blocks: NamedRecipe[];
  recurring: NamedRecurring[];
  onlyRecurringSlots: Slot[];
  /** Группы продуктов базы — для быстрых чипов keyword-фильтра. */
  groups: string[];
}

/** Загружает сводку предпочтений пользователя с названиями рецептов и группами. */
export async function getPreferencesOverview(
  userId: string,
): Promise<PreferencesOverview> {
  const [favorites, blocks, recurring, filters, slotSettings, groupRows] =
    await Promise.all([
      prisma.favoriteRecipe.findMany({
        where: { userId },
        select: { recipeId: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.blockedRecipe.findMany({
        where: { userId },
        select: { recipeId: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.recurringRecipe.findMany({
        where: { userId },
        select: { recipeId: true, frequency: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.keywordFilter.findMany({
        where: { userId },
        select: { term: true },
        orderBy: { term: "asc" },
      }),
      prisma.mealSlotSetting.findMany({
        where: { userId, onlyRecurring: true },
        select: { slot: true },
      }),
      prisma.ingredient.findMany({
        where: { ownerUserId: null },
        select: { group: true },
        distinct: ["group"],
        orderBy: { group: "asc" },
      }),
    ]);

  // Названия рецептов одним запросом по объединению id.
  const ids = [
    ...new Set([
      ...favorites.map((f) => f.recipeId),
      ...blocks.map((b) => b.recipeId),
      ...recurring.map((r) => r.recipeId),
    ]),
  ];
  // Имена берём из рецептов и (для recurring кастом-продуктов, тикет 17) продуктов —
  // recurring хранится по строковому id, который может быть и id рецепта, и id
  // ингредиента. Один запрос на каждую таблицу по объединению id.
  const [recipes, products] = ids.length
    ? await Promise.all([
        prisma.recipe.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        }),
        prisma.ingredient.findMany({
          where: { id: { in: ids }, isCustom: true, ownerUserId: userId },
          select: { id: true, name: true },
        }),
      ])
    : [[], []];
  const nameById = new Map<string, string>();
  for (const r of recipes) nameById.set(r.id, r.name);
  for (const p of products) nameById.set(p.id, p.name);
  const name = (id: string) => nameById.get(id) ?? "Блюдо";

  return {
    keywordTerms: filters.map((f) => f.term),
    favorites: favorites.map((f) => ({ recipeId: f.recipeId, name: name(f.recipeId) })),
    blocks: blocks.map((b) => ({ recipeId: b.recipeId, name: name(b.recipeId) })),
    recurring: recurring.map((r) => ({
      recipeId: r.recipeId,
      name: name(r.recipeId),
      frequency: r.frequency as RecurringFrequency,
    })),
    onlyRecurringSlots: slotSettings.map((s) => s.slot as Slot),
    groups: groupRows.map((g) => g.group),
  };
}

/** Читает состояние предпочтений пользователя по конкретному рецепту. */
export async function getRecipePreference(
  userId: string,
  recipeId: string,
): Promise<RecipePreferenceState> {
  const [favorite, blocked, recurring] = await Promise.all([
    prisma.favoriteRecipe.findUnique({
      where: { userId_recipeId: { userId, recipeId } },
      select: { id: true },
    }),
    prisma.blockedRecipe.findUnique({
      where: { userId_recipeId: { userId, recipeId } },
      select: { id: true },
    }),
    prisma.recurringRecipe.findUnique({
      where: { userId_recipeId: { userId, recipeId } },
      select: { frequency: true },
    }),
  ]);
  return {
    favorite: favorite !== null,
    blocked: blocked !== null,
    recurring: (recurring?.frequency as RecurringFrequency | undefined) ?? null,
  };
}
