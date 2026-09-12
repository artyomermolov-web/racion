import { describe, it, expect } from "vitest";
import { recipeToRecipe, categoryToSlots, RECIPE_MATCH_THRESHOLD } from "./recipe";
import type { CatalogIndex, VvRecipe } from "./types";

// Импорт рецептов ВВ (тикет 05, spec.md шов 1, Q6=a). Проверяем внешнее поведение
// чистой трансформации: импорт при сопоставлении ≥80% ингредиентов, пропуск при
// <80%, перенос шагов/аллергенов, привязка состава к каталогу по id товара ВВ.

// Каталог Racion для мэтча ингредиентов рецепта. Синк индексирует строку каталога
// по ОБОИМ ключам товара ВВ (числовой id и строковый xml_id), т.к. рецепт может
// ссылаться на любой из них; поэтому у молока здесь две записи на один ингредиент.
const catalog: CatalogIndex = new Map([
  ["0040100", { ingredientId: "moloko32", allergens: ["milk"] }],
  ["40100", { ingredientId: "moloko32", allergens: ["milk"] }],
  ["0020015", { ingredientId: "grechka", allergens: [] }],
  ["0041220", { ingredientId: "yaico", allergens: ["egg"] }],
  ["0051002", { ingredientId: "kurinoe-file", allergens: ["poultry"] }],
  ["0060310", { ingredientId: "ogurcy", allergens: [] }],
]);

// Рецепт с 5 ингредиентами, все сопоставлены (5/5 = 100%).
const fullMatch: VvRecipe = {
  id: 9001,
  name: "Гречка с курицей и овощами",
  category: "Основные блюда",
  servings: 2,
  timeMin: 35,
  steps: ["Отварить гречку.", "Обжарить филе.", "Добавить овощи."],
  nutritional: { kcal: 210, protein: 18, fat: 6, carb: 22 },
  ingredients: [
    { id: "0020015", name: "Гречка", grams: 200 },
    { id: "0051002", name: "Филе куриное", grams: 300 },
    { id: "0060310", name: "Огурцы", grams: 100 },
    { id: 40100, name: "Молоко", grams: 50 }, // id числом — приводится к строке
    { id: "0041220", name: "Яйцо", grams: 60 },
  ],
};

describe("recipeToRecipe — импорт при сопоставлении ≥80%", () => {
  it("все ингредиенты сопоставлены → рецепт импортируется, ratio=1", () => {
    const { recipe, matchedRatio } = recipeToRecipe(fullMatch, catalog);
    expect(matchedRatio).toBe(1);
    expect(recipe).not.toBeNull();
    expect(recipe!.name).toBe("Гречка с курицей и овощами");
    expect(recipe!.source).toBe("vkusvill");
    expect(recipe!.vvId).toBe("9001");
  });

  it("ровно 80% (4 из 5) → импортируется (порог включительно)", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      ingredients: [
        { id: "0020015", grams: 200 },
        { id: "0051002", grams: 300 },
        { id: "0060310", grams: 100 },
        { id: "0041220", grams: 60 },
        { id: "9999999", grams: 30 }, // нет в каталоге
      ],
    };
    const { recipe, matchedRatio } = recipeToRecipe(vv, catalog);
    expect(matchedRatio).toBeCloseTo(0.8);
    expect(matchedRatio).toBeGreaterThanOrEqual(RECIPE_MATCH_THRESHOLD);
    expect(recipe).not.toBeNull();
    // Несопоставленный ингредиент в состав не попадает.
    expect(recipe!.items).toHaveLength(4);
    expect(recipe!.items.map((i) => i.ingredientId)).not.toContain("9999999");
  });
});

describe("recipeToRecipe — пропуск при <80%", () => {
  it("3 из 5 (60%) → пропуск (recipe=null), ratio отдаётся честно", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      ingredients: [
        { id: "0020015", grams: 200 },
        { id: "0051002", grams: 300 },
        { id: "0060310", grams: 100 },
        { id: "8888888", grams: 40 },
        { id: "7777777", grams: 40 },
      ],
    };
    const { recipe, matchedRatio } = recipeToRecipe(vv, catalog);
    expect(matchedRatio).toBeCloseTo(0.6);
    expect(recipe).toBeNull();
  });

  it("пустой список ингредиентов → пропуск (ratio 0)", () => {
    const { recipe, matchedRatio } = recipeToRecipe({ ...fullMatch, ingredients: [] }, catalog);
    expect(matchedRatio).toBe(0);
    expect(recipe).toBeNull();
  });
});

