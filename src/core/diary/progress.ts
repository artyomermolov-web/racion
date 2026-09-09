// Прогресс дня против цели: остаток КБЖУ со знаком и выбор отстающего макроса.
// Чистый модуль без Prisma/Next (spec.md, Testing Decisions).
//
// Правила (spec, User Stories 29–30 и Implementation Decisions):
//  • ккал и Б/Ж/У — остаток со знаком (target − eaten); перебор не обрезается;
//  • клетчатка — только «добрать» (min-only): remaining = max(target − eaten, 0),
//    т.к. верхней границы у клетчатки нет;
//  • отстающий макрос — с наибольшим ОТНОСИТЕЛЬНЫМ дефицитом среди Б/Ж/У, но
//    белок приоритетен: если у белка есть дефицит, отстающий — он (product-фокус
//    «добрать белок»). Все добраны → null.

import type { DayTarget } from "@/core/generator";
import type {
  DayProgress,
  DiaryNutrients,
  Macro,
  NutrientRemaining,
} from "./types";

/** Остаток со знаком по одному нутриенту. */
function signed(target: number, eaten: number): NutrientRemaining {
  return { target, eaten, remaining: target - eaten };
}

/** Относительный дефицит (0, если добран или цель нулевая). */
function relDeficit(target: number, eaten: number): number {
  if (target <= 0) return 0;
  return Math.max(0, (target - eaten) / target);
}

/** Отстающий макрос: приоритет белка, иначе наибольший относительный дефицит. */
function pickLagging(target: DayTarget, eaten: DiaryNutrients): Macro | null {
  // Приоритет белка: любой его дефицит делает белок отстающим (product-фокус).
  if (relDeficit(target.protein, eaten.protein) > 0) return "protein";

  const rest: Macro[] = ["fat", "carb"];
  let best: Macro | null = null;
  let bestDeficit = 0;
  for (const m of rest) {
    const d = relDeficit(target[m], eaten[m]);
    if (d > bestDeficit) {
      bestDeficit = d;
      best = m;
    }
  }
  return best;
}

/**
 * Остаток дня: ккал+Б/Ж/У со знаком, клетчатка min-only, идентификатор
 * отстающего макроса. Остаток считается от факта на момент, не «размазывает» по
 * пропущенным приёмам.
 */
export function remaining(
  target: DayTarget,
  eaten: DiaryNutrients,
): DayProgress {
  const fiberRemaining = Math.max(0, target.fiber - eaten.fiber);
  return {
    kcal: signed(target.kcal, eaten.kcal),
    protein: signed(target.protein, eaten.protein),
    fat: signed(target.fat, eaten.fat),
    carb: signed(target.carb, eaten.carb),
    fiber: { target: target.fiber, eaten: eaten.fiber, remaining: fiberRemaining },
    laggingMacro: pickLagging(target, eaten),
  };
}
