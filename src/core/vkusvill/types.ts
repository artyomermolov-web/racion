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
