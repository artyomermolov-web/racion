// Сборка списка покупок (тикет 18, решения тикета 07). Чистый детерминированный
// модуль без Prisma/Next — основной шов тестирования.
//
// Порядок расчёта (решение 07):
//  1. Агрегация потребности по диапазону плана: для каждого приёма разворачиваем
//     рецепт → ингредиенты × (количество / порций рецепта) × порция × едоки;
//     суммируем по ингредиенту в единице продажи (г/мл/шт).
//  2. Вычет запаса дома (только real-лоты кладовки; здесь — шов, по умолчанию 0).
//  3. Округление до целых пачек: packsToBuy = ceil((need − onHand) / packSize),
//     не меньше 0; остаток позиции = packsToBuy·packSize − чистая потребность.
//  4. Сумма ₽ = Σ packsToBuy · pricePerPack — только по позициям, сопоставленным
//     с товаром ВВ (source=vkusvill). Несопоставленные остаются в списке (и в
//     КБЖУ/меню), но из стоимости исключены; смета помечается `partial` (тикет 03).

import type {
  ShoppingIngredient,
  ShoppingLine,
  ShoppingList,
  ShoppingListInput,
  ShoppingRecipe,
} from "./types";

// Небольшой допуск гасит ошибку плавающей точки при делении потребности на
// порции: ровно-пачка (напр. 1800/900 = 2.0000000001) не должна округляться до
// лишней пачки. Реальный «чуть больше пачки» на порядки крупнее допуска.
const EPS = 1e-9;

/**
 * Множитель потребности одного приёма: порция, делённая на порций рецепта, × едоки.
 * Экспортируется — списание кладовки (тикет 20, `/core/pantry`) разворачивает приём
 * в потребность ТОЙ ЖЕ формулой, чтобы «сколько купить» и «сколько списать»
 * никогда не разошлись (решение 07: без двойного вычитания).
 */
export function itemFactor(portion: number, servings: number, people?: number): number {
  const s = servings >= 1 ? servings : 1;
  const p = people && people >= 1 ? people : 1;
  return (portion / s) * p;
}

/** Агрегирует потребность по ingredientId (единица продажи), пропуская неизвестное. */
function aggregateNeed(
  input: ShoppingListInput,
  recipesById: Map<string, ShoppingRecipe>,
  ingredientsById: Map<string, ShoppingIngredient>,
): Map<string, number> {
  const need = new Map<string, number>();
  for (const item of input.plan) {
    const recipe = recipesById.get(item.recipeId);
    if (!recipe) continue; // неизвестный рецепт (напр. устаревшая ссылка) — пропуск
    const factor = itemFactor(item.portion, recipe.servings, item.people);
    for (const ri of recipe.ingredients) {
      if (!ingredientsById.has(ri.ingredientId)) continue; // нет карточки-пачки
      need.set(ri.ingredientId, (need.get(ri.ingredientId) ?? 0) + ri.quantity * factor);
    }
  }
  return need;
}

/** Строит строку списка из потребности: вычет запаса → пачки → остаток → ₽. */
function toLine(
  ing: ShoppingIngredient,
  rawNeed: number,
  onHand: number,
): ShoppingLine {
  const have = Math.max(0, onHand);
  const netNeed = Math.max(0, rawNeed - have);
  const packsToBuy =
    ing.packSize > 0 && netNeed > 0 ? Math.max(0, Math.ceil(netNeed / ing.packSize - EPS)) : 0;
  const leftover = Math.max(0, packsToBuy * ing.packSize - netNeed);
  // Цена в смету идёт только у сопоставленных с ВВ (тикет 03). Несопоставленные
  // остаются в списке (и в КБЖУ/меню), но их фолбэк-цена в стоимость не попадает.
  const priced = ing.source === "vkusvill";
  return {
    ingredientId: ing.id,
    name: ing.name,
    group: ing.group,
    unit: ing.unit,
    need: rawNeed,
    onHand: have,
    netNeed,
    packSize: ing.packSize,
    pricePerPack: ing.pricePerPack,
    packsToBuy,
    leftover,
    priced,
    lineCost: priced ? packsToBuy * ing.pricePerPack : 0,
  };
}

/**
 * Собирает список покупок за период плана. Потребность агрегируется по
 * ингредиенту, из неё вычитается запас дома, остаток округляется до целых пачек,
 * считаются остаток по позиции и сумма ₽. Строки отсортированы по группе, затем
 * по имени — стабильный порядок для UI и печати.
 */
export function buildShoppingList(input: ShoppingListInput): ShoppingList {
  const recipesById = new Map(input.recipes.map((r) => [r.id, r]));
  const ingredientsById = new Map(input.ingredients.map((i) => [i.id, i]));
  const onHand = input.onHand ?? {};

  const need = aggregateNeed(input, recipesById, ingredientsById);

  const lines: ShoppingLine[] = [];
  for (const [id, rawNeed] of need) {
    const ing = ingredientsById.get(id);
    if (!ing) continue;
    lines.push(toLine(ing, rawNeed, onHand[id] ?? 0));
  }

  lines.sort(
    (a, b) => a.group.localeCompare(b.group, "ru") || a.name.localeCompare(b.name, "ru"),
  );

  const totalCost = lines.reduce((sum, l) => sum + l.lineCost, 0);
  // «Дыра» в смете — покупаемая позиция (packsToBuy>0) без реальной цены ВВ.
  // Полностью покрытые кладовкой (0 пачек) стоимость и так не меняют — не дыра.
  const excludedCount = lines.filter((l) => !l.priced && l.packsToBuy > 0).length;
  return { lines, totalCost, partial: excludedCount > 0, excludedCount };
}
