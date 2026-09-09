// Расчёт КБЖУ записи дневника по количеству (тикет 09). Чистый модуль без
// Prisma/Next — основной шов тестирования (spec.md, Testing Decisions).
//
// Три формы количества (LoggedAmount): граммы и штуки — только для продукта
// (ingredient), порции — только для рецепта (recipe). Штуки переводятся в граммы
// через грамм-эквивалент штуки (gramsPerPiece); без него штучный ввод недоступен.
//
// Округление — по kbju-master.md A1: только в самом финале, ккал и граммы макросов
// до целого. Промежуточные множители не округляются. Натрий дневник не отслеживает
// (spec), поэтому снапшот — 5 полей DiaryNutrients, а не 6 полей FoodNutrients.

import type { FoodNutrients } from "@/core/nutrition";
import { DIARY_NUTRIENT_KEYS, type DiaryNutrients, type LoggedAmount } from "./types";
import { zeroNutrients } from "./aggregate";

/**
 * Еда для расчёта количества: продукт задаётся нутриентами на 100 г и (опционально)
 * грамм-эквивалентом штуки; рецепт — нутриентами на одну порцию. Ровно те данные,
 * что нужны ядру, чтобы не тащить сюда формы БД/UI.
 */
export type AmountFood =
  | { source: "ingredient"; per100: FoodNutrients; gramsPerPiece: number | null }
  | { source: "recipe"; perServing: FoodNutrients };

/** Пресет-«чипс»: подпись + количество, которое он подставляет. */
export interface AmountPreset {
  label: string;
  amount: LoggedAmount;
}

/** Что писать в строку записи: заполнено ровно одно из grams/servings + снапшот. */
export interface ResolvedAmount {
  grams: number | null;
  servings: number | null;
  nutrients: DiaryNutrients;
}

/** Снапшот из 5 отслеживаемых нутриентов, домноженных на factor и округлённых. */
function scaleAndRound(base: FoodNutrients, factor: number): DiaryNutrients {
  const out = zeroNutrients();
  for (const k of DIARY_NUTRIENT_KEYS) out[k] = Math.round(base[k] * factor);
  return out;
}

/**
 * Граммы продукта из количества: сами граммы, либо штуки × gramsPerPiece. Штуки
 * без грамм-эквивалента недоступны — это ошибка (UI такой ввод не показывает,
 * item 13; здесь — защитный гвард).
 */
function ingredientGrams(
  food: Extract<AmountFood, { source: "ingredient" }>,
  amount: LoggedAmount,
): number {
  if (amount.kind === "grams") return amount.grams;
  if (amount.kind === "pieces") {
    if (food.gramsPerPiece == null) {
      throw new Error("Штучный ввод недоступен: у продукта нет gramsPerPiece");
    }
    return amount.pieces * food.gramsPerPiece;
  }
  throw new Error("Порции недоступны для продукта — используйте граммы или штуки");
}

/**
 * Снапшот КБЖУ записи по количеству. Продукт: per100 × grams/100 (штуки сперва
 * переводятся в граммы). Рецепт: perServing × servings. Возвращается новый объект —
 * значение-снапшот, не связанный с исходными данными еды (проверяется тестом
 * неизменяемости).
 */
export function nutrientsForAmount(
  food: AmountFood,
  amount: LoggedAmount,
): DiaryNutrients {
  if (food.source === "ingredient") {
    const grams = ingredientGrams(food, amount);
    return scaleAndRound(food.per100, grams / 100);
  }
  if (amount.kind !== "servings") {
    throw new Error("Граммы/штуки недоступны для рецепта — используйте порции");
  }
  return scaleAndRound(food.perServing, amount.servings);
}

/**
 * Резолв количества в поля строки записи. Продукт хранит граммы (штуки уже
 * переведены в граммы), рецепт — порции; заполнено ровно одно поле. Снапшот
 * считается тем же nutrientsForAmount.
 */
export function resolveAmount(
  food: AmountFood,
  amount: LoggedAmount,
): ResolvedAmount {
  const nutrients = nutrientsForAmount(food, amount);
  if (food.source === "ingredient") {
    return { grams: ingredientGrams(food, amount), servings: null, nutrients };
  }
  // nutrientsForAmount уже отверг не-порционные количества для рецепта; здесь
  // сужаем тип для доступа к servings.
  if (amount.kind !== "servings") {
    throw new Error("Порции обязательны для рецепта");
  }
  return { grams: null, servings: amount.servings, nutrients };
}

/**
 * Чипсы-пресеты для быстрого выбора количества над теми же полями ввода. Рецепт —
 * ½/1/1½ порции; продукт — «100 г», а при наличии грамм-эквивалента ещё и «1 шт»
 * (первым). Продукт без gramsPerPiece штучного пресета не получает (item 13).
 */
export function presetsForFood(food: AmountFood): AmountPreset[] {
  if (food.source === "recipe") {
    return [
      { label: "½ порции", amount: { kind: "servings", servings: 0.5 } },
      { label: "1 порция", amount: { kind: "servings", servings: 1 } },
      { label: "1½ порции", amount: { kind: "servings", servings: 1.5 } },
    ];
  }
  const presets: AmountPreset[] = [];
  if (food.gramsPerPiece != null) {
    presets.push({ label: "1 шт", amount: { kind: "pieces", pieces: 1 } });
  }
  presets.push({ label: "100 г", amount: { kind: "grams", grams: 100 } });
  return presets;
}
