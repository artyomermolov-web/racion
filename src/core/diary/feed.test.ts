import { describe, it, expect } from "vitest";
import { assembleDayFeed } from "./feed";
import type { DiaryEntry, DiaryNutrients, PlanMeal } from "./types";

// Хелперы: минимальные фикстуры плана и записей (для сумм важны только нутриенты).
function plan(
  slot: PlanMeal["slot"],
  recipeId: string,
  n: Partial<DiaryNutrients> = {},
): PlanMeal {
  return {
    slot,
    recipeId,
    portion: 1,
    nutrients: { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, ...n },
  };
}

let seq = 0;
function entry(
  slot: DiaryEntry["slot"],
  over: Partial<DiaryEntry> = {},
  n: Partial<DiaryNutrients> = {},
): DiaryEntry {
  return {
    id: `e${seq++}`,
    date: "2026-09-11",
    slot,
    source: "recipe",
    refId: "r1",
    grams: null,
    servings: 1,
    nutrients: { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, ...n },
    suggestedRecipeId: null,
    ...over,
  };
}

const zero: DiaryNutrients = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 };

describe("assembleDayFeed — пустой день", () => {
  it("нет плана и записей → 4 приёма в каноническом порядке, пустые, нулевая сумма", () => {
    const { perSlot, totals } = assembleDayFeed([], []);
    expect(perSlot.map((s) => s.slot)).toEqual([
      "breakfast",
      "lunch",
      "dinner",
      "snack",
    ]);
    for (const s of perSlot) {
      expect(s.items).toEqual([]);
      expect(s.totals).toEqual(zero);
    }
    expect(totals).toEqual(zero);
  });

  it("только план → все позиции suggested (нет записей — нечего есть)", () => {
    const { perSlot } = assembleDayFeed(
      [plan("breakfast", "r1", { kcal: 300 }), plan("dinner", "r2", { kcal: 600 })],
      [],
    );
    const bySlot = Object.fromEntries(perSlot.map((s) => [s.slot, s]));
    expect(bySlot.breakfast.items).toHaveLength(1);
    expect(bySlot.breakfast.items[0].status).toBe("suggested");
    expect(bySlot.breakfast.items[0].suggestion?.recipeId).toBe("r1");
    expect(bySlot.breakfast.items[0].entry).toBeNull();
    expect(bySlot.breakfast.totals.kcal).toBe(300);
    expect(bySlot.dinner.items[0].status).toBe("suggested");
  });
});

describe("assembleDayFeed — частично съеденный (микс)", () => {
  it("под предложенный приём есть запись → одна позиция eaten, без дубля suggested", () => {
    const meals = [
      plan("breakfast", "r1", { kcal: 300 }),
      plan("dinner", "r2", { kcal: 600 }),
    ];
    // Завтрак съеден по плану (запись помечена происхождением r1); ужин ещё нет.
    const entries = [
      entry("breakfast", { suggestedRecipeId: "r1", refId: "r1" }, { kcal: 320 }),
    ];
    const { perSlot } = assembleDayFeed(meals, entries);
    const bySlot = Object.fromEntries(perSlot.map((s) => [s.slot, s]));

    expect(bySlot.breakfast.items).toHaveLength(1);
    const eaten = bySlot.breakfast.items[0];
    expect(eaten.status).toBe("eaten");
    expect(eaten.suggestion?.recipeId).toBe("r1");
    expect(eaten.entry?.id).toBe(entries[0].id);
    // КБЖУ позиции — снапшот съеденного (320), не плановые 300.
    expect(eaten.nutrients.kcal).toBe(320);
    expect(bySlot.breakfast.totals.kcal).toBe(320);

    expect(bySlot.dinner.items[0].status).toBe("suggested");
  });

  it("запись того же слота, но с другим происхождением, не закрывает предложение", () => {
    const meals = [plan("breakfast", "r1", { kcal: 300 })];
    // Съеден другой рецепт (r9) на завтрак — предложение r1 остаётся suggested,
    // а r9 попадает как extra.
    const entries = [
      entry("breakfast", { suggestedRecipeId: "r9", refId: "r9" }, { kcal: 100 }),
    ];
    const { perSlot } = assembleDayFeed(meals, entries);
    const breakfast = perSlot.find((s) => s.slot === "breakfast")!;
    expect(breakfast.items.map((i) => i.status)).toEqual(["suggested", "extra"]);
    expect(breakfast.totals.kcal).toBe(400);
  });
});

describe("assembleDayFeed — съеденное вне плана (extra)", () => {
  it("ручной лог без плановой позиции под ним → extra", () => {
    // Плана на перекус нет; запись есть — это extra.
    const { perSlot } = assembleDayFeed(
      [plan("lunch", "r1", { kcal: 500 })],
      [entry("snack", { suggestedRecipeId: null }, { kcal: 150, protein: 5 })],
    );
    const bySlot = Object.fromEntries(perSlot.map((s) => [s.slot, s]));
    expect(bySlot.lunch.items[0].status).toBe("suggested");

    const snack = bySlot.snack.items;
    expect(snack).toHaveLength(1);
    expect(snack[0].status).toBe("extra");
    expect(snack[0].suggestion).toBeNull();
    expect(snack[0].entry?.id).toBeDefined();
    expect(bySlot.snack.totals).toMatchObject({ kcal: 150, protein: 5 });

    // Сумма за день = план (500) + extra (150).
    expect(perSlot.reduce((s, x) => s + x.totals.kcal, 0)).toBe(650);
  });
});

describe("assembleDayFeed — продукт без рецепта", () => {
  it("продукт (source=ingredient, без suggestedRecipeId) попадает в ленту как extra без предложения", () => {
    const { perSlot } = assembleDayFeed(
      [],
      [
        entry(
          "breakfast",
          { source: "ingredient", refId: "ing-banana", grams: 120, servings: null },
          { kcal: 107, carb: 27, fiber: 3 },
        ),
      ],
    );
    const breakfast = perSlot.find((s) => s.slot === "breakfast")!;
    expect(breakfast.items).toHaveLength(1);
    const item = breakfast.items[0];
    expect(item.status).toBe("extra");
    // У extra нет плановой позиции → UI не рисует «заменить».
    expect(item.suggestion).toBeNull();
    expect(item.entry?.source).toBe("ingredient");
    expect(breakfast.totals).toMatchObject({ kcal: 107, carb: 27, fiber: 3 });
  });
});

describe("assembleDayFeed — идемпотентность статуса", () => {
  it("съеденный по плану приём остаётся одной eaten-позицией при повторной сборке", () => {
    const meals = [plan("breakfast", "r1", { kcal: 300 })];
    const entries = [
      entry("breakfast", { suggestedRecipeId: "r1", refId: "r1" }, { kcal: 300 }),
    ];
    const first = assembleDayFeed(meals, entries);
    const second = assembleDayFeed(meals, entries);
    expect(second).toEqual(first);

    const breakfast = second.perSlot.find((s) => s.slot === "breakfast")!;
    expect(breakfast.items).toHaveLength(1);
    expect(breakfast.items[0].status).toBe("eaten");
  });

  it("детерминизм: порядок extra-записей внутри приёма — как во входе", () => {
    const a = entry("lunch", { suggestedRecipeId: null }, { kcal: 100 });
    const b = entry("lunch", { suggestedRecipeId: null }, { kcal: 200 });
    const { perSlot } = assembleDayFeed([], [b, a]);
    const lunch = perSlot.find((s) => s.slot === "lunch")!;
    expect(lunch.items.map((i) => i.entry?.id)).toEqual([b.id, a.id]);
  });
});
