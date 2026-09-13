// Импорт рецептов ВкусВилл (тикет 05, spec.md шов 1, Q6=a). Чистая функция без
// сети/БД — тестируется на фикстурах, применяется синком.
//
// Рецепт ВВ (`vkusvill_recipes`) несёт шаги, порции и ссылки на товары ВВ по их
// id/xml_id. Импорт сопоставляет каждый ингредиент с каталогом Racion в два шага:
//  1) точный мэтч по id/xml_id товара (после ре-сорса товар ВВ хранит SKU в
//     `Ingredient.vvXmlId`);
//  2) если товара нет в охвате — фолбэк по НАЗВАНИЮ против всего каталога
//     (`matchCatalogIngredient`: стеммер + синонимы + канон), т.к. нужный продукт
//     часто уже есть под другим именем/словоформой («Сахар»→«Сахар-песок»).
//
// Политика импорта (решение заказчика): рецепты импортируются БЕЗ ПРОПУСКОВ —
// несопоставленный ингредиент просто выпадает из состава (позже подключим базу
// продуктов, чтобы его КБЖУ не терялось). Единственный случай пропуска —
// вырожденный рецепт, где не сопоставился ни один ингредиент (состава нет вовсе).
//
// Меню-единицей остаётся `Recipe` Racion: КБЖУ считается из привязанного состава,
// аллергены — объединение по сопоставленным ингредиентам (как во всём каталоге).
// Структурные КБЖУ рецепта ВВ сохраняются в `nutrition` только для аудита.

import type { FoodNutrients } from "@/core/nutrition";
import { stripVvMarkup } from "./parse";
import { matchCatalogIngredient } from "./catalog-match";
import type {
  CatalogEntry,
  CatalogIndex,
  RecipeImport,
  RecipeImportItem,
  RecipeImportResult,
  VvRecipe,
} from "./types";

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

/** Слоты по ключевым словам текста (или [] — ни одно правило не сработало). */
function slotsByKeyword(text: string | null | undefined): string[] {
  if (!text) return [];
  for (const [re, slots] of SLOT_RULES) if (re.test(text)) return [...slots];
  return [];
}

/** Категория рецепта ВВ → слоты меню (фолбэк — обед и ужин). */
export function categoryToSlots(category: string | null | undefined): string[] {
  const byCat = slotsByKeyword(category);
  return byCat.length ? byCat : [...DEFAULT_SLOTS];
}

/**
 * Слоты меню из категории И названия рецепта (объединение). Название несёт сигнал
 * слота не хуже категории: «Творожная запеканка» в категории «Десерты» — это ещё и
 * завтрак. Если ни то ни другое не распознано — обед и ужин (рецепт размещаем).
 */
export function deriveSlots(category: string | null | undefined, name: string): string[] {
  const union = [...new Set([...slotsByKeyword(category), ...slotsByKeyword(name)])];
  return union.length ? union : [...DEFAULT_SLOTS];
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
 * Проецирует рецепт ВВ в поля `Recipe` Racion. Каждый ингредиент сопоставляется с
 * каталогом сперва по id/xml_id товара, затем — фолбэком по названию против всего
 * каталога. Рецепт импортируется, если сопоставился хотя бы один ингредиент (без
 * пропусков — решение заказчика); несопоставленные выпадают из состава. Если не
 * сопоставился НИ один ингредиент — `recipe: null` (состава нет). `matchedRatio`
 * отдаётся честно. Повторные ссылки на один товар суммируются в одну строку
 * состава; аллергены — объединение по сопоставленным ингредиентам.
 *
 * `catalog` — полный список каталога Racion для фолбэк-мэтча по имени (не только
 * товары ВВ: искомый продукт может быть seed-строкой). Необязателен — без него
 * работает лишь точный мэтч по id.
 */
export function recipeToRecipe(
  vvRecipe: VvRecipe,
  catalogIndex: CatalogIndex,
  catalog: readonly CatalogEntry[] = [],
): RecipeImportResult {
  const ingredients = vvRecipe.ingredients ?? [];
  const total = ingredients.length;

  // Слияние состава по каталожному ингредиенту (сумма грамм) + сбор аллергенов.
  const gramsById = new Map<string, number>();
  const allergens = new Set<string>();
  let matchedCount = 0;
  for (const ing of ingredients) {
    // Масса должна быть валидным положительным числом: 0/NaN/мусор из живого ответа
    // ВВ дал бы NaN в КБЖУ рецепта — такой ингредиент в состав не берём.
    if (!(ing.grams > 0)) continue;
    // Шаг 1 — точный мэтч по id/xml_id товара ВВ; шаг 2 — фолбэк по названию.
    let entry = catalogIndex.get(String(ing.id));
    if (!entry && ing.name && catalog.length) {
      entry = matchCatalogIngredient(ing.name, catalog) ?? undefined;
    }
    if (!entry) continue; // несопоставленный — в состав не идёт (рецепт не пропускаем)
    matchedCount++;
    gramsById.set(entry.ingredientId, (gramsById.get(entry.ingredientId) ?? 0) + ing.grams);
    for (const a of entry.allergens ?? []) allergens.add(a);
  }

  const matchedRatio = total === 0 ? 0 : matchedCount / total;
  // Без пропусков: пропускаем только вырожденный рецепт без единого сопоставления
  // (состава нет — КБЖУ считать не из чего, в меню он был бы пустышкой).
  if (gramsById.size === 0) return { recipe: null, matchedRatio };

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
    slots: deriveSlots(vvRecipe.category, vvRecipe.name),
    items,
    allergens: [...allergens],
    source: "vkusvill",
    vvId: String(vvRecipe.id),
    nutrition: fullNutrition(vvRecipe.nutritional),
  };
  return { recipe, matchedRatio };
}
