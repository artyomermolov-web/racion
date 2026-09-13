// Маппер «Товар ВВ → поля Ingredient» (тикет 01, spec.md шов 1, решение Q10).
// Чистая функция без сети/БД — тестируется на фикстурах, применяется синком.
//
// Правила (Q10):
//  • Штучный (unit="шт", масса в weight, кг) → unit=pcs, gramsPerPiece=weight·1000,
//    packSize=1, pricePerPack=price.current.
//  • Весовой/фасовка по массе → unit=g, packSize=weight·1000, pricePerPack=price.current.
//    (Только эти два исхода — Q10. ВВ отдаёт массу упаковки в кг, поэтому граммовка
//    корректна и для жидкостей; отдельного unit=ml не вводим — это было бы скрытым
//    допущением плотности сверх спека.)
//  • Скидка: смета по price.current; price.old/discount_percent → vvPriceOld/
//    vvDiscountPct только для бейджа. Цена по карте лояльности НЕ подставляется.
//  • Категория ВВ → русская подпись группы (Ingredient.group хранит подпись, не ключ).

import type { Unit } from "@/core/shopping/types";
import { parseVkusvillNutrition } from "./parse";
import type { VvCategory, VvIngredient, VvProduct, VvWeight } from "./types";

// Срок годности ВВ в ответе поиска не отдаётся; для тонкого слайса — консервативный
// дефолт (двое суток свежего продукта переживут, кладовка тикета 19 использует его
// как задел). Точные сроки — отдельный тикет наполнения.
const DEFAULT_SHELF_LIFE_DAYS = 14;
// Фолбэк упаковки, если у весового товара нет weight — чтобы packSize был > 0.
const FALLBACK_PACK_GRAMS = 100;

// Категория ВВ → одна из 13 русских подписей групп сида. Первое совпадение по
// ключевому слову побеждает; порядок важен (молочное раньше яиц: у ВВ есть общая
// категория «Молоко, сыр, яйцо»). Неизвестное → «Бакалея».
const GROUP_RULES: [RegExp, string][] = [
  [/рыб|морепрод/i, "Рыба и морепродукты"],
  [/мяс|птиц|кур|говяд|свин|индей/i, "Мясо и птица"],
  [/молок|молоч|сыр|творог|кефир|йогурт|сметан/i, "Молочные продукты"],
  [/яйц/i, "Яйца"],
  [/круп|макарон|вермишел|лапш|греча/i, "Крупы и макароны"],
  [/овощ|зелен/i, "Овощи"],
  [/фрукт|ягод/i, "Фрукты и ягоды"],
  [/орех|семеч/i, "Орехи и семечки"],
  [/хлеб|выпеч|булоч/i, "Хлеб и выпечка"],
  [/напит|\bвод|\bсок|чай|кофе/i, "Напитки"],
  [/консерв/i, "Консервы"],
  [/заморож/i, "Замороженное"],
];

const DEFAULT_GROUP = "Бакалея";

/** Имена категории по порядку (лист → корень); строка/объект → один элемент. */
function categoryNames(cat: VvCategory): string[] {
  if (!cat) return [];
  const nodes = Array.isArray(cat) ? cat : [cat];
  return nodes
    .map((n) => (typeof n === "string" ? n : n?.name ?? ""))
    .filter((s) => s.length > 0);
}

/**
 * Категория ВВ → русская подпись группы Ingredient (фолбэк «Бакалея»). Для
 * массива категорий (живая форма — лист→корень) берём ПЕРВОЕ имя, давшее
 * не-дефолтную группу: лист самый конкретный, но у него имя-подкатегория может не
 * содержать ключевого слова («Огурцы» → пусто), тогда спускаемся к родителю («Овощи»).
 */
export function categoryToGroup(cat: VvCategory): string {
  for (const name of categoryNames(cat)) {
    for (const [re, group] of GROUP_RULES) if (re.test(name)) return group;
  }
  return DEFAULT_GROUP;
}

/** Масса товара ВВ → кг. Живая форма — объект `{value}`; число — старая форма. */
function weightKg(weight: VvWeight | undefined): number | null {
  if (weight == null) return null;
  if (typeof weight === "number") return Number.isFinite(weight) ? weight : null;
  const v = weight.value;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Единица продажи по строке unit ВВ (Q10): «шт»→pcs, всё остальное (весовое)→g. */
function saleUnit(rawUnit: string): Unit {
  return rawUnit.toLowerCase().includes("шт") ? "pcs" : "g";
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Проецирует товар ВВ в поля Ingredient (готово к upsert). Возвращает null, если
 * КБЖУ-строку нельзя распарсить: без настоящих цифр смысла источить товар из ВВ нет
 * (несопоставленное остаётся seed-фолбэком — тикет 02).
 */
export function productToIngredient(product: VvProduct): VvIngredient | null {
  const nutritionRaw = product.properties?.map((p) => p.value ?? "").join("<br>") ?? "";
  const parsed = parseVkusvillNutrition(nutritionRaw);
  if (!parsed) return null;

  const unit = saleUnit(product.unit);
  const wKg = weightKg(product.weight);
  const weightGrams = wKg != null ? round(wKg * 1000) : null;

  const isPiece = unit === "pcs";
  const packSize = isPiece ? 1 : weightGrams ?? FALLBACK_PACK_GRAMS;
  const gramsPerPiece = isPiece ? weightGrams ?? null : null;

  const price = product.price;
  return {
    name: product.name,
    group: categoryToGroup(product.category),
    unit,
    kcalPer100: parsed.nutrients.kcal,
    proteinPer100: parsed.nutrients.protein,
    fatPer100: parsed.nutrients.fat,
    carbPer100: parsed.nutrients.carb,
    fiberPer100: parsed.nutrients.fiber,
    sodiumPer100: parsed.nutrients.sodium,
    packSize,
    pricePerPack: price.current,
    shelfLifeDays: DEFAULT_SHELF_LIFE_DAYS,
    gramsPerPiece,
    source: "vkusvill",
    vvXmlId: String(product.xml_id),
    vvPriceOld: price.old ?? null,
    vvDiscountPct: price.discount_percent ?? null,
  };
}
