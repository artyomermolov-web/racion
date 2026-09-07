// Валидация и парсинг ввода «своего» (тикет 17): кастом-продукт (ручной КБЖУ) и
// кастом-рецепт / персонализация. Чистый модуль без Prisma/UI — шов тестирования.
// Сообщения на русском (показываются пользователю как есть). Единицы/слоты/техника/
// аллергены проверяются против канонических наборов (совпадают со схемой и core).

import type { FoodNutrients } from "@/core/nutrition";
import { ALL_SLOTS } from "./generate";
import type { Slot, Equipment, Allergen } from "./types";

export type Unit = "g" | "ml" | "pcs";
export const UNITS: readonly Unit[] = ["g", "ml", "pcs"];
export const EQUIPMENTS: readonly Equipment[] = [
  "stove",
  "oven",
  "blender",
  "multicooker",
  "none",
];
export const ALLERGENS: readonly Allergen[] = [
  "milk",
  "gluten",
  "egg",
  "fish",
  "meat",
  "poultry",
  "nuts",
  "soy",
];
export const DIETS: readonly string[] = ["vegetarian", "vegan", "pescatarian"];

/** Рабочие пределы (не мед. предписания) — защита от опечаток и мусора. */
export const LIMITS = {
  nameMax: 80,
  kcalPer100Max: 1000, // чистый жир ~900 ккал/100 г — потолок с запасом
  macroPer100Max: 100, // белок/жир/углеводы — максимум 100 г на 100 г продукта
  gramMax: 5000,
  timeMinMax: 24 * 60,
  servingsMax: 50,
} as const;

// ── Кастом-продукт ───────────────────────────────────────────────────────────

/** Сырой ввод продукта из формы: все числа — строки. */
export interface CustomProductDraft {
  name?: string;
  unit?: string;
  kcal?: string;
  protein?: string;
  fat?: string;
  carb?: string;
  fiber?: string;
  sodium?: string;
  allergens?: string[];
}

export interface CustomProductErrors {
  name?: string;
  unit?: string;
  kcal?: string;
  protein?: string;
  fat?: string;
  carb?: string;
  form?: string;
}

/** Разобранный продукт: КБЖУ на 100 г/мл/шт + аллергены. */
export interface CustomProductValue {
  name: string;
  unit: Unit;
  per100: FoodNutrients;
  allergens: Allergen[];
}

export interface CustomProductResult {
  errors: CustomProductErrors;
  value?: CustomProductValue;
}

/** Парсит число (запятая как разделитель); null — если пусто/не число. Знак и
 *  диапазон проверяет вызывающий (см. requireNonNeg). */
