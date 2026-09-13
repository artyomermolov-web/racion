import { describe, it, expect } from "vitest";
import { matchIngredient, normalizeName } from "./match";

// Мэтчер «seed-ингредиент ↔ товар ВВ» (тикет 02, spec.md шов 1, Q5=b/Q9=c).
// Проверяем внешнее поведение чистой функции: нормализацию названий, порог
// уверенности и возврат null при неоднозначности (не угадываем).

describe("normalizeName — нормализация названий продуктов", () => {
  it("регистр, ё→е, лишние пробелы", () => {
    expect(normalizeName("  Гречка   ЯДРИЦА ")).toBe("гречка ядрица");
    expect(normalizeName("Свёкла")).toBe("свекла");
  });

  it("десятичная запятая → точка, кавычки/скобки вырезаются", () => {
    expect(normalizeName("Молоко 3,2%")).toBe("молоко 3.2%");
    expect(normalizeName('Сыр «Российский» 50%')).toBe("сыр российский 50%");
  });
});

// Кандидаты — товары ВВ (форма: имя + группа); мэтчер обобщён по T, чтобы синк мог
// передавать любую структуру с name/group.
const vv = (name: string, group?: string) => ({ name, group, tag: name });

describe("matchIngredient — уверенный мэтч", () => {
  it("точное совпадение имени → тот кандидат", () => {
    const seed = { name: "Гречка ядрица", group: "Крупы и макароны" };
    const candidates = [vv("Огурцы гладкие"), vv("Гречка ядрица"), vv("Творог 5%")];
    expect(matchIngredient(seed, candidates)?.tag).toBe("Гречка ядрица");
  });

  it("совпадение по общим значимым словам при разном порядке/шуме", () => {
    const seed = { name: "Молоко 3.2%", group: "Молочные продукты" };
    const candidates = [vv("Молоко пастеризованное 3,2%"), vv("Кефир 2,5%")];
    expect(matchIngredient(seed, candidates)?.tag).toBe("Молоко пастеризованное 3,2%");
  });
});

describe("matchIngredient — ничего не подходит", () => {
  it("нет близких кандидатов → null (остаётся seed-фолбэк)", () => {
    const seed = { name: "Гречка ядрица", group: "Крупы и макароны" };
    const candidates = [vv("Огурцы гладкие"), vv("Творог 5%")];
    expect(matchIngredient(seed, candidates)).toBeNull();
  });

  it("пустой список кандидатов → null", () => {
    expect(matchIngredient({ name: "Гречка ядрица" }, [] as ReturnType<typeof vv>[])).toBeNull();
  });
});

describe("matchIngredient — неоднозначность (не угадываем)", () => {
  it("два одинаково близких кандидата над порогом → null", () => {
    // «Творог» одинаково близок и к 5%, и к 9% — уверенно выбрать нельзя.
    const seed = { name: "Творог", group: "Молочные продукты" };
    const candidates = [vv("Творог 5%"), vv("Творог 9%")];
    expect(matchIngredient(seed, candidates)).toBeNull();
  });

  it("явный лидер среди похожих → он и выбран (не null)", () => {
    // Точное «Творог 5%» побеждает «Творог 9%» с заметным отрывом.
    const seed = { name: "Творог 5%", group: "Молочные продукты" };
    const candidates = [vv("Творог 9%"), vv("Творог 5%")];
    expect(matchIngredient(seed, candidates)?.tag).toBe("Творог 5%");
  });

  it("ничью по имени разрешает совпадение группы", () => {
    // Оба «Молоко 3.2%» по имени идентичны; выбираем того, чья группа совпала.
    const seed = { name: "Молоко 3.2%", group: "Молочные продукты" };
    const candidates = [
      vv("Молоко 3,2%", "Напитки"),
      vv("Молоко 3,2%", "Молочные продукты"),
    ];
    const m = matchIngredient(seed, candidates);
    expect(m?.tag).toBe("Молоко 3,2%");
    expect(m?.group).toBe("Молочные продукты");
  });

  it("ничья по имени и группа не различает → null", () => {
    const seed = { name: "Молоко 3.2%", group: "Молочные продукты" };
    const candidates = [
      vv("Молоко 3,2%", "Молочные продукты"),
      vv("Молоко 3,2%", "Молочные продукты"),
    ];
    expect(matchIngredient(seed, candidates)).toBeNull();
  });
});

// Ориентация вызова из синка (ре-сорс): запрос — товар ВВ, кандидаты — seed-строки
// каталога. Матчер симметричен, но синк ходит именно так — фиксируем поведение.
describe("matchIngredient — ориентация ре-сорса (товар ВВ → seed-строки)", () => {
  const seedRow = (id: string, name: string, group: string) => ({ id, name, group });
  const SEED_ROWS = [
    seedRow("grechka", "Гречка ядрица", "Крупы и макароны"),
    seedRow("moloko32", "Молоко 3.2%", "Молочные продукты"),
    seedRow("moloko25", "Молоко 2.5%", "Молочные продукты"),
    seedRow("ogurcy", "Огурцы", "Овощи"),
  ];

  it("товар ВВ ре-сорсит уверенно сопоставленную seed-строку (возвращает её id)", () => {
    const vvProduct = { name: "Молоко пастеризованное 3,2%", group: "Молочные продукты" };
    expect(matchIngredient(vvProduct, SEED_ROWS)?.id).toBe("moloko32");
  });

  it("несопоставимый товар ВВ → null (seed-строка останется фолбэком)", () => {
    const vvProduct = { name: "Филе грудки цыплёнка-бройлера", group: "Мясо и птица" };
    expect(matchIngredient(vvProduct, SEED_ROWS)).toBeNull();
  });
});
