// Серверный клей «своего» (тикет 17): кастом-продукты (ручной КБЖУ), кастом-
// рецепты и персонализация базового рецепта. Бизнес-правила (валидация, КБЖУ из
// состава, вытеснение базового своей версией) живут в /core; здесь только доступ
// к данным и приведение к сериализуемым формам для UI.
import "server-only";
import { prisma } from "@/lib/db";
import { computeRecipeNutrition, type FoodNutrients } from "@/core/nutrition";
import { per100ToNutrients, toRecipeComponents } from "@/lib/foodNutrients";
import type {
  CustomProductValue,
  CustomRecipeValue,
  CustomRecipeDraft,
} from "@/core/generator";
import type { RecurringFrequency } from "@/lib/preferences";

// Кастом-продукту нужны поля упаковки/цены/срока (NOT NULL в схеме), но список
// покупок — отдельный тикет; для генератора они не используются. Задаём разумные
// заглушки, пока у продукта нет своей закупочной карточки.
const CUSTOM_PRODUCT_DEFAULTS = {
  group: "Своё",
  packSize: 1,
  pricePerPack: 0,
  shelfLifeDays: 365,
} as const;

// ── Кастом-продукты ──────────────────────────────────────────────────────────

/** Кастом-продукт пользователя для списка «Мои продукты». */
export interface CustomProductRow {
  id: string;
  name: string;
  unit: string;
  per100: FoodNutrients;
  allergens: string[];
  /** Отмечен ли продукт recurring (тогда генератор берёт его в план). */
  recurring: RecurringFrequency | null;
}

/** Список кастом-продуктов пользователя + их recurring-статус. */
export async function listCustomProducts(userId: string): Promise<CustomProductRow[]> {
  const rows = await prisma.ingredient.findMany({
    where: { isCustom: true, ownerUserId: userId },
    include: { allergens: true },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return [];

  // Recurring хранится в общей таблице по строковому id (кастом-продукт = id
  // ингредиента; FK к Recipe нет — см. schema.prisma).
  const recurring = await prisma.recurringRecipe.findMany({
    where: { userId, recipeId: { in: rows.map((r) => r.id) } },
    select: { recipeId: true, frequency: true },
  });
  const recurringById = new Map(recurring.map((r) => [r.recipeId, r.frequency]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    per100: per100ToNutrients(r),
    allergens: r.allergens.map((a) => a.allergen),
    recurring: (recurringById.get(r.id) as RecurringFrequency | undefined) ?? null,
  }));
}

/** Создаёт кастом-продукт (ручной КБЖУ) пользователя. Возвращает его id. */
export async function createCustomProduct(
  userId: string,
  value: CustomProductValue,
): Promise<string> {
  const created = await prisma.ingredient.create({
    data: {
      name: value.name,
      group: CUSTOM_PRODUCT_DEFAULTS.group,
      unit: value.unit,
      kcalPer100: value.per100.kcal,
      proteinPer100: value.per100.protein,
      fatPer100: value.per100.fat,
      carbPer100: value.per100.carb,
      fiberPer100: value.per100.fiber,
      sodiumPer100: value.per100.sodium,
      packSize: CUSTOM_PRODUCT_DEFAULTS.packSize,
      pricePerPack: CUSTOM_PRODUCT_DEFAULTS.pricePerPack,
      shelfLifeDays: CUSTOM_PRODUCT_DEFAULTS.shelfLifeDays,
      isCustom: true,
      ownerUserId: userId,
      allergens: { create: value.allergens.map((allergen) => ({ allergen })) },
    },
    select: { id: true },
  });
  return created.id;
}

/** Удаляет кастом-продукт пользователя и его recurring-пометку. */
export async function deleteCustomProduct(userId: string, id: string): Promise<void> {
  // Только свой продукт (чужой/базовый — не трогаем).
  const owned = await prisma.ingredient.findFirst({
    where: { id, isCustom: true, ownerUserId: userId },
    select: { id: true },
  });
  if (!owned) return;
  await prisma.$transaction([
    prisma.recurringRecipe.deleteMany({ where: { userId, recipeId: id } }),
    prisma.ingredient.delete({ where: { id } }),
  ]);
}

// ── Кастом-рецепты и персонализация ──────────────────────────────────────────

/** Свой рецепт пользователя для списка «Мои рецепты». */
export interface CustomRecipeRow {
  id: string;
  name: string;
  timeMin: number;
  perServing: FoodNutrients;
  /** id базового рецепта, если это персонализация (иначе null). */
  baseRecipeId: string | null;
  /** Название базового рецепта — для подписи «моя версия …». */
  baseName: string | null;
}

/** Список своих рецептов пользователя (кастом + персонализации) с КБЖУ порции. */
export async function listCustomRecipes(userId: string): Promise<CustomRecipeRow[]> {
  const rows = await prisma.recipe.findMany({
    where: { ownerUserId: userId },
    include: { ingredients: { include: { ingredient: true } } },
    orderBy: { createdAt: "desc" },
  });
  if (rows.length === 0) return [];

  const baseIds = [
    ...new Set(rows.map((r) => r.baseRecipeId).filter((x): x is string => !!x)),
  ];
  const bases = baseIds.length
    ? await prisma.recipe.findMany({
        where: { id: { in: baseIds } },
        select: { id: true, name: true },
      })
    : [];
  const baseName = new Map(bases.map((b) => [b.id, b.name]));

  return rows.map((r) => {
    const { perServing } = computeRecipeNutrition(toRecipeComponents(r.ingredients), r.servings);
    return {
      id: r.id,
      name: r.name,
      timeMin: r.timeMin,
      perServing,
      baseRecipeId: r.baseRecipeId,
      baseName: r.baseRecipeId ? baseName.get(r.baseRecipeId) ?? null : null,
    };
  });
}

/**
 * Создаёт свой рецепт пользователя. `baseRecipeId` задаёт персонализацию: своя
 * версия вытеснит базовый рецепт в новых планах (тикет 17, `resolvePersonalization`).
 * Возвращает id созданного рецепта.
 */
export async function createCustomRecipe(
  userId: string,
  value: CustomRecipeValue,
  baseRecipeId: string | null = null,
): Promise<string> {
  const created = await prisma.recipe.create({
    data: {
      name: value.name,
      steps: value.steps.join("\n"),
      timeMin: value.timeMin,
      difficulty: value.difficulty,
      servings: value.servings,
      isCustom: true,
      ownerUserId: userId,
      baseRecipeId,
      ingredients: {
        create: value.ingredients.map((it) => ({
          ingredientId: it.ingredientId,
          grams: it.grams,
        })),
      },
      slots: { create: value.slots.map((slot) => ({ slot })) },
      dietTags: { create: value.diet.map((tag) => ({ tag })) },
      equipment: { create: value.equipment.map((equipment) => ({ equipment })) },
    },
    select: { id: true },
  });
  return created.id;
}

/** Удаляет свой рецепт пользователя и предпочтения, ссылающиеся на него. */
export async function deleteCustomRecipe(userId: string, id: string): Promise<void> {
  const owned = await prisma.recipe.findFirst({
    where: { id, ownerUserId: userId },
    select: { id: true },
  });
  if (!owned) return;
  await prisma.$transaction([
    prisma.favoriteRecipe.deleteMany({ where: { userId, recipeId: id } }),
    prisma.blockedRecipe.deleteMany({ where: { userId, recipeId: id } }),
    prisma.recurringRecipe.deleteMany({ where: { userId, recipeId: id } }),
    // Состав/слоты/техника/диета удалятся каскадом (onDelete: Cascade).
    prisma.recipe.delete({ where: { id } }),
  ]);
}

// ── Данные для редактора рецепта ─────────────────────────────────────────────

/** Продукт, доступный для состава рецепта (база + свои кастом-продукты). */
export interface SelectableIngredient {
  id: string;
  name: string;
  unit: string;
  per100: FoodNutrients;
}

/** Продукты для выбора в редакторе рецепта: базовые + кастом-продукты юзера. */
export async function listSelectableIngredients(
  userId: string,
): Promise<SelectableIngredient[]> {
  const rows = await prisma.ingredient.findMany({
    where: { OR: [{ ownerUserId: null }, { ownerUserId: userId }] },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    unit: r.unit,
    per100: per100ToNutrients(r),
  }));
}

