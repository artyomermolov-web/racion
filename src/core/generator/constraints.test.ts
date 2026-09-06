import { describe, it, expect } from "vitest";
import { filterCandidates } from "./constraints";
import type { GeneratorRecipe, MealSlot } from "./types";
import type { FoodNutrients } from "@/core/nutrition";

// Жёсткие ограничения (тикет 06 шаг 1, тикет 14): аллергены, совместимость
// слота, техника, время отсекают кандидатов ДО скоринга. Тесты «на утечки» —
// ни один запрещённый кандидат не должен просочиться в пул слота.

const N: FoodNutrients = {
  kcal: 400,
  protein: 20,
  fat: 10,
  carb: 50,
  fiber: 5,
  sodium: 100,
};

function recipe(over: Partial<GeneratorRecipe>): GeneratorRecipe {
  return {
    id: "r",
    slots: ["lunch"],
    timeMin: 20,
    equipment: ["stove"],
    allergens: [],
    perServing: N,
    ...over,
  };
}

function slot(over: Partial<MealSlot> = {}): MealSlot {
  return {
    slot: "lunch",
    kcalShare: 0.35,
    cookTimeMin: 60,
    canCook: true,
    availableEquipment: ["stove", "oven", "blender", "multicooker", "none"],
    ...over,
  };
}

describe("filterCandidates — жёсткие ограничения по слоту", () => {
  it("отсекает блюдо с исключённым аллергеном (утечка аллергена)", () => {
    const clean = recipe({ id: "clean", allergens: ["gluten"] });
    const milk = recipe({ id: "milk", allergens: ["milk", "gluten"] });
    const out = filterCandidates([clean, milk], slot(), {
      excludedAllergens: ["milk"],
    });
    expect(out.map((r) => r.id)).toEqual(["clean"]);
  });

  it("несовместимый со слотом рецепт не проходит", () => {
    const breakfast = recipe({ id: "b", slots: ["breakfast"] });
    const lunch = recipe({ id: "l", slots: ["lunch", "dinner"] });
    const out = filterCandidates([breakfast, lunch], slot({ slot: "lunch" }), {
      excludedAllergens: [],
    });
    expect(out.map((r) => r.id)).toEqual(["l"]);
  });

  it("отсекает блюдо, которое дольше доступного времени приёма", () => {
    const quick = recipe({ id: "q", timeMin: 20 });
    const slow = recipe({ id: "s", timeMin: 90 });
    const out = filterCandidates([quick, slow], slot({ cookTimeMin: 30 }), {
      excludedAllergens: [],
    });
    expect(out.map((r) => r.id)).toEqual(["q"]);
  });

  it("при canCook=false берёт только блюда без готовки (equipment=none)", () => {
    const raw = recipe({ id: "raw", equipment: ["none"] });
    const cooked = recipe({ id: "cooked", equipment: ["stove"] });
    const out = filterCandidates([raw, cooked], slot({ canCook: false }), {
      excludedAllergens: [],
    });
    expect(out.map((r) => r.id)).toEqual(["raw"]);
  });

  it("отсекает блюдо, требующее недоступную технику", () => {
    const stove = recipe({ id: "stove", equipment: ["stove"] });
    const oven = recipe({ id: "oven", equipment: ["oven"] });
    const out = filterCandidates([stove, oven], slot({ availableEquipment: ["stove", "none"] }), {
      excludedAllergens: [],
    });
    expect(out.map((r) => r.id)).toEqual(["stove"]);
  });

  it("несколько исключённых аллергенов: проходит только чистое блюдо", () => {
    const a = recipe({ id: "a", allergens: ["fish"] });
    const b = recipe({ id: "b", allergens: ["nuts"] });
    const c = recipe({ id: "c", allergens: [] });
    const out = filterCandidates([a, b, c], slot(), {
      excludedAllergens: ["fish", "nuts"],
    });
    expect(out.map((r) => r.id)).toEqual(["c"]);
  });
});
