// Подбор порции (тикет 06, шаг 2). Порция — множитель 0.25–2.0 с шагом 0.25
// (CONTEXT.md). Для кандидата выбираем порцию, минимизирующую расстояние ккал до
// цели приёма; при равенстве берём меньшую порцию (детерминированно).

/** Сетка допустимых порций: {0.25 … 2.0, шаг 0.25}. */
export const PORTION_STEPS: readonly number[] = [
  0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0,
];

/**
 * Порция кандидата под целевую калорийность приёма: перебирает сетку и берёт
 * ближайшую по |ккал×порция − цель|. Блюдо с нулевой калорийностью не даёт
 * информации о порции — возвращаем минимальную (защита от деления/вырождения).
 */
export function bestPortion(kcalPerServing: number, targetKcal: number): number {
  if (kcalPerServing <= 0) return PORTION_STEPS[0];
  let best = PORTION_STEPS[0];
  let bestDist = Infinity;
  for (const p of PORTION_STEPS) {
    const dist = Math.abs(kcalPerServing * p - targetKcal);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}
