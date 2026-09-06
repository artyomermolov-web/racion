import { describe, it, expect } from "vitest";
import { mifflinBmr, tdee, computeTargets, KCAL_FLOOR } from "./targets";
import type { BodyInput } from "./targets";

// Эталонные примеры — из research/nutrition-norms.md §1 (независимый источник истины).
describe("mifflinBmr", () => {
  it("мужчина 30 лет, 80 кг, 180 см → 1780", () => {
    expect(
      mifflinBmr({ sex: "male", age: 30, weightKg: 80, heightCm: 180 }),
    ).toBeCloseTo(1780, 5);
  });

  it("женщина 30 лет, 65 кг, 165 см → 1370.25", () => {
    expect(
      mifflinBmr({ sex: "female", age: 30, weightKg: 65, heightCm: 165 }),
    ).toBeCloseTo(1370.25, 5);
  });

  it("мужчина 45 лет, 95 кг, 178 см → 1842.5", () => {
    expect(
      mifflinBmr({ sex: "male", age: 45, weightKg: 95, heightCm: 178 }),
    ).toBeCloseTo(1842.5, 5);
  });
});

describe("tdee", () => {
  // BMR 1800 × множители из research/nutrition-norms.md §2.
  it("сидячий образ жизни ×1.2", () => {
    expect(tdee(1800, "sedentary")).toBeCloseTo(2160, 5);
  });
  it("лёгкая активность ×1.375", () => {
    expect(tdee(1800, "light")).toBeCloseTo(2475, 5);
  });
  it("умеренная активность ×1.55", () => {
    expect(tdee(1800, "moderate")).toBeCloseTo(2790, 5);
  });
  it("высокая активность ×1.725", () => {
    expect(tdee(1800, "high")).toBeCloseTo(3105, 5);
  });
  it("очень высокая активность ×1.9", () => {
    expect(tdee(1800, "veryHigh")).toBeCloseTo(3420, 5);
  });
});

// Эталон: мужчина 30/80/180, умеренная активность, «держать», без %жира.
// Ручной расчёт (research §1–5): BMR 1780 → TDEE 2759 → цель 2759 ккал.
const MALE_MAINTAIN: BodyInput = {
  sex: "male",
  age: 30,
  weightKg: 80,
  heightCm: 180,
  activityLevel: "moderate",
  goal: "maintain",
};

describe("computeTargets — базовый расчёт (держать вес)", () => {
  const t = computeTargets(MALE_MAINTAIN);

  it("отдаёт BMR, TDEE и целевую калорийность", () => {
    expect(t.bmr).toBeCloseTo(1780, 5);
    expect(t.tdee).toBeCloseTo(2759, 5);
    expect(t.goalKcal).toBeCloseTo(2759, 5);
    expect(t.kcalFloorApplied).toBe(false);
  });

  it("диапазон ккал = цель ±5%, округлён до 10", () => {
    // 2759·0.95=2621.05→2620 ; 2759·1.05=2896.95→2900
    expect(t.kcal).toEqual({ min: 2620, max: 2900 });
  });

  it("белок по общей массе, поддержание/набор 1.6–2.2 г/кг (kbju A8)", () => {
    // 80·1.6=128 ; 80·2.2=176
    expect(t.protein).toEqual({ min: 128, max: 176 });
  });

  it("жиры: диапазон 0.8–1.2 г/кг с потолком 30% калорий (kbju A8)", () => {
    // min 80·0.8=64 ; max = min(80·1.2=96, 2759·0.30/9=91.97→92) = 92
    expect(t.fat).toEqual({ min: 64, max: 92 });
  });

  it("углеводы — остаток калорий диапазоном", () => {
    // max=(2900−128·4−64·9)/4=453 ; min=(2620−176·4−92·9)/4=272
    expect(t.carb).toEqual({ min: 272, max: 453 });
  });

  it("клетчатка — минимум, зажата в 25–30 г", () => {
    // 14·2759/1000=38.6 → 30 (верхняя граница)
    expect(t.fiberMin).toBe(30);
  });
});