/** Черновик рецепта для формы-редактора (персонализация/правка). */
export interface RecipeDraftData extends CustomRecipeDraft {
  name: string;
  steps: string;
  timeMin: string;
  servings: string;
  difficulty: string;
  slots: string[];
  equipment: string[];
  diet: string[];
  ingredients: { ingredientId: string; grams: string }[];
}

/**
 * Готовит черновик из существующего рецепта для предзаполнения формы (например,
 * «Персонализировать» открывает копию базового). Возвращает null, если рецепта нет.
 */
export async function getRecipeDraft(id: string): Promise<RecipeDraftData | null> {
  const r = await prisma.recipe.findUnique({
    where: { id },
    include: {
      ingredients: { include: { ingredient: true }, orderBy: { grams: "desc" } },
      slots: true,
      dietTags: true,
      equipment: true,
    },
  });
  if (!r) return null;
  return {
    name: r.name,
    steps: r.steps,
    timeMin: String(r.timeMin),
    servings: String(r.servings),
    difficulty: String(r.difficulty),
    slots: r.slots.map((s) => s.slot),
    equipment: r.equipment.map((e) => e.equipment),
    diet: r.dietTags.map((d) => d.tag),
    ingredients: r.ingredients.map((ri) => ({
      ingredientId: ri.ingredientId,
      grams: String(ri.grams),
    })),
  };
}

/** Базовый рецепт для персонализации: id и название (или null). */
export async function getBaseRecipeName(id: string): Promise<string | null> {
  const r = await prisma.recipe.findFirst({
    where: { id, ownerUserId: null },
    select: { name: true },
  });
  return r?.name ?? null;
}
