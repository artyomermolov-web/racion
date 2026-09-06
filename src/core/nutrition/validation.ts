// Чистая валидация и парсинг физданных профиля (тикет 12). Без Prisma/UI.
// Сообщения на русском — показываются пользователю как есть.

import type {
  ActivityLevel,
  BodyInput,
  Goal,
  Sex,
} from "./targets";

/** Границы допустимых значений (рабочие пределы, не мед. предписания). */
export const LIMITS = {
  age: { min: 14, max: 100 },
  heightCm: { min: 120, max: 250 },
  weightKg: { min: 30, max: 300 },
  bodyFatPct: { min: 3, max: 60 },
} as const;

const ACTIVITY_LEVELS: readonly ActivityLevel[] = [
  "sedentary",
  "light",
  "moderate",
  "high",
  "veryHigh",
];
const GOALS: readonly Goal[] = ["lose", "maintain", "gain"];
const SEXES: readonly Sex[] = ["male", "female"];

/** Сырой ввод из формы: все поля — строки (или отсутствуют). */
export interface BodyInputDraft {
  sex?: string;
  age?: string;
  heightCm?: string;
  weightKg?: string;
  activityLevel?: string;
  goal?: string;
  bodyFatPct?: string;
}

export interface BodyInputErrors {
  sex?: string;
  age?: string;
  heightCm?: string;
  weightKg?: string;
  activityLevel?: string;
  goal?: string;
  bodyFatPct?: string;
}

export interface BodyInputResult {
  errors: BodyInputErrors;
  /** Заполнено только при отсутствии ошибок. */
  value?: BodyInput;
}

interface NumField {
  key: "age" | "heightCm" | "weightKg";
  label: string;
  integer: boolean;
}

const NUM_FIELDS: NumField[] = [
  { key: "age", label: "возраст", integer: true },
  { key: "heightCm", label: "рост", integer: false },
  { key: "weightKg", label: "вес", integer: false },
];

function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Валидирует и парсит физданные. При успехе `value` — типизированный BodyInput,
 * готовый для computeTargets; иначе `errors` перечисляет проблемы по полям.
 */
export function validateBodyInput(draft: BodyInputDraft): BodyInputResult {
  const errors: BodyInputErrors = {};

  const sex = draft.sex as Sex | undefined;
  if (!sex || !SEXES.includes(sex)) errors.sex = "Выберите пол";

  const activityLevel = draft.activityLevel as ActivityLevel | undefined;
  if (!activityLevel || !ACTIVITY_LEVELS.includes(activityLevel)) {
    errors.activityLevel = "Выберите уровень активности";
  }

  const goal = draft.goal as Goal | undefined;
  if (!goal || !GOALS.includes(goal)) errors.goal = "Выберите цель";

  const nums: Record<string, number> = {};
  for (const field of NUM_FIELDS) {
    const n = parseNumber(draft[field.key]);
    const bounds = LIMITS[field.key];
    if (n === null) {
      errors[field.key] = `Укажите ${field.label}`;
    } else if (field.integer && !Number.isInteger(n)) {
      errors[field.key] = `Укажите ${field.label} целым числом`;
    } else if (n < bounds.min || n > bounds.max) {
      errors[field.key] = `Допустимо ${bounds.min}–${bounds.max}`;
    } else {
      nums[field.key] = n;
    }
  }

  // Процент жира — опционален: пусто = «не указан».
  let bodyFatPct: number | null = null;
  const bfRaw = draft.bodyFatPct?.trim();
  if (bfRaw) {
    const bf = parseNumber(bfRaw);
    if (bf === null) {
      errors.bodyFatPct = "Процент жира должен быть числом";
    } else if (bf < LIMITS.bodyFatPct.min || bf > LIMITS.bodyFatPct.max) {
      errors.bodyFatPct = `Допустимо ${LIMITS.bodyFatPct.min}–${LIMITS.bodyFatPct.max}%`;
    } else {
      bodyFatPct = bf;
    }
  }

  if (Object.keys(errors).length > 0) return { errors };

  return {
    errors,
    value: {
      sex: sex as Sex,
      age: nums.age,
      heightCm: nums.heightCm,
      weightKg: nums.weightKg,
      activityLevel: activityLevel as ActivityLevel,
      goal: goal as Goal,
      bodyFatPct,
    },
  };
}

// ---------------------------------------------------------------------------
// Ручная подстройка диапазонов нормы до грамма (тикет 12).
// ---------------------------------------------------------------------------

