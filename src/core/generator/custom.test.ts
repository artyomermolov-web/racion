import { describe, it, expect } from "vitest";
import { resolvePersonalization, productCandidates } from "./custom";
import type { CustomProduct } from "./custom";
import { generateDay, DEFAULT_DAY_LAYOUT } from "./generate";
import type { GeneratorRecipe, DayTarget, GeneratorConstraints } from "./types";
import type { FoodNutrients } from "@/core/nutrition";

// Тикет 17 — «Своё» и персонализация. Тесты для двух чистых правил пула:
//  1) персонализированный рецепт (baseRecipeId) вытесняет базовый из кандидатов;
//  2) кастом-продукт попадает в кандидаты ТОЛЬКО как recurring — сам генератор
//     его не берёт.

const per = (kcal: number, over: Partial<FoodNutrients> = {}): FoodNutrients => ({
  kcal,
  protein: 0,
  fat: 0,
  carb: 0,
  fiber: 0,
  sodium: 0,
  ...over,
});

/** Базовый рецепт-кандидат под все слоты (минимум для теста пула). */
function baseRecipe(id: string, over: Partial<GeneratorRecipe> = {}): GeneratorRecipe {
  return {
    id,
    slots: ["breakfast", "lunch", "dinner", "snack"],
    timeMin: 10,
    equipment: [],
    allergens: [],
    perServing: per(400),
    ...over,
  };
}

describe("resolvePersonalization — персонализация вытесняет базовый рецепт", () => {
  it("убирает базовый рецепт, у которого есть персональная версия", () => {
    const base = baseRecipe("base-a");
    const mine = baseRecipe("mine-a", { baseRecipeId: "base-a" });
    const other = baseRecipe("base-b");

    const pool = resolvePersonalization([base, mine, other]);
    const ids = pool.map((r) => r.id).sort();

    // base-a вытеснен своей версией; mine-a и base-b остаются.
    expect(ids).toEqual(["base-b", "mine-a"]);
  });

  it("оставляет пул без изменений, если персонализаций нет", () => {
    const pool = [baseRecipe("a"), baseRecipe("b")];
    expect(resolvePersonalization(pool)).toEqual(pool);
  });

  it("не трогает обычные кастом-рецепты (без baseRecipeId)", () => {
    const base = baseRecipe("base-a");
    const custom = baseRecipe("custom-x"); // своё блюдо, не персонализация
    const ids = resolvePersonalization([base, custom]).map((r) => r.id).sort();
    expect(ids).toEqual(["base-a", "custom-x"]);
  });

  it("оставляет персональную версию, даже если базового нет в пуле", () => {
    // Базовый мог быть отсеян раньше (блок/фильтр) — своя версия всё равно живёт.
    const mine = baseRecipe("mine-a", { baseRecipeId: "base-a" });
    expect(resolvePersonalization([mine]).map((r) => r.id)).toEqual(["mine-a"]);
  });

  it("персонализированный рецепт вытесняет базовый ПРИ ГЕНЕРАЦИИ", () => {
    // Ключевой тест тикета 17: базовый рецепт — единственный кандидат на завтрак,
    // но у него есть персональная версия. После resolvePersonalization на завтрак
    // остаётся только своя версия, поэтому в собранном дне стоит именно она, а
    // базового id нет. filler закрывает прочие слоты, чтобы день собрался.
    const base = baseRecipe("base-a", { slots: ["breakfast"], perServing: per(500) });
    const mine = baseRecipe("mine-a", {
      slots: ["breakfast"],
      baseRecipeId: "base-a",
      perServing: per(500),
    });
    const filler = baseRecipe("filler", {
      slots: ["lunch", "dinner", "snack"],
      perServing: per(500),
    });

    const target: DayTarget = { kcal: 2000, protein: 100, fat: 60, carb: 200, fiber: 25 };
    const constraints: GeneratorConstraints = { excludedAllergens: [] };

    const day = generateDay({
      recipes: resolvePersonalization([base, mine, filler]),
      slots: DEFAULT_DAY_LAYOUT,
      target,
      constraints,
      seed: 7,
    });

    const usedIds = day.items.map((it) => it.recipeId);
    // Базовый вытеснен, а его персональная версия реально поставлена на завтрак.
    expect(usedIds).not.toContain("base-a");
    expect(usedIds).toContain("mine-a");
    expect(day.items.find((it) => it.slot === "breakfast")?.recipeId).toBe("mine-a");
  });
});

describe("productCandidates — кастом-продукт только как recurring", () => {
  const product: CustomProduct = {
    id: "prod-1",
    perServing: per(250, { protein: 20 }),
    allergens: ["milk"],
    keywords: ["коктейль"],
  };

  it("не включает продукт, если он не отмечен recurring (генератор сам его не берёт)", () => {
    expect(productCandidates([product], [])).toEqual([]);
  });

  it("включает продукт как кандидата, если он recurring", () => {
    const out = productCandidates([product], ["prod-1"]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "prod-1",
      perServing: per(250, { protein: 20 }),
      allergens: ["milk"],
      keywords: ["коктейль"],
      timeMin: 0,
      equipment: [],
    });
    // Доступен во всех слотах — конкретный слот выбирает пользователь/recurring.
    expect(out[0].slots).toEqual(["breakfast", "lunch", "dinner", "snack"]);
  });

  it("генерация не берёт кастом-продукт, пока он не recurring", () => {
    const target: DayTarget = { kcal: 2000, protein: 100, fat: 60, carb: 200, fiber: 25 };
    const constraints: GeneratorConstraints = { excludedAllergens: [] };
    const base = baseRecipe("base-a", { perServing: per(500) });

    const day = generateDay({
      recipes: [base, ...productCandidates([product], [])],
      slots: DEFAULT_DAY_LAYOUT,
      target,
      constraints,
      seed: 3,
    });

    expect(day.items.map((it) => it.recipeId)).not.toContain("prod-1");
  });
});
