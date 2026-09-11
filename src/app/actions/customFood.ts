"use server";

// Действия «своего» (тикет 17): кастом-продукт (ручной КБЖУ), кастом-рецепт и
// персонализация базового рецепта. Валидация — чистым ядром /core/generator;
// здесь доступ к БД, ревалидация путей и приведение форм. План сам не
// перегенерируется (decision 06 шаг 9) — только по кнопке на экране меню.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  validateCustomProduct,
  validateCustomRecipe,
  type CustomProductDraft,
  type CustomProductErrors,
  type CustomRecipeDraft,
  type CustomRecipeErrors,
  type CustomRecipeIngredientDraft,
} from "@/core/generator";
import {
  createCustomProduct,
  deleteCustomProduct,
  createCustomRecipe,
  deleteCustomRecipe,
  getBaseRecipeName,
} from "@/lib/customFood";
import { applyRecurring, type RecurringFrequency } from "@/lib/preferences";

/** Пути, зависящие от «своего»: экран своего, база и меню. */
function revalidateOwnViews() {
  revalidatePath("/svoe");
  revalidatePath("/baza");
  revalidatePath("/dnevnik/nedelya");
}

function field(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return v == null ? undefined : String(v);
}

// ── Кастом-продукт ───────────────────────────────────────────────────────────

export interface ProductFormState {
  errors: CustomProductErrors;
  values: CustomProductDraft;
  saved?: boolean;
}

function readProductDraft(formData: FormData): CustomProductDraft {
  return {
    name: field(formData, "name"),
    unit: field(formData, "unit"),
    kcal: field(formData, "kcal"),
    protein: field(formData, "protein"),
    fat: field(formData, "fat"),
    carb: field(formData, "carb"),
    fiber: field(formData, "fiber"),
    sodium: field(formData, "sodium"),
    allergens: formData.getAll("allergens").map(String),
  };
}

/** Создаёт кастом-продукт. При ошибках возвращает их и введённые значения. */
export async function createCustomProductAction(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const user = await requireUser();
  const draft = readProductDraft(formData);

  const { errors, value } = validateCustomProduct(draft);
  if (!value) return { errors, values: draft };

  await createCustomProduct(user.id, value);
  revalidateOwnViews();
  // Пустые значения — форма очищается для следующего продукта.
  return { errors: {}, values: {}, saved: true };
}

/** Удаляет кастом-продукт пользователя. */
export async function deleteCustomProductAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteCustomProduct(user.id, id);
  revalidateOwnViews();
}

/**
 * Отмечает кастом-продукт recurring (often/always) или снимает (null). Только так
 * продукт попадает в план — «генератор сам его не берёт» (тикет 17). Идемпотентно:
 * тот же режим повторно — снимает. Хранится в общей таблице RecurringRecipe по
 * строковому id продукта (FK к Recipe нет; тумблер — в `applyRecurring`).
 */
export async function setProductRecurringAction(
  productId: string,
  frequency: RecurringFrequency | null,
): Promise<RecurringFrequency | null> {
  const user = await requireUser();
  // Только свой продукт.
  const owned = await prisma.ingredient.findFirst({
    where: { id: productId, isCustom: true, ownerUserId: user.id },
    select: { id: true },
  });
  if (!owned) throw new Error("Продукт не найден");

  const target = await applyRecurring(user.id, productId, frequency);
  revalidateOwnViews();
  return target;
}

// ── Кастом-рецепт / персонализация ───────────────────────────────────────────

export interface RecipeFormState {
  errors: CustomRecipeErrors;
  values: CustomRecipeDraft;
}

/** Разбирает состав из скрытого JSON-поля формы (ingredient picker на клиенте). */
function readIngredients(formData: FormData): CustomRecipeIngredientDraft[] {
  const raw = field(formData, "ingredients");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((r) => ({
      ingredientId: typeof r?.ingredientId === "string" ? r.ingredientId : "",
      grams: typeof r?.grams === "number" || typeof r?.grams === "string" ? r.grams : "",
    }));
  } catch {
    return [];
  }
}

function readRecipeDraft(formData: FormData): CustomRecipeDraft {
  return {
    name: field(formData, "name"),
    steps: field(formData, "steps"),
    timeMin: field(formData, "timeMin"),
    servings: field(formData, "servings"),
    difficulty: field(formData, "difficulty"),
    slots: formData.getAll("slots").map(String),
    equipment: formData.getAll("equipment").map(String),
    diet: formData.getAll("diet").map(String),
    ingredients: readIngredients(formData),
  };
}

/**
 * Создаёт свой рецепт (или персонализацию, если задан валидный `baseRecipeId`).
 * При успехе — редирект на экран «Своё»; при ошибках возвращает их в форму.
 * Персонализация одна на базовый рецепт: прежняя версия пользователя заменяется.
 */
export async function saveCustomRecipeAction(
  _prev: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const user = await requireUser();
  const draft = readRecipeDraft(formData);
  const baseRecipeIdRaw = field(formData, "baseRecipeId")?.trim() || null;

  const { errors, value } = validateCustomRecipe(draft);
  if (!value) return { errors, values: draft };

  // Персонализация: базовый рецепт должен существовать и быть базовым.
  let baseRecipeId: string | null = null;
  if (baseRecipeIdRaw) {
    const baseName = await getBaseRecipeName(baseRecipeIdRaw);
    if (!baseName) {
      return {
        errors: { form: "Базовый рецепт не найден" },
        values: draft,
      };
    }
    baseRecipeId = baseRecipeIdRaw;
    // Одна персонализация на базовый рецепт — заменяем прежнюю версию.
    const existing = await prisma.recipe.findFirst({
      where: { ownerUserId: user.id, baseRecipeId },
      select: { id: true },
    });
    if (existing) await deleteCustomRecipe(user.id, existing.id);
  }

  await createCustomRecipe(user.id, value, baseRecipeId);
  revalidateOwnViews();
  redirect("/svoe");
}

/** Удаляет свой рецепт пользователя. */
export async function deleteCustomRecipeAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteCustomRecipe(user.id, id);
  revalidateOwnViews();
}
