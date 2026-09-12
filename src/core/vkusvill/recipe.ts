// Импорт рецептов ВкусВилл (тикет 05, spec.md шов 1, Q6=a). Чистая функция без
// сети/БД — тестируется на фикстурах, применяется синком.
//
// Рецепт ВВ (`vkusvill_recipes`) несёт шаги, порции и ссылки на товары ВВ по их
// id/xml_id. Импорт мэтчит эти ссылки к каталогу Racion (после ре-сорса товары ВВ
// хранят свой SKU в `Ingredient.vvXmlId`) и импортирует рецепт при сопоставлении
// ≥80% ингредиентов; иначе пропускает — так меню-КБЖУ, которое Racion считает из
// состава (computeRecipeNutrition), не проседает из-за пропущенной массы.
//
// Меню-единицей остаётся `Recipe` Racion: КБЖУ считается из привязанного состава,
// аллергены — объединение по сопоставленным ингредиентам (как во всём каталоге).
// Структурные КБЖУ рецепта ВВ сохраняются в `nutrition` только для аудита.

import type { FoodNutrients } from "@/core/nutrition";
import { stripVvMarkup } from "./parse";
import type {
  CatalogIndex,
  RecipeImport,
  RecipeImportItem,
  RecipeImportResult,
  VvRecipe,
} from "./types";

/** Порог сопоставления ингредиентов, при котором рецепт импортируется (Q6=a). */
export const RECIPE_MATCH_THRESHOLD = 0.8;

/** Слоты меню по умолчанию — рецепт без явной категории остаётся размещаемым. */
const DEFAULT_SLOTS = ["lunch", "dinner"];

// Категория рецепта ВВ → слоты меню Racion. Первое совпадение по ключевому слову
// побеждает; порядок важен (каша раньше общего). Неизвестное → обед+ужин.
const SLOT_RULES: [RegExp, string[]][] = [
  [/завтрак|каш|омлет|сырник|запеканк/i, ["breakfast"]],
  [/суп|бульон/i, ["lunch"]],
  [/десерт|выпеч|печен|торт|кекс|смузи/i, ["snack"]],
  [/салат|закуск/i, ["lunch", "dinner"]],
  [/гарнир|основн|горяч|второе|паст|ужин/i, ["lunch", "dinner"]],
];

/** Категория рецепта ВВ → слоты меню (фолбэк — обед и ужин). */
export function categoryToSlots(category: string | null | undefined): string[] {
  if (!category) return [...DEFAULT_SLOTS];
  for (const [re, slots] of SLOT_RULES) if (re.test(category)) return [...slots];
  return [...DEFAULT_SLOTS];
}

/**
 * Шаги рецепта → массив чистых строк. Чистку <br>/&nbsp;/HTML-тегов/сущностей
 * делит с парсером КБЖУ (stripVvMarkup) — формат разметки ВВ один. Отсутствующие
 * шаги (неполный ответ ВВ) → пустой массив, а не падение.
 */
function normalizeSteps(steps: string[] | string | null | undefined): string[] {
  const joined = Array.isArray(steps) ? steps.join("\n") : steps;
  return stripVvMarkup(joined)
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Целое в диапазоне [min,max]; нечисло/пусто → fallback. */
function clampInt(value: number | null | undefined, min: number, max: number, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Дополняет частичные структурные КБЖУ ВВ до полного FoodNutrients (нули по умолчанию). */
function fullNutrition(partial: Partial<FoodNutrients> | null | undefined): FoodNutrients | null {
  if (!partial) return null;
  return {
    kcal: partial.kcal ?? 0,
    protein: partial.protein ?? 0,
    fat: partial.fat ?? 0,
    carb: partial.carb ?? 0,
    fiber: partial.fiber ?? 0,
    sodium: partial.sodium ?? 0,
  };
}

/**
 * Проецирует рецепт ВВ в поля `Recipe` Racion. Ингредиенты мэтчатся к каталогу по
 * id/xml_id товара ВВ; при сопоставлении ≥80% возвращает готовый к upsert рецепт,
 * иначе `recipe: null` (пропуск). `matchedRatio` отдаётся честно в обоих случаях.
 * Повторные ссылки на один товар суммируются в одну строку состава; аллергены —
 * объединение по сопоставленным ингредиентам (несопоставленные в состав не входят,
 * их аллергены не переносятся — это и ограничивает порог ≥80%).
 */
export function recipeToRecipe(
  vvRecipe: VvRecipe,
  catalogIndex: CatalogIndex,
): RecipeImportResult {
  const ingredients = vvRecipe.ingredients ?? [];
  const total = ingredients.length;

  // Слияние состава по каталожному ингредиенту (сумма грамм) + сбор аллергенов.
  const gramsById = new Map<string, number>();
  const allergens = new Set<string>();
  let matchedCount = 0;
  for (const ing of ingredients) {
    const entry = catalogIndex.get(String(ing.id));
    if (!entry) continue; // несопоставленный — в состав не идёт
    matchedCount++;
    gramsById.set(entry.ingredientId, (gramsById.get(entry.ingredientId) ?? 0) + ing.grams);
    for (const a of entry.allergens ?? []) allergens.add(a);
  }

  const matchedRatio = total === 0 ? 0 : matchedCount / total;
  if (matchedRatio < RECIPE_MATCH_THRESHOLD) return { recipe: null, matchedRatio };

  const items: RecipeImportItem[] = [...gramsById].map(([ingredientId, grams]) => ({
    ingredientId,
    grams,
  }));

  const recipe: RecipeImport = {
    name: vvRecipe.name,
    steps: normalizeSteps(vvRecipe.steps),
    timeMin: clampInt(vvRecipe.timeMin, 0, 24 * 60, 0),
    difficulty: clampInt(vvRecipe.difficulty, 1, 3, 1),
    servings: clampInt(vvRecipe.servings, 1, 99, 1),
    slots: categoryToSlots(vvRecipe.category),
    items,
    allergens: [...allergens],
    source: "vkusvill",
    vvId: String(vvRecipe.id),
    nutrition: fullNutrition(vvRecipe.nutritional),
  };
  return { recipe, matchedRatio };
}
