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
}

/** Целевые КБЖУ на день (точки, а не диапазоны — берём середины нормы). */
export interface DayTarget {
  kcal: number;
  protein: number;
  fat: number;
  carb: number;
  fiber: number;
}

/** Жёсткие персональные ограничения (аллергены/стоп-лист). */
export interface GeneratorConstraints {
  /** Исключённые аллергены — блюдо с любым из них никогда не попадёт в план. */
  excludedAllergens: Allergen[];
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
  /** Seed детерминирует выбор среди близких кандидатов (для тестов и стабильности). */
  seed: number;
}
