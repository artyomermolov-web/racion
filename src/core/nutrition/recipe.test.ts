import { describe, it, expect } from "vitest";
import { computeRecipeNutrition } from "./recipe";
import type { RecipeComponent } from "./recipe";
import { INGREDIENTS, RECIPES } from "../../../prisma/seed-data";

// КБЖУ рецепта = линейная свёртка нутриентов ингредиентов по граммам
// (тикет 13: «КБЖУ рецепта вычисляется из состава, не хранится вручную»).
// Значения на 100 г — из research/products-ru.md; итоги посчитаны вручную
// как независимый эталон. Округление — по kbju-master.md A1 (ккал и граммы
// макросов до целого, в самом конце).

describe("computeRecipeNutrition — свёртка по граммам", () => {
  it("масштабирует нутриенты по массе и суммирует", () => {
    const components: RecipeComponent[] = [
      // 200 г продукта: вклад ×2
      {
        grams: 200,
        per100: { kcal: 100, protein: 10, fat: 5, carb: 20, fiber: 3, sodium: 40 },
      },
      // 50 г продукта: вклад ×0.5
      {
        grams: 50,
        per100: { kcal: 400, protein: 0, fat: 40, carb: 0, fiber: 0, sodium: 0 },
      },
    ];
    // Итог: ккал 200+200=400, белок 20, жир 10+20=30, угл 40, клетч 6, натрий 80
    const { total } = computeRecipeNutrition(components, 1);
    expect(total).toEqual({
      kcal: 400,
      protein: 20,
      fat: 30,
      carb: 40,
      fiber: 6,
      sodium: 80,
    });
  });

  it("делит итог на число порций (перед округлением)", () => {
    const components: RecipeComponent[] = [
      {
        grams: 200,
        per100: { kcal: 100, protein: 10, fat: 5, carb: 20, fiber: 3, sodium: 40 },
      },
      {
        grams: 50,
        per100: { kcal: 400, protein: 0, fat: 40, carb: 0, fiber: 0, sodium: 0 },
      },
    ];
    // total /2 → ккал 200, белок 10, жир 15, угл 20, клетч 3, натрий 40
    const { perServing } = computeRecipeNutrition(components, 2);
    expect(perServing).toEqual({
      kcal: 200,
      protein: 10,
      fat: 15,
      carb: 20,
      fiber: 3,
      sodium: 40,
    });
  });

  it("округляет ккал и граммы макросов до целого в конце", () => {
    // Гречка ядрица (products-ru.md), 75 г → ×0.75:
    // ккал 343·0.75=257.25→257 ; белок 12.6·0.75=9.45→9 ; жир 3.3·0.75=2.475→2
    // угл 62·0.75=46.5→47 ; клетч 11·0.75=8.25→8 ; натрий 3·0.75=2.25→2
    const { total } = computeRecipeNutrition(
      [
        {
          grams: 75,
          per100: {
            kcal: 343,
            protein: 12.6,
            fat: 3.3,
            carb: 62,
            fiber: 11,
            sodium: 3,
          },
        },
      ],
      1,
    );
    expect(total).toEqual({
      kcal: 257,
      protein: 9,
      fat: 2,
      carb: 47,
      fiber: 8,
      sodium: 2,
    });
  });

  it("пустой состав даёт нули", () => {
    const { total, perServing } = computeRecipeNutrition([], 1);
    const zero = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, sodium: 0 };
    expect(total).toEqual(zero);
    expect(perServing).toEqual(zero);
  });

  it("число порций меньше 1 трактуется как 1 (защита от деления на 0)", () => {
    const c: RecipeComponent[] = [
      {
        grams: 100,
        per100: { kcal: 200, protein: 10, fat: 5, carb: 30, fiber: 2, sodium: 10 },
      },
    ];
    const { total, perServing } = computeRecipeNutrition(c, 0);
    expect(perServing).toEqual(total);
  });
});

// Правдоподобность сид-набора (тикет 13, checkbox: «суп ~300–500 ккал»).
// КБЖУ каждого рецепта считается из состава тем же ядром, что и в приложении —
// тест ловит опечатки в граммовках/данных, дающие неправдоподобные блюда.
describe("правдоподобность КБЖУ сид-рецептов", () => {
  const bySlug = new Map(INGREDIENTS.map((i) => [i.slug, i]));

  const componentsOf = (slug: string): RecipeComponent[] => {
    const recipe = RECIPES.find((r) => r.slug === slug);
    if (!recipe) throw new Error(`нет рецепта ${slug}`);
    return recipe.items.map((it) => {
      const ing = bySlug.get(it.ingredient);
      if (!ing) throw new Error(`рецепт ${slug}: нет ингредиента ${it.ingredient}`);
      return {
        grams: it.grams,
        per100: {
          kcal: ing.kcal,
          protein: ing.protein,
          fat: ing.fat,
          carb: ing.carb,
          fiber: ing.fiber,
          sodium: ing.sodium,
        },
      };
    });
  };

  it("все ингредиенты рецептов есть в каталоге", () => {
    for (const r of RECIPES) {
      for (const it of r.items) {
        expect(bySlug.has(it.ingredient), `${r.slug} → ${it.ingredient}`).toBe(true);
      }
    }
  });

  it.each(RECIPES.map((r) => [r.slug, r.name, r.servings] as const))(
    "«%s» (%s): порция в разумных пределах и с белком",
    (slug, _name, servings) => {
      const { perServing } = computeRecipeNutrition(componentsOf(slug), servings);
      // Одна порция реального блюда — не «пустая» и не абсурдно калорийная.
      expect(perServing.kcal).toBeGreaterThanOrEqual(150);
      expect(perServing.kcal).toBeLessThanOrEqual(900);
      expect(perServing.protein).toBeGreaterThan(0);
    },
  );

  it.each(["sup-kurinyy", "shchi-govyadina", "sup-chechevica"])(
    "суп «%s» попадает в 300–500 ккал на порцию",
    (slug) => {
      const recipe = RECIPES.find((r) => r.slug === slug)!;
      const { perServing } = computeRecipeNutrition(
        componentsOf(slug),
        recipe.servings,
      );
      expect(perServing.kcal).toBeGreaterThanOrEqual(300);
      expect(perServing.kcal).toBeLessThanOrEqual(500);
    },
  );

  // Диет-теги должны быть честными: генератор будет фильтровать по ним жёстко
  // (kbju-master.md C), поэтому веган-блюдо не может содержать животных продуктов.
  it("веган-рецепты не содержат животных ингредиентов", () => {
    const ANIMAL_ALLERGENS = new Set(["milk", "egg", "fish", "meat", "poultry"]);
    // Животные продукты без тега аллергена (мёд не аллерген, но не веганский).
    const NON_VEGAN_SLUGS = new Set(["med"]);

    for (const r of RECIPES) {
      if (!r.diet.includes("vegan")) continue;
      for (const it of r.items) {
        const ing = bySlug.get(it.ingredient)!;
        const animalAllergen = ing.allergens.find((a) => ANIMAL_ALLERGENS.has(a));
        expect(
          animalAllergen,
          `${r.slug} помечен vegan, но «${ing.name}» содержит ${animalAllergen}`,
        ).toBeUndefined();
        expect(
          NON_VEGAN_SLUGS.has(ing.slug),
          `${r.slug} помечен vegan, но содержит «${ing.name}»`,
        ).toBe(false);
      }
    }
  });
});
