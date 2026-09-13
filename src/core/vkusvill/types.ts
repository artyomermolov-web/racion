// Типы интеграции ВкусВилл (тикет 01, spec.md). Чистый модуль без Prisma/Next —
// общий для парсера/маппера (core), клиента-адаптера (lib) и синка (scripts).
//
// `VvProduct` — форма товара из `vkusvill_products_search` (mode=full): поля
// id/xml_id/name/price/unit/weight/category/properties (подтверждено `tools/list`
// на живом MCP). КБЖУ приходит НЕструктурной русской строкой в `properties[].value`
// (см. [ADR-0001]); её разбирает `parseVkusvillNutrition`.

import type { FoodNutrients } from "@/core/nutrition";
import type { Unit } from "@/core/shopping/types";

/** Цена товара ВВ. Смета считается по `current`; `old`/`discount_percent` — бейдж. */
export interface VvPrice {
  /** Текущая цена, ₽ (основа сметы). */
  current: number;
  /** Старая цена до скидки, ₽ (null — скидки нет). */
  old?: number | null;
  /** Процент скидки (null — нет). */
  discount_percent?: number | null;
}

/** Категория товара ВВ (в ответе — объект с именем; строка/пусто допускаются). */
export type VvCategory = { id?: number; name?: string } | string | null | undefined;

/** Одно свойство карточки ВВ; КБЖУ лежит в `value` неструктурной строкой. */
export interface VvProperty {
  name?: string;
  value?: string;
}

/** Товар из `vkusvill_products_search` (mode=full). Единица каталога = «Товар ВВ». */
export interface VvProduct {
  id: number;
  /** Стабильный SKU-идентификатор (может быть строкой «0000123» или числом). */
  xml_id: string | number;
  name: string;
  slug?: string;
  price: VvPrice;
  /** Единица продажи: «шт» — штучный; «кг»/«г»/«мл»/«л» — весовой/фасовка. */
  unit: string;
  /** Масса упаковки, кг (для штучного — масса одной штуки). */
  weight?: number | null;
  category?: VvCategory;
  properties?: VvProperty[];
}

/** Результат разбора КБЖУ-строки ВВ: усреднённые нутриенты + данные для аудита. */
export interface ParsedNutrition {
  /**
   * КБЖУ на 100 г, усреднённые по вариантам поставщиков. Тип — `FoodNutrients`
   * ядра (kcal/protein/fat/carb/fiber/sodium); клетчатка/натрий = 0, если в строке
   * их нет (ВВ обычно даёт только Б/Ж/У/ккал).
   */
  nutrients: FoodNutrients;
  /** Сколько вариантов поставщиков распознано (для аудита; ≥1). */
  variants: number;
  /** Исходная строка КБЖУ (для аудита/отладки). */
  raw: string;
}

/**
 * Товар ВВ, спроецированный в поля `Ingredient` (готово к upsert синком).
 * Провенанс — всегда `vkusvill`; `vvUpdatedAt` проставляет синк (это часы, не
 * трансформация), поэтому здесь его нет.
 */
export interface VvIngredient {
  name: string;
  group: string;
  unit: Unit;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbPer100: number;
  fiberPer100: number;
  sodiumPer100: number;
  /** Размер магазинной упаковки (единица продажи). Штучный → 1. */
  packSize: number;
  /** Цена за пачку, ₽ = `price.current`. */
  pricePerPack: number;
  shelfLifeDays: number;
  /** Масса одной штуки, г — только для штучных; иначе null. */
  gramsPerPiece: number | null;
  source: "vkusvill";
  /** SKU ВВ (строкой) — ключ идемпотентного upsert. */
  vvXmlId: string;
  /** Старая цена, ₽ (для бейджа скидки; null — нет). */
  vvPriceOld: number | null;
  /** Процент скидки (для бейджа; null — нет). */
  vvDiscountPct: number | null;
}

