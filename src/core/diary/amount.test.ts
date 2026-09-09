import { describe, it, expect } from "vitest";
import {
  nutrientsForAmount,
  resolveAmount,
  presetsForFood,
  type AmountFood,
} from "./amount";
import type { FoodNutrients } from "@/core/nutrition";

// Продукт на 100 г: куриная грудка (штучная только у продуктов с gramsPerPiece).
const chicken100: FoodNutrients = {
  kcal: 165,
  protein: 31,
  fat: 3.6,
  carb: 0,
  fiber: 0,
  sodium: 74,
};
// Продукт со штучным эквивалентом: яйцо, 60 г/шт.
const egg100: FoodNutrients = {
  kcal: 143,
  protein: 13,
  fat: 9.5,
  carb: 0.7,
  fiber: 0,
  sodium: 142,
};
// Рецепт: КБЖУ на одну порцию.
const soupServing: FoodNutrients = {
  kcal: 320,
  protein: 18,
  fat: 12,
  carb: 34,
  fiber: 6,
  sodium: 480,
};

const chicken: AmountFood = {
  source: "ingredient",
  per100: chicken100,
  gramsPerPiece: null,
};
const egg: AmountFood = {
  source: "ingredient",
  per100: egg100,
  gramsPerPiece: 60,
};
const soup: AmountFood = {
  source: "recipe",
  perServing: soupServing,
};

describe("nutrientsForAmount — снапшот КБЖУ по количеству", () => {
  it("продукт в граммах: per100 × grams/100, округление в финале (A1)", () => {
    const n = nutrientsForAmount(chicken, { kind: "grams", grams: 150 });
    // 165×1.5=247.5→248; 31×1.5=46.5→47(→46? банковское? нет, Math.round=47);
    // 3.6×1.5=5.4→5; углеводы/клетчатка 0.
    expect(n).toEqual({ kcal: 248, protein: 47, fat: 5, carb: 0, fiber: 0 });
  });

  it("натрий в снапшот дневника не попадает (5 отслеживаемых полей)", () => {
    const n = nutrientsForAmount(chicken, { kind: "grams", grams: 100 });
    expect(n).not.toHaveProperty("sodium");
    expect(Object.keys(n).sort()).toEqual(
      ["carb", "fat", "fiber", "kcal", "protein"].sort(),
    );
  });

  it("продукт в штуках: pieces × gramsPerPiece → граммы, затем per100", () => {
    // 2 яйца × 60 г = 120 г → factor 1.2: 143×1.2=171.6→172; 13×1.2=15.6→16;
    // 9.5×1.2=11.4→11; 0.7×1.2=0.84→1.
    const n = nutrientsForAmount(egg, { kind: "pieces", pieces: 2 });
    expect(n).toEqual({ kcal: 172, protein: 16, fat: 11, carb: 1, fiber: 0 });
  });

  it("штуки эквивалентны граммам через gramsPerPiece", () => {
    const byPieces = nutrientsForAmount(egg, { kind: "pieces", pieces: 3 });
    const byGrams = nutrientsForAmount(egg, { kind: "grams", grams: 180 });
    expect(byPieces).toEqual(byGrams);
  });

  it("рецепт в порциях: perServing × servings", () => {
    // 1.5 порции: 320×1.5=480; 18×1.5=27; 12×1.5=18; 34×1.5=51; 6×1.5=9.
    const n = nutrientsForAmount(soup, { kind: "servings", servings: 1.5 });
    expect(n).toEqual({ kcal: 480, protein: 27, fat: 18, carb: 51, fiber: 9 });
  });

  it("штуки без gramsPerPiece недоступны (ошибка)", () => {
    expect(() =>
      nutrientsForAmount(chicken, { kind: "pieces", pieces: 1 }),
    ).toThrow();
  });

  it("граммы у рецепта и порции у продукта — несовместимые количества (ошибка)", () => {
    expect(() =>
      nutrientsForAmount(soup, { kind: "grams", grams: 100 }),
    ).toThrow();
    expect(() =>
      nutrientsForAmount(chicken, { kind: "servings", servings: 1 }),
    ).toThrow();
  });
});

describe("resolveAmount — что писать в строку записи", () => {
  it("продукт в граммах: grams заполнено, servings = null", () => {
    const r = resolveAmount(chicken, { kind: "grams", grams: 150 });
    expect(r.grams).toBe(150);
    expect(r.servings).toBeNull();
    expect(r.nutrients).toEqual(
      nutrientsForAmount(chicken, { kind: "grams", grams: 150 }),
    );
  });

  it("продукт в штуках: grams = pieces × gramsPerPiece (штуки резолвятся в граммы)", () => {
    const r = resolveAmount(egg, { kind: "pieces", pieces: 2 });
    expect(r.grams).toBe(120);
    expect(r.servings).toBeNull();
  });

  it("рецепт в порциях: servings заполнено, grams = null", () => {
    const r = resolveAmount(soup, { kind: "servings", servings: 2 });
    expect(r.servings).toBe(2);
    expect(r.grams).toBeNull();
  });
});

describe("presetsForFood — чипсы-пресеты над теми же полями", () => {
  it("рецепт: ½ / 1 / 1½ порции", () => {
    const presets = presetsForFood(soup);
    expect(presets.map((p) => p.amount)).toEqual([
      { kind: "servings", servings: 0.5 },
      { kind: "servings", servings: 1 },
      { kind: "servings", servings: 1.5 },
    ]);
  });

  it("продукт со штучным эквивалентом: «1 шт» и «100 г»", () => {
    const presets = presetsForFood(egg);
    expect(presets.map((p) => p.amount)).toEqual([
      { kind: "pieces", pieces: 1 },
      { kind: "grams", grams: 100 },
    ]);
  });

  it("продукт без gramsPerPiece: только «100 г» (штучный пресет скрыт)", () => {
    const presets = presetsForFood(chicken);
    expect(presets.map((p) => p.amount)).toEqual([{ kind: "grams", grams: 100 }]);
  });
});

describe("снапшот неизменяем при последующем изменении данных еды", () => {
  it("мутация per100 после расчёта не меняет ранее посчитанный снапшот", () => {
    const food: AmountFood = {
      source: "ingredient",
      per100: { ...chicken100 },
      gramsPerPiece: null,
    };
    const snap = nutrientsForAmount(food, { kind: "grams", grams: 100 });
    const before = { ...snap };
    // Позже продукт в базе поправили (изменили исходные данные).
    food.per100.kcal = 999;
    food.per100.protein = 1;
    expect(snap).toEqual(before);
  });

  it("снапшот — самостоятельный объект (не ссылка на per100)", () => {
    const snap = nutrientsForAmount(chicken, { kind: "grams", grams: 100 });
    expect(snap).not.toBe(chicken.source === "ingredient" ? chicken.per100 : null);
  });
});
