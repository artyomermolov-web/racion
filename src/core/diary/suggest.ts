// Движок подсказок «Что поесть сейчас» (тикет 10, под-проект A). Чистый
// детерминированный модуль без Prisma/Next — главная тестовая поверхность
// (spec.md, Testing Decisions). Строится ПОВЕРХ /core/generator (ядро генератора
// не меняем): жёсткие ограничения переиспользуют `filterCandidates`, бонусы
// предпочтений — `preferenceBonus`, масштаб порции — `PORTION_STEPS`/`scalePortion`.
//
// Задача: под остаток дня выдать топ-N конкретных вариантов, каждый закрывает
// остаток КБЖУ с приоритетом на ОТСТАЮЩИЙ макрос (чаще белок). Отличие от
// генератора (собирает весь день жадно по долям приёмов) — здесь один приём под
// явный остаток, поэтому отдельный слой, а не переиспользование `pickForSlot`.
//
// Плюс `logDecision` — чистая идемпотентность лога подсказки (ключ
// date|slot|suggestedRecipeId), прямой аналог guard-логики core/pantry/track.ts.

import type { FoodNutrients } from "@/core/nutrition";
import {
  filterCandidates,
  preferenceBonus,
  scalePortion,
  PORTION_STEPS,
  type GeneratorRecipe,
  type Equipment,
  type MealSlot,
  type GeneratorConstraints,
  type Preferences,
  type Slot,
} from "@/core/generator";
import { mulberry32, hashString } from "@/core/generator/rng";
import type {
  DiaryEntry,
  DiaryNutrients,
  Macro,
  SuggestedMeal,
} from "./types";

/** Кандидат-подсказка: кандидат генератора + человекочитаемое имя для карточки. */
export interface SuggestCandidate extends GeneratorRecipe {
  name: string;
}

/** Фильтр усилий (чипсы быстро/готовить/не готовить) по времени и технике. */
export interface SuggestFilters {
  /** «быстро»: время готовки ≤ порога, мин. */
  maxTimeMin?: number;
  /** «не готовить»: только блюда без техники (equipment = [none]). */
  mustNotCook?: boolean;
}

export interface SuggestInput {
  /** Остаток дня «добрать» по 5 отслеживаемым нутриентам (из DayProgress). */
  remaining: DiaryNutrients;
  /** Отстающий макрос — приоритет в скоринге и в подборе порции; null — все добраны. */
  laggingMacro: Macro | null;
  /** Текущий приём (подсказки совместимы со слотом). */
  slot: Slot;
  candidates: SuggestCandidate[];
  /** Дневная цель — масштаб нормировки (сопоставимость нутриентов, как в генераторе). */
  scale: DiaryNutrients;
  filters?: SuggestFilters;
  constraints: GeneratorConstraints;
  /** Мягкие предпочтения (избранное/recurring) — бонус к скорингу. */
  preferences?: Preferences;
  /** Рецепты, уже залогированные из подсказок сегодня — исключаются из блока. */
  excludeRecipeIds?: string[];
  /** Детерминирует разрешение близких скорингов (как seed генератора). */
  seed: number;
  /** Сколько вариантов вернуть (топ-N, по умолчанию 3). */
  limit?: number;
}

// Веса взвешенного разрыва остатка (меньше — лучше). Согласованы с генератором
// (W_KCAL=1, W_PROTEIN=0.8, W_FAT=W_CARB=0.4): ккал и белок важнее. Отстающий
// макрос получает множитель LAGGING_BOOST — «добрать белок» реально доминирует
// над «просто подошло по ккал». Перебор ккал штрафуется отдельно и сильнее
// недобора (честно: лишние калории хуже, чем чуть недобрать).
const W_KCAL = 1.0;
const W_PROTEIN = 0.8;
const W_FAT = 0.4;
const W_CARB = 0.4;
const W_FIBER = 0.3;
const LAGGING_BOOST = 4;
const W_KCAL_OVERSHOOT = 1.5;

const DEFAULT_LIMIT = 3;

/** Вся техника доступна дома (персональной кухни в «тонком» слое ещё нет). */
const ALL_EQUIPMENT: Equipment[] = [
  "stove",
  "oven",
  "blender",
  "multicooker",
  "none",
];

const MACRO_KEYS: Macro[] = ["protein", "fat", "carb"];

/** Базовый вес макроса в разрыве остатка. */
function macroWeight(macro: Macro): number {
  if (macro === "protein") return W_PROTEIN;
  return macro === "fat" ? W_FAT : W_CARB;
}

