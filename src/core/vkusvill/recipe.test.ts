import { describe, it, expect } from "vitest";
import { recipeToRecipe, categoryToSlots, deriveSlots } from "./recipe";
import type { CatalogEntry, CatalogIndex, VvRecipe } from "./types";

// Импорт рецептов ВВ (тикет 05, spec.md шов 1, Q6=a + доработка «без пропусков»).
// Проверяем внешнее поведение чистой трансформации: точный мэтч по id, фолбэк по
// названию, импорт без пропусков (несопоставленный ингредиент выпадает из состава),
// перенос шагов/аллергенов, привязка состава к каталогу.

// Каталог по id/xml_id товара ВВ (как строит синк). У молока две записи на один
// ингредиент — синк индексирует по числовому id и строковому xml_id.
const catalog: CatalogIndex = new Map<string, CatalogEntry>([
  ["0040100", { ingredientId: "moloko32", name: "Молоко 3.2%", allergens: ["milk"] }],
  ["40100", { ingredientId: "moloko32", name: "Молоко 3.2%", allergens: ["milk"] }],
  ["0020015", { ingredientId: "grechka", name: "Гречка ядрица", allergens: [] }],
  ["0041220", { ingredientId: "yaico", name: "Яйцо куриное С1", allergens: ["egg"] }],
  ["0051002", { ingredientId: "kurinoe-file", name: "Куриное филе грудки", allergens: ["poultry"] }],
  ["0060310", { ingredientId: "ogurcy", name: "Огурцы", allergens: [] }],
]);

// Полный список каталога для фолбэк-мэтча по названию (не только товары ВВ).
const catalogList: CatalogEntry[] = [
  { ingredientId: "grechka", name: "Гречка ядрица", allergens: [] },
  { ingredientId: "kurinoe-file", name: "Куриное филе грудки", allergens: ["poultry"] },
  { ingredientId: "ogurcy", name: "Огурцы", allergens: [] },
  { ingredientId: "moloko32", name: "Молоко 3.2%", allergens: ["milk"] },
  { ingredientId: "yaico", name: "Яйцо куриное С1", allergens: ["egg"] },
  { ingredientId: "muka", name: "Мука пшеничная в/с", allergens: ["gluten"] },
  { ingredientId: "sahar", name: "Сахар-песок", allergens: [] },
  { ingredientId: "tvorog5", name: "Творог 5%", allergens: ["milk"] },
];

// Рецепт с 5 ингредиентами, все сопоставлены по id (5/5 = 100%).
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

describe("recipeToRecipe — базовый импорт (мэтч по id)", () => {
  it("все ингредиенты сопоставлены → рецепт импортируется, ratio=1", () => {
    const { recipe, matchedRatio } = recipeToRecipe(fullMatch, catalog);
    expect(matchedRatio).toBe(1);
    expect(recipe).not.toBeNull();
    expect(recipe!.name).toBe("Гречка с курицей и овощами");
    expect(recipe!.source).toBe("vkusvill");
    expect(recipe!.vvId).toBe("9001");
    expect(recipe!.items).toHaveLength(5);
  });
});

describe("recipeToRecipe — фолбэк по названию (id вне охвата)", () => {
  it("товара нет в индексе → сопоставляется по имени против каталога", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      id: 9010,
      name: "Сырники",
      ingredients: [
        { id: "0041220", name: "Яйцо", grams: 60 }, // по id
        { id: 70001, name: "Мука пшеничная", grams: 80 }, // id вне охвата → по имени
        { id: 70002, name: "Сахар", grams: 40 }, // id вне охвата → по имени (канон)
        { id: 70003, name: "Творог 5%", grams: 400 }, // id вне охвата → по имени
      ],
    };
    const { recipe, matchedRatio } = recipeToRecipe(vv, catalog, catalogList);
    expect(matchedRatio).toBe(1);
    expect(recipe).not.toBeNull();
    const ids = recipe!.items.map((i) => i.ingredientId).sort();
    expect(ids).toEqual(["muka", "sahar", "tvorog5", "yaico"]);
  });

  it("без переданного каталога фолбэк не работает (только точный id)", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      ingredients: [
        { id: "0020015", name: "Гречка", grams: 200 },
        { id: 70001, name: "Мука пшеничная", grams: 80 }, // нет каталога → не найдётся
      ],
    };
    const { recipe, matchedRatio } = recipeToRecipe(vv, catalog); // без catalogList
    expect(matchedRatio).toBe(0.5);
    expect(recipe!.items).toHaveLength(1);
  });
});