describe("computeTargets — цель сдвигает калории", () => {
  it("похудение = TDEE × 0.8", () => {
    const t = computeTargets({ ...MALE_MAINTAIN, goal: "lose" });
    expect(t.goalKcal).toBeCloseTo(2207.2, 4);
  });
  it("набор = TDEE × 1.15", () => {
    const t = computeTargets({ ...MALE_MAINTAIN, goal: "gain" });
    expect(t.goalKcal).toBeCloseTo(3172.85, 4);
  });
});

describe("computeTargets — белок по сухой массе при известном %жира", () => {
  it("LBM = вес·(1−%жир), белок 1.6–2.2 г/кг LBM (поддержание)", () => {
    // 90 кг, 25% жира → LBM 67.5 → 108–148.5 → 108..149 (округл.)
    const t = computeTargets({
      sex: "male",
      age: 30,
      weightKg: 90,
      heightCm: 180,
      activityLevel: "moderate",
      goal: "maintain",
      bodyFatPct: 25,
    });
    expect(t.protein).toEqual({ min: 108, max: 149 });
  });
});

describe("computeTargets — белок зависит от цели (kbju A8)", () => {
  it("на сушке белок выше: 2.0–2.6 г/кг", () => {
    // мужчина 80 кг, lose, без %жира → 80·2.0=160 ; 80·2.6=208
    const t = computeTargets({ ...MALE_MAINTAIN, goal: "lose" });
    expect(t.protein).toEqual({ min: 160, max: 208 });
  });

  it("на наборе белок 1.6–2.2 г/кг", () => {
    const t = computeTargets({ ...MALE_MAINTAIN, goal: "gain" });
    expect(t.protein).toEqual({ min: 128, max: 176 });
  });

  it("верх жиров ограничен вес·1.2, когда калорий много (набор)", () => {
    // gain: goalKcal 3172.85 → 30%/9=105.8→106 ; вес·1.2=96 → берём 96
    const t = computeTargets({ ...MALE_MAINTAIN, goal: "gain" });
    expect(t.fat).toEqual({ min: 64, max: 96 });
  });
});

describe("computeTargets — защитные минимумы калорий", () => {
  it("женщина: цель не опускается ниже 1200 ккал", () => {
    // мелкая женщина на дефиците → сырая цель < 1200
    const t = computeTargets({
      sex: "female",
      age: 60,
      weightKg: 45,
      heightCm: 150,
      activityLevel: "sedentary",
      goal: "lose",
    });
    expect(t.kcalFloorApplied).toBe(true);
    expect(t.goalKcal).toBe(KCAL_FLOOR.female);
    expect(t.goalKcal).toBe(1200);
  });

  it("мужчина: цель не опускается ниже 1500 ккал", () => {
    const t = computeTargets({
      sex: "male",
      age: 70,
      weightKg: 50,
      heightCm: 160,
      activityLevel: "sedentary",
      goal: "lose",
    });
    expect(t.kcalFloorApplied).toBe(true);
    expect(t.goalKcal).toBe(KCAL_FLOOR.male);
  });
});

describe("computeTargets — защита диапазонов", () => {
  it("углеводы не уходят в минус при высоком белке/жире", () => {
    const t = computeTargets({
      sex: "male",
      age: 25,
      weightKg: 120,
      heightCm: 175,
      activityLevel: "sedentary",
      goal: "lose",
      bodyFatPct: 10,
    });
    expect(t.carb.min).toBeGreaterThanOrEqual(0);
    expect(t.carb.max).toBeGreaterThanOrEqual(t.carb.min);
  });

  it("верх жиров не ниже нижнего порога", () => {
    const t = computeTargets({
      sex: "female",
      age: 55,
      weightKg: 95,
      heightCm: 158,
      activityLevel: "sedentary",
      goal: "lose",
    });
    expect(t.fat.max).toBeGreaterThanOrEqual(t.fat.min);
  });
});
