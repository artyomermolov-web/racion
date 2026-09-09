// Типы ядра дневника еды (тикет 08, под-проект A). Чистый модуль без Prisma/Next —
// основной шов тестирования (spec.md, Testing Decisions). Значения-«enum» (slot,
// source) совпадают с seed-data/схемой и фиксируются union-типами.
//
// Переиспользует FoodNutrients (полные 6 нутриентов еды) из /core/nutrition и
// Slot/DayTarget из /core/generator, чтобы веса и формы данных жили в одном месте.

import type { FoodNutrients } from "@/core/nutrition";
import type { Slot } from "@/core/generator";

/** Что залогировано: базовый продукт или рецепт. */
export type DiarySource = "ingredient" | "recipe";

/** Три макроса, между которыми выбирается «отстающий» (клетчатка/ккал — не макрос). */
export type Macro = "protein" | "fat" | "carb";

/**
 * Снапшот отслеживаемых дневником нутриентов — 5 полей (spec: натрий в MVP не
 * отслеживается). Структурно совпадает с DayTarget, но семантика иная («съедено»,
 * а не «цель»), поэтому это отдельный тип.
 */
export interface DiaryNutrients {
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
  fiber: number;
}

/** Ключи снапшота — для свёрток без «магических строк». */
export const DIARY_NUTRIENT_KEYS: readonly (keyof DiaryNutrients)[] = [
  "kcal",
  "protein",
  "fat",
  "carb",
  "fiber",
];

/** Слоты дня — фиксированные 4, порядок канонический (spec: раскладку не подключаем). */
export const DIARY_SLOTS: readonly Slot[] = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
];

/**
 * Одна залогированная запись дневника (доменная форма, в которую слой БД
 * отображает строку DiaryEntry). Снапшот КБЖУ уже посчитан на момент записи.
 */
export interface DiaryEntry {
  id: string;
  /** Локальная дата пользователя, YYYY-MM-DD. */
  date: string;
  slot: Slot;
  source: DiarySource;
  /** Ingredient.id (source=ingredient) или Recipe.id (source=recipe). */
  refId: string;
  /** Граммы (source=ingredient, штуки уже переведены в граммы) — иначе null. */
  grams: number | null;
  /** Порции (source=recipe) — иначе null. */
  servings: number | null;
  /** Снапшот нутриентов записи (5 отслеживаемых). */
  nutrients: DiaryNutrients;
  /** Происхождение из подсказки «Что поесть сейчас» (тикет 10) — иначе null. */
  suggestedRecipeId: string | null;
}

/**
 * Количество для расчёта КБЖУ записи (вход `nutrientsForAmount`, тикет 09).
 * Штуки доступны только у продуктов с заданным грамм-эквивалентом; расчёт и
 * гварды — в amount.ts (ещё не реализовано в тикете 08, тип объявлен заранее).
 */
export type LoggedAmount =
  | { kind: "grams"; grams: number }
  | { kind: "pieces"; pieces: number }
  | { kind: "servings"; servings: number };

/** Сумма по одному приёму: его записи + подытог КБЖУ. */
export interface SlotSummary {
  slot: Slot;
  entries: DiaryEntry[];
  totals: DiaryNutrients;
}

/** Итог агрегации дня: разбивка по всем 4 приёмам + сумма за день. */
export interface DayLog {
  /** Все 4 слота в каноническом порядке, включая пустые (для секций UI). */
  perSlot: SlotSummary[];
  totals: DiaryNutrients;
}

/** Остаток по одному нутриенту: цель, съедено и остаток со знаком (target − eaten). */
export interface NutrientRemaining {
  target: number;
  eaten: number;
  /** target − eaten: отрицательное — перебор (не обрезается, spec). */
  remaining: number;
}

/**
 * Прогресс дня против цели. Ккал и Б/Ж/У — со знаком (перебор честно
 * отрицательный). Клетчатка — только «добрать» (min-only, без перебора), т.к. у
 * неё нет верхней границы. `laggingMacro` — отстающий макрос (приоритет белка).
 */
export interface DayProgress {
  kcal: NutrientRemaining;
  protein: NutrientRemaining;
  fat: NutrientRemaining;
  carb: NutrientRemaining;
  /** Клетчатка: remaining = max(target − eaten, 0). */
  fiber: NutrientRemaining;
  /** Наибольший относительный дефицит среди Б/Ж/У; null — все добраны. */
  laggingMacro: Macro | null;
}

/**
 * Вариант подсказки «Что поесть сейчас» (тикет 10). Объявлен заранее; движок
 * подсказок (suggest.ts) строится поверх /core/generator в своём тикете.
 */
export interface SuggestedMeal {
  recipeId: string;
  name: string;
  /** Подобранная порция (кратна сетке PORTION_STEPS). */
  portion: number;
  /** КБЖУ порции варианта. */
  nutrients: FoodNutrients;
  timeMin: number;
  /** Честная пометка приближения, напр. «добирает белок, но чуть выше по ккал». */
  note?: string;
}
