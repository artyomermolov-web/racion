import { describe, it, expect } from "vitest";
import { suggestNextMeal, logDecision, type SuggestCandidate } from "./suggest";
import type { DiaryEntry, DiaryNutrients, Macro } from "./types";
import type { FoodNutrients } from "@/core/nutrition";
import type { GeneratorRecipe } from "@/core/generator";

// Главная поверхность тикета 10 (spec.md, Testing Decisions): движок подсказок
// «Что поесть сейчас». Проверяем внешнее поведение чистых функций:
//  • при дефиците белка топ-вариант добирает ИМЕННО белок (не «просто по ккал»);
//  • жёсткие ограничения (аллерген/блок/keyword/слот) и фильтр усилий
//    (время/техника) не пропускают запрещённого кандидата;
//  • детерминизм по одному seed; ≥1 вариант при непустой базе; пусто — только при
//    пустой базе; честная пометка при неидеальном варианте;
//  • logDecision: повтор подсказки не создаёт второй записи, удаление её возвращает.

/** Дневная цель — масштаб нормировки скоринга (сопоставимость нутриентов). */
const SCALE: DiaryNutrients = {
  kcal: 2000,
  protein: 120,
  fat: 70,
  carb: 220,
  fiber: 30,
};

/** КБЖУ порции кандидата (6 полей FoodNutrients; натрий не важен для скоринга). */
function perServing(over: Partial<FoodNutrients>): FoodNutrients {
  return { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, sodium: 0, ...over };
}

/** Кандидат-подсказка: GeneratorRecipe + имя. По умолчанию — обеденное блюдо. */
function cand(
  id: string,
  ns: Partial<FoodNutrients>,
  over: Partial<GeneratorRecipe> = {},
): SuggestCandidate {
  return {
    id,
    name: id,
    slots: ["lunch"],
    timeMin: 20,
    equipment: ["stove"],
    allergens: [],
    perServing: perServing(ns),
    ...over,
  };
}

interface SuggestOver {
  remaining?: Partial<DiaryNutrients>;
  laggingMacro?: Macro | null;
  candidates: SuggestCandidate[];
  filters?: { maxTimeMin?: number; mustNotCook?: boolean };
  excludedAllergens?: GeneratorRecipe["allergens"];
  blockedRecipeIds?: string[];
  keywordFilter?: string[];
  excludeRecipeIds?: string[];
  seed?: number;
  limit?: number;
}

/** Удобный вызов suggestNextMeal с разумными дефолтами. */
function run(over: SuggestOver) {
  return suggestNextMeal({
    remaining: {
      kcal: 700,
      protein: 50,
      fat: 15,
      carb: 40,
      fiber: 8,
      ...over.remaining,
    },
    laggingMacro: over.laggingMacro === undefined ? "protein" : over.laggingMacro,
    slot: "lunch",
    candidates: over.candidates,
    scale: SCALE,
    filters: over.filters,
    constraints: {
      excludedAllergens: over.excludedAllergens ?? [],
      blockedRecipeIds: over.blockedRecipeIds,
      keywordFilter: over.keywordFilter,
    },
    excludeRecipeIds: over.excludeRecipeIds,
    seed: over.seed ?? 1,
    limit: over.limit,
  });
}

describe("suggestNextMeal — закрытие остатка с приоритетом отстающего макроса", () => {
  // Белковое блюдо, углеводное и «пустое» — при дефиците белка победить должно
  // белковое, даже если углеводное ближе по калориям.
  const chicken = cand("chicken", { kcal: 250, protein: 30, fat: 8, carb: 4 });
  const pasta = cand("pasta", { kcal: 350, protein: 9, fat: 6, carb: 65 });
  const salad = cand("salad", { kcal: 120, protein: 3, fat: 7, carb: 10, fiber: 4 });

  it("при дефиците белка топ-вариант добирает именно белок", () => {
    const out = run({
      remaining: { kcal: 700, protein: 50, fat: 15, carb: 40, fiber: 8 },
      laggingMacro: "protein",
      candidates: [pasta, salad, chicken],
    });
    expect(out[0].recipeId).toBe("chicken");
    // Порция подобрана так, чтобы реально добрать белок (ближе к остатку 50 г),
    // а не символические 30 г одной порции.
    expect(out[0].nutrients.protein).toBeGreaterThanOrEqual(45);
  });

  it("без отстающего макроса целится по калориям остатка", () => {
    // Все макросы добраны (lagging=null): берём блюдо, чей вклад ближе к ккал-остатку.
    const near = cand("near", { kcal: 300, protein: 10, fat: 8, carb: 40 });
    const far = cand("far", { kcal: 800, protein: 10, fat: 20, carb: 90 });
    const out = run({
      remaining: { kcal: 300, protein: 0, fat: 0, carb: 0, fiber: 0 },
      laggingMacro: null,
      candidates: [far, near],
    });
    expect(out[0].recipeId).toBe("near");
  });

  it("порция подбирается из сетки PORTION_STEPS (кратна 0.25, в диапазоне)", () => {
    const out = run({ candidates: [chicken, pasta, salad] });
    for (const m of out) {
      expect(m.portion).toBeGreaterThanOrEqual(0.25);
      expect(m.portion).toBeLessThanOrEqual(2);
      expect(Math.round(m.portion * 4) / 4).toBeCloseTo(m.portion, 10);
    }
  });
});