/** Разумные верхние пределы, чтобы отсечь опечатки/бессмыслицу. */
const TARGETS_CAP = { macro: 2000, fiber: 200 } as const;

/** Калорийность макроса: 1 г белка/углеводов = 4 ккал, 1 г жира = 9 ккал. */
const KCAL_PER_GRAM = { protein: 4, fat: 9, carb: 4 } as const;

export interface EditableTargets {
  kcalMin: number;
  kcalMax: number;
  proteinMin: number;
  proteinMax: number;
  fatMin: number;
  fatMax: number;
  carbMin: number;
  carbMax: number;
  fiberMin: number;
}

/**
 * Поля, которые пользователь редактирует вручную. Калории (kcalMin/kcalMax)
 * не вводятся — они выводятся из макросов (см. kcalFromMacros).
 */
export type EditableTargetsInput = Exclude<
  keyof EditableTargets,
  "kcalMin" | "kcalMax"
>;

export type TargetsDraft = Partial<Record<EditableTargetsInput, string>>;
export type TargetsErrors = Partial<Record<EditableTargetsInput, string>>;

export interface TargetsResult {
  errors: TargetsErrors;
  value?: EditableTargets;
}

/** Калории из граммов макросов (4·Б + 9·Ж + 4·У). */
export function kcalFromMacros(m: {
  protein: number;
  fat: number;
  carb: number;
}): number {
  return (
    KCAL_PER_GRAM.protein * m.protein +
    KCAL_PER_GRAM.fat * m.fat +
    KCAL_PER_GRAM.carb * m.carb
  );
}

interface RangeSpec {
  min: EditableTargetsInput;
  max: EditableTargetsInput;
  label: string;
}

const RANGE_SPECS: RangeSpec[] = [
  { min: "proteinMin", max: "proteinMax", label: "белка" },
  { min: "fatMin", max: "fatMax", label: "жиров" },
  { min: "carbMin", max: "carbMax", label: "углеводов" },
];

/** Целое ≥0 в допустимом пределе; иначе — текст ошибки. */
function parseGrams(
  raw: string | undefined,
  cap: number,
): { value: number } | { error: string } {
  const n = parseNumber(raw);
  if (n === null) return { error: "Укажите значение" };
  if (!Number.isInteger(n)) return { error: "Только целое число" };
  if (n < 0) return { error: "Не может быть отрицательным" };
  if (n > cap) return { error: "Слишком большое значение" };
  return { value: n };
}

/**
 * Валидирует ручные диапазоны Б/Ж/У и клетчатки (целые ≥0 в пределах, min ≤ max)
 * и выводит калории из макросов. При успехе возвращает готовый к сохранению
 * EditableTargets с рассчитанными kcalMin/kcalMax.
 */
export function validateTargetsDraft(draft: TargetsDraft): TargetsResult {
  const errors: TargetsErrors = {};
  const g: Partial<Record<EditableTargetsInput, number>> = {};

  for (const spec of RANGE_SPECS) {
    const lo = parseGrams(draft[spec.min], TARGETS_CAP.macro);
    const hi = parseGrams(draft[spec.max], TARGETS_CAP.macro);
    if ("error" in lo) errors[spec.min] = lo.error;
    else g[spec.min] = lo.value;
    if ("error" in hi) errors[spec.max] = hi.error;
    else g[spec.max] = hi.value;

    if ("value" in lo && "value" in hi && lo.value > hi.value) {
      errors[spec.max] = `Максимум ${spec.label} меньше минимума`;
    }
  }

  const fiber = parseGrams(draft.fiberMin, TARGETS_CAP.fiber);
  if ("error" in fiber) errors.fiberMin = fiber.error;
  else g.fiberMin = fiber.value;

  if (Object.keys(errors).length > 0) return { errors };

  return {
    errors,
    value: {
      kcalMin: kcalFromMacros({
        protein: g.proteinMin!,
        fat: g.fatMin!,
        carb: g.carbMin!,
      }),
      kcalMax: kcalFromMacros({
        protein: g.proteinMax!,
        fat: g.fatMax!,
        carb: g.carbMax!,
      }),
      proteinMin: g.proteinMin!,
      proteinMax: g.proteinMax!,
      fatMin: g.fatMin!,
      fatMax: g.fatMax!,
      carbMin: g.carbMin!,
      carbMax: g.carbMax!,
      fiberMin: g.fiberMin!,
    },
  };
}
