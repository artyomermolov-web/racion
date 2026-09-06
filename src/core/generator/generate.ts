// Сборка дня и замена блюда (тикет 14, «тонкий» слой уровня дня — тикет 06,
// шаги 2–3 и 7). Чистый детерминированный модуль без Prisma/Next.
//
// Что делает этот слой (и что осознанно НЕ делает):
//  • жёсткие ограничения отсекают кандидатов по слоту (constraints.ts);
//  • для каждого слота подбираем блюдо + порцию 0.25–2.0 жадно, минимизируя
//    отклонение накопленного КБЖУ от цели (кумулятивно по долям приёмов);
//  • среди нескольких близких по скорингу кандидатов выбор делает seed — так
//    «перегенерировать» даёт свежий вариант, оставаясь детерминированным;
//  • замена блюда пересобирает один слот под ОСТАТОК дневной цели (день минус
//    прочие приёмы) — «автодополнение» тикета 06 шаг 7.
// Мягкие штрафы/бонусы, бюджет, кладовка, анти-повторы за 14 дней и недельный
// simulated annealing — не здесь (тикеты 15–19).

import type { FoodNutrients } from "@/core/nutrition";
import type {
  Slot,
  Equipment,
  GeneratorRecipe,
  MealSlot,
  DayTarget,
  GeneratorConstraints,
  PlanItem,
  GeneratedDay,
  GenerateDayInput,
} from "./types";
import { filterCandidates } from "./constraints";
import { PORTION_STEPS, bestPortion } from "./portions";
import { mulberry32, pickIndex } from "./rng";

/** Вся техника доступна («тонкий» слой): персональной кухни ещё нет (тикет 16+). */
const ALL_EQUIPMENT: Equipment[] = [
  "stove",
  "oven",
  "blender",
  "multicooker",
  "none",
];

/**
 * Раскладка дня «тонкого» слоя (аналог MealType, тикет 04). Модели
 * MealType/DaySetting в схеме пока нет — задаём кодом. Доли ккал в сумме = 1;
 * время готовки — потолок для жёсткого ограничения по времени.
 */
export const DEFAULT_DAY_LAYOUT: MealSlot[] = [
  { slot: "breakfast", kcalShare: 0.25, cookTimeMin: 25, canCook: true, availableEquipment: ALL_EQUIPMENT },
  { slot: "lunch", kcalShare: 0.35, cookTimeMin: 90, canCook: true, availableEquipment: ALL_EQUIPMENT },
  { slot: "dinner", kcalShare: 0.3, cookTimeMin: 60, canCook: true, availableEquipment: ALL_EQUIPMENT },
  { slot: "snack", kcalShare: 0.1, cookTimeMin: 15, canCook: true, availableEquipment: ALL_EQUIPMENT },
];

// Веса скоринга отклонения КБЖУ (тикет 06 шаг 4, отражают «КБЖУ прежде всего»):
// ккал и белок важнее жира/углеводов. Нормируем на масштаб дня, чтобы веса были
// сопоставимы между нутриентами.
const W_KCAL = 1.0;
const W_PROTEIN = 0.8;
const W_FAT = 0.4;
const W_CARB = 0.4;

// Сколько лучших кандидатов попадают в «корзину выбора» seed'ом. Больше 1 —
// чтобы «перегенерировать» давало разнообразие; малое число — чтобы держаться
// близко к оптимуму по КБЖУ.
const POOL_SIZE = 3;

const NUTRIENT_KEYS: (keyof FoodNutrients)[] = [
  "kcal",
  "protein",
  "fat",
  "carb",
  "fiber",
  "sodium",
];

/** Нулевые нутриенты — свежий объект (общая точка для суммирования). */
export const zeroNutrients = (): FoodNutrients => ({
  kcal: 0,
  protein: 0,
  fat: 0,
  carb: 0,
  fiber: 0,
  sodium: 0,
});

/** КБЖУ порции = КБЖУ одной порции × множитель, округлено (kbju-master.md A1). */
export function scalePortion(
  perServing: FoodNutrients,
  portion: number,
): FoodNutrients {
  const out = zeroNutrients();
  for (const k of NUTRIENT_KEYS) out[k] = Math.round(perServing[k] * portion);
  return out;
}

/**
 * Сумма КБЖУ набора приёмов. Обобщена по «носителю КБЖУ» (что угодно с полем
 * `nutrients`), чтобы её переиспользовал и UI (DayMeal), не дублируя свёртку.
 */
export function sumNutrients(
  items: readonly { nutrients: FoodNutrients }[],
): FoodNutrients {
  const acc = zeroNutrients();
  for (const it of items) {
    for (const k of NUTRIENT_KEYS) acc[k] += it.nutrients[k];
  }
  return acc;
}

/**
 * Взвешенное нормированное отклонение спроецированного КБЖУ (running + вклад)
 * от кумулятивной цели. Меньше — лучше. Нормировка на масштаб дня делает вклад
 * нутриентов сопоставимым независимо от абсолютных величин.
 */
function deviation(
  projected: FoodNutrients,
  cumTarget: { kcal: number; protein: number; fat: number; carb: number },
  scale: DayTarget,
): number {
  const nd = (a: number, b: number, s: number) => Math.abs(a - b) / Math.max(s, 1);
  return (
    W_KCAL * nd(projected.kcal, cumTarget.kcal, scale.kcal) +
    W_PROTEIN * nd(projected.protein, cumTarget.protein, scale.protein) +
    W_FAT * nd(projected.fat, cumTarget.fat, scale.fat) +
    W_CARB * nd(projected.carb, cumTarget.carb, scale.carb)
  );
}

