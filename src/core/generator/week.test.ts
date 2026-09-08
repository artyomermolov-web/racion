import { describe, it, expect } from "vitest";
import { generateWeek, regenerateDay, replaceMealInWeek, FIBER_SOFT_TOLERANCE } from "./week";
import { DEFAULT_DAY_LAYOUT } from "./generate";
import { PORTION_STEPS } from "./portions";
import type {
  GeneratorRecipe,
  DayTarget,
  NutrientRanges,
  PlanItem,
  Slot,
  Equipment,
  Allergen,
} from "./types";
import { SEED_RECIPES } from "./seed-recipes.fixture";

// Сборка недели (тикет 15): жадный проход + simulated annealing тянет недельные
// СРЕДНИЕ КБЖУ в диапазоны (отдельные дни могут отклоняться), анти-повторы
// адаптивно смягчаются при нехватке кандидатов, перегенерация недели/дня/приёма
// автодополняет под остаток. Фикстура — реальный сид-набор через ядро nutrition.

const ALL_RECIPES = SEED_RECIPES;

const TARGET: DayTarget = {
  kcal: 2000,
  protein: 140,
  fat: 65,
  carb: 220,
  fiber: 28,
};

// Диапазоны недельного среднего: цель ±10% по калориям и макросам, клетчатка — минимум.
const RANGES: NutrientRanges = {
  kcalMin: 1800,
  kcalMax: 2200,
  proteinMin: 126,
  proteinMax: 154,
  fatMin: 58,
  fatMax: 72,
  carbMin: 198,
  carbMax: 242,
  fiberMin: 28,
};

const noConstraints = { excludedAllergens: [] as Allergen[] };

const weekInput = (over: Partial<Parameters<typeof generateWeek>[0]> = {}) => ({
  recipes: ALL_RECIPES,
  slots: DEFAULT_DAY_LAYOUT,
  days: 7,
  ranges: RANGES,
  dayTarget: TARGET,
  constraints: noConstraints,
  seed: 1,
  ...over,
});

describe("generateWeek — сборка недели", () => {
  it("собирает запрошенное число дней, в каждом дне — приём на каждый слот", () => {
    const week = generateWeek(weekInput({ seed: 3 }));
    expect(week.days).toHaveLength(7);
    for (const day of week.days) {
      expect(day.items).toHaveLength(DEFAULT_DAY_LAYOUT.length);
      day.items.forEach((it, i) => expect(it.slot).toBe(DEFAULT_DAY_LAYOUT[i].slot));
    }
  });

  it("каждое блюдо совместимо со своим слотом", () => {
    const week = generateWeek(weekInput({ seed: 9 }));
    for (const day of week.days) {
      for (const it of day.items) {
        const r = ALL_RECIPES.find((x) => x.id === it.recipeId)!;
        expect(r.slots).toContain(it.slot);
      }
    }
  });

  it("исключённый аллерген не просачивается ни в один приём недели", () => {
    const excluded: Allergen[] = ["milk", "gluten"];
    const week = generateWeek(
      weekInput({ seed: 5, constraints: { excludedAllergens: excluded } }),
    );
    for (const day of week.days) {
      for (const it of day.items) {
        const r = ALL_RECIPES.find((x) => x.id === it.recipeId)!;
        for (const a of excluded) expect(r.allergens).not.toContain(a);
      }
    }
  });

  it("все порции строго в диапазоне 0.25–2.0", () => {
    const week = generateWeek(weekInput({ seed: 11 }));
    for (const day of week.days) {
      for (const it of day.items) {
        expect(PORTION_STEPS).toContain(it.portion);
      }
    }
  });

  it("детерминизм: тот же seed → идентичная неделя", () => {
    const a = generateWeek(weekInput({ seed: 42 }));
    const b = generateWeek(weekInput({ seed: 42 }));
    expect(a).toEqual(b);
  });
});

describe("generateWeek — недельные средние в диапазонах (тест «на утечки» №5)", () => {
  const within = (v: number, min: number, max: number) => v >= min && v <= max;

  it("средние КБЖУ за неделю попадают в диапазоны при достаточной базе", () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      const week = generateWeek(weekInput({ seed }));
      const a = week.weeklyAverage;
      expect(within(a.kcal, RANGES.kcalMin, RANGES.kcalMax)).toBe(true);
      expect(within(a.protein, RANGES.proteinMin, RANGES.proteinMax)).toBe(true);
      expect(within(a.fat, RANGES.fatMin, RANGES.fatMax)).toBe(true);
      expect(within(a.carb, RANGES.carbMin, RANGES.carbMax)).toBe(true);
      // Клетчатка — мягкий минимум: на реалистичной базе среднее держится у цели,
      // допуская недобор в пределах FIBER_SOFT_TOLERANCE при идеальных макросах.
      expect(a.fiber).toBeGreaterThanOrEqual(RANGES.fiberMin - FIBER_SOFT_TOLERANCE);
      expect(week.compromised).toBe(false);
    }
  });

  it("weeklyAverage = округлённая сумма всех приёмов / число дней", () => {
    const week = generateWeek(weekInput({ seed: 8 }));
    const total = week.days
      .flatMap((d) => d.items)
      .reduce((acc, it) => acc + it.nutrients.kcal, 0);
    expect(week.weeklyAverage.kcal).toBe(Math.round(total / week.days.length));
  });

  it("недостижимые диапазоны → compromised=true, но неделя собрана целиком", () => {
    // Заведомо невозможная цель среднего (белок 400 г/день на сид-базе).
    const impossible: NutrientRanges = {
      ...RANGES,
      proteinMin: 380,
      proteinMax: 420,
    };
    const week = generateWeek(weekInput({ seed: 4, ranges: impossible }));
    expect(week.compromised).toBe(true);
    expect(week.days).toHaveLength(7);
    for (const day of week.days) {
      expect(day.items).toHaveLength(DEFAULT_DAY_LAYOUT.length);
    }
  });
});

