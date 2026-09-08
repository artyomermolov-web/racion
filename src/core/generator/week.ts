// Сборка недели (тикет 15; тикет 06 шаги 3, 5, 6, 7, 8). Чистый детерминированный
// модуль без Prisma/Next. Надстройка над «дневным» слоем (generate.ts):
//
//  • жадный проход собирает 7 дней сразу, учитывая повторы между днями;
//  • simulated annealing тянет НЕДЕЛЬНЫЕ СРЕДНИЕ КБЖУ в диапазоны (высокий вес),
//    отдельные дни могут отклоняться (низкий вес), и снижает повторы;
//  • анти-повторы «≤ maxPerWindow за окно» — мягкий штраф, а не жёсткий отсев:
//    при нехватке кандидатов слота автоматически смягчается (адаптивность);
//  • перегенерация недели/дня/приёма — с «автодополнением» под остаток целей.
//
// Детерминизм: один seeded-поток RNG на жадность и отжиг; число итераций отжига
// фиксировано (не по стенным часам) — тот же seed даёт ту же неделю. Потолок по
// времени — только страховка (в норме не срабатывает), чтобы держать ≤2 сек.

import type { FoodNutrients } from "@/core/nutrition";
import type {
  GeneratorRecipe,
  MealSlot,
  DayTarget,
  GeneratorConstraints,
  Preferences,
  NutrientRanges,
  RepeatPolicy,
  PlanItem,
  GeneratedDay,
  GenerateWeekInput,
  GeneratedWeek,
  Slot,
} from "./types";
import { filterCandidates } from "./constraints";
import { bestPortion } from "./portions";
import {
  scalePortion,
  sumNutrients,
  zeroNutrients,
  deviation,
  preferenceBonus,
  pantryBonus,
  isAlwaysRecurring,
  chooseScored,
  NUTRIENT_KEYS,
  type Scored,
} from "./generate";
import { mulberry32, pickIndex } from "./rng";

// Веса скоринга (тикет 06 шаг 4): недельное среднее в диапазонах — приоритет;
// дневной баланс — мягко; повторы — умеренно. Веса отдельных нутриентов в
// дневном отклонении живут в generate.ts (переиспользуем `deviation`), чтобы
// формула не двоилась между дневным и недельным слоями.
const W_WEEK = 10;
const W_DAILY = 1;
const W_REPEAT = 2;
// Вес бонуса предпочтений в энергии недели (тикет 16): мягко удерживает избранное
// и recurring often при отжиге, не перебивая приоритет КБЖУ (W_WEEK).
const W_PREF = 1;
// Вес бонуса кладовки в энергии недели (тикет 19): та же роль, что и W_PREF —
// мягко тянет отжиг к домашним продуктам, не перебивая КБЖУ.
const W_PANTRY = 1;
// Штраф за повтор при жадном выборе (нудж прочь от уже исчерпанных, не отсев).
const W_REPEAT_GREEDY = 3;

const POOL_SIZE = 3;
const DEFAULT_DAYS = 7;
// Клетчатка — мягкий минимум (kbju-master; в отжиге это minPenalty, а не жёсткий
// rangePenalty). Вердикт `compromised` тоже трактует её мягко: небольшой недобор
// в пределах допуска при выполненных ЖЁСТКИХ коридорах КБЖУ (ккал/Б/Ж/У) не
// помечает неделю неудачной — иначе на реалистичной базе (тикет 21, ~60 рецептов)
// пользователь видел бы ложное предупреждение из-за 1–2 г клетчатки при идеальных
// макросах. Грубый недобор (> допуска) неделю по-прежнему компрометирует.
export const FIBER_SOFT_TOLERANCE = 3;
const DEFAULT_MAX_PER_WINDOW = 2;
const DEFAULT_MAX_ITERATIONS = 3000;
const DEFAULT_TIME_BUDGET_MS = 1800;

/** Нормированное расстояние |a−b|/масштаб (масштаб не меньше 1). */
const nd = (a: number, b: number, s: number) => Math.abs(a - b) / Math.max(s, 1);

