import { describe, it, expect } from "vitest";
import { INGREDIENTS, RECIPES } from "../../../prisma/seed-data";
import type { Allergen, Slot, Unit } from "../../../prisma/seed-data";

// Полнота стартового каталога (тикет 21): база наполнена целиком —
// ~211 продуктов из research/products-ru.md и 60–80 собственных рецептов.
// Тест сторожит объём и целостность набора: уникальные ключи, валидные
// единицы/аллергены, ссылочная целостность рецептов, покрытие по слотам.
// Правдоподобность КБЖУ каждого рецепта проверяет recipe.test.ts.

const VALID_UNITS: Unit[] = ["g", "ml", "pcs"];
const VALID_ALLERGENS: Allergen[] = [
  "milk",
  "gluten",
  "egg",
  "fish",
  "meat",
  "poultry",
  "nuts",
  "soy",
];
const ALL_SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];

describe("каталог продуктов", () => {
  it("наполнен полностью (~211 продуктов)", () => {
    expect(INGREDIENTS.length).toBeGreaterThanOrEqual(205);
  });

  it("ключи (slug) уникальны", () => {
    const slugs = INGREDIENTS.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("единицы измерения валидны", () => {
    for (const i of INGREDIENTS) {
      expect(VALID_UNITS, i.slug).toContain(i.unit);
    }
  });

  it("штучные продукты знают массу штуки, весовые/жидкие — нет", () => {
    for (const i of INGREDIENTS) {
      if (i.unit === "pcs") {
        expect(i.gramsPerPiece, `${i.slug}: pcs без gramsPerPiece`).toBeGreaterThan(0);
      } else {
        expect(i.gramsPerPiece ?? undefined, `${i.slug}: gramsPerPiece у ${i.unit}`).toBeUndefined();
      }
    }
  });

  it("аллергены — только из допустимого набора", () => {
    for (const i of INGREDIENTS) {
      for (const a of i.allergens) {
        expect(VALID_ALLERGENS, `${i.slug} → ${a}`).toContain(a);
      }
    }
  });

  it("нутриенты, фасовка, цена и срок неотрицательны", () => {
    for (const i of INGREDIENTS) {
      for (const [field, v] of Object.entries({
        kcal: i.kcal,
        protein: i.protein,
        fat: i.fat,
        carb: i.carb,
        fiber: i.fiber,
        sodium: i.sodium,
        packSize: i.packSize,
        pricePerPack: i.pricePerPack,
        shelfLifeDays: i.shelfLifeDays,
      })) {
        expect(v, `${i.slug}.${field}`).toBeGreaterThanOrEqual(0);
      }
      expect(i.packSize, `${i.slug}.packSize`).toBeGreaterThan(0);
      expect(i.name.trim().length, `${i.slug}: пустое имя`).toBeGreaterThan(0);
      expect(i.group.trim().length, `${i.slug}: пустая группа`).toBeGreaterThan(0);
    }
  });

  it("каталог покрывает все ключевые группы, включая напитки и заморозку", () => {
    const groups = new Set(INGREDIENTS.map((i) => i.group));
    for (const g of ["Напитки", "Замороженное"]) {
      expect(groups, `нет группы «${g}»`).toContain(g);
    }
    // Достаточное разнообразие групп для генератора.
    expect(groups.size).toBeGreaterThanOrEqual(12);
  });
});

describe("каталог рецептов", () => {
  it("собственных рецептов 60–80", () => {
    expect(RECIPES.length).toBeGreaterThanOrEqual(60);
    expect(RECIPES.length).toBeLessThanOrEqual(80);
  });

  it("ключи (slug) уникальны", () => {
    const slugs = RECIPES.map((r) => r.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("каждый рецепт имеет слот, состав и хотя бы одну технику", () => {
    for (const r of RECIPES) {
      expect(r.slots.length, `${r.slug}: нет слота`).toBeGreaterThan(0);
      expect(r.items.length, `${r.slug}: пустой состав`).toBeGreaterThan(0);
      expect(r.equipment.length, `${r.slug}: нет техники`).toBeGreaterThan(0);
      expect(r.steps.length, `${r.slug}: нет шагов`).toBeGreaterThan(0);
      expect(r.servings, `${r.slug}: порций < 1`).toBeGreaterThanOrEqual(1);
    }
  });

  it("состав ссылается только на существующие продукты", () => {
    const known = new Set(INGREDIENTS.map((i) => i.slug));
    for (const r of RECIPES) {
      for (const it of r.items) {
        expect(known.has(it.ingredient), `${r.slug} → ${it.ingredient}`).toBe(true);
        expect(it.grams, `${r.slug}/${it.ingredient}: граммы ≤ 0`).toBeGreaterThan(0);
      }
    }
  });

  it("каждый слот покрыт достаточным числом рецептов (≥6)", () => {
    for (const slot of ALL_SLOTS) {
      const n = RECIPES.filter((r) => r.slots.includes(slot)).length;
      expect(n, `слот ${slot}: только ${n} рецептов`).toBeGreaterThanOrEqual(6);
    }
  });

  it("есть вегетарианские, веганские и пескетарианские варианты", () => {
    const withTag = (tag: string) => RECIPES.filter((r) => r.diet.includes(tag as never)).length;
    expect(withTag("vegetarian"), "мало вегетарианских").toBeGreaterThanOrEqual(8);
    expect(withTag("vegan"), "мало веганских").toBeGreaterThanOrEqual(4);
    expect(withTag("pescatarian"), "мало пескетарианских").toBeGreaterThanOrEqual(3);
  });
});
