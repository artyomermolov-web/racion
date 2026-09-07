import { describe, it, expect } from "vitest";
import { buildShoppingList } from "./list";
import type { ShoppingListInput, ShoppingRecipe, ShoppingIngredient } from "./types";

// Список покупок (тикет 18, решения тикета 07): агрегация потребности по
// диапазону плана × порции × едоки → вычет запаса (кладовка — тикет 19, здесь
// пусто) → округление до целых пачек → остаток по позиции и сумма ₽.
//
// Ядро — чистый модуль без Prisma/Next (основной шов тестирования). Количества
// ингредиента приходят уже в единице ПРОДАЖИ (г/мл/шт): перевод «граммовый
// эквивалент → штуки» для штучных делает слой данных.

/** Ингредиент-пачка для тестов (packSize/цена — что проверяем при округлении). */
const ing = (
  id: string,
  packSize: number,
  pricePerPack: number,
  extra: Partial<ShoppingIngredient> = {},
): ShoppingIngredient => ({
  id,
  name: id,
  group: "Тест",
  unit: "g",
  packSize,
  pricePerPack,
  ...extra,
});

/** Рецепт из одного ингредиента с заданным количеством на всё блюдо. */
const oneIngredientRecipe = (
  id: string,
  ingredientId: string,
  quantity: number,
  servings = 1,
): ShoppingRecipe => ({
  id,
  servings,
  ingredients: [{ ingredientId, quantity }],
});

const lineFor = (input: ShoppingListInput, ingredientId: string) => {
  const list = buildShoppingList(input);
  const line = list.lines.find((l) => l.ingredientId === ingredientId);
  if (!line) throw new Error(`нет строки для ${ingredientId}`);
  return line;
};