describe("recipeToRecipe — импорт без пропусков", () => {
  it("несопоставленный ингредиент выпадает из состава, рецепт импортируется", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      id: 9020,
      ingredients: [
        { id: "0020015", name: "Гречка", grams: 200 },
        { id: "0051002", name: "Филе куриное", grams: 300 },
        { id: 90001, name: "Паста мисо", grams: 20 }, // экзотика — нет в каталоге
      ],
    };
    const { recipe, matchedRatio } = recipeToRecipe(vv, catalog, catalogList);
    expect(matchedRatio).toBeCloseTo(2 / 3);
    expect(recipe).not.toBeNull(); // НЕ пропускаем
    expect(recipe!.items).toHaveLength(2);
    expect(recipe!.items.map((i) => i.ingredientId)).not.toContain(undefined);
  });

  it("низкое покрытие (1 из 5) всё равно импортируется", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      id: 9021,
      ingredients: [
        { id: "0020015", name: "Гречка", grams: 100 },
        { id: 90001, name: "Мисо", grams: 10 },
        { id: 90002, name: "Нори", grams: 5 },
        { id: 90003, name: "Дайкон", grams: 30 },
        { id: 90004, name: "Комбу", grams: 5 },
      ],
    };
    const { recipe, matchedRatio } = recipeToRecipe(vv, catalog, catalogList);
    expect(matchedRatio).toBeCloseTo(0.2);
    expect(recipe).not.toBeNull();
    expect(recipe!.items).toHaveLength(1);
  });

  it("ни один ингредиент не сопоставлен → пропуск (состава нет)", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      ingredients: [
        { id: 90001, name: "Мисо", grams: 10 },
        { id: 90002, name: "Нори", grams: 5 },
      ],
    };
    const { recipe, matchedRatio } = recipeToRecipe(vv, catalog, catalogList);
    expect(matchedRatio).toBe(0);
    expect(recipe).toBeNull();
  });

  it("ингредиент с нулевой/невалидной массой выпадает из состава", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      id: 9030,
      ingredients: [
        { id: "0020015", name: "Гречка", grams: 200 },
        { id: "0051002", name: "Филе", grams: 0 }, // нулевая масса — не берём
        { id: "0060310", name: "Огурцы", grams: NaN as unknown as number }, // мусор
      ],
    };
    const { recipe } = recipeToRecipe(vv, catalog);
    expect(recipe!.items).toHaveLength(1);
    expect(recipe!.items[0]).toEqual({ ingredientId: "grechka", grams: 200 });
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
    expect(recipe!.steps).toEqual(["Отварить гречку.", "Обжарить филе.", "Добавить овощи."]);
  });

  it("строка шагов с <br>/переносами и HTML-мусором → массив чистых строк", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      steps: "Отварить гречку.<br>Обжарить филе.&nbsp;<br> Добавить овощи. ",
    };
    const { recipe } = recipeToRecipe(vv, catalog);
    expect(recipe!.steps).toEqual(["Отварить гречку.", "Обжарить филе.", "Добавить овощи."]);
  });

  it("отсутствующие шаги (неполный ответ ВВ) → пустой массив, не падение", () => {
    const vv = { ...fullMatch, steps: undefined } as unknown as VvRecipe;
    const { recipe } = recipeToRecipe(vv, catalog);
    expect(recipe).not.toBeNull();
    expect(recipe!.steps).toEqual([]);
  });
});

describe("recipeToRecipe — перенос аллергенов (union по сопоставленным)", () => {
  it("аллергены собираются из каталожных ингредиентов, без повторов", () => {
    const { recipe } = recipeToRecipe(fullMatch, catalog);
    expect([...recipe!.allergens].sort()).toEqual(["egg", "milk", "poultry"]);
  });

  it("аллерген несопоставленного ингредиента не переносится", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      ingredients: [
        { id: "0020015", name: "Гречка", grams: 200 },
        { id: "0051002", name: "Филе куриное", grams: 300 },
        { id: "0040100", name: "Молоко", grams: 50 },
        { id: 90001, name: "Арахис жареный", grams: 20 }, // нет в каталоге → nuts не переносится
      ],
    };
    const { recipe } = recipeToRecipe(vv, catalog, catalogList);
    expect([...recipe!.allergens].sort()).toEqual(["milk", "poultry"]);
  });
});

describe("recipeToRecipe — состав, порции, слоты, КБЖУ", () => {
  it("состав ссылается на каталог Racion с массами блюда", () => {
    const { recipe } = recipeToRecipe(fullMatch, catalog);
    expect(recipe!.items).toContainEqual({ ingredientId: "grechka", grams: 200 });
    expect(recipe!.items).toContainEqual({ ingredientId: "kurinoe-file", grams: 300 });
  });

  it("повторный товар в рецепте суммирует граммы (одна строка состава)", () => {
    const vv: VvRecipe = {
      ...fullMatch,
      ingredients: [
        { id: "0020015", name: "Гречка", grams: 150 },
        { id: "0020015", name: "Гречка", grams: 50 }, // тот же товар — суммируется
        { id: "0051002", name: "Филе", grams: 300 },
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
    const { recipe } = recipeToRecipe({ ...fullMatch, nutritional: null }, catalog);
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

  it("неизвестная/пустая категория → обед и ужин (фолбэк)", () => {
    expect(categoryToSlots("Основные блюда")).toEqual(["lunch", "dinner"]);
    expect(categoryToSlots(null)).toEqual(["lunch", "dinner"]);
    expect(categoryToSlots(undefined)).toEqual(["lunch", "dinner"]);
  });
});

describe("deriveSlots — слоты из категории И названия", () => {
  it("название дополняет слоты категории (запеканка-десерт → snack + breakfast)", () => {
    expect(deriveSlots("Десерты", "Творожная запеканка").sort()).toEqual(["breakfast", "snack"]);
  });

  it("сигнал только в названии, категория неизвестна", () => {
    expect(deriveSlots("Разное", "Овсяная каша")).toEqual(["breakfast"]);
  });

  it("ничего не распознано → обед и ужин", () => {
    expect(deriveSlots(null, "Блюдо дня")).toEqual(["lunch", "dinner"]);
  });
});