describe("suggestNextMeal — жёсткие ограничения не пропускают запрещённое", () => {
  const clean = cand("clean", { kcal: 250, protein: 25, carb: 10 });

  it("блюдо с исключённым аллергеном не появляется в подсказках", () => {
    const milk = cand("milk", { kcal: 300, protein: 28, carb: 8 }, {
      allergens: ["milk"],
    });
    const out = run({ candidates: [clean, milk], excludedAllergens: ["milk"] });
    expect(out.map((m) => m.recipeId)).not.toContain("milk");
    expect(out.map((m) => m.recipeId)).toContain("clean");
  });

  it("заблокированное блюдо (blockedRecipeIds) не появляется", () => {
    const banned = cand("banned", { kcal: 260, protein: 30, carb: 6 });
    const out = run({ candidates: [clean, banned], blockedRecipeIds: ["banned"] });
    expect(out.map((m) => m.recipeId)).toEqual(["clean"]);
  });

  it("keyword-фильтр отсекает блюдо по ключевому слову", () => {
    const chicken = cand("chicken", { kcal: 260, protein: 30, carb: 6 }, {
      keywords: ["курица", "грудка"],
    });
    const out = run({
      candidates: [clean, chicken],
      keywordFilter: ["курица"],
    });
    expect(out.map((m) => m.recipeId)).toEqual(["clean"]);
  });

  it("несовместимое со слотом блюдо не предлагается", () => {
    const breakfastOnly = cand("oats", { kcal: 280, protein: 26, carb: 30 }, {
      slots: ["breakfast"],
    });
    const out = run({ candidates: [clean, breakfastOnly] });
    expect(out.map((m) => m.recipeId)).toEqual(["clean"]);
  });
});

describe("suggestNextMeal — фильтр усилий (быстро/готовить/не готовить)", () => {
  const quickRaw = cand("quickRaw", { kcal: 200, protein: 25, carb: 8 }, {
    timeMin: 5,
    equipment: ["none"],
  });
  const slowCook = cand("slowCook", { kcal: 260, protein: 28, carb: 10 }, {
    timeMin: 45,
    equipment: ["stove", "oven"],
  });

  it("«не готовить» оставляет только блюда без техники (equipment=none)", () => {
    const out = run({
      candidates: [quickRaw, slowCook],
      filters: { mustNotCook: true },
    });
    expect(out.map((m) => m.recipeId)).toEqual(["quickRaw"]);
  });

  it("«быстро» отсекает блюда дольше порога времени", () => {
    const out = run({
      candidates: [quickRaw, slowCook],
      filters: { maxTimeMin: 15 },
    });
    expect(out.map((m) => m.recipeId)).toEqual(["quickRaw"]);
  });

  it("«готовить» (без фильтра) допускает и долгие блюда", () => {
    const out = run({ candidates: [quickRaw, slowCook] });
    expect(out.map((m) => m.recipeId).sort()).toEqual(["quickRaw", "slowCook"]);
  });
});

