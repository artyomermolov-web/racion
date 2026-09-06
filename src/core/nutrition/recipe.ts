// КБЖУ рецепта из состава. Чистый модуль без Prisma/Next — шов тестирования
// (spec.md, Testing Decisions). Тикет 13: КБЖУ рецепта вычисляется из
// ингредиентов и не хранится вручную.
//
// Значения ингредиентов заданы на 100 г (по research/products-ru.md, источники —
// kbju-master.md D1: USDA/Скурихин). Итог рецепта — линейная свёртка по граммам.
// Округление — по kbju-master.md A1: только в самом конце, ккал и граммы макросов
// до целого; натрий (мг) тоже до целого. Промежуточные суммы не округляются.

/** Нутриенты на 100 г (для ингредиента) или итог блюда (для рецепта). */
export interface FoodNutrients {
  /** ккал */
  kcal: number;
  /** белок, г */
  protein: number;
  /** жир, г */
  fat: number;
  /** углеводы (усвояемые, без клетчатки), г */
  carb: number;
  /** клетчатка, г */
  fiber: number;
  /** натрий, мг */
  sodium: number;
}

/** Ингредиент в составе рецепта: масса в граммах + его нутриенты на 100 г. */
export interface RecipeComponent {
  grams: number;
  per100: FoodNutrients;
}

export interface RecipeNutrition {
  /** КБЖУ всего блюда (на все порции). */
  total: FoodNutrients;
  /** КБЖУ на одну порцию. */
  perServing: FoodNutrients;
}

const NUTRIENT_KEYS: (keyof FoodNutrients)[] = [
  "kcal",
  "protein",
  "fat",
  "carb",
  "fiber",
  "sodium",
];

const zero = (): FoodNutrients => ({
  kcal: 0,
  protein: 0,
  fat: 0,
  carb: 0,
  fiber: 0,
  sodium: 0,
});

/** Свёртка нутриентов ингредиентов по граммам, без округления. */
function accumulate(components: RecipeComponent[]): FoodNutrients {
  const acc = zero();
  for (const { grams, per100 } of components) {
    const factor = grams / 100;
    for (const k of NUTRIENT_KEYS) acc[k] += per100[k] * factor;
  }
  return acc;
}

/** Округление всех нутриентов до целого (kbju-master.md A1, финальный шаг). */
function roundNutrients(n: FoodNutrients): FoodNutrients {
  const out = zero();
  for (const k of NUTRIENT_KEYS) out[k] = Math.round(n[k]);
  return out;
}

const scale = (n: FoodNutrients, factor: number): FoodNutrients => {
  const out = zero();
  for (const k of NUTRIENT_KEYS) out[k] = n[k] * factor;
  return out;
};

/**
 * Полное КБЖУ рецепта из состава: суммирует вклад каждого ингредиента по массе,
 * затем отдаёт итог на всё блюдо и на одну порцию. Деление на порции идёт до
 * округления, чтобы порция не «плыла» от двойного округления. Число порций < 1
 * трактуется как 1 (защита от деления на ноль).
 */
export function computeRecipeNutrition(
  components: RecipeComponent[],
  servings = 1,
): RecipeNutrition {
  const totalRaw = accumulate(components);
  const s = servings >= 1 ? servings : 1;
  return {
    total: roundNutrients(totalRaw),
    perServing: roundNutrients(scale(totalRaw, 1 / s)),
  };
}
