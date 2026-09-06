// Типы ядра генератора (тикет 14, «тонкий» слой уровня дня). Чистый модуль без
// Prisma/Next — основной шов тестирования (spec.md, Testing Decisions).
//
// Здесь только структуры данных; жёсткие ограничения, подбор порций, сборка дня
// и замена блюда — в соседних файлах модуля. Значения-«enum» (slot, equipment,
// allergen) совпадают с seed-data.ts и фиксируются union-типами.

import type { FoodNutrients } from "@/core/nutrition";

export type Slot = "breakfast" | "lunch" | "dinner" | "snack";
export type Equipment = "stove" | "oven" | "blender" | "multicooker" | "none";
export type Allergen =
  | "milk"
  | "gluten"
  | "egg"
  | "fish"
  | "meat"
  | "poultry"
  | "nuts"
  | "soy";

/**
 * Кандидат генератора — рецепт, приведённый к тому, что нужно для отсева и
 * скоринга: где может стоять, сколько готовится, какая техника нужна, какие
 * аллергены несёт (объединение аллергенов ингредиентов) и КБЖУ одной порции.
 */
export interface GeneratorRecipe {
  id: string;
  /** Слоты, с которыми рецепт совместим (RecipeSlot). */
  slots: Slot[];
  /** Время приготовления, мин. */
  timeMin: number;
  /** Требуемая техника (RecipeEquipment). */
  equipment: Equipment[];
  /** Аллергены блюда — объединение аллергенов ингредиентов. */
  allergens: Allergen[];
  /** КБЖУ одной порции (посчитано из состава ядром nutrition). */
  perServing: FoodNutrients;
  /**
   * Ключевые слова для keyword-фильтра (тикет 06 шаг 1): слова названия и
   * теги групп продуктов. Синонимы («курица» → грудка/бедро/фарш) разворачивает
   * слой данных — сюда попадает уже общий тег группы, поэтому один фильтр
   * отсекает все варианты. Необязательно (проводка предпочтений — тикет 16).
   */
  keywords?: string[];
}

/**
 * Тип приёма в дне (аналог MealType, тикет 04). В «тонком» слое задаётся кодом
 * (DEFAULT_DAY_LAYOUT), т.к. модели MealType/DaySetting ещё нет в схеме.
 */
export interface MealSlot {
  slot: Slot;
  /** Доля дневных ккал на этот приём (сумма долей по дню ≈ 1). */
  kcalShare: number;
  /** Максимальное время готовки для приёма, мин (жёсткое ограничение). */
  cookTimeMin: number;
  /** Можно ли готовить в этот приём: false → только техника «none». */
  canCook: boolean;
  /** Доступная техника для приёма (жёсткое ограничение). */
  availableEquipment: Equipment[];
  /**
   * Режим «только recurring» (тикет 16, decision 06: MealType.onlyRecurring). Если
   * true — в приём попадают лишь блюда, отмеченные пользователем как recurring
   * (often/always); прочие кандидаты жёстко отсекаются. По умолчанию false.
   */
  onlyRecurring?: boolean;
}

/** Целевые КБЖУ на день (точки, а не диапазоны — берём середины нормы). */
export interface DayTarget {
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
  fiber: number;
}

/**
 * Мягкие предпочтения по вкусам (тикет 16, decision 06 шаг 4 «бонусы»). В отличие
 * от жёстких GeneratorConstraints (нарушать нельзя) — это скоринговые бонусы и
 * near-hard-гарантия присутствия для always-recurring:
 *  • favorite → бонус к скорингу (блюдо предлагается чаще);
 *  • recurring often → больший бонус (попадает регулярно);
 *  • recurring always → блюдо гарантированно ставится в свой слот (обязательно) и
 *    освобождено от штрафа за повтор.
 * Блок и keyword-фильтр — это жёсткие ограничения, они живут в GeneratorConstraints.
 */
export interface Preferences {
  /** Избранные рецепты — бонус к скорингу. */
  favoriteIds?: string[];
  /** Recurring often — больший бонус (регулярно). */
  recurringOftenIds?: string[];
  /** Recurring always — гарантированное присутствие + освобождение от анти-повторов. */
  recurringAlwaysIds?: string[];
}