/** Полное дневное отклонение суммы дня от дневной цели (для энергии отжига). */
function dayDeviation(totals: FoodNutrients, target: DayTarget): number {
  return deviation(totals, target, target);
}

/** Квадрат нормированного выхода за [min,max]; 0 внутри коридора. */
function rangePenalty(value: number, min: number, max: number, scale: number): number {
  if (value < min) {
    const d = nd(min, value, scale);
    return d * d;
  }
  if (value > max) {
    const d = nd(value, max, scale);
    return d * d;
  }
  return 0;
}

/** Штраф за недобор нижней границы (клетчатка — только минимум). */
function minPenalty(value: number, min: number, scale: number): number {
  if (value >= min) return 0;
  const d = nd(min, value, scale);
  return d * d;
}

/** Собирает PlanItem из кандидата и порции. */
function toItem(slot: Slot, chosen: Scored): PlanItem {
  return {
    slot,
    recipeId: chosen.recipe.id,
    portion: chosen.portion,
    nutrients: scalePortion(chosen.recipe.perServing, chosen.portion),
  };
}

/** Рецепт освобождён от штрафа за повтор (остаток / always-recurring)? */
function isRepeatExempt(id: string, repeat: RepeatPolicy): boolean {
  return (
    (repeat.alwaysRecurringIds?.includes(id) ?? false) ||
    (repeat.leftoverIds?.includes(id) ?? false)
  );
}

/**
 * Штраф за очередное использование рецепта при текущем счётчике `count`
 * (сколько раз уже стоит в неделе). Растёт после порога; исключённые — 0.
 * Мягкий (не отсев) — в этом адаптивность: при нехватке кандидатов генератор
 * всё равно поставит блюдо, просто с бóльшим штрафом.
 */
function repeatStepCost(count: number, id: string, repeat: RepeatPolicy): number {
  if (isRepeatExempt(id, repeat)) return 0;
  const over = count + 1 - repeat.maxPerWindow;
  return over > 0 ? over : 0;
}

/**
 * Лучший (кандидат, порция) для слота под долю-цель приёма и накопленный КБЖУ,
 * с учётом повторов между днями (usage). Порция — под ккал-цель приёма; среди
 * кандидатов ранжируем по (кумулятивное отклонение + штраф повтора); seed
 * выбирает одного из POOL_SIZE лучших.
 */
function pickForSlot(
  candidates: GeneratorRecipe[],
  running: FoodNutrients,
  slotShare: number,
  cumShare: number,
  target: DayTarget,
  usage: Map<string, number>,
  repeat: RepeatPolicy,
  rng: () => number,
  preferences?: Preferences,
  pantryStockIds?: string[],
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
    const repeatCost =
      W_REPEAT_GREEDY * repeatStepCost(usage.get(recipe.id) ?? 0, recipe.id, repeat);
    const score =
      deviation(projected, cumTarget, target) +
      repeatCost -
      preferenceBonus(recipe.id, preferences) -
      pantryBonus(recipe, pantryStockIds);
    return { recipe, portion, score };
  });

  // Гарантия always-recurring + «корзина выбора» по seed — общая логика ядра.
  return chooseScored(scored, preferences, rng, POOL_SIZE);
}

/**
 * Жадно собирает один день под цель, учитывая повторы между днями (usage,
 * мутируется). Блюдо не повторяется внутри дня. Возвращает приёмы дня.
 */
function greedyDay(
  recipes: GeneratorRecipe[],
  slots: MealSlot[],
  target: DayTarget,
  constraints: GeneratorConstraints,
  usage: Map<string, number>,
  repeat: RepeatPolicy,
  rng: () => number,
  preferences?: Preferences,
  pantryStockIds?: string[],
): PlanItem[] {
  const items: PlanItem[] = [];
  const usedToday = new Set<string>();
  let cumShare = 0;
  for (const slot of slots) {
    cumShare += slot.kcalShare;
    const candidates = filterCandidates(recipes, slot, constraints, preferences).filter(
      (r) => !usedToday.has(r.id),
    );
    const chosen = pickForSlot(
      candidates,
      sumNutrients(items),
      slot.kcalShare,
      cumShare,
      target,
      usage,
      repeat,
      rng,
      preferences,
      pantryStockIds,
    );
    if (!chosen) continue;
    usedToday.add(chosen.recipe.id);
    usage.set(chosen.recipe.id, (usage.get(chosen.recipe.id) ?? 0) + 1);
    items.push(toItem(slot.slot, chosen));
  }
  return items;
}