interface Scored {
  recipe: GeneratorRecipe;
  portion: number;
  score: number;
}

/**
 * Лучший (кандидат, порция) для слота под заданную «долю-цель» приёма и
 * накопленный КБЖУ. Порцию берём под ккал-цель приёма, затем среди кандидатов
 * ранжируем по кумулятивному отклонению; seed выбирает одного из POOL_SIZE
 * лучших (разнообразие при детерминизме).
 */
function pickForSlot(
  candidates: GeneratorRecipe[],
  running: FoodNutrients,
  slotShare: number,
  cumShare: number,
  target: DayTarget,
  rng: () => number,
): Scored | null {
  if (candidates.length === 0) return null;

  const slotKcalTarget = target.kcal * slotShare;
  const cumTarget = {
    kcal: target.kcal * cumShare,
    protein: target.protein * cumShare,
    fat: target.fat * cumShare,
    carb: target.carb * cumShare,
  };

  const scored: Scored[] = candidates.map((recipe) => {
    const portion = bestPortion(recipe.perServing.kcal, slotKcalTarget);
    const contrib = scalePortion(recipe.perServing, portion);
    const projected = zeroNutrients();
    for (const k of NUTRIENT_KEYS) projected[k] = running[k] + contrib[k];
    return { recipe, portion, score: deviation(projected, cumTarget, target) };
  });

  // Стабильная сортировка по скорингу, затем по id — детерминизм при равенстве.
  scored.sort((a, b) => a.score - b.score || (a.recipe.id < b.recipe.id ? -1 : 1));

  const pool = scored.slice(0, Math.min(POOL_SIZE, scored.length));
  return pool[pickIndex(rng, pool.length)];
}

/** Собирает PlanItem из выбранного кандидата и порции. */
function toItem(slot: MealSlot, chosen: Scored): PlanItem {
  return {
    slot: slot.slot,
    recipeId: chosen.recipe.id,
    portion: chosen.portion,
    nutrients: scalePortion(chosen.recipe.perServing, chosen.portion),
  };
}

/**
 * Собирает день под цель: по слотам в порядке раскладки жадно выбирает блюдо +
 * порцию, минимизируя отклонение накопленного КБЖУ от цели. Блюдо не повторяется
 * внутри дня. Детерминировано при фиксированном seed.
 */
export function generateDay(input: GenerateDayInput): GeneratedDay {
  const { recipes, slots, target, constraints, seed } = input;
  const rng = mulberry32(seed);

  const items: PlanItem[] = [];
  const used = new Set<string>();
  let cumShare = 0;

  for (const slot of slots) {
    cumShare += slot.kcalShare;
    const candidates = filterCandidates(recipes, slot, constraints).filter(
      (r) => !used.has(r.id),
    );
    const chosen = pickForSlot(
      candidates,
      sumNutrients(items),
      slot.kcalShare,
      cumShare,
      target,
      rng,
    );
    if (!chosen) continue; // нет кандидатов на слот — пропускаем (редко на сид-базе)
    used.add(chosen.recipe.id);
    items.push(toItem(slot, chosen));
  }

  return { items, totals: sumNutrients(items), target };
}

export interface ReplaceDishInput extends GenerateDayInput {
  /** Текущие приёмы дня (по одному на слот). */
  current: PlanItem[];
  /** Слот, чей приём заменяем. */
  slot: Slot;
}

/**
 * Заменяет блюдо в одном слоте под ОСТАТОК дневной цели (тикет 06 шаг 7,
 * «автодополнение»): цель слота = дневная цель минус КБЖУ прочих зафиксированных
 * приёмов. Новое блюдо — из кандидатов слота, исключая текущее и уже стоящие в
 * других приёмах. Слот адресуется по имени, а не по индексу, — устойчиво к
 * дырам в дне (слот без кандидатов). Детерминировано при фиксированном seed.
 */
export function replaceDish(input: ReplaceDishInput): PlanItem | null {
  const { recipes, slots, target, constraints, seed, current, slot } = input;
  const mealSlot = slots.find((s) => s.slot === slot);
  if (!mealSlot) return null;
  const rng = mulberry32(seed);

  const others = current.filter((it) => it.slot !== slot);
  const usedElsewhere = new Set(others.map((it) => it.recipeId));
  const currentId = current.find((it) => it.slot === slot)?.recipeId;

  const candidates = filterCandidates(recipes, mealSlot, constraints).filter(
    (r) => r.id !== currentId && !usedElsewhere.has(r.id),
  );
  if (candidates.length === 0) return null;

  // Остаток дневной цели после прочих приёмов (не опускаем ниже нуля).
  const othersSum = sumNutrients(others);
  const remaining: DayTarget = {
    kcal: Math.max(0, target.kcal - othersSum.kcal),
    protein: Math.max(0, target.protein - othersSum.protein),
    fat: Math.max(0, target.fat - othersSum.fat),
    carb: Math.max(0, target.carb - othersSum.carb),
    fiber: Math.max(0, target.fiber - othersSum.fiber),
  };

  // Цель слота — весь остаток (доля = 1): кумулятивная цель совпадает со слотовой.
  const chosen = pickForSlot(candidates, zeroNutrients(), 1, 1, remaining, rng);
  if (!chosen) return null;
  return toItem(mealSlot, chosen);
}