describe("buildShoppingList — агрегация × порции × едоки", () => {
  it("делит количество рецепта на порции и множит на порцию плана", () => {
    // Рецепт на 2 порции, 200 г продукта → 100 г на порцию.
    const recipes = [oneIngredientRecipe("r1", "prod", 200, 2)];
    const line = lineFor(
      {
        plan: [{ recipeId: "r1", portion: 1 }],
        recipes,
        ingredients: [ing("prod", 900, 90)],
      },
      "prod",
    );
    expect(line.need).toBe(100);
  });

  it("порция 0.5 берёт половину, порция 2 — вдвое", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 100, 1)];
    const half = lineFor(
      { plan: [{ recipeId: "r1", portion: 0.5 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    const dbl = lineFor(
      { plan: [{ recipeId: "r1", portion: 2 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    expect(half.need).toBe(50);
    expect(dbl.need).toBe(200);
  });

  it("умножает потребность на число едоков (people)", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 100, 1)];
    const line = lineFor(
      {
        plan: [{ recipeId: "r1", portion: 1, people: 3 }],
        recipes,
        ingredients: [ing("prod", 900, 90)],
      },
      "prod",
    );
    expect(line.need).toBe(300);
  });

  it("people по умолчанию = 1, некорректное (<1) → 1", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 100, 1)];
    const def = lineFor(
      { plan: [{ recipeId: "r1", portion: 1 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    const bad = lineFor(
      { plan: [{ recipeId: "r1", portion: 1, people: 0 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    expect(def.need).toBe(100);
    expect(bad.need).toBe(100);
  });

  it("суммирует один ингредиент из разных приёмов и рецептов", () => {
    const recipes = [
      oneIngredientRecipe("r1", "prod", 100, 1),
      oneIngredientRecipe("r2", "prod", 40, 1),
    ];
    const line = lineFor(
      {
        plan: [
          { recipeId: "r1", portion: 1 },
          { recipeId: "r1", portion: 0.5 },
          { recipeId: "r2", portion: 1 },
        ],
        recipes,
        ingredients: [ing("prod", 900, 90)],
      },
      "prod",
    );
    // 100 + 50 + 40 = 190
    expect(line.need).toBe(190);
  });

  it("рецепт с servings < 1 трактуется как 1 (защита от деления на 0)", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 100, 0)];
    const line = lineFor(
      { plan: [{ recipeId: "r1", portion: 1 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    expect(line.need).toBe(100);
  });
});

describe("buildShoppingList — округление до пачек и остаток (граничные)", () => {
  it("ровно одна пачка → 1 пачка, остаток 0", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 900, 1)];
    const line = lineFor(
      { plan: [{ recipeId: "r1", portion: 1 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    expect(line.packsToBuy).toBe(1);
    expect(line.leftover).toBe(0);
    expect(line.lineCost).toBe(90);
  });

  it("чуть больше пачки → округляет вверх, остаток = пачки·размер − потребность", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 901, 1)];
    const line = lineFor(
      { plan: [{ recipeId: "r1", portion: 1 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    expect(line.packsToBuy).toBe(2);
    expect(line.leftover).toBe(899); // 2·900 − 901
    expect(line.lineCost).toBe(180);
  });

  it("потребность меньше пачки → 1 пачка, остаток = размер − потребность", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 225, 1)];
    const line = lineFor(
      { plan: [{ recipeId: "r1", portion: 1 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    expect(line.packsToBuy).toBe(1);
    expect(line.leftover).toBe(675);
  });

  it("нулевая потребность (нет плана) не создаёт строку", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 100, 1)];
    const list = buildShoppingList({ plan: [], recipes, ingredients: [ing("prod", 900, 90)] });
    expect(list.lines).toHaveLength(0);
    expect(list.totalCost).toBe(0);
  });

  it("дробная потребность от порций не «плывёт» на границе пачки", () => {
    // Рецепт на 2 порции, 3600 г → 1800 г/порция; порция 1 → ровно 2 пачки по 900.
    const recipes = [oneIngredientRecipe("r1", "prod", 3600, 2)];
    const line = lineFor(
      { plan: [{ recipeId: "r1", portion: 1 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    expect(line.need).toBe(1800);
    expect(line.packsToBuy).toBe(2);
    expect(line.leftover).toBe(0);
  });
});

describe("buildShoppingList — вычет запаса (шов кладовки, тикет 19)", () => {
  it("по умолчанию запас пуст: чистая потребность = потребности", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 500, 1)];
    const line = lineFor(
      { plan: [{ recipeId: "r1", portion: 1 }], recipes, ingredients: [ing("prod", 900, 90)] },
      "prod",
    );
    expect(line.onHand).toBe(0);
    expect(line.netNeed).toBe(500);
    expect(line.packsToBuy).toBe(1);
  });

  it("запас больше потребности → 0 пачек, 0 ₽", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 500, 1)];
    const line = lineFor(
      {
        plan: [{ recipeId: "r1", portion: 1 }],
        recipes,
        ingredients: [ing("prod", 900, 90)],
        onHand: { prod: 900 },
      },
      "prod",
    );
    expect(line.netNeed).toBe(0);
    expect(line.packsToBuy).toBe(0);
    expect(line.leftover).toBe(0);
    expect(line.lineCost).toBe(0);
  });

  it("запас частично покрывает: пачки считаются от остатка потребности", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 1000, 1)];
    const line = lineFor(
      {
        plan: [{ recipeId: "r1", portion: 1 }],
        recipes,
        ingredients: [ing("prod", 900, 90)],
        onHand: { prod: 200 },
      },
      "prod",
    );
    // netNeed = 800 → 1 пачка, остаток 100
    expect(line.netNeed).toBe(800);
    expect(line.packsToBuy).toBe(1);
    expect(line.leftover).toBe(100);
  });
});

describe("buildShoppingList — сумма ₽, порядок и устойчивость", () => {
  it("итог = сумма стоимостей строк", () => {
    const recipes = [
      oneIngredientRecipe("r1", "a", 900, 1),
      oneIngredientRecipe("r2", "b", 300, 1),
    ];
    const list = buildShoppingList({
      plan: [
        { recipeId: "r1", portion: 1 },
        { recipeId: "r2", portion: 1 },
      ],
      recipes,
      ingredients: [ing("a", 900, 90), ing("b", 400, 60)],
    });
    // a: 1 пачка·90 = 90 ; b: ceil(300/400)=1 пачка·60 = 60
    expect(list.totalCost).toBe(150);
  });

  it("сортирует строки по группе, затем по имени (стабильный вывод)", () => {
    const recipes = [
      oneIngredientRecipe("r1", "z", 100, 1),
      oneIngredientRecipe("r2", "a", 100, 1),
    ];
    const list = buildShoppingList({
      plan: [
        { recipeId: "r1", portion: 1 },
        { recipeId: "r2", portion: 1 },
      ],
      recipes,
      ingredients: [
        ing("z", 900, 90, { name: "Яблоки", group: "Фрукты" }),
        ing("a", 900, 90, { name: "Гречка", group: "Крупы" }),
      ],
    });
    expect(list.lines.map((l) => l.name)).toEqual(["Гречка", "Яблоки"]);
  });

  it("неизвестный рецепт в плане пропускается", () => {
    const recipes = [oneIngredientRecipe("r1", "prod", 100, 1)];
    const list = buildShoppingList({
      plan: [
        { recipeId: "r1", portion: 1 },
        { recipeId: "missing", portion: 1 },
      ],
      recipes,
      ingredients: [ing("prod", 900, 90)],
    });
    expect(list.lines).toHaveLength(1);
    expect(list.lines[0].need).toBe(100);
  });

  it("ингредиент без карточки-пачки не создаёт строку (нечем считать цену)", () => {
    const recipes = [
      {
        id: "r1",
        servings: 1,
        ingredients: [
          { ingredientId: "prod", quantity: 100 },
          { ingredientId: "ghost", quantity: 50 },
        ],
      },
    ];
    const list = buildShoppingList({
      plan: [{ recipeId: "r1", portion: 1 }],
      recipes,
      ingredients: [ing("prod", 900, 90)],
    });
    expect(list.lines).toHaveLength(1);
    expect(list.lines[0].ingredientId).toBe("prod");
  });

  it("штучный продукт: единица «шт» переносится в строку", () => {
    // Яйца: 6 шт нужно, пачка 10 → 1 пачка, остаток 4.
    const recipes = [oneIngredientRecipe("r1", "egg", 6, 1)];
    const line = lineFor(
      {
        plan: [{ recipeId: "r1", portion: 1 }],
        recipes,
        ingredients: [ing("egg", 10, 110, { unit: "pcs", name: "Яйцо" })],
      },
      "egg",
    );
    expect(line.unit).toBe("pcs");
    expect(line.packsToBuy).toBe(1);
    expect(line.leftover).toBe(4);
  });
});