/** Счётчик использования каждого рецепта во всех днях. */
function countUsage(days: PlanItem[][]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const day of days) {
    for (const it of day) usage.set(it.recipeId, (usage.get(it.recipeId) ?? 0) + 1);
  }
  return usage;
}

/** Суммарный штраф за повторы по всей неделе (квадрат перебора над порогом). */
function repeatEnergy(days: PlanItem[][], repeat: RepeatPolicy): number {
  let penalty = 0;
  for (const [id, count] of countUsage(days)) {
    if (isRepeatExempt(id, repeat)) continue;
    const over = count - repeat.maxPerWindow;
    if (over > 0) penalty += over * over;
  }
  return penalty;
}

/** Недельное среднее КБЖУ (сумма всех приёмов / число дней), НЕ округлено. */
function weeklyMean(days: PlanItem[][], nDays: number): FoodNutrients {
  const total = zeroNutrients();
  for (const day of days) {
    for (const it of day) {
      for (const k of NUTRIENT_KEYS) total[k] += it.nutrients[k];
    }
  }
  const mean = zeroNutrients();
  for (const k of NUTRIENT_KEYS) mean[k] = total[k] / Math.max(nDays, 1);
  return mean;
}

/** Энергия недельного среднего относительно диапазонов (высокий вес). */
function weekRangeEnergy(
  mean: FoodNutrients,
  ranges: NutrientRanges,
  scale: DayTarget,
): number {
  return (
    rangePenalty(mean.kcal, ranges.kcalMin, ranges.kcalMax, scale.kcal) +
    rangePenalty(mean.protein, ranges.proteinMin, ranges.proteinMax, scale.protein) +
    rangePenalty(mean.fat, ranges.fatMin, ranges.fatMax, scale.fat) +
    rangePenalty(mean.carb, ranges.carbMin, ranges.carbMax, scale.carb) +
    minPenalty(mean.fiber, ranges.fiberMin, scale.fiber)
  );
}

/**
 * Бонус-энергия предпочтений (тикет 16): сумма бонусов размещённых избранных /
 * recurring often, со знаком минус (наличие предпочтённого снижает энергию). SA
 * мягко удерживает вкусы, не перебивая КБЖУ. always-recurring сюда не входит —
 * его присутствие уже гарантировано жадным forced-выбором и защитой ходов.
 */
function preferenceEnergy(days: PlanItem[][], preferences?: Preferences): number {
  if (!preferences) return 0;
  let bonus = 0;
  for (const day of days) {
    for (const it of day) bonus += preferenceBonus(it.recipeId, preferences);
  }
  return -bonus;
}

/**
 * Бонус кладовки по рецептам на id (тикет 19), посчитанный один раз до отжига:
 * значение бонуса за каждый рецепт при текущем запасе дома. Пусто, если запаса
 * нет — тогда pantry-энергия не считается вовсе.
 */
function pantryBonusMap(
  recipes: GeneratorRecipe[],
  pantryStockIds?: string[],
): Map<string, number> {
  const map = new Map<string, number>();
  if (!pantryStockIds || pantryStockIds.length === 0) return map;
  for (const r of recipes) {
    const b = pantryBonus(r, pantryStockIds);
    if (b > 0) map.set(r.id, b);
  }
  return map;
}

/**
 * Бонус-энергия кладовки (тикет 19): сумма бонусов размещённых домашних блюд со
 * знаком минус (наличие домашнего снижает энергию). SA мягко тянет к кладовке, не
 * перебивая КБЖУ. Значения бонусов заранее в `bonusById` (не пересчитываем на ход).
 */
function pantryEnergy(days: PlanItem[][], bonusById: Map<string, number>): number {
  if (bonusById.size === 0) return 0;
  let bonus = 0;
  for (const day of days) {
    for (const it of day) bonus += bonusById.get(it.recipeId) ?? 0;
  }
  return -bonus;
}

