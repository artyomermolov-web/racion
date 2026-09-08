import { describe, it, expect } from "vitest";
import { generateDay, pantryBonus, DEFAULT_DAY_LAYOUT } from "./generate";
import { generateWeek } from "./week";
import type {
  GeneratorRecipe,
  DayTarget,
  MealSlot,
  NutrientRanges,
  Allergen,
} from "./types";

// Бонус кладовки (тикет 19, decision 06 шаг 4 «бонусы»): за использование
// домашних (real) продуктов генератор при прочих равных предпочитает блюдо из
// кладовки. Бонус — мягкий (вычитается из скоринга), КБЖУ остаётся приоритетом.

const N = { kcal: 500, protein: 30, fat: 15, carb: 55, fiber: 7, sodium: 300 };

const TARGET: DayTarget = { kcal: 2000, protein: 140, fat: 65, carb: 220, fiber: 28 };

const RANGES: NutrientRanges = {
  kcalMin: 1800, kcalMax: 2200,
  proteinMin: 126, proteinMax: 154,
  fatMin: 58, fatMax: 72,
  carbMin: 198, carbMax: 242,
  fiberMin: 28,
};

const noConstraints = { excludedAllergens: [] as Allergen[] };

const lunch = (id: string, ingredientIds?: string[]): GeneratorRecipe => ({
  id,
  slots: ["lunch"],
  timeMin: 20,
  equipment: ["none"],
  allergens: [],
  perServing: N,
  ...(ingredientIds ? { ingredientIds } : {}),
});

const LUNCH_SLOT: MealSlot[] = [
  { slot: "lunch", kcalShare: 1, cookTimeMin: 90, canCook: true, availableEquipment: ["none"] },
];

describe("pantryBonus — величина бонуса за домашние продукты", () => {
  it("растёт с числом домашних ингредиентов рецепта, capped; без запаса — 0", () => {
    const r = lunch("r", ["egg", "milk", "flour"]);
    expect(pantryBonus(r, [])).toBe(0);
    expect(pantryBonus(r, ["egg"])).toBeGreaterThan(0);
    expect(pantryBonus(r, ["egg", "milk"])).toBeGreaterThan(pantryBonus(r, ["egg"]));
    // Рецепт без состава — бонуса нет.
    expect(pantryBonus(lunch("x"), ["egg"])).toBe(0);
  });
});

describe("приоритет кладовки — при прочих равных берётся домашнее блюдо (тест #8, ticket 06)", () => {
  // Восемь равных по КБЖУ обедов; «домашний» намеренно с поздним id, чтобы без
  // бонуса он не попадал в «корзину выбора» (топ-3 по id). Бонус кладовки обязан
  // вытащить его в выбор — как в тесте избранного (ticket 16).
  const RECIPES = [...Array(7)].map((_, i) => lunch(`l${i}`)).concat(lunch("zhome", ["egg", "milk"]));

  const countHome = (pantryStockIds?: string[]) => {
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const day = generateDay({
        recipes: RECIPES,
        slots: LUNCH_SLOT,
        target: TARGET,
        constraints: noConstraints,
        pantryStockIds,
        seed,
      });
      if (day.items.some((it) => it.recipeId === "zhome")) n++;
    }
    return n;
  };

  it("без кладовки домашнее блюдо не выбирается, с запасом дома — выбирается", () => {
    expect(countHome(undefined)).toBe(0);
    expect(countHome(["egg", "milk"])).toBeGreaterThan(0);
  });
});

describe("бонус кладовки не перебивает КБЖУ", () => {
  it("блюдо из кладовки с плохими макросами не вытесняет точное по цели", () => {
    // fit — ровно на дневную цель. home — из кладовки, той же калорийности (порция
    // не спасёт), но с сильно перекошенными макросами: почти без белка, углеводный.
    // Отклонение КБЖУ большое и порцией не лечится → потолок бонуса кладовки его
    // не перебивает.
    const fit: GeneratorRecipe = {
      id: "afit",
      slots: ["lunch"],
      timeMin: 20,
      equipment: ["none"],
      allergens: [],
      perServing: { kcal: 2000, protein: 140, fat: 65, carb: 220, fiber: 28, sodium: 300 },
    };
    const home: GeneratorRecipe = {
      id: "bhome",
      slots: ["lunch"],
      timeMin: 20,
      equipment: ["none"],
      allergens: [],
      perServing: { kcal: 2000, protein: 10, fat: 10, carb: 480, fiber: 5, sodium: 300 },
      ingredientIds: ["egg", "milk", "flour"],
    };
    const week = generateWeek({
      recipes: [fit, home],
      slots: LUNCH_SLOT,
      days: 3,
      ranges: RANGES,
      dayTarget: TARGET,
      constraints: noConstraints,
      pantryStockIds: ["egg", "milk", "flour"],
      seed: 7,
    });
    for (const day of week.days) {
      const lunchItem = day.items.find((it) => it.slot === "lunch")!;
      expect(lunchItem.recipeId).toBe("afit");
    }
  });
});