describe("suggestNextMeal — всегда есть ответ, детерминизм, пометки", () => {
  const chicken = cand("chicken", { kcal: 250, protein: 30, fat: 8, carb: 4 });
  const pasta = cand("pasta", { kcal: 350, protein: 9, fat: 6, carb: 65 });
  const salad = cand("salad", { kcal: 120, protein: 3, fat: 7, carb: 10, fiber: 4 });
  const beef = cand("beef", { kcal: 300, protein: 26, fat: 12, carb: 2 });

  it("≥1 вариант при непустой базе кандидатов", () => {
    const out = run({ candidates: [chicken, pasta, salad, beef] });
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it("не более топ-N (по умолчанию 3) вариантов", () => {
    const out = run({ candidates: [chicken, pasta, salad, beef] });
    expect(out.length).toBeLessThanOrEqual(3);
  });

  it("пусто — только при пустой базе кандидатов", () => {
    expect(run({ candidates: [] })).toEqual([]);
  });

  it("даёт приближение, даже если идеального по КБЖУ нет", () => {
    // Огромный дефицит белка: ни одно блюдо не закрывает его полностью, но ответ
    // обязан быть (story 11 — не упираться в пустой экран).
    const out = run({
      remaining: { kcal: 1500, protein: 120, fat: 40, carb: 120, fiber: 15 },
      laggingMacro: "protein",
      candidates: [chicken, salad],
    });
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it("неидеальный вариант несёт честную пометку про белок/ккал", () => {
    // Блюдо добирает белок, но перебирает калории: ждём пометку-ярлык.
    const leanHeavy = cand("leanHeavy", { kcal: 900, protein: 30, fat: 20, carb: 60 });
    const out = run({
      remaining: { kcal: 300, protein: 40, fat: 10, carb: 20, fiber: 5 },
      laggingMacro: "protein",
      candidates: [leanHeavy],
    });
    expect(out[0].note).toBeTruthy();
    expect(out[0].note!.toLowerCase()).toContain("ккал");
  });

  it("детерминизм: тот же seed → тот же результат", () => {
    const a = run({ candidates: [chicken, pasta, salad, beef], seed: 42 });
    const b = run({ candidates: [chicken, pasta, salad, beef], seed: 42 });
    expect(a).toEqual(b);
  });

  it("исключённые рецепты (excludeRecipeIds) не попадают в блок", () => {
    const out = run({
      candidates: [chicken, beef],
      excludeRecipeIds: ["chicken"],
    });
    expect(out.map((m) => m.recipeId)).not.toContain("chicken");
    expect(out.map((m) => m.recipeId)).toContain("beef");
  });
});

describe("logDecision — идемпотентность лога подсказки (ключ date|slot|suggestedRecipeId)", () => {
  function entry(over: Partial<DiaryEntry>): DiaryEntry {
    return {
      id: "e",
      date: "2026-09-11",
      slot: "lunch",
      source: "recipe",
      refId: "chicken",
      grams: null,
      servings: 1,
      nutrients: { kcal: 250, protein: 30, fat: 8, carb: 4, fiber: 0 },
      suggestedRecipeId: "chicken",
      ...over,
    };
  }

  it("новая подсказка (нет совпадения) → создаём запись", () => {
    const d = logDecision({
      existing: [],
      date: "2026-09-11",
      slot: "lunch",
      suggestedRecipeId: "chicken",
    });
    expect(d.create).toBe(true);
  });

  it("повтор той же подсказки (повторный тап «съел») → no-op, без дубля", () => {
    const d = logDecision({
      existing: [entry({})],
      date: "2026-09-11",
      slot: "lunch",
      suggestedRecipeId: "chicken",
    });
    expect(d.create).toBe(false);
  });

  it("цикл лог→удаление возвращает подсказку в блок (exclude + logDecision)", () => {
    // Реальный цикл, а не повтор «новой подсказки»: подсказка видна в блоке →
    // после лога исключается (excludeRecipeIds) → после удаления снова видна и
    // снова логируется. Связывает две поверхности возврата: suggestNextMeal и
    // logDecision.
    const chicken = cand("chicken", { kcal: 250, protein: 30, fat: 8, carb: 4 });
    const beef = cand("beef", { kcal: 300, protein: 26, fat: 12, carb: 2 });

    // 1) До лога подсказка видна в блоке.
    const before = run({ candidates: [chicken, beef] });
    expect(before.map((m) => m.recipeId)).toContain("chicken");

    // 2) После лога (запись с suggestedRecipeId=chicken) повтор не дублирует и
    //    подсказка исчезает из блока.
    const logged = entry({ suggestedRecipeId: "chicken", refId: "chicken" });
    expect(
      logDecision({
        existing: [logged],
        date: "2026-09-11",
        slot: "lunch",
        suggestedRecipeId: "chicken",
      }).create,
    ).toBe(false);
    const during = run({ candidates: [chicken, beef], excludeRecipeIds: ["chicken"] });
    expect(during.map((m) => m.recipeId)).not.toContain("chicken");

    // 3) После удаления записи подсказка снова логируется и снова видна в блоке.
    expect(
      logDecision({
        existing: [],
        date: "2026-09-11",
        slot: "lunch",
        suggestedRecipeId: "chicken",
      }).create,
    ).toBe(true);
    const after = run({ candidates: [chicken, beef] });
    expect(after.map((m) => m.recipeId)).toContain("chicken");
  });

  it("другой слот той же подсказки — отдельная запись", () => {
    const d = logDecision({
      existing: [entry({ slot: "lunch" })],
      date: "2026-09-11",
      slot: "dinner",
      suggestedRecipeId: "chicken",
    });
    expect(d.create).toBe(true);
  });

  it("ручная запись (suggestedRecipeId=null) не мешает логу подсказки", () => {
    const manual = entry({ suggestedRecipeId: null, id: "manual" });
    const d = logDecision({
      existing: [manual],
      date: "2026-09-11",
      slot: "lunch",
      suggestedRecipeId: "chicken",
    });
    expect(d.create).toBe(true);
  });
});