/** Полная энергия недели: диапазоны + дни + повторы + предпочтения + кладовка. */
function totalEnergy(
  days: PlanItem[][],
  ranges: NutrientRanges,
  dayTarget: DayTarget,
  repeat: RepeatPolicy,
  nDays: number,
  preferences: Preferences | undefined,
  pantryById: Map<string, number>,
): number {
  const mean = weeklyMean(days, nDays);
  let dayE = 0;
  for (const day of days) dayE += dayDeviation(sumNutrients(day), dayTarget);
  return (
    W_WEEK * weekRangeEnergy(mean, ranges, dayTarget) +
    W_DAILY * dayE +
    W_REPEAT * repeatEnergy(days, repeat) +
    W_PREF * preferenceEnergy(days, preferences) +
    W_PANTRY * pantryEnergy(days, pantryById)
  );
}

/** Соседняя порция (±1 шаг сетки 0.25–2.0), детерминированно по rng. */
function nudgePortion(portion: number, rng: () => number): number {
  const up = Math.min(2.0, portion + 0.25);
  const down = Math.max(0.25, portion - 0.25);
  if (up === portion) return down;
  if (down === portion) return up;
  return rng() < 0.5 ? up : down;
}

interface Move {
  undo: () => void;
}

/**
 * Предлагает и ПРИМЕНЯЕТ на месте один ход отжига: замена блюда в слоте, смена
 * порции или обмен блюдами между днями в одном слоте. Возвращает undo (откат при
 * отклонении по Метрополису) или null (ход невозможен). Ходы держат инвариант
 * «блюдо не повторяется внутри дня».
 */
function proposeMove(
  days: PlanItem[][],
  recipes: GeneratorRecipe[],
  slots: MealSlot[],
  constraints: GeneratorConstraints,
  dayTarget: DayTarget,
  rng: () => number,
  fixedDay?: number,
  preferences?: Preferences,
): Move | null {
  const kind = rng();
  const dIdx = fixedDay ?? pickIndex(rng, days.length);
  const day = days[dIdx];
  if (day.length === 0) return null;
  const sIdx = pickIndex(rng, day.length);
  const item = day[sIdx];
  const mealSlot = slots.find((s) => s.slot === item.slot);
  if (!mealSlot) return null;
  // always-recurring обязателен: его нельзя вытеснить из плана. Смену порции
  // разрешаем (блюдо остаётся), а замену/обмен — нет.
  const itemForced = isAlwaysRecurring(item.recipeId, preferences);

  // 1/3 — смена порции.
  if (kind < 0.34) {
    const gr = recipes.find((r) => r.id === item.recipeId);
    if (!gr) return null;
    const oldItem = item;
    const portion = nudgePortion(item.portion, rng);
    day[sIdx] = {
      slot: item.slot,
      recipeId: item.recipeId,
      portion,
      nutrients: scalePortion(gr.perServing, portion),
    };
    return { undo: () => (day[sIdx] = oldItem) };
  }

  // 2/3 — обмен блюдами между днями в этом же слоте. При фокусной перегенерации
  // одного дня (fixedDay) обмен запрещён — он бы менял и другой день.
  if (kind < 0.67 && days.length > 1 && fixedDay === undefined) {
    let oIdx = pickIndex(rng, days.length);
    if (oIdx === dIdx) oIdx = (oIdx + 1) % days.length;
    const other = days[oIdx];
    const oSlot = other.findIndex((it) => it.slot === item.slot);
    if (oSlot === -1) return null;
    const a = day[sIdx];
    const b = other[oSlot];
    if (a.recipeId === b.recipeId) return null;
    // Не переносим always-recurring между днями (в дне-доноре он обязан остаться).
    if (itemForced || isAlwaysRecurring(b.recipeId, preferences)) return null;
    // Инвариант дня: не создаём дубль внутри дня после обмена.
    if (day.some((it, i) => i !== sIdx && it.recipeId === b.recipeId)) return null;
    if (other.some((it, i) => i !== oSlot && it.recipeId === a.recipeId)) return null;
    day[sIdx] = b;
    other[oSlot] = a;
    return {
      undo: () => {
        day[sIdx] = a;
        other[oSlot] = b;
      },
    };
  }

  // 3/3 — замена блюда в слоте другим кандидатом. always-recurring не заменяем —
  // он обязан присутствовать (тикет 16).
  if (itemForced) return null;
  const candidates = filterCandidates(recipes, mealSlot, constraints, preferences).filter(
    (r) => r.id !== item.recipeId && !day.some((it, i) => i !== sIdx && it.recipeId === r.id),
  );
  if (candidates.length === 0) return null;
  const cand = candidates[pickIndex(rng, candidates.length)];
  const slotKcalTarget = dayTarget.kcal * mealSlot.kcalShare;
  const portion = bestPortion(cand.perServing.kcal, slotKcalTarget);
  const oldItem = item;
  day[sIdx] = toItem(item.slot, { recipe: cand, portion, score: 0 });
  return { undo: () => (day[sIdx] = oldItem) };
}