describe("recipeToRecipe — перенос шагов", () => {
  it("массив шагов переносится как есть", () => {
    const { recipe } = recipeToRecipe(fullMatch, catalog);
    expect(recipe!.steps).toEqual([
      "Отварить гречку.",
      "Обжарить филе.",
      "Добавить овощи.",
    ]);
  });

  it("строка шагов с <br>/переносами и HTML-мусором → массив чистых строк", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      steps: "Отварить гречку.<br>Обжарить филе.&nbsp;<br> Добавить овощи. ",
    };
    const { recipe } = recipeToRecipe(vv, catalog);
    expect(recipe!.steps).toEqual([
      "Отварить гречку.",
      "Обжарить филе.",
      "Добавить овощи.",
    ]);
  });

  it("отсутствующие шаги (неполный ответ ВВ) → пустой массив, не падение", () => {
    // Живой ответ может не отдать steps; isRecipe их не проверяет — не должно падать.
    const vv = { ...fullMatch, steps: undefined } as unknown as VvRecipe;
    const { recipe } = recipeToRecipe(vv, catalog);
    expect(recipe).not.toBeNull();
    expect(recipe!.steps).toEqual([]);
  });
});

describe("recipeToRecipe — перенос аллергенов (union по сопоставленным)", () => {
  it("аллергены собираются из каталожных ингредиентов, без повторов", () => {
    const { recipe } = recipeToRecipe(fullMatch, catalog);
    // moloko→milk, yaico→egg, kurinoe-file→poultry; гречка/огурцы — пусто.
    expect([...recipe!.allergens].sort()).toEqual(["egg", "milk", "poultry"]);
  });

  it("аллерген несопоставленного ингредиента не переносится (его нет в составе)", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      ingredients: [
        { id: "0020015", grams: 200 }, // гречка, нет аллергенов
        { id: "0051002", grams: 300 }, // курица → poultry
        { id: "0060310", grams: 100 }, // огурцы
        { id: "0040100", grams: 50 }, // молоко → milk
        { id: "5550000", grams: 20 }, // нет в каталоге (был бы, скажем, орех)
      ],
    };
    const { recipe } = recipeToRecipe(vv, catalog);
    expect([...recipe!.allergens].sort()).toEqual(["milk", "poultry"]);
  });
});

describe("recipeToRecipe — состав, порции, слоты, КБЖУ", () => {
  it("состав ссылается на каталог Racion с массами блюда", () => {
    const { recipe } = recipeToRecipe(fullMatch, catalog);
    expect(recipe!.items).toContainEqual({ ingredientId: "grechka", grams: 200 });
    expect(recipe!.items).toContainEqual({ ingredientId: "kurinoe-file", grams: 300 });
  });

  it("повторный товар ВВ в рецепте суммирует граммы (одна строка состава)", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      ingredients: [
        { id: "0020015", grams: 150 },
        { id: "0020015", grams: 50 }, // тот же товар — суммируется
        { id: "0051002", grams: 300 },
        { id: "0060310", grams: 100 },
        { id: "0041220", grams: 60 },
      ],
    };
    const { recipe } = recipeToRecipe(vv, catalog);
    const grechka = recipe!.items.filter((i) => i.ingredientId === "grechka");
    expect(grechka).toHaveLength(1);
    expect(grechka[0].grams).toBe(200);
  });

  it("порции/время/сложность переносятся; сложность вне 1–3 зажимается", () => {
    const { recipe } = recipeToRecipe({ ...fullMatch, difficulty: 5 }, catalog);
    expect(recipe!.servings).toBe(2);
    expect(recipe!.timeMin).toBe(35);
    expect(recipe!.difficulty).toBe(3);
  });

  it("отсутствующие порции → 1; структурные КБЖУ ВВ сохраняются для аудита", () => {
    const { recipe } = recipeToRecipe({ ...fullMatch, servings: null }, catalog);
    expect(recipe!.servings).toBe(1);
    expect(recipe!.nutrition).toEqual({ kcal: 210, protein: 18, fat: 6, carb: 22, fiber: 0, sodium: 0 });
  });

  it("без структурных КБЖУ → nutrition=null (меню посчитает из состава)", () => {
    const vv: VvRecipe = { ...fullMatch, nutritional: null };
    const { recipe } = recipeToRecipe(vv, catalog);
    expect(recipe!.nutrition).toBeNull();
  });
});

describe("categoryToSlots — категория рецепта ВВ → слоты меню", () => {
  it("завтрак/каша → breakfast", () => {
    expect(categoryToSlots("Завтраки")).toEqual(["breakfast"]);
    expect(categoryToSlots("Каши")).toEqual(["breakfast"]);
  });

  it("суп → lunch; салат → обед/ужин; десерт → snack", () => {
    expect(categoryToSlots("Супы")).toEqual(["lunch"]);
    expect(categoryToSlots("Салаты и закуски")).toEqual(["lunch", "dinner"]);
    expect(categoryToSlots("Десерты")).toEqual(["snack"]);
  });

  it("неизвестная/пустая категория → обед и ужин (фолбэк, рецепт остаётся размещаемым)", () => {
    expect(categoryToSlots("Основные блюда")).toEqual(["lunch", "dinner"]);
    expect(categoryToSlots(null)).toEqual(["lunch", "dinner"]);
    expect(categoryToSlots(undefined)).toEqual(["lunch", "dinner"]);
  });
});
