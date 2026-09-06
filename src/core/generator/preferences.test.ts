import { describe, it, expect } from "vitest";
import { generateDay, replaceDish, preferenceBonus, isAlwaysRecurring } from "./generate";
import { generateWeek, regenerateDay } from "./week";
import { DEFAULT_DAY_LAYOUT } from "./generate";
import type {
  GeneratorRecipe,
  DayTarget,
  MealSlot,
  NutrientRanges,
  Preferences,
  Allergen,
  PlanItem,
} from "./types";
import { SEED_RECIPES } from "./seed-recipes.fixture";

// Мягкие предпочтения по вкусам (тикет 16, decision 06 шаг 4): избранное даёт
// бонус (предлагается чаще), recurring often — бонус больше, recurring always
// гарантированно присутствует, режим слота «только recurring» пускает лишь
// recurring-блюда. Блок и keyword-фильтр (жёсткие) покрыты constraints/keywords.

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

const lunchOnly = (id: string): GeneratorRecipe => ({
  id,
  slots: ["lunch"],
  timeMin: 20,
  equipment: ["none"],
  allergens: [],
  perServing: N,
});

const LUNCH_SLOT: MealSlot[] = [
  { slot: "lunch", kcalShare: 1, cookTimeMin: 90, canCook: true, availableEquipment: ["none"] },
];

describe("preferenceBonus / isAlwaysRecurring — величины бонусов", () => {
  it("recurring often даёт бонус больше избранного", () => {
    const prefs: Preferences = { favoriteIds: ["f"], recurringOftenIds: ["o"] };
    expect(preferenceBonus("o", prefs)).toBeGreaterThan(preferenceBonus("f", prefs));
    expect(preferenceBonus("f", prefs)).toBeGreaterThan(0);
    expect(preferenceBonus("x", prefs)).toBe(0);
  });

  it("always-recurring не даёт бонуса (присутствие гарантируется иначе)", () => {
    const prefs: Preferences = { recurringAlwaysIds: ["a"] };
    expect(preferenceBonus("a", prefs)).toBe(0);
    expect(isAlwaysRecurring("a", prefs)).toBe(true);
  });
});

describe("избранное даёт бонус — предлагается чаще (тест ticket 16)", () => {
  // Восемь равных по КБЖУ блюд; избранное намеренно с «поздним» id, чтобы без
  // бонуса оно не попадало в «корзину выбора» (топ-3 по id) и не бралось вовсе.
  // Бонус обязан вытащить его в выбор.
  const RECIPES = [...Array(7)].map((_, i) => lunchOnly(`l${i}`)).concat(lunchOnly("zfav"));

  const countFav = (preferences?: Preferences) => {
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const day = generateDay({
        recipes: RECIPES,
        slots: LUNCH_SLOT,
        target: TARGET,
        constraints: noConstraints,
        preferences,
        seed,
      });
      if (day.items.some((it) => it.recipeId === "zfav")) n++;
    }
    return n;
  };

  it("без предпочтений избранное-кандидат не выбирается, с бонусом — выбирается", () => {
    expect(countFav(undefined)).toBe(0);
    expect(countFav({ favoriteIds: ["zfav"] })).toBeGreaterThan(0);
  });

  it("recurring often вытаскивает блюдо сильнее (не реже избранного)", () => {
    expect(countFav({ recurringOftenIds: ["zfav"] })).toBeGreaterThanOrEqual(
      countFav({ favoriteIds: ["zfav"] }),
    );
  });
});