/** Жёсткие персональные ограничения (аллергены/стоп-лист). */
export interface GeneratorConstraints {
  /** Исключённые аллергены — блюдо с любым из них никогда не попадёт в план. */
  excludedAllergens: Allergen[];
  /** Заблокированные рецепты (стоп-лист по id) — не попадают в план. */
  blockedRecipeIds?: string[];
  /**
   * Keyword-фильтр: блюдо выбывает, если любой из терминов встречается (без
   * учёта регистра, по подстроке) в его `keywords`. Проводка — тикет 16.
   */
  keywordFilter?: string[];
}

/** Один поставленный приём: слот, рецепт, порция и его КБЖУ (уже с учётом порции). */
export interface PlanItem {
  slot: Slot;
  recipeId: string;
  /** Множитель порции из диапазона 0.25–2.0 (шаг 0.25). */
  portion: number;
  /** КБЖУ приёма = КБЖУ порции × portion, округлено. */
  nutrients: FoodNutrients;
}

/** Собранный день: приёмы, сумма КБЖУ за день и цель, под которую собирали. */
export interface GeneratedDay {
  items: PlanItem[];
  totals: FoodNutrients;
  target: DayTarget;
}

export interface GenerateDayInput {
  recipes: GeneratorRecipe[];
  /** Приёмы дня в порядке следования. */
  slots: MealSlot[];
  target: DayTarget;
  constraints: GeneratorConstraints;
  /** Мягкие предпочтения (избранное/recurring). Необязательно. */
  preferences?: Preferences;
  /** Seed детерминирует выбор среди близких кандидатов (для тестов и стабильности). */
  seed: number;
}

/**
 * Диапазоны недельного среднего КБЖУ (тикет 15, шаг 6). Недельные СРЕДНИЕ обязаны
 * попадать внутрь [min,max] — высокий вес в скоринге; отдельные дни могут
 * отклоняться. Клетчатка — только нижняя граница (как в норме, kbju-master.md).
 */
export interface NutrientRanges {
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
 * Политика анти-повторов (тикет 15, шаг 8). Цель — «≤ maxPerWindow за окно»;
 * при нехватке кандидатов слота смягчается автоматически (штраф мягкий, не
 * жёсткий отсев). Исключения — блюда-остатки и always-recurring: их повтор не
 * штрафуется. Проводка предпочтений/остатков — тикеты 16/19; здесь только шов.
 *
 * Осознанное упрощение «тонкого» слоя: генерируется ровно одна неделя, поэтому
 * окном служит сама сгенерированная неделя (7 дней), а не буквальные «14 дней»
 * из тикета 06 — это строже цели и достаточно, пока планы не персистятся.
 */
export interface RepeatPolicy {
  /** Порог повторов за окно (по умолчанию 2). */
  maxPerWindow: number;
  /** Рецепты, которым разрешён свободный повтор (always-recurring). */
  alwaysRecurringIds?: string[];
  /** Рецепты-остатки — повтор не штрафуется. */
  leftoverIds?: string[];
}

export interface GenerateWeekInput {
  recipes: GeneratorRecipe[];
  /** Раскладка одного дня (одинаковая для всех дней недели). */
  slots: MealSlot[];
  /** Число дней (по умолчанию 7). */
  days: number;
  /** Диапазоны недельного среднего — жёсткая цель для SA. */
  ranges: NutrientRanges;
  /** Точечная дневная цель (середины нормы) — мягкая тяга дня к балансу. */
  dayTarget: DayTarget;
  constraints: GeneratorConstraints;
  /** Мягкие предпочтения (избранное/recurring). Необязательно. */
  preferences?: Preferences;
  repeat?: RepeatPolicy;
  seed: number;
  /** Число итераций отжига (детерминировано). По умолчанию задаётся модулем. */
  maxIterations?: number;
  /** Жёсткий потолок времени, мс (safety, а не основной контроль цикла). */
  timeBudgetMs?: number;
}

/** Собранная неделя: дни, недельное среднее КБЖУ, диапазоны и флаг компромисса. */
export interface GeneratedWeek {
  days: GeneratedDay[];
  /** Среднее КБЖУ за день по неделе (сумма дней / число дней), округлено. */
  weeklyAverage: FoodNutrients;
  ranges: NutrientRanges;
  /**
   * true — недельные средние КБЖУ не удалось загнать в диапазоны (малая база /
   * жёсткие ограничения). UI честно показывает компромисс (тикет 15, шаг 6).
   */
  compromised: boolean;
}
