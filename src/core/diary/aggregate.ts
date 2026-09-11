// Агрегация дневника: суммы КБЖУ по приёмам и за день. Чистый модуль без
// Prisma/Next (spec.md, Testing Decisions). Снапшоты записей уже посчитаны на
// момент записи — здесь только линейная свёртка по 5 отслеживаемым нутриентам.

import type { Slot } from "@/core/generator";
import {
  DIARY_NUTRIENT_KEYS,
  DIARY_SLOTS,
  type DiaryEntry,
  type DiaryNutrients,
  type DayLog,
  type SlotSummary,
} from "./types";

/** Нулевой снапшот (пустой приём/день). */
export function zeroNutrients(): DiaryNutrients {
  return { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 };
}

/** Сумма снапшотов набора записей (по 5 отслеживаемым нутриентам). */
function sumEntries(entries: readonly DiaryEntry[]): DiaryNutrients {
  const acc = zeroNutrients();
  for (const e of entries) {
    for (const k of DIARY_NUTRIENT_KEYS) acc[k] += e.nutrients[k];
  }
  return acc;
}

/**
 * Свёртка записей дня в разбивку по всем 4 приёмам (канонический порядок,
 * включая пустые — под секции UI) и сумму за день. Порядок записей внутри приёма
 * сохраняется как во входе.
 */
export function summarize(entries: readonly DiaryEntry[]): DayLog {
  const perSlot: SlotSummary[] = DIARY_SLOTS.map((slot) => {
    const slotEntries = entries.filter((e) => e.slot === slot);
    return { slot, entries: slotEntries, totals: sumEntries(slotEntries) };
  });
  return { perSlot, totals: sumEntries(entries) };
}

/**
 * Следующий незаполненный приём дня в каноническом порядке, иначе перекус — общий
 * дефолт слота для дневника (быстрое добавление на экране и целевой приём подсказок
 * на сервере считают его одинаково).
 */
export function nextEmptySlot(perSlot: readonly SlotSummary[]): Slot {
  return perSlot.find((s) => s.entries.length === 0)?.slot ?? "snack";
}