// --- Импорт рецептов ВВ (тикет 05, spec.md шов 1, Q6=a) ----------------------
// Рецепт из `vkusvill_recipes`: чистые структурные КБЖУ и привязка ингредиентов
// к товарам ВВ по `id`/`xml_id`. Меню-единицей остаётся `Recipe` Racion; КБЖУ
// считается из состава (порог сопоставления ≥80% держит состав достаточно полным).

/** Ингредиент рецепта ВВ: ссылка на товар ВВ (по ней мэтч к каталогу) + масса. */
export interface VvRecipeIngredient {
  /** id/xml_id товара ВВ — ключ мэтча к каталогу (сопоставленные строки хранят его в vvXmlId). */
  id: string | number;
  /** Название (для аудита; мэтч идёт по id, не по имени). */
  name?: string;
  /** Масса на всё блюдо, г (для мл — миллилитры, плотность ~1). */
  grams: number;
}

/** Рецепт из `vkusvill_recipes` (нужные импорту поля; остальное игнорируется). */
export interface VvRecipe {
  id: string | number;
  name: string;
  /** Шаги приготовления: массив строк или единая строка с <br>/переносами. */
  steps: string[] | string;
  /** Категория рецепта ВВ (→ слоты меню Racion; фолбэк — обед/ужин). */
  category?: string | null;
  /** Число порций (default 1). */
  servings?: number | null;
  /** Время приготовления, мин. */
  timeMin?: number | null;
  /** Сложность 1–3, если ВВ отдаёт; иначе дефолт 1. */
  difficulty?: number | null;
  /**
   * Структурные КБЖУ рецепта ВВ (на порцию) — для аудита. Меню-КБЖУ Racion
   * считается из состава (computeRecipeNutrition), поэтому это поле информационное.
   */
  nutritional?: Partial<FoodNutrients> | null;
  ingredients: VvRecipeIngredient[];
}

/** Строка каталога Racion для мэтча ингредиентов рецепта. */
export interface CatalogEntry {
  /** id ингредиента в каталоге Racion (Ingredient.id) — цель ссылки рецепта. */
  ingredientId: string;
  /** Название каталожного ингредиента — для фолбэк-мэтча по имени. */
  name: string;
  /** Аллергены каталожного ингредиента (перенос в рецепт при импорте). */
  allergens?: string[];
}

/** Индекс каталога по id/xml_id товара ВВ → каталожный ингредиент (точный мэтч). */
export type CatalogIndex = Map<string, CatalogEntry>;

/** Ингредиент импортируемого рецепта: ссылка на каталог Racion + масса блюда. */
export interface RecipeImportItem {
  ingredientId: string;
  grams: number;
}

/** Рецепт ВВ, спроецированный в поля `Recipe` Racion (готово к upsert синком). */
export interface RecipeImport {
  name: string;
  /** Шаги — по одному на строку (в БД склеиваются через \n). */
  steps: string[];
  timeMin: number;
  difficulty: number;
  servings: number;
  /** Слоты меню (breakfast|lunch|dinner|snack) — из категории ВВ. */
  slots: string[];
  /** Состав: ссылки на каталог Racion + массы (КБЖУ считается по ним). */
  items: RecipeImportItem[];
  /** Аллергены — объединение по сопоставленным ингредиентам (перенос, дедуп). */
  allergens: string[];
  source: "vkusvill";
  /** id рецепта ВВ (строкой) — ключ идемпотентного upsert. */
  vvId: string;
  /** Структурные КБЖУ рецепта ВВ (аудит); меню считает КБЖУ из состава. */
  nutrition: FoodNutrients | null;
}

/** Итог импорта одного рецепта ВВ: готовый рецепт (или пропуск) + доля мэтча. */
export interface RecipeImportResult {
  /** Готовый к upsert рецепт или null (matchedRatio ниже порога — пропуск). */
  recipe: RecipeImport | null;
  /** Доля сопоставленных с каталогом ингредиентов рецепта, [0,1]. */
  matchedRatio: number;
}
