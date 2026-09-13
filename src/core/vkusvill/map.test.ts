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
    // Развес: price.current (95 ₽/кг) приводится к packSize: 95·900/1000 = 85.5.
    expect(ing.pricePerPack).toBe(85.5);
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

// Живая форма карточки ВВ (сверено с MCP, тикет 06): weight — объект {value,unit},
// category — массив узлов лист→корень, КБЖУ строчными с точкой и хвостом «Поставщики:».
describe("productToIngredient — реальная (живая) форма ответа", () => {
  const liveMilk: VvProduct = {
    id: 173,
    xml_id: 173,
    name: "Молоко 3,2%, 1 л",
    price: { current: 93 },
    unit: "шт",
    weight: { value: 1, unit: "кг" },
    category: [
      { id: 50390, name: "Молоко, сливки, сгущёнка" },
      { id: 50388, name: "Молочные продукты, яйцо" },
    ],
    properties: [
      {
        name: "Пищевая и энергетическая ценность в 100 г",
        value:
          'ООО "ЛЕБЕДЯНЬМОЛОКО": белки 3 г, жиры 3.2 г, углеводы 4.7 г; 60 ккал<br>ООО "КОСМОЛ": белки 3 г, жиры 3.2 г, углеводы 4.7 г; 59.6 ккал',
      },
    ],
  };

  it("объектный weight → gramsPerPiece/packSize (не NaN)", () => {
    const ing = productToIngredient(liveMilk)!;
    expect(ing.unit).toBe("pcs");
    expect(ing.gramsPerPiece).toBe(1000);
    expect(ing.packSize).toBe(1);
    expect(Number.isNaN(ing.gramsPerPiece)).toBe(false);
  });

  it("КБЖУ строчными с точкой и «; ккал» парсится, варианты усредняются", () => {
    const ing = productToIngredient(liveMilk)!;
    expect(ing.proteinPer100).toBe(3);
    expect(ing.fatPer100).toBe(3.2);
    expect(ing.carbPer100).toBe(4.7);
    expect(ing.kcalPer100).toBe(59.8); // (60 + 59.6) / 2
  });

  it("массив category (лист→корень) → русская подпись группы", () => {
    expect(productToIngredient(liveMilk)!.group).toBe("Молочные продукты");
  });

  it("хвост «Поставщики:…» не мешает разбору единственного варианта", () => {
    const curd: VvProduct = {
      id: 185,
      xml_id: 185,
      name: "Творог 5%, 400 г",
      price: { current: 198 },
      unit: "шт",
      weight: { value: 0.4, unit: "кг" },
      category: [{ name: "Творог" }, { name: "Молочные продукты, яйцо" }],
      properties: [
        {
          name: "Пищевая и энергетическая ценность в 100 г",
          value: 'белки 16 г, жиры 5 г, углеводы 3 г; 121 ккал Поставщики:ООО "НИКОН";ООО "КОСМОЛ"',
        },
      ],
    };
    const ing = productToIngredient(curd)!;
    expect(ing.proteinPer100).toBe(16);
    expect(ing.kcalPer100).toBe(121);
    expect(ing.gramsPerPiece).toBe(400);
  });

  it("весовой (кг) без weight → packSize фолбэк, не падает", () => {
    const fillet: VvProduct = {
      id: 488,
      xml_id: 488,
      name: "Филе грудки цыпленка-бройлера",
      price: { current: 645 },
      unit: "кг",
      weight: null,
      category: [{ name: "Курица" }, { name: "Мясо, птица" }],
      properties: [{ value: "белки 20 г, жиры 4 г, ; 116 ккал" }],
    };
    const ing = productToIngredient(fillet)!;
    expect(ing.unit).toBe("g");
    expect(ing.packSize).toBe(100); // фолбэк развеса без веса
    // Развес: 645 ₽/кг → цена за 100 г фолбэка = 64.5 (а не полные 645 за 100 г).
    expect(ing.pricePerPack).toBe(64.5);
    expect(ing.group).toBe("Мясо и птица");
    expect(ing.carbPer100).toBe(0); // углеводов в строке нет
  });

  it("нулевая/битая масса → packSize фолбэк, а не 0 (нет деления на 0 в смете)", () => {
    const zeroWeight: VvProduct = {
      id: 999,
      xml_id: 999,
      name: "Развес с битой массой",
      price: { current: 200 }, // ₽/кг
      unit: "кг",
      weight: { value: 0, unit: "кг" },
      category: [{ name: "Овощи" }],
      properties: [{ value: "белки 1 г, жиры 0 г, углеводы 5 г; 25 ккал" }],
    };
    const ing = productToIngredient(zeroWeight)!;
    expect(ing.packSize).toBe(100); // 0 не должен стать packSize=0
    expect(ing.pricePerPack).toBe(20); // 200·100/1000
    expect(ing.gramsPerPiece).toBeNull();
  });

  it("товар без КБЖУ (свежие огурцы) → null, не источится", () => {
    const cucumber: VvProduct = {
      id: 16645,
      xml_id: 16645,
      name: "Огурцы гладкие",
      price: { current: 160 },
      unit: "кг",
      weight: null,
      category: [{ name: "Огурцы" }, { name: "Овощи" }],
      properties: [
        { name: "Пищевая и энергетическая ценность в 100 г", value: "" },
        { name: "Состав", value: "Огурцы гладкие" },
      ],
    };
    expect(productToIngredient(cucumber)).toBeNull();
  });
});

describe("categoryToGroup — категория ВВ → русская подпись группы", () => {
  it("массив категорий: первое имя с не-дефолтной группой (лист→корень)", () => {
    expect(categoryToGroup([{ name: "Яйцо" }, { name: "Молочные продукты, яйцо" }])).toBe("Яйца");
    expect(categoryToGroup([{ name: "Огурцы" }, { name: "Овощи" }])).toBe("Овощи");
    expect(categoryToGroup([{ name: "Курица" }, { name: "Мясо, птица" }])).toBe("Мясо и птица");
    expect(categoryToGroup([])).toBe("Бакалея");
  });

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