/** Русская форма макроса для честной пометки. */
const MACRO_NOTE_LABEL: Record<Macro, string> = {
  protein: "белок",
  fat: "жиры",
  carb: "углеводы",
};

/**
 * Синтетический приём для переиспользования жёстких ограничений генератора.
 * Фильтр усилий ложится на те же поля: «не готовить» → canCook=false (только
 * equipment=none), «быстро» → cookTimeMin=порог. Без фильтров техника вся
 * доступна, а время не ограничено.
 */
function effortSlot(slot: Slot, filters?: SuggestFilters): MealSlot {
  return {
    slot,
    kcalShare: 1,
    cookTimeMin: filters?.maxTimeMin ?? Number.POSITIVE_INFINITY,
    canCook: !(filters?.mustNotCook ?? false),
    availableEquipment: ALL_EQUIPMENT,
  };
}

/**
 * Порция кандидата под целевую величину ОДНОГО нутриента: перебирает сетку
 * PORTION_STEPS, берёт ближайшую по |perServing×порция − цель|, при равенстве —
 * меньшую (обобщение `bestPortion` генератора с «цели по ккал» до «цели по
 * выбранному нутриенту»). Нулевой вклад нутриента → минимальная порция.
 */
function portionForValue(perServingValue: number, targetValue: number): number {
  if (perServingValue <= 0) return PORTION_STEPS[0];
  let best = PORTION_STEPS[0];
  let bestDist = Infinity;
  for (const p of PORTION_STEPS) {
    const dist = Math.abs(perServingValue * p - targetValue);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

/**
 * Порция под остаток: целимся по отстающему макросу (если он есть и блюдо его
 * несёт), иначе — по калориям остатка. Отрицательный остаток (уже перебор)
 * трактуем как цель 0 → минимальная порция.
 */
function choosePortion(
  perServing: FoodNutrients,
  remaining: DiaryNutrients,
  lagging: Macro | null,
): number {
  if (lagging && perServing[lagging] > 0) {
    return portionForValue(perServing[lagging], Math.max(remaining[lagging], 0));
  }
  return portionForValue(perServing.kcal, Math.max(remaining.kcal, 0));
}

/** Недобор нутриента после еды (сколько ещё нужно добрать, ≥0). */
const under = (need: number, got: number) => Math.max(need - got, 0);

/**
 * Взвешенный разрыв остатка после порции (меньше — лучше). Недобор по каждому
 * нутриенту (нормированный на масштаб дня) штрафуется своим весом; отстающий
 * макрос — с множителем. Перебор калорий — отдельный штраф (недобор калорий уже
 * учтён общим ккал-весом). Перебор макросов не штрафуем — это не цель подсказки.
 */
function gapScore(
  contrib: FoodNutrients,
  remaining: DiaryNutrients,
  scale: DiaryNutrients,
  lagging: Macro | null,
): number {
  const norm = (value: number, s: number) => value / Math.max(s, 1);

  let score = W_KCAL * norm(under(remaining.kcal, contrib.kcal), scale.kcal);
  for (const m of MACRO_KEYS) {
    const w = macroWeight(m) * (m === lagging ? LAGGING_BOOST : 1);
    score += w * norm(under(remaining[m], contrib[m]), scale[m]);
  }
  score += W_FIBER * norm(under(remaining.fiber, contrib.fiber), scale.fiber);
  // Перебор калорий — честный штраф (лишнее сверх остатка).
  const kcalOver = Math.max(contrib.kcal - remaining.kcal, 0);
  score += W_KCAL_OVERSHOOT * norm(kcalOver, scale.kcal);
  return score;
}

/** Порог «значимого» отклонения для пометки (в долях дневного масштаба). */
const NOTE_FRACTION = 0.05;

/**
 * Честная пометка для неидеального варианта: добирает ли он отстающий макрос не
 * полностью и/или перебирает калории. Идеальный вариант (закрывает отстающий
 * макрос, без заметного перебора ккал) пометки не несёт (undefined).
 */
function buildNote(
  contrib: FoodNutrients,
  remaining: DiaryNutrients,
  scale: DiaryNutrients,
  lagging: Macro | null,
): string | undefined {
  const laggingShort =
    lagging != null &&
    under(remaining[lagging], contrib[lagging]) > scale[lagging] * NOTE_FRACTION;
  const kcalOver =
    contrib.kcal - remaining.kcal > scale.kcal * NOTE_FRACTION;

  if (lagging != null && (laggingShort || kcalOver)) {
    const macro = MACRO_NOTE_LABEL[lagging];
    if (laggingShort && kcalOver) return `добирает ${macro}, но выше по ккал`;
    if (kcalOver) return `добирает ${macro}, но чуть выше по ккал`;
    return `добирает ${macro}, но не полностью`;
  }
  // Нет отстающего макроса: отметим только заметный перебор калорий.
  if (kcalOver) return "чуть выше по ккал";
  return undefined;
}

interface Scored {
  candidate: SuggestCandidate;
  portion: number;
  contrib: FoodNutrients;
  score: number;
}

/**
 * Топ-N подсказок под остаток дня, детерминированно. Порядок:
 *  1) жёсткие ограничения (аллерген/блок/keyword/слот) + фильтр усилий отсекают
 *     кандидатов через `filterCandidates` генератора — запрещённое не просочится;
 *  2) уже залогированные из подсказок рецепты исключаются (удаление вернёт их);
 *  3) каждому кандидату — порция под отстающий макрос и взвешенный скор разрыва
 *     (минус бонус предпочтений);
 *  4) сортировка по скору; близкие скоры разрешает seed (детерминированно), затем
 *     id — стабильный порядок.
 * Пусто — только когда после отсева кандидатов не осталось (story 11/12: иначе
 * всегда есть хотя бы приближение с честной пометкой).
 */
export function suggestNextMeal(input: SuggestInput): SuggestedMeal[] {
  const {
    remaining,
    laggingMacro,
    slot,
    candidates,
    scale,
    filters,
    constraints,
    preferences,
    excludeRecipeIds,
    seed,
    limit,
  } = input;

  const excluded = new Set(excludeRecipeIds ?? []);
  const mealSlot = effortSlot(slot, filters);
  const pool = filterCandidates(candidates, mealSlot, constraints, preferences).filter(
    (r) => !excluded.has(r.id),
  ) as SuggestCandidate[];
  if (pool.length === 0) return [];

  const scored: Scored[] = pool.map((candidate) => {
    const portion = choosePortion(candidate.perServing, remaining, laggingMacro);
    const contrib = scalePortion(candidate.perServing, portion);
    const score =
      gapScore(contrib, remaining, scale, laggingMacro) -
      preferenceBonus(candidate.id, preferences);
    return { candidate, portion, contrib, score };
  });

  // Детерминизм: округляем скор в бакеты, внутри бакета решает seed, затем id.
  // Так явный выигрыш по КБЖУ не перебивается seed'ом, а близкие — тасуются
  // детерминированно (свежесть при «перегенерации» остаётся воспроизводимой).
  const tie = (id: string) => mulberry32(hashString(id) + seed)();
  scored.sort(
    (a, b) =>
      roundScore(a.score) - roundScore(b.score) ||
      tie(a.candidate.id) - tie(b.candidate.id) ||
      (a.candidate.id < b.candidate.id ? -1 : 1),
  );

  const top = scored.slice(0, limit ?? DEFAULT_LIMIT);
  return top.map((s) => ({
    recipeId: s.candidate.id,
    name: s.candidate.name,
    portion: s.portion,
    nutrients: s.contrib,
    timeMin: s.candidate.timeMin,
    note: buildNote(s.contrib, remaining, scale, laggingMacro),
  }));
}

/** Округление скора в бакет (4 знака) — total order для устойчивой сортировки. */
function roundScore(s: number): number {
  return Math.round(s * 1e4) / 1e4;
}

// ── Идемпотентность лога подсказки ───────────────────────────────────────────

export interface LogDecisionInput {
  /** Записи дня (или их подмножество того же дня) — источник «уже ли залогировано». */
  existing: readonly DiaryEntry[];
  /** Локальная дата пользователя, YYYY-MM-DD. */
  date: string;
  slot: Slot;
  /** Подсказка, которую логируем (её рецепт-происхождение). */
  suggestedRecipeId: string;
}

export interface LogDecision {
  /** true — создать новую запись; false — подсказка уже залогирована (no-op). */
  create: boolean;
}

/**
 * Чистое решение «создать запись или no-op» для лога подсказки. Ключ
 * идемпотентности — date|slot|suggestedRecipeId (прямой прообраз guard-логики
 * core/pantry/track.ts поверх @@unique). Повторный тап «съел» по той же подсказке
 * → create=false (без дубля); удаление залогированной записи убирает её из
 * `existing` → та же подсказка снова create=true (возвращается в блок). Ручные
 * записи (suggestedRecipeId=null) в расчёт не идут.
 */
export function logDecision(input: LogDecisionInput): LogDecision {
  const exists = input.existing.some(
    (e) =>
      e.suggestedRecipeId === input.suggestedRecipeId &&
      e.date === input.date &&
      e.slot === input.slot,
  );
  return { create: !exists };
}