/**
 * Simulated annealing: старт от жадного решения, ходы по Метрополису с
 * геометрическим охлаждением. Итераций фиксированное число (детерминизм);
 * потолок по времени — только страховка. Мутирует `days` на месте.
 */
function anneal(
  days: PlanItem[][],
  input: GenerateWeekInput,
  repeat: RepeatPolicy,
  nDays: number,
  rng: () => number,
  opts: { fixedDay?: number; maxIterations?: number } = {},
): void {
  const maxIters = opts.maxIterations ?? input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const budgetMs = input.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const start = Date.now();
  const T0 = 1.0;
  const Tend = 0.01;

  const pantryById = pantryBonusMap(input.recipes, input.pantryStockIds);
  let energy = totalEnergy(
    days,
    input.ranges,
    input.dayTarget,
    repeat,
    nDays,
    input.preferences,
    pantryById,
  );
  for (let i = 0; i < maxIters; i++) {
    const T = T0 * Math.pow(Tend / T0, i / maxIters);
    const move = proposeMove(
      days,
      input.recipes,
      input.slots,
      input.constraints,
      input.dayTarget,
      rng,
      opts.fixedDay,
      input.preferences,
    );
    if (!move) continue;
    const next = totalEnergy(
      days,
      input.ranges,
      input.dayTarget,
      repeat,
      nDays,
      input.preferences,
      pantryById,
    );
    const dE = next - energy;
    if (dE <= 0 || rng() < Math.exp(-dE / T)) {
      energy = next; // принять
    } else {
      move.undo(); // отклонить
    }
    // Проверка времени редко (страховка от зависания на большой базе).
    if ((i & 127) === 0 && Date.now() - start > budgetMs) break;
  }
}

// Итераций отжига при перегенерации одного дня — меньше (оптимизируем лишь один
// день при зафиксированных прочих), этого достаточно и держит скорость.
const DAY_ANNEAL_ITERATIONS = 1200;

/** Округлённое недельное среднее и флаг «в диапазонах ли». */
function summarize(
  days: PlanItem[][],
  ranges: NutrientRanges,
  nDays: number,
): { weeklyAverage: FoodNutrients; compromised: boolean } {
  const mean = weeklyMean(days, nDays);
  const weeklyAverage = zeroNutrients();
  for (const k of NUTRIENT_KEYS) weeklyAverage[k] = Math.round(mean[k]);

  const within =
    weeklyAverage.kcal >= ranges.kcalMin &&
    weeklyAverage.kcal <= ranges.kcalMax &&
    weeklyAverage.protein >= ranges.proteinMin &&
    weeklyAverage.protein <= ranges.proteinMax &&
    weeklyAverage.fat >= ranges.fatMin &&
    weeklyAverage.fat <= ranges.fatMax &&
    weeklyAverage.carb >= ranges.carbMin &&
    weeklyAverage.carb <= ranges.carbMax &&
    // Клетчатка — мягкий минимум с допуском (см. FIBER_SOFT_TOLERANCE).
    weeklyAverage.fiber >= ranges.fiberMin - FIBER_SOFT_TOLERANCE;

  return { weeklyAverage, compromised: !within };
}