function num(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Обязательное неотрицательное число в пределах [0, max]. */
function requireNonNeg(
  raw: string | undefined,
  max: number,
): { value?: number; error?: string } {
  const n = num(raw);
  if (n === null) return { error: "Укажите число" };
  if (n < 0) return { error: "Не может быть отрицательным" };
  if (n > max) return { error: `Слишком большое значение (макс. ${max})` };
  return { value: n };
}

export function validateCustomProduct(draft: CustomProductDraft): CustomProductResult {
  const errors: CustomProductErrors = {};

  const name = (draft.name ?? "").trim();
  if (!name) errors.name = "Введите название";
  else if (name.length > LIMITS.nameMax)
    errors.name = `Не длиннее ${LIMITS.nameMax} символов`;

  const unit = draft.unit as Unit | undefined;
  if (!unit || !UNITS.includes(unit)) errors.unit = "Выберите единицу";

  const kcal = requireNonNeg(draft.kcal, LIMITS.kcalPer100Max);
  if (kcal.error) errors.kcal = kcal.error;
  const protein = requireNonNeg(draft.protein, LIMITS.macroPer100Max);
  if (protein.error) errors.protein = protein.error;
  const fat = requireNonNeg(draft.fat, LIMITS.macroPer100Max);
  if (fat.error) errors.fat = fat.error;
  const carb = requireNonNeg(draft.carb, LIMITS.macroPer100Max);
  if (carb.error) errors.carb = carb.error;

  // Клетчатка и натрий — необязательны, по умолчанию 0.
  const fiber = num(draft.fiber) ?? 0;
  const sodium = num(draft.sodium) ?? 0;

  const allergens = (draft.allergens ?? []).filter((a): a is Allergen =>
    ALLERGENS.includes(a as Allergen),
  );

  if (Object.keys(errors).length > 0) return { errors };

  return {
    errors: {},
    value: {
      name,
      unit: unit as Unit,
      per100: {
        kcal: kcal.value!,
        protein: protein.value!,
        fat: fat.value!,
        carb: carb.value!,
        fiber: Math.max(0, fiber),
        sodium: Math.max(0, sodium),
      },
      allergens,
    },
  };
}

// ── Кастом-рецепт / персонализация ───────────────────────────────────────────

/** Один ингредиент состава: ссылка на продукт базы/свой + масса, г. */
export interface CustomRecipeIngredientDraft {
  ingredientId?: string;
  grams?: string | number;
}

/** Сырой ввод рецепта из формы. */
export interface CustomRecipeDraft {
  name?: string;
  steps?: string; // по строке на шаг
  timeMin?: string;
  servings?: string;
  difficulty?: string;
  slots?: string[];
  equipment?: string[];
  diet?: string[];
  ingredients?: CustomRecipeIngredientDraft[];
}

export interface CustomRecipeErrors {
  name?: string;
  timeMin?: string;
  servings?: string;
  slots?: string;
  ingredients?: string;
  form?: string;
}

export interface CustomRecipeValue {
  name: string;
  steps: string[];
  timeMin: number;
  servings: number;
  difficulty: number;
  slots: Slot[];
  equipment: Equipment[];
  diet: string[];
  ingredients: { ingredientId: string; grams: number }[];
}

export interface CustomRecipeResult {
  errors: CustomRecipeErrors;
  value?: CustomRecipeValue;
}

/** Округляет разобранное число до целого; null — если пусто/не число. */
function int(raw: string | undefined): number | null {
  const n = num(raw);
  if (n === null) return null;
  return Math.round(n);
}

export function validateCustomRecipe(draft: CustomRecipeDraft): CustomRecipeResult {
  const errors: CustomRecipeErrors = {};

  const name = (draft.name ?? "").trim();
  if (!name) errors.name = "Введите название";
  else if (name.length > LIMITS.nameMax)
    errors.name = `Не длиннее ${LIMITS.nameMax} символов`;

  const timeMin = int(draft.timeMin);
  if (timeMin === null || timeMin < 0) errors.timeMin = "Укажите время в минутах";
  else if (timeMin > LIMITS.timeMinMax) errors.timeMin = "Слишком большое время";

  const servings = int(draft.servings);
  if (servings === null || servings < 1) errors.servings = "Минимум 1 порция";
  else if (servings > LIMITS.servingsMax) errors.servings = "Слишком много порций";

  const difficultyRaw = int(draft.difficulty);
  const difficulty = difficultyRaw && difficultyRaw >= 1 && difficultyRaw <= 3
    ? difficultyRaw
    : 1;

  const slots = (draft.slots ?? []).filter((s): s is Slot =>
    ALL_SLOTS.includes(s as Slot),
  );
  if (slots.length === 0) errors.slots = "Выберите хотя бы один приём";

  const equipment = (draft.equipment ?? []).filter((e): e is Equipment =>
    EQUIPMENTS.includes(e as Equipment),
  );
  const diet = (draft.diet ?? []).filter((d) => DIETS.includes(d));

  // Состав: строки с валидным продуктом и массой > 0. Пустые строки формы
  // (без продукта) игнорируем, чтобы «пустой слот» ингредиента не ломал сохранение.
  const ingredients: { ingredientId: string; grams: number }[] = [];
  let badGrams = false;
  for (const row of draft.ingredients ?? []) {
    const id = (row.ingredientId ?? "").trim();
    if (!id) continue;
    const grams = typeof row.grams === "number" ? row.grams : num(row.grams);
    if (grams === null || grams <= 0 || grams > LIMITS.gramMax) {
      badGrams = true;
      continue;
    }
    ingredients.push({ ingredientId: id, grams });
  }
  if (ingredients.length === 0)
    errors.ingredients = "Добавьте хотя бы один ингредиент с массой";
  else if (badGrams) errors.ingredients = "Проверьте массу ингредиентов (граммы > 0)";

  if (Object.keys(errors).length > 0) return { errors };

  const steps = (draft.steps ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    errors: {},
    value: {
      name,
      steps,
      timeMin: timeMin!,
      servings: servings!,
      difficulty,
      slots,
      equipment,
      diet,
      ingredients,
    },
  };
}
