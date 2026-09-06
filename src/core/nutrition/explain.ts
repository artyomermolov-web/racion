// Объяснение расчёта нормы «простыми словами» (тикет 05, онбординг).
// Чистая функция без UI — возвращает абзацы для показа как есть.

import { KCAL_FLOOR } from "./targets";
import type { BodyInput, NutritionTargets } from "./targets";

const round10 = (x: number) => Math.round(x / 10) * 10;

const GOAL_PHRASE: Record<BodyInput["goal"], (goalKcal: number) => string> = {
  lose: (k) => `Чтобы худеть, берём примерно на 20% меньше — около ${k} ккал в день.`,
  maintain: (k) => `Чтобы держать вес, оставляем как есть — около ${k} ккал в день.`,
  gain: (k) => `Чтобы набирать массу, добавляем около 15% — около ${k} ккал в день.`,
};

/**
 * Возвращает абзацы-объяснение расчёта нормы для показа пользователю.
 * Каждая строка — самостоятельный абзац.
 */
export function explainTargets(
  input: BodyInput,
  t: NutritionTargets,
): string[] {
  const out: string[] = [];

  out.push(
    `Ваше тело тратит примерно ${round10(t.tdee)} ккал в день ` +
      `(базовый обмен ${round10(t.bmr)} ккал с учётом вашей активности).`,
  );

  out.push(GOAL_PHRASE[input.goal](round10(t.goalKcal)));

  out.push(
    `Из них белок ${t.protein.min}–${t.protein.max} г, ` +
      `жиры ${t.fat.min}–${t.fat.max} г, ` +
      `углеводы ${t.carb.min}–${t.carb.max} г; ` +
      `клетчатки — не меньше ${t.fiberMin} г.`,
  );

  if (input.bodyFatPct != null && input.bodyFatPct > 0) {
    out.push(
      `Белок посчитан точнее — по сухой массе тела ` +
        `(вы указали ${input.bodyFatPct}% жира).`,
    );
  }

  if (t.kcalFloorApplied) {
    out.push(
      `⚠ Расчёт опустил бы норму ниже безопасного минимума ` +
        `${KCAL_FLOOR[input.sex]} ккал, поэтому мы подняли её до этого уровня. ` +
        `При необходимости обсудите план питания со специалистом.`,
    );
  }

  return out;
}
