import { describe, it, expect } from "vitest";
import { summarize } from "./aggregate";
import type { DiaryEntry, DiaryNutrients } from "./types";

// Хелпер: запись с заданным слотом и снапшотом (остальные поля не важны для сумм).
let seq = 0;
function entry(
  slot: DiaryEntry["slot"],
  n: Partial<DiaryNutrients>,
): DiaryEntry {
  return {
    id: `e${seq++}`,
    date: "2026-09-09",
    slot,
    source: "recipe",
    refId: "r1",
    grams: null,
    servings: 1,
    nutrients: { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, ...n },
    suggestedRecipeId: null,
  };
}

describe("summarize", () => {
  it("пустой день → 4 приёма в каноническом порядке с нулями и нулевой суммой", () => {
    const { perSlot, totals } = summarize([]);
    expect(perSlot.map((s) => s.slot)).toEqual([
      "breakfast",
      "lunch",
      "dinner",
      "snack",
    ]);
    for (const s of perSlot) {
      expect(s.entries).toEqual([]);
      expect(s.totals).toEqual({ kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
    }
    expect(totals).toEqual({ kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 });
  });

  it("суммирует КБЖУ по приёму и за день", () => {
    const entries = [
      entry("breakfast", { kcal: 300, protein: 20, fat: 10, carb: 30, fiber: 4 }),
      entry("breakfast", { kcal: 150, protein: 5, fat: 5, carb: 20, fiber: 2 }),
      entry("dinner", { kcal: 600, protein: 40, fat: 20, carb: 50, fiber: 8 }),
    ];
    const { perSlot, totals } = summarize(entries);

    const bySlot = Object.fromEntries(perSlot.map((s) => [s.slot, s]));
    expect(bySlot.breakfast.entries).toHaveLength(2);
    expect(bySlot.breakfast.totals).toEqual({
      kcal: 450,
      protein: 25,
      fat: 15,
      carb: 50,
      fiber: 6,
    });
    expect(bySlot.lunch.entries).toEqual([]);
    expect(bySlot.dinner.totals).toEqual({
      kcal: 600,
      protein: 40,
      fat: 20,
      carb: 50,
      fiber: 8,
    });

    expect(totals).toEqual({
      kcal: 1050,
      protein: 65,
      fat: 35,
      carb: 100,
      fiber: 14,
    });
  });

  it("сохраняет порядок записей внутри приёма как во входе", () => {
    const a = entry("lunch", { kcal: 100 });
    const b = entry("lunch", { kcal: 200 });
    const { perSlot } = summarize([b, a]);
    const lunch = perSlot.find((s) => s.slot === "lunch")!;
    expect(lunch.entries.map((e) => e.id)).toEqual([b.id, a.id]);
  });
});
