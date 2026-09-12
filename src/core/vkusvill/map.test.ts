import { describe, it, expect } from "vitest";
import { productToIngredient, categoryToGroup } from "./map";
import type { VvProduct } from "./types";

// Маппинг «Товар ВВ → поля Ingredient» (spec.md шов 1, Implementation Decisions
// Q10). Проверяем внешнее поведение: штучный/весовой, перенос скидки в отдельные
// поля, категория→русская подпись группы, провенанс vkusvill.

const weightProduct: VvProduct = {
  id: 40100,
  xml_id: "0040100",
  name: "Молоко пастеризованное 3,2%",
  price: { current: 89.9, old: 99.9, discount_percent: 10 },
  unit: "шт", // ВВ отдаёт бутылку молока штучно, масса — в weight (кг)
  weight: 0.93,
  category: { id: 12, name: "Молоко, сыр, яйцо" },
  properties: [
    { name: "Пищевая ценность", value: "Белки 2,9 г, жиры 3,2 г, углеводы 4,7 г, 59 ккал" },
  ],
};

const bulkProduct: VvProduct = {
  id: 500,
  xml_id: 500,
  name: "Гречка ядрица",
  price: { current: 95 },
  unit: "кг",
  weight: 0.9,
  category: { name: "Бакалея, крупы и макароны" },
  properties: [{ value: "Белки 12,6 г, жиры 3,3 г, углеводы 62 г, 343 ккал" }],
};

describe("productToIngredient — штучный товар", () => {
  it("unit=pcs, gramsPerPiece из веса, packSize=1, цена=current", () => {
    const ing = productToIngredient(weightProduct)!;
    expect(ing.unit).toBe("pcs");
    expect(ing.gramsPerPiece).toBe(930);
    expect(ing.packSize).toBe(1);
    expect(ing.pricePerPack).toBe(89.9);
  });

  it("КБЖУ берётся из распарсенной строки", () => {
    const ing = productToIngredient(weightProduct)!;
    expect(ing.kcalPer100).toBe(59);
    expect(ing.proteinPer100).toBe(2.9);
    expect(ing.fatPer100).toBe(3.2);
    expect(ing.carbPer100).toBe(4.7);
  });

  it("скидка уходит в отдельные поля, смета — по current", () => {
    const ing = productToIngredient(weightProduct)!;
    expect(ing.vvPriceOld).toBe(99.9);
    expect(ing.vvDiscountPct).toBe(10);
    expect(ing.pricePerPack).toBe(89.9); // не old, не по карте
  });

  it("провенанс vkusvill, vvXmlId строкой", () => {
    const ing = productToIngredient(weightProduct)!;
    expect(ing.source).toBe("vkusvill");
    expect(ing.vvXmlId).toBe("0040100");
  });
});

describe("productToIngredient — весовой товар", () => {
  it("unit=g, packSize из веса (в граммах), gramsPerPiece=null", () => {
    const ing = productToIngredient(bulkProduct)!;
    expect(ing.unit).toBe("g");
    expect(ing.packSize).toBe(900);
    expect(ing.gramsPerPiece).toBeNull();
    expect(ing.pricePerPack).toBe(95);
  });

  it("без скидки поля скидки — null, vvXmlId из числа", () => {
    const ing = productToIngredient(bulkProduct)!;
    expect(ing.vvPriceOld).toBeNull();
    expect(ing.vvDiscountPct).toBeNull();
    expect(ing.vvXmlId).toBe("500");
  });
});

describe("productToIngredient — крайние случаи", () => {
  it("null, если КБЖУ-строку не распарсить (нельзя источить настоящие цифры)", () => {
    const noNutrition: VvProduct = {
      ...bulkProduct,
      properties: [{ name: "Состав", value: "гречневая крупа" }],
    };
    expect(productToIngredient(noNutrition)).toBeNull();
  });

  it("весовой без веса → packSize фолбэк 100 г, не падает", () => {
    const noWeight: VvProduct = { ...bulkProduct, weight: null };
    const ing = productToIngredient(noWeight)!;
    expect(ing.unit).toBe("g");
    expect(ing.packSize).toBeGreaterThan(0);
  });
});

describe("categoryToGroup — категория ВВ → русская подпись группы", () => {
  it("сопоставляет по ключевым словам названия", () => {
    expect(categoryToGroup({ name: "Молоко, сыр, яйцо" })).toBe("Молочные продукты");
    expect(categoryToGroup({ name: "Мясо и птица" })).toBe("Мясо и птица");
    expect(categoryToGroup({ name: "Рыба и морепродукты" })).toBe("Рыба и морепродукты");
    expect(categoryToGroup({ name: "Овощи и зелень" })).toBe("Овощи");
    expect(categoryToGroup({ name: "Бакалея, крупы и макароны" })).toBe("Крупы и макароны");
  });

  it("неизвестная/пустая категория → Бакалея (фолбэк)", () => {
    expect(categoryToGroup({ name: "Товары для дома" })).toBe("Бакалея");
    expect(categoryToGroup(null)).toBe("Бакалея");
    expect(categoryToGroup(undefined)).toBe("Бакалея");
  });
});
