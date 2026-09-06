import { describe, it, expect } from "vitest";
import { generateDay, replaceDish, DEFAULT_DAY_LAYOUT } from "./generate";
import { PORTION_STEPS } from "./portions";
import type { GeneratorRecipe, DayTarget, MealSlot } from "./types";
import type { FoodNutrients } from "@/core/nutrition";
import type { Slot, Allergen } from "./types";
import { SEED_RECIPES } from "./seed-recipes.fixture";

// Сборка дня (тикет 14): жёсткие ограничения отсекают кандидатов, порции 0.25–2.0
// под цель, замена автодополняет под остаток дня, всё детерминированно по seed.
// Фикстура — реальный сид-набор (через ядро nutrition), чтобы тесты «на утечки»
// шли на тех же данных, что и приложение.

const ALL_RECIPES: GeneratorRecipe[] = SEED_RECIPES;

const TARGET: DayTarget = {
  kcal: 2000,
  protein: 140,
  fat: 65,
  carb: 220,
  fiber: 28,
};

const noConstraints = { excludedAllergens: [] as Allergen[] };

describe("generateDay — сборка дня под цель", () => {
  it("ставит по приёму на каждый слот раскладки", () => {
    const day = generateDay({
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 1,
    });
    expect(day.items).toHaveLength(DEFAULT_DAY_LAYOUT.length);
    day.items.forEach((it, i) => {
      expect(it.slot).toBe(DEFAULT_DAY_LAYOUT[i].slot);
    });
  });

  it("каждое блюдо совместимо со своим слотом", () => {
    const day = generateDay({
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 7,
    });
    for (const it of day.items) {
      const r = ALL_RECIPES.find((x) => x.id === it.recipeId)!;
      expect(r.slots).toContain(it.slot);
    }
  });

  it("все порции строго в диапазоне 0.25–2.0", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const day = generateDay({
        recipes: ALL_RECIPES,
        slots: DEFAULT_DAY_LAYOUT,
        target: TARGET,
        constraints: noConstraints,
        seed,
      });
      for (const it of day.items) {
        expect(PORTION_STEPS).toContain(it.portion);
        expect(it.portion).toBeGreaterThanOrEqual(0.25);
        expect(it.portion).toBeLessThanOrEqual(2.0);
      }
    }
  });

  it("исключённый аллерген никогда не просачивается ни в один приём", () => {
    // Молоко и глютен под запретом: во всех приёмах при любом seed — ни следа.
    const excluded: Allergen[] = ["milk", "gluten"];
    for (let seed = 1; seed <= 20; seed++) {
      const day = generateDay({
        recipes: ALL_RECIPES,
        slots: DEFAULT_DAY_LAYOUT,
        target: TARGET,
        constraints: { excludedAllergens: excluded },
        seed,
      });
      for (const it of day.items) {
        const r = ALL_RECIPES.find((x) => x.id === it.recipeId)!;
        for (const a of excluded) expect(r.allergens).not.toContain(a);
      }
    }
  });

  it("детерминизм: тот же seed → идентичный день", () => {
    const input = {
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 42,
    };
    expect(generateDay(input)).toEqual(generateDay(input));
  });

  it("totals = сумма КБЖУ приёмов", () => {
    const day = generateDay({
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 3,
    });
    const sum = day.items.reduce(
      (acc, it) => ({
        kcal: acc.kcal + it.nutrients.kcal,
        protein: acc.protein + it.nutrients.protein,
        fat: acc.fat + it.nutrients.fat,
        carb: acc.carb + it.nutrients.carb,
        fiber: acc.fiber + it.nutrients.fiber,
        sodium: acc.sodium + it.nutrients.sodium,
      }),
      { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, sodium: 0 },
    );
    expect(day.totals).toEqual(sum);
  });

  it("разные seed дают разнообразие (не все дни идентичны)", () => {
    const days = Array.from({ length: 12 }, (_, i) =>
      generateDay({
        recipes: ALL_RECIPES,
        slots: DEFAULT_DAY_LAYOUT,
        target: TARGET,
        constraints: noConstraints,
        seed: i + 1,
      }),
    );
    const signatures = new Set(
      days.map((d) => d.items.map((it) => it.recipeId).join("|")),
    );
    expect(signatures.size).toBeGreaterThan(1);
  });

  it("день собирается в разумную близость к цели ккал (±25%)", () => {
    const day = generateDay({
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 5,
    });
    expect(day.totals.kcal).toBeGreaterThan(TARGET.kcal * 0.75);
    expect(day.totals.kcal).toBeLessThan(TARGET.kcal * 1.25);
  });
});

describe("replaceDish — замена блюда с автодополнением под остаток дня", () => {
  const baseDay = () =>
    generateDay({
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 2,
    });

  it("возвращает другое блюдо, совместимое со слотом, порция в диапазоне", () => {
    const day = baseDay();
    const currentLunch = day.items.find((it) => it.slot === "lunch")!;
    const replaced = replaceDish({
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 99,
      current: day.items,
      slot: "lunch",
    });
    expect(replaced).not.toBeNull();
    expect(replaced!.recipeId).not.toBe(currentLunch.recipeId);
    expect(replaced!.slot).toBe("lunch");
    const r = ALL_RECIPES.find((x) => x.id === replaced!.recipeId)!;
    expect(r.slots).toContain(replaced!.slot);
    expect(PORTION_STEPS).toContain(replaced!.portion);
  });

  it("не ставит блюдо, уже стоящее в другом приёме дня", () => {
    const day = baseDay();
    const otherIds = new Set(
      day.items.filter((it) => it.slot !== "lunch").map((it) => it.recipeId),
    );
    const replaced = replaceDish({
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 5,
      current: day.items,
      slot: "lunch",
    });
    expect(otherIds.has(replaced!.recipeId)).toBe(false);
  });

  it("остаток исчерпан прочими приёмами → минимальная порция замены", () => {
    // Прочие приёмы уже дают всю дневную цель по ккал: остаток ≈ 0 → замена
    // берёт наименьшую порцию (0.25). Так видно, что подбор идёт под остаток.
    const others: { slot: Slot; recipeId: string; portion: number; nutrients: FoodNutrients }[] =
      (["breakfast", "dinner", "snack"] as Slot[]).map((s) => ({
        slot: s,
        recipeId: `filler-${s}`,
        portion: 1,
        nutrients: {
          kcal: Math.round(TARGET.kcal / 3),
          protein: 47,
          fat: 22,
          carb: 74,
          fiber: 10,
          sodium: 200,
        },
      }));
    const replaced = replaceDish({
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 4,
      current: others,
      slot: "lunch",
    });
    expect(replaced!.portion).toBe(0.25);
  });

  it("детерминизм замены: тот же seed → тот же результат", () => {
    const day = baseDay();
    const args = {
      recipes: ALL_RECIPES,
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      seed: 77,
      current: day.items,
      slot: "dinner" as Slot,
    };
    expect(replaceDish(args)).toEqual(replaceDish(args));
  });
});

describe("DEFAULT_DAY_LAYOUT — раскладка «тонкого» слоя", () => {
  it("доли ккал в сумме дают ~1", () => {
    const sum = DEFAULT_DAY_LAYOUT.reduce((a: number, s: MealSlot) => a + s.kcalShare, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});