/** Собирает GeneratedDay (день + сумма + цель) из приёмов. */
function toGeneratedDay(items: PlanItem[], target: DayTarget): GeneratedDay {
  return { items, totals: sumNutrients(items), target };
}

/**
 * Политика повторов из входа с дефолтами. always-recurring (тикет 16) освобождён
 * от штрафа за повтор — он и так стоит каждый день; объединяем его id с явным
 * списком из repeat, чтобы источник исключений был один.
 */
function repeatPolicy(input: GenerateWeekInput): RepeatPolicy {
  const always = [
    ...new Set([
      ...(input.repeat?.alwaysRecurringIds ?? []),
      ...(input.preferences?.recurringAlwaysIds ?? []),
    ]),
  ];
  return {
    maxPerWindow: input.repeat?.maxPerWindow ?? DEFAULT_MAX_PER_WINDOW,
    alwaysRecurringIds: always.length > 0 ? always : undefined,
    leftoverIds: input.repeat?.leftoverIds,
  };
}

/**
 * Собирает неделю под диапазоны недельного среднего: жадный проход (учёт
 * повторов между днями) → simulated annealing (тянет средние в диапазоны,
 * снижает повторы). Детерминировано при фиксированном seed.
 */
export function generateWeek(input: GenerateWeekInput): GeneratedWeek {
  const nDays = input.days ?? DEFAULT_DAYS;
  const repeat = repeatPolicy(input);
  const rng = mulberry32(input.seed);

  const usage = new Map<string, number>();
  const days: PlanItem[][] = [];
  for (let d = 0; d < nDays; d++) {
    days.push(
      greedyDay(
        input.recipes,
        input.slots,
        input.dayTarget,
        input.constraints,
        usage,
        repeat,
        rng,
        input.preferences,
        input.pantryStockIds,
      ),
    );
  }

  anneal(days, input, repeat, nDays, rng);

  const { weeklyAverage, compromised } = summarize(days, input.ranges, nDays);
  return {
    days: days.map((items) => toGeneratedDay(items, input.dayTarget)),
    weeklyAverage,
    ranges: input.ranges,
    compromised,
  };
}

export interface RegenerateDayInput extends GenerateWeekInput {
  /** Текущие дни недели (по одному приёму на слот). */
  current: PlanItem[][];
  /** Индекс дня, который пересобираем. */
  dayIndex: number;
}

/**
 * Перегенерация одного дня недели с «автодополнением под остаток» (тикет 06
 * шаг 7): цель дня = (середины диапазонов × дней − сумма прочих дней), зажатая в
 * разумный коридор вокруг дневной цели, — так недельное среднее удерживается в
 * диапазонах. Повторы учитываются относительно прочих дней. Возвращает всю
 * пересобранную неделю.
 */
export function regenerateDay(input: RegenerateDayInput): GeneratedWeek {
  const nDays = input.current.length;
  const repeat = repeatPolicy(input);
  const rng = mulberry32(input.seed);
  const { ranges, dayTarget } = input;

  const others = input.current.filter((_, i) => i !== input.dayIndex);
  const othersSum = zeroNutrients();
  for (const day of others) {
    for (const it of day) for (const k of NUTRIENT_KEYS) othersSum[k] += it.nutrients[k];
  }

  const midRange = (min: number, max: number) => (min + max) / 2;
  // Остаток под день + зажим в [0.5×; 1.5×] дневной цели (без экстремумов).
  const residual = (weeklyMid: number, other: number, dayScale: number): number => {
    const raw = weeklyMid * nDays - other;
    return Math.min(1.5 * dayScale, Math.max(0.5 * dayScale, raw));
  };
  const residualTarget: DayTarget = {
    kcal: residual(midRange(ranges.kcalMin, ranges.kcalMax), othersSum.kcal, dayTarget.kcal),
    protein: residual(midRange(ranges.proteinMin, ranges.proteinMax), othersSum.protein, dayTarget.protein),
    fat: residual(midRange(ranges.fatMin, ranges.fatMax), othersSum.fat, dayTarget.fat),
    carb: residual(midRange(ranges.carbMin, ranges.carbMax), othersSum.carb, dayTarget.carb),
    fiber: dayTarget.fiber,
  };

  // Повторы относительно прочих дней (текущий день пересобираем с нуля).
  const usage = countUsage(others);
  const newDay = greedyDay(
    input.recipes,
    input.slots,
    residualTarget,
    input.constraints,
    usage,
    repeat,
    rng,
    input.preferences,
    input.pantryStockIds,
  );

  // Собираем неделю с новым днём и дожимаем ТОЛЬКО этот день отжигом при
  // зафиксированных прочих — чтобы недельное среднее вернулось в диапазоны
  // (автодополнение под остаток), не трогая остальные дни.
  const days = input.current.map((d, i) => (i === input.dayIndex ? newDay : d));
  anneal(days, input, repeat, nDays, rng, {
    fixedDay: input.dayIndex,
    maxIterations: DAY_ANNEAL_ITERATIONS,
  });

  const { weeklyAverage, compromised } = summarize(days, ranges, nDays);
  return {
    days: days.map((items) => toGeneratedDay(items, dayTarget)),
    weeklyAverage,
    ranges,
    compromised,
  };
}

