// Расчёт персональной нормы КБЖУ. Чистый модуль без зависимостей от Prisma/Next —
// основной шов тестирования (spec.md, Testing Decisions).
// Все коэффициенты и формулы — из docs/kbju-master.md (разделы A7–A8), это
// опорный документ проекта; при конфликте с research-заметками он первичен.

export type Sex = "male" | "female";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "high"
  | "veryHigh";
export type Goal = "lose" | "maintain" | "gain";

/** Множители активности (PAL → TDEE), kbju-master.md A7. */
export const ACTIVITY_MULTIPLIER: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  veryHigh: 1.9,
};

/** Корректировка калорий под цель, kbju-master.md A7 (набор +15%, сушка −20%). */
export const GOAL_FACTOR: Record<Goal, number> = {
  lose: 0.8,
  maintain: 1.0,
  gain: 1.15,
};

export interface BmrInput {
  sex: Sex;
  age: number;
  weightKg: number;
  heightCm: number;
}

/**
 * Базовый обмен (BMR) по формуле Миффлина–Сан Жеора, по общей массе тела:
 * `10·вес + 6.25·рост − 5·возраст + s` (муж s=+5, жен s=−161).
 * Возвращает неокруглённое значение — округление живёт в computeTargets/UI.
 */
export function mifflinBmr(input: BmrInput): number {
  const { sex, age, weightKg, heightCm } = input;
  const s = sex === "male" ? 5 : -161;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + s;
}

/** Суточный расход (TDEE) = BMR × множитель активности. */
export function tdee(bmr: number, activityLevel: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIER[activityLevel];
}

/**
 * Защитные минимумы целевой калорийности: ниже них не опускаем даже на дефиците.
 * UI показывает мягкое предупреждение (kcalFloorApplied).
 */
export const KCAL_FLOOR: Record<Sex, number> = {
  female: 1200,
  male: 1500,
};

/** Белок, г на кг (kbju-master.md A8): на сушке выше, чем на наборе/поддержании. */
const PROTEIN_PER_KG: Record<Goal, [number, number]> = {
  lose: [2.0, 2.6],
  maintain: [1.6, 2.2],
  gain: [1.6, 2.2],
};

/** Жиры, г на кг массы тела — диапазон 0.8–1.2 (kbju-master.md A8). */
const FAT_FLOOR_PER_KG = 0.8;
const FAT_TARGET_PER_KG = 1.2;
/** Потолок доли калорий из жиров (kbju-master.md B3/C, ВОЗ ≤30%). */
const FAT_KCAL_SHARE = 0.3;
/** Клетчатка: г на 1000 ккал, затем зажимается в диапазон [25; 30] (kbju A8). */
const FIBER_PER_1000_KCAL = 14;
const FIBER_MIN = 25;
const FIBER_MAX = 30;

export interface BodyInput extends BmrInput {
  activityLevel: ActivityLevel;
  goal: Goal;
  /** Процент жира (0–100). Если задан — белок считается по сухой массе. */
  bodyFatPct?: number | null;
}

export interface Range {
  min: number;
  max: number;
}

export interface NutritionTargets {
  bmr: number;
  tdee: number;
  /** Целевая калорийность после поправки на цель и защитного минимума. */
  goalKcal: number;
  /** Сработал ли защитный минимум калорий (для мягкого предупреждения в UI). */
  kcalFloorApplied: boolean;
  kcal: Range;
  /** Диапазоны макросов в граммах. */
  protein: Range;
  fat: Range;
  carb: Range;
  /** Минимум клетчатки, г. */
  fiberMin: number;
}

const round10 = (x: number) => Math.round(x / 10) * 10;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/**
 * Полный расчёт персональной нормы (kbju-master.md A7–A8):
 * BMR → TDEE → цель по ккал (с защитным минимумом) → диапазон ±5% →
 * белок (по цели; база — сухая масса при известном %жира, иначе общая масса) →
 * жир (0.8–1.2 г/кг с потолком 30% калорий) → углеводы (остаток) →
 * клетчатка (минимум).
 */
export function computeTargets(input: BodyInput): NutritionTargets {
  const bmr = mifflinBmr(input);
  const tdeeVal = tdee(bmr, input.activityLevel);

  const rawGoalKcal = tdeeVal * GOAL_FACTOR[input.goal];
  const floor = KCAL_FLOOR[input.sex];
  const kcalFloorApplied = rawGoalKcal < floor;
  const goalKcal = Math.max(rawGoalKcal, floor);

  const kcal: Range = {
    min: round10(goalKcal * 0.95),
    max: round10(goalKcal * 1.05),
  };

  // Белок: диапазон г/кг зависит от цели (сушка выше). База — сухая масса при
  // известном %жира (точнее для людей с высоким %жира), иначе общая масса.
  const hasBodyFat =
    input.bodyFatPct != null && input.bodyFatPct > 0 && input.bodyFatPct < 100;
  const proteinBase = hasBodyFat
    ? input.weightKg * (1 - (input.bodyFatPct as number) / 100)
    : input.weightKg;
  const [proteinLo, proteinHi] = PROTEIN_PER_KG[input.goal];
  const protein: Range = {
    min: Math.round(proteinBase * proteinLo),
    max: Math.round(proteinBase * proteinHi),
  };

  // Жиры: диапазон 0.8–1.2 г/кг, но верх не выше 30% калорийности и не ниже низа.
  const fatMin = Math.round(input.weightKg * FAT_FLOOR_PER_KG);
  const fatMax = Math.max(
    fatMin,
    Math.min(
      Math.round(input.weightKg * FAT_TARGET_PER_KG),
      Math.round((goalKcal * FAT_KCAL_SHARE) / 9),
    ),
  );
  const fat: Range = { min: fatMin, max: fatMax };

  // Углеводы — остаток калорий. Максимум углеводов при высоких ккал и низких
  // белке/жире; минимум — наоборот. Не уходим ниже нуля и не пересекаем границы.
  const carbMaxRaw = (kcal.max - protein.min * 4 - fat.min * 9) / 4;
  const carbMinRaw = (kcal.min - protein.max * 4 - fat.max * 9) / 4;
  const carbMax = Math.max(0, Math.round(carbMaxRaw));
  const carbMin = clamp(Math.round(carbMinRaw), 0, carbMax);
  const carb: Range = { min: carbMin, max: carbMax };

  const fiberMin = clamp(
    Math.round((FIBER_PER_1000_KCAL * goalKcal) / 1000),
    FIBER_MIN,
    FIBER_MAX,
  );

  return {
    bmr,
    tdee: tdeeVal,
    goalKcal,
    kcalFloorApplied,
    kcal,
    protein,
    fat,
    carb,
    fiberMin,
  };
}