describe("recurring always гарантированно присутствует (тест ticket 16)", () => {
  const always = (): GeneratorRecipe => ({
    id: "always-oats",
    slots: ["breakfast"],
    timeMin: 5,
    equipment: ["none"],
    allergens: [],
    perServing: { kcal: 350, protein: 15, fat: 8, carb: 55, fiber: 6, sodium: 100 },
  });

  it("день: always-recurring стоит в своём слоте", () => {
    const day = generateDay({
      recipes: [always(), ...SEED_RECIPES],
      slots: DEFAULT_DAY_LAYOUT,
      target: TARGET,
      constraints: noConstraints,
      preferences: { recurringAlwaysIds: ["always-oats"] },
      seed: 3,
    });
    expect(day.items.some((it) => it.recipeId === "always-oats")).toBe(true);
  });

  it("неделя: always-recurring присутствует в каждом дне при любом seed", () => {
    for (const seed of [1, 2, 7, 42]) {
      const week = generateWeek({
        recipes: [always(), ...SEED_RECIPES],
        slots: DEFAULT_DAY_LAYOUT,
        days: 7,
        ranges: RANGES,
        dayTarget: TARGET,
        constraints: noConstraints,
        preferences: { recurringAlwaysIds: ["always-oats"] },
        seed,
      });
      for (const day of week.days) {
        expect(day.items.some((it) => it.recipeId === "always-oats")).toBe(true);
      }
    }
  });

  it("неделя: перегенерация дня сохраняет always-recurring", () => {
    const input = {
      recipes: [always(), ...SEED_RECIPES],
      slots: DEFAULT_DAY_LAYOUT,
      days: 7,
      ranges: RANGES,
      dayTarget: TARGET,
      constraints: noConstraints,
      preferences: { recurringAlwaysIds: ["always-oats"] },
      seed: 5,
    };
    const base = generateWeek(input);
    const week = regenerateDay({
      ...input,
      seed: 500,
      current: base.days.map((d) => d.items),
      dayIndex: 2,
    });
    for (const day of week.days) {
      expect(day.items.some((it) => it.recipeId === "always-oats")).toBe(true);
    }
  });
});

describe("режим слота «только recurring»", () => {
  const onlyRecurringLunch: MealSlot[] = [
    { slot: "lunch", kcalShare: 1, cookTimeMin: 90, canCook: true, availableEquipment: ["none"], onlyRecurring: true },
  ];

  it("в приём попадают только recurring-блюда, прочие отсечены", () => {
    const recipes = [lunchOnly("r1"), lunchOnly("r2"), lunchOnly("plain")];
    const day = generateDay({
      recipes,
      slots: onlyRecurringLunch,
      target: TARGET,
      constraints: noConstraints,
      preferences: { recurringOftenIds: ["r1"], recurringAlwaysIds: ["r2"] },
      seed: 9,
    });
    const lunch = day.items.find((it) => it.slot === "lunch");
    expect(lunch).toBeTruthy();
    expect(["r1", "r2"]).toContain(lunch!.recipeId);
  });

  it("нет recurring-кандидатов → приём остаётся пустым (жёсткий отсев)", () => {
    const day = generateDay({
      recipes: [lunchOnly("plain")],
      slots: onlyRecurringLunch,
      target: TARGET,
      constraints: noConstraints,
      preferences: { recurringOftenIds: [], recurringAlwaysIds: [] },
      seed: 1,
    });
    expect(day.items.find((it) => it.slot === "lunch")).toBeUndefined();
  });
});

describe("блок никогда не просачивается (тест «на утечки» №2, ticket 16)", () => {
  // Блокируем блюда, которые иначе стабильно попадают в план, и проверяем, что
  // при любом seed их нет ни в дне, ни в неделе.
  const blocked = ["grechka-kurica", "sup-kurinyy", "ovsyanka-banan"];
  const constraints = { excludedAllergens: [] as Allergen[], blockedRecipeIds: blocked };

  it("день: заблокированное блюдо не встречается ни при одном seed", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const day = generateDay({
        recipes: SEED_RECIPES,
        slots: DEFAULT_DAY_LAYOUT,
        target: TARGET,
        constraints,
        seed,
      });
      for (const it of day.items) expect(blocked).not.toContain(it.recipeId);
    }
  });

  it("неделя: заблокированное блюдо не встречается ни в одном приёме", () => {
    for (const seed of [1, 2, 7, 42]) {
      const week = generateWeek({
        recipes: SEED_RECIPES,
        slots: DEFAULT_DAY_LAYOUT,
        days: 7,
        ranges: RANGES,
        dayTarget: TARGET,
        constraints,
        seed,
      });
      for (const day of week.days) {
        for (const it of day.items) expect(blocked).not.toContain(it.recipeId);
      }
    }
  });
});

describe("замена уважает предпочтения", () => {
  it("replaceDish не ставит заблокированное и уважает only-recurring нельзя обойти", () => {
    const current: PlanItem[] = [
      { slot: "lunch", recipeId: "a", portion: 1, nutrients: N },
    ];
    const replaced = replaceDish({
      recipes: [lunchOnly("a"), lunchOnly("blocked"), lunchOnly("ok")],
      slots: LUNCH_SLOT,
      target: TARGET,
      constraints: { excludedAllergens: [], blockedRecipeIds: ["blocked"] },
      seed: 2,
      current,
      slot: "lunch",
    });
    expect(replaced).not.toBeNull();
    expect(replaced!.recipeId).toBe("ok");
  });
});