export interface ReplaceMealInWeekInput extends GenerateWeekInput {
  current: PlanItem[][];
  dayIndex: number;
  slot: Slot;
}

/**
 * Замена одного приёма (блюда) в конкретном дне под ОСТАТОК дневной цели (тикет
 * 06 шаг 7): цель слота = дневная цель − прочие приёмы дня. Новое блюдо — из
 * кандидатов слота, исключая текущее, стоящие в других приёмах дня и (мягко)
 * перебор повторов по неделе. Возвращает всю неделю. В «тонком» слое приём и
 * блюдо совпадают (один приём = одно блюдо), поэтому это же действие обслуживает
 * оба уровня перегенерации.
 */
export function replaceMealInWeek(input: ReplaceMealInWeekInput): GeneratedWeek | null {
  const nDays = input.current.length;
  const repeat = repeatPolicy(input);
  const rng = mulberry32(input.seed);
  const { dayTarget, ranges } = input;

  const day = input.current[input.dayIndex];
  if (!day) return null;
  const mealSlot = input.slots.find((s) => s.slot === input.slot);
  if (!mealSlot) return null;

  const others = day.filter((it) => it.slot !== input.slot);
  const usedInDay = new Set(others.map((it) => it.recipeId));
  const currentId = day.find((it) => it.slot === input.slot)?.recipeId;

  const candidates = filterCandidates(
    input.recipes,
    mealSlot,
    input.constraints,
    input.preferences,
  ).filter((r) => r.id !== currentId && !usedInDay.has(r.id));
  if (candidates.length === 0) return null;

  // Остаток дневной цели после прочих приёмов дня (не ниже нуля).
  const othersSum = sumNutrients(others);
  const remaining: DayTarget = {
    kcal: Math.max(0, dayTarget.kcal - othersSum.kcal),
    protein: Math.max(0, dayTarget.protein - othersSum.protein),
    fat: Math.max(0, dayTarget.fat - othersSum.fat),
    carb: Math.max(0, dayTarget.carb - othersSum.carb),
    fiber: Math.max(0, dayTarget.fiber - othersSum.fiber),
  };

  // Повторы относительно прочих дней (не считаем текущий день).
  const usage = countUsage(input.current.filter((_, i) => i !== input.dayIndex));
  const chosen = pickForSlot(
    candidates,
    zeroNutrients(),
    1,
    1,
    remaining,
    usage,
    repeat,
    rng,
    input.preferences,
    input.pantryStockIds,
  );
  if (!chosen) return null;

  const newItem = toItem(input.slot, chosen);
  const newDay = day.map((it) => (it.slot === input.slot ? newItem : it));
  const days = input.current.map((d, i) => (i === input.dayIndex ? newDay : d));
  const { weeklyAverage, compromised } = summarize(days, ranges, nDays);
  return {
    days: days.map((items) => toGeneratedDay(items, dayTarget)),
    weeklyAverage,
    ranges,
    compromised,
  };
}
