import { describe, it, expect } from "vitest";
import { validateCustomProduct, validateCustomRecipe } from "./custom-input";

// Тикет 17 — валидация ввода «своего». Проверяем внешнее поведение: что
// принимается, что отклоняется и как парсится (запятая-разделитель, дефолты,
// отсев пустых строк состава).

describe("validateCustomProduct", () => {
  it("принимает корректный продукт и парсит КБЖУ (запятая как разделитель)", () => {
    const { errors, value } = validateCustomProduct({
      name: "  Протеиновый батончик  ",
      unit: "pcs",
      kcal: "350",
      protein: "20",
      fat: "12,5",
      carb: "30",
      allergens: ["milk", "soy", "нет-такого"],
    });
    expect(errors).toEqual({});
    expect(value).toEqual({
      name: "Протеиновый батончик",
      unit: "pcs",
      per100: { kcal: 350, protein: 20, fat: 12.5, carb: 30, fiber: 0, sodium: 0 },
      allergens: ["milk", "soy"], // невалидный аллерген отсеян
    });
  });

  it("требует название, единицу и КБЖУ", () => {
    const { errors, value } = validateCustomProduct({ name: "", unit: "" });
    expect(value).toBeUndefined();
    expect(errors.name).toBeTruthy();
    expect(errors.unit).toBeTruthy();
    expect(errors.kcal).toBeTruthy();
  });

  it("отклоняет отрицательные и абсурдные значения", () => {
    const { errors } = validateCustomProduct({
      name: "X",
      unit: "g",
      kcal: "-5",
      protein: "0",
      fat: "0",
      carb: "0",
    });
    expect(errors.kcal).toBeTruthy();
  });
});

describe("validateCustomRecipe", () => {
  const base = {
    name: "Мой обед",
    timeMin: "20",
    servings: "2",
    difficulty: "2",
    slots: ["lunch", "dinner"],
    equipment: ["stove"],
    diet: ["vegetarian"],
    steps: "Порезать\nСварить\n\n",
    ingredients: [
      { ingredientId: "ing-a", grams: "150" },
      { ingredientId: "", grams: "" }, // пустая строка формы — игнор
      { ingredientId: "ing-b", grams: 80 },
    ],
  };

  it("принимает корректный рецепт, чистит шаги и состав", () => {
    const { errors, value } = validateCustomRecipe(base);
    expect(errors).toEqual({});
    expect(value?.steps).toEqual(["Порезать", "Сварить"]);
    expect(value?.ingredients).toEqual([
      { ingredientId: "ing-a", grams: 150 },
      { ingredientId: "ing-b", grams: 80 },
    ]);
    expect(value?.slots).toEqual(["lunch", "dinner"]);
  });

  it("требует хотя бы один слот и один ингредиент", () => {
    const { errors, value } = validateCustomRecipe({
      name: "Пусто",
      timeMin: "10",
      servings: "1",
      slots: [],
      ingredients: [],
    });
    expect(value).toBeUndefined();
    expect(errors.slots).toBeTruthy();
    expect(errors.ingredients).toBeTruthy();
  });

  it("ловит некорректную массу ингредиента", () => {
    const { errors } = validateCustomRecipe({
      ...base,
      ingredients: [{ ingredientId: "ing-a", grams: "0" }],
    });
    expect(errors.ingredients).toBeTruthy();
  });
});
