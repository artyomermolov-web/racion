import { describe, it, expect } from "vitest";
import { consumeFromLots } from "./consume";
import { mealDemand, writeOffMeal } from "./track";
import type { PantryLot, WriteOffRecipe } from "./types";

// Тесты ядра списания «по факту» (тикет 20, решение 07). Проверяют FIFO по сроку
// годности, разворот приёма в потребность (порция × едоки), «по факту» (недостача
// не блокирует) и главный инвариант: повторная отметка/снятие не списывают дважды
// (guard на alreadyApplied).

const real = (
  id: string,
  ingredientId: string,
  qty: number,
  expiresAt: string | null = null,
): PantryLot => ({ id, ingredientId, qty, kind: "real", expiresAt });

const pending = (id: string, ingredientId: string, qty: number): PantryLot => ({
  id,
  ingredientId,
  qty,
  kind: "pending",
  expiresAt: null,
});

describe("consumeFromLots — FIFO-списание из real-лотов", () => {
  it("расходует по сроку годности: раньше истекает — раньше берётся", () => {
    // Два лота яиц: один истекает раньше (09-10), другой позже (09-20).
    const lots = [
      real("late", "egg", 10, "2026-09-20"),
      real("soon", "egg", 10, "2026-09-10"),
    ];
    const { draws, shortfall } = consumeFromLots(lots, [{ ingredientId: "egg", qty: 6 }]);
    // Берём 6 из раннего лота, поздний не тронут.
    expect(draws).toEqual([
      { lotId: "soon", ingredientId: "egg", qty: 6, expiresAt: "2026-09-10" },
    ]);
    expect(shortfall).toEqual({});
  });

  it("переходит на следующий лот, когда первый исчерпан; null-срок берётся последним", () => {
    const lots = [
      real("noexp", "milk", 500, null), // без срока — в конец
      real("dated", "milk", 300, "2026-09-12"),
    ];
    const { draws } = consumeFromLots(lots, [{ ingredientId: "milk", qty: 700 }]);
    expect(draws).toEqual([
      { lotId: "dated", ingredientId: "milk", qty: 300, expiresAt: "2026-09-12" },
      { lotId: "noexp", ingredientId: "milk", qty: 400, expiresAt: null },
    ]);
  });

  it("«по факту»: берёт сколько есть, недостачу отдаёт в shortfall", () => {
    const lots = [real("l", "egg", 2)];
    const { draws, shortfall } = consumeFromLots(lots, [{ ingredientId: "egg", qty: 5 }]);
    expect(draws).toEqual([{ lotId: "l", ingredientId: "egg", qty: 2, expiresAt: null }]);
    expect(shortfall).toEqual({ egg: 3 });
  });

  it("pending-лоты не списываются (только real — запас дома)", () => {
    const lots = [pending("p", "egg", 100), real("r", "egg", 4)];
    const { draws, shortfall } = consumeFromLots(lots, [{ ingredientId: "egg", qty: 4 }]);
    expect(draws).toEqual([{ lotId: "r", ingredientId: "egg", qty: 4, expiresAt: null }]);
    expect(shortfall).toEqual({});
  });

  it("продукта нет дома вовсе → вся потребность в shortfall, отборов нет", () => {
    const { draws, shortfall } = consumeFromLots([], [{ ingredientId: "flour", qty: 300 }]);
    expect(draws).toEqual([]);
    expect(shortfall).toEqual({ flour: 300 });
  });
});

describe("mealDemand — разворот приёма в потребность", () => {
  // Омлет: на 2 порции 6 яиц + 200 мл молока.
  const omelet: WriteOffRecipe = {
    id: "omelet",
    servings: 2,
    ingredients: [
      { ingredientId: "egg", quantity: 6 },
      { ingredientId: "milk", quantity: 200 },
    ],
  };

  it("делит на порций рецепта и умножает на порцию приёма", () => {
    // Порция ×1 от рецепта на 2 порции → половина состава: 3 яйца, 100 мл.
    expect(mealDemand(omelet, 1).sort((a, b) => (a.ingredientId < b.ingredientId ? -1 : 1))).toEqual([
      { ingredientId: "egg", qty: 3 },
      { ingredientId: "milk", qty: 100 },
    ]);
  });

  it("учитывает число едоков (умножает потребность)", () => {
    // Порция ×1, 2 едока → полный состав рецепта: 6 яиц, 200 мл.
    const d = mealDemand(omelet, 1, 2).sort((a, b) => (a.ingredientId < b.ingredientId ? -1 : 1));
    expect(d).toEqual([
      { ingredientId: "egg", qty: 6 },
      { ingredientId: "milk", qty: 200 },
    ]);
  });

  it("пустой состав → пустая потребность", () => {
    expect(mealDemand({ id: "x", servings: 1, ingredients: [] }, 1)).toEqual([]);
  });
});

describe("writeOffMeal — списание приёма с guard от двойного вычитания (решение 07)", () => {
  const recipe: WriteOffRecipe = {
    id: "omelet",
    servings: 1,
    ingredients: [{ ingredientId: "egg", quantity: 3 }],
  };
  const meal = { key: "m1", recipeId: "omelet", portion: 1 };

  it("первая отметка «съел» списывает из кладовки один раз", () => {
    const lots = [real("l", "egg", 10)];
    const res = writeOffMeal({ meal, alreadyApplied: false, recipe, realLots: lots });
    expect(res.apply).toBe(true);
    expect(res.draws).toEqual([{ lotId: "l", ingredientId: "egg", qty: 3, expiresAt: null }]);
  });

  it("повторная отметка того же приёма (alreadyApplied) НЕ списывает второй раз", () => {
    const lots = [real("l", "egg", 10)];
    // Симулируем полный цикл: списали → в состоянии данных ключ уже применён →
    // повторный вызов с alreadyApplied=true не должен ничего вычитать.
    const first = writeOffMeal({ meal, alreadyApplied: false, recipe, realLots: lots });
    expect(first.apply).toBe(true);

    const second = writeOffMeal({ meal, alreadyApplied: true, recipe, realLots: lots });
    expect(second.apply).toBe(false);
    expect(second.draws).toEqual([]);
    expect(second.shortfall).toEqual({});
  });

  it("снятие/повторная отметка не накапливают списание (guard идемпотентен)", () => {
    const lots = [real("l", "egg", 10)];
    // Многократные «уже применено» вызовы — всегда no-op.
    for (let i = 0; i < 3; i++) {
      const r = writeOffMeal({ meal, alreadyApplied: true, recipe, realLots: lots });
      expect(r.apply).toBe(false);
      expect(r.draws).toEqual([]);
    }
  });

  it("недостача запаса не блокирует отметку: apply=true, остаток в shortfall", () => {
    const lots = [real("l", "egg", 1)];
    const res = writeOffMeal({ meal, alreadyApplied: false, recipe, realLots: lots });
    expect(res.apply).toBe(true);
    expect(res.draws).toEqual([{ lotId: "l", ingredientId: "egg", qty: 1, expiresAt: null }]);
    expect(res.shortfall).toEqual({ egg: 2 });
  });

  it("пустой состав рецепта → списывать нечего (apply=false)", () => {
    const res = writeOffMeal({
      meal,
      alreadyApplied: false,
      recipe: { id: "omelet", servings: 1, ingredients: [] },
      realLots: [real("l", "egg", 10)],
    });
    expect(res.apply).toBe(false);
  });
});