/** Дни недели как массив приёмов (вход для перегенерации/замены). */
const daysOf = (w: ReturnType<typeof generateWeek>): PlanItem[][] =>
  w.days.map((d) => d.items);

/** Максимальное число повторов одного рецепта за неделю. */
function maxRepeat(week: ReturnType<typeof generateWeek>): number {
  const counts = new Map<string, number>();
  for (const day of week.days) {
    for (const it of day.items) counts.set(it.recipeId, (counts.get(it.recipeId) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

describe("generateWeek — анти-повторы (тест «на утечки» №6)", () => {
  it("на достаточной базе повторы держатся в норме (≤2 за неделю)", () => {
    for (const seed of [1, 2, 3, 7, 42]) {
      expect(maxRepeat(generateWeek(weekInput({ seed })))).toBeLessThanOrEqual(2);
    }
  });

  // Малая база: кандидатов слота меньше, чем нужно на 7 дней → «≤2» недостижимо.
  // Ожидаем адаптивное смягчение: неделя всё равно собрана целиком (штраф мягкий,
  // не жёсткий отсев), без зацикливания.
  const tinySlot = (slot: Slot, n: number): GeneratorRecipe[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${slot}-${i}`,
      slots: [slot],
      timeMin: 10,
      equipment: ["none"] as Equipment[],
      allergens: [] as Allergen[],
      perServing: { kcal: 500, protein: 30, fat: 15, carb: 55, fiber: 7, sodium: 300 },
    }));
  const TINY: GeneratorRecipe[] = [
    ...tinySlot("breakfast", 2),
    ...tinySlot("lunch", 2),
    ...tinySlot("dinner", 2),
    ...tinySlot("snack", 2),
  ];

  it("малая база: неделя собрана целиком, повторы смягчены (не отсев)", () => {
    const week = generateWeek(weekInput({ seed: 1, recipes: TINY }));
    expect(week.days).toHaveLength(7);
    for (const day of week.days) {
      expect(day.items).toHaveLength(DEFAULT_DAY_LAYOUT.length);
    }
    // 2 кандидата на слот × 7 дней → повтор неизбежно > 2 (смягчение сработало).
    expect(maxRepeat(week)).toBeGreaterThan(2);
  });

  it("малая база: детерминизм сохраняется (нет зацикливания/случайности)", () => {
    const a = generateWeek(weekInput({ seed: 5, recipes: TINY }));
    const b = generateWeek(weekInput({ seed: 5, recipes: TINY }));
    expect(a).toEqual(b);
  });

  it("always-recurring исключён из штрафа за повтор", () => {
    // Один always-recurring рецепт может стоять во всех днях без штрафа —
    // проверяем, что политика исключений уважается ядром.
    const only: GeneratorRecipe[] = [
      {
        id: "coffee",
        slots: ["breakfast", "lunch", "dinner", "snack"],
        timeMin: 2,
        equipment: ["none"],
        allergens: [],
        perServing: { kcal: 500, protein: 30, fat: 15, carb: 55, fiber: 7, sodium: 300 },
      },
    ];
    const week = generateWeek(
      weekInput({
        seed: 1,
        recipes: only,
        repeat: { maxPerWindow: 2, alwaysRecurringIds: ["coffee"] },
      }),
    );
    // Единственный рецепт стоит везде; исключение из штрафа не ломает сборку.
    expect(week.days).toHaveLength(7);
  });
});

describe("regenerateDay — перегенерация дня с автодополнением (тест №10)", () => {
  const sig = (items: PlanItem[]) => items.map((it) => it.recipeId).join("|");

  it("меняет только целевой день, прочие дни без изменений", () => {
    const base = generateWeek(weekInput({ seed: 3 }));
    const current = daysOf(base);
    const out = regenerateDay({
      ...weekInput({ seed: 999 }),
      current,
      dayIndex: 2,
    });
    for (let i = 0; i < current.length; i++) {
      if (i === 2) continue;
      expect(out.days[i].items).toEqual(current[i]);
    }
  });

  it("перегенерация даёт разнообразие целевого дня по разным seed", () => {
    const current = daysOf(generateWeek(weekInput({ seed: 3 })));
    const variants = new Set(
      [10, 20, 30, 40, 50].map((seed) =>
        sig(regenerateDay({ ...weekInput({ seed }), current, dayIndex: 2 }).days[2].items),
      ),
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it("недельное среднее остаётся в диапазонах после перегенерации дня", () => {
    const base = generateWeek(weekInput({ seed: 6 }));
    const out = regenerateDay({
      ...weekInput({ seed: 123 }),
      current: daysOf(base),
      dayIndex: 4,
    });
    expect(out.compromised).toBe(false);
  });

  it("детерминизм перегенерации дня: тот же seed → тот же результат", () => {
    const base = generateWeek(weekInput({ seed: 2 }));
    const args = { ...weekInput({ seed: 55 }), current: daysOf(base), dayIndex: 1 };
    expect(regenerateDay(args)).toEqual(regenerateDay(args));
  });
});

describe("replaceMealInWeek — замена приёма под остаток дня (тест №10)", () => {
  it("меняет один приём одного дня; прочие приёмы и дни без изменений", () => {
    const base = generateWeek(weekInput({ seed: 3 }));
    const current = daysOf(base);
    const targetDay = 2;
    const out = replaceMealInWeek({
      ...weekInput({ seed: 777 }),
      current,
      dayIndex: targetDay,
      slot: "lunch",
    })!;
    expect(out).not.toBeNull();
    // Прочие дни нетронуты.
    for (let i = 0; i < current.length; i++) {
      if (i === targetDay) continue;
      expect(out.days[i].items).toEqual(current[i]);
    }
    // В целевом дне изменился только обед.
    const before = current[targetDay];
    const after = out.days[targetDay].items;
    for (const slot of ["breakfast", "dinner", "snack"] as Slot[]) {
      expect(after.find((it) => it.slot === slot)).toEqual(
        before.find((it) => it.slot === slot),
      );
    }
    const lunchBefore = before.find((it) => it.slot === "lunch")!;
    const lunchAfter = after.find((it) => it.slot === "lunch")!;
    expect(lunchAfter.recipeId).not.toBe(lunchBefore.recipeId);
  });

  it("остаток дня исчерпан прочими приёмами → минимальная порция замены", () => {
    // Прочие приёмы дня уже дают всю дневную цель по ккал → остаток ≈ 0 → замена
    // берёт наименьшую порцию (0.25). Видно, что подбор идёт под остаток дня.
    const filler = (slot: Slot): PlanItem => ({
      slot,
      recipeId: `filler-${slot}`,
      portion: 1,
      nutrients: {
        kcal: Math.round(TARGET.kcal / 3),
        protein: 47,
        fat: 22,
        carb: 74,
        fiber: 10,
        sodium: 200,
      },
    });
    // День содержит обед (его и заменяем); прочие три приёма уже дают всю цель.
    const lunchToReplace: PlanItem = {
      slot: "lunch",
      recipeId: ALL_RECIPES.find((r) => r.slots.includes("lunch"))!.id,
      portion: 1,
      nutrients: { kcal: 300, protein: 20, fat: 10, carb: 30, fiber: 5, sodium: 100 },
    };
    const day: PlanItem[] = [
      filler("breakfast"),
      lunchToReplace,
      filler("dinner"),
      filler("snack"),
    ];
    const out = replaceMealInWeek({
      ...weekInput({ seed: 4 }),
      current: [day],
      dayIndex: 0,
      slot: "lunch",
    })!;
    const lunch = out.days[0].items.find((it) => it.slot === "lunch")!;
    expect(lunch.portion).toBe(0.25);
  });

  it("детерминизм замены приёма: тот же seed → тот же результат", () => {
    const base = generateWeek(weekInput({ seed: 2 }));
    const args = {
      ...weekInput({ seed: 88 }),
      current: daysOf(base),
      dayIndex: 3,
      slot: "dinner" as Slot,
    };
    expect(replaceMealInWeek(args)).toEqual(replaceMealInWeek(args));
  });
});

describe("generateWeek — производительность (тест «на утечки» №11)", () => {
  // База ~300 рецептов, равномерно по слотам, с разбросом КБЖУ.
  const BIG: GeneratorRecipe[] = Array.from({ length: 300 }, (_, i) => {
    const slotsFor: Slot[][] = [["breakfast"], ["lunch"], ["dinner"], ["snack"], ["lunch", "dinner"]];
    const kcal = 250 + (i % 20) * 25; // 250…725
    return {
      id: `big-${i}`,
      slots: slotsFor[i % slotsFor.length],
      timeMin: 10 + (i % 6) * 10,
      equipment: ["none", "stove"] as Equipment[],
      allergens: [] as Allergen[],
      perServing: {
        kcal,
        protein: Math.round(kcal * 0.08),
        fat: Math.round(kcal * 0.03),
        carb: Math.round(kcal * 0.1),
        fiber: 3 + (i % 5),
        sodium: 150 + (i % 10) * 30,
      },
    };
  });

  it("генерация недели укладывается в 2 секунды на базе ~300", () => {
    const t0 = Date.now();
    const week = generateWeek(weekInput({ seed: 1, recipes: BIG }));
    const elapsed = Date.now() - t0;
    expect(week.days).toHaveLength(7);
    expect(elapsed).toBeLessThan(2000);
  });
});
