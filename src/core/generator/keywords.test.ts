import { describe, it, expect } from "vitest";
import { filterCandidates } from "./constraints";
import { expandFilterTerms, recipeKeywords } from "./keywords";
import type { GeneratorRecipe, MealSlot } from "./types";
import type { FoodNutrients } from "@/core/nutrition";

// Keyword-фильтр «не хочу есть» с разворачиванием синонимов (тикет 16, тест «на
// утечки» №3). Пользователь пишет одно слово («курица») — фильтр обязан поймать
// все словоформы и продукты концепта (грудка/бедро/филе/фарш), но не задеть
// посторонние (говядина, рыба). Разворачивание — на слое данных (этот модуль);
// само совпадение по подстроке — в constraints.ts.

const N: FoodNutrients = { kcal: 400, protein: 20, fat: 10, carb: 50, fiber: 5, sodium: 100 };

function slot(over: Partial<MealSlot> = {}): MealSlot {
  return {
    slot: "lunch",
    kcalShare: 0.35,
    cookTimeMin: 90,
    canCook: true,
    availableEquipment: ["stove", "oven", "blender", "multicooker", "none"],
    ...over,
  };
}

describe("recipeKeywords — токены рецепта для keyword-фильтра", () => {
  it("собирает нижний регистр из названия, ингредиентов и групп", () => {
    const kw = recipeKeywords(
      "Гречка с куриным бедром",
      ["Куриное бедро (мякоть)", "Гречка ядрица"],
      ["Мясо и птица", "Крупы и макароны"],
    );
    expect(kw).toContain("куриным");
    expect(kw).toContain("бедром");
    expect(kw).toContain("бедро"); // из названия ингредиента
    expect(kw).toContain("мясо и птица"); // группа целиком
    // Все токены — нижний регистр.
    expect(kw.every((k) => k === k.toLowerCase())).toBe(true);
  });

  it("не плодит пустые токены и дубликаты", () => {
    const kw = recipeKeywords("Рис  с   рыбой", ["Рис круглозёрный"], ["Крупы и макароны"]);
    expect(kw).not.toContain("");
    expect(new Set(kw).size).toBe(kw.length);
  });
});

describe("expandFilterTerms — разворачивание синонимов", () => {
  it("«курица» разворачивается в словоформы концепта", () => {
    const terms = expandFilterTerms(["курица"]);
    // Должна ловить куриное филе грудки, бедро, фарш.
    expect(terms.some((t) => "куриное филе грудки".includes(t))).toBe(true);
    expect(terms.some((t) => "куриное бедро".includes(t))).toBe(true);
  });

  it("сохраняет исходный термин и приводит к нижнему регистру", () => {
    const terms = expandFilterTerms(["Говядина"]);
    expect(terms).toContain("говядина");
  });

  it("незнакомый термин остаётся собой (без синонимов)", () => {
    const terms = expandFilterTerms(["кабачок"]);
    expect(terms).toContain("кабачок");
  });
});

describe("keyword-фильтр «курица» ловит все куриные формы, не задевая прочее", () => {
  const recipe = (id: string, name: string, ings: string[], groups: string[]): GeneratorRecipe => ({
    id,
    slots: ["lunch"],
    timeMin: 30,
    equipment: ["stove"],
    allergens: [],
    perServing: N,
    keywords: recipeKeywords(name, ings, groups),
  });

  it("отсекает грудку/бедро/суп с курицей, оставляет говядину и рыбу", () => {
    const breast = recipe("breast", "Курица гриль", ["Куриное филе грудки"], ["Мясо и птица"]);
    const thigh = recipe("thigh", "Гречка с куриным бедром", ["Куриное бедро (мякоть)"], ["Мясо и птица"]);
    const soup = recipe("soup", "Куриный суп с лапшой", ["Куриное филе грудки", "Макароны рожки"], ["Мясо и птица"]);
    const beef = recipe("beef", "Щи с говядиной", ["Говядина (лопатка)"], ["Мясо и птица"]);
    const fish = recipe("fish", "Рис с минтаем", ["Минтай (филе)"], ["Рыба и морепродукты"]);

    const filter = expandFilterTerms(["курица"]);
    const out = filterCandidates([breast, thigh, soup, beef, fish], slot(), {
      excludedAllergens: [],
      keywordFilter: filter,
    });
    expect(out.map((r) => r.id).sort()).toEqual(["beef", "fish"]);
  });
});
