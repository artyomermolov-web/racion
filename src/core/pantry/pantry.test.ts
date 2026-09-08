import { describe, it, expect } from "vitest";
import { realOnHand, pantryStockIds } from "./lots";
import { confirmPurchase } from "./confirm";
import { cookableFromPantry } from "./cook";
import type { PantryLot, PurchaseLineInput } from "./types";
import { buildShoppingList } from "../shopping";
import type { ShoppingRecipe } from "../shopping";

// Тесты ядра кладовки (тикет 19, решение 07). Проверяют, что real/pending лоты
// строго раздельны, снапшот замораживается по ценам на момент покупки, купленное
// переносится в real-лоты со сроком годности, а вкладка «приготовить из дома»
// считает доступные порции только из real-запаса.

const real = (id: string, ingredientId: string, qty: number, expiresAt: string | null = null): PantryLot => ({
  id,
  ingredientId,
  qty,
  kind: "real",
  expiresAt,
});

const pending = (id: string, ingredientId: string, qty: number): PantryLot => ({
  id,
  ingredientId,
  qty,
  kind: "pending",
  expiresAt: null,
});

describe("realOnHand — запас дома только из real-лотов", () => {
  it("суммирует real-лоты по ингредиенту, pending игнорирует полностью", () => {
    const lots = [
      real("l1", "egg", 10),
      real("l2", "egg", 5),
      pending("p1", "egg", 100), // прогноз покупки — НЕ считается запасом
      real("l3", "milk", 900),
      pending("p2", "flour", 1000),
    ];
    const onHand = realOnHand(lots);
    expect(onHand).toEqual({ egg: 15, milk: 900 });
    // flour был только pending → его нет в запасе.
    expect(onHand.flour).toBeUndefined();
  });

  it("pantryStockIds — ингредиенты с положительным real-запасом (без pending)", () => {
    const lots = [real("l1", "egg", 6), pending("p1", "milk", 900), real("l2", "rice", 0)];
    expect(pantryStockIds(lots).sort()).toEqual(["egg"]);
  });
});

describe("confirmPurchase — снапшот, real-лоты, промоушен pending→real", () => {
  const lines: PurchaseLineInput[] = [
    { ingredientId: "egg", name: "Яйцо", packsBought: 1, packSize: 10, pricePerPack: 90 },
    { ingredientId: "milk", name: "Молоко", packsBought: 2, packSize: 900, pricePerPack: 80 },
    { ingredientId: "salt", name: "Соль", packsBought: 0, packSize: 1000, pricePerPack: 20 },
  ];

  const base = {
    lines,
    purchasedAt: "2026-09-08",
    shelfLifeDays: { egg: 30, milk: 7 }, // соль без срока
    makeLotId: (seq: number) => `lot-${seq}`,
  };

  it("снапшот: только купленные строки, стоимость и сумма заморожены по текущим ценам", () => {
    const { snapshot } = confirmPurchase(base);
    expect(snapshot.confirmedAt).toBe("2026-09-08");
    expect(snapshot.lines.map((l) => l.ingredientId)).toEqual(["egg", "milk"]); // соль (0 пачек) исключена
    const egg = snapshot.lines.find((l) => l.ingredientId === "egg")!;
    expect(egg.qty).toBe(10); // 1 пачка × 10
    expect(egg.lineCost).toBe(90);
    expect(snapshot.totalCost).toBe(90 + 2 * 80); // 250
  });

  it("real-лоты: qty = пачки·размер, срок годности = дата + shelfLifeDays", () => {
    const { newRealLots } = confirmPurchase(base);
    expect(newRealLots).toHaveLength(2);
    const egg = newRealLots.find((l) => l.ingredientId === "egg")!;
    expect(egg.kind).toBe("real");
    expect(egg.qty).toBe(10);
    expect(egg.expiresAt).toBe("2026-10-08"); // +30 дней
    const milk = newRealLots.find((l) => l.ingredientId === "milk")!;
    expect(milk.qty).toBe(1800);
    expect(milk.expiresAt).toBe("2026-09-15"); // +7 дней
  });

  it("продукт без срока годности → лот без срока (expiresAt = null)", () => {
    const withSalt = {
      ...base,
      lines: [{ ingredientId: "salt", name: "Соль", packsBought: 1, packSize: 1000, pricePerPack: 20 }],
    };
    const { newRealLots } = confirmPurchase(withSalt);
    expect(newRealLots[0].expiresAt).toBeNull();
  });

  it("pending купленных ингредиентов промотятся в real; чужие pending не трогаются", () => {
    const withPending = {
      ...base,
      pendingLots: [pending("pe", "egg", 30), pending("px", "flour", 1000)],
    };
    const { promotedPendingIds, promotedLots } = confirmPurchase(withPending);
    expect(promotedPendingIds).toEqual(["pe"]); // egg куплен → его pending промотится
    expect(promotedLots[0].kind).toBe("real"); // строго real после промоушена
    expect(promotedLots[0].id).toBe("pe");
    // flour не покупали → его pending остаётся pending (не в списке промоушена).
    expect(promotedPendingIds).not.toContain("px");
  });

  it("снапшот не меняется при последующей смене цен (заморожен)", () => {
    const snap = confirmPurchase(base).snapshot;
    // «Цена выросла» — пересобираем ЖИВОЙ список с новой ценой яйца.
    const liveAfterPriceHike = buildShoppingList({
      plan: [{ recipeId: "r", portion: 1 }],
      recipes: [{ id: "r", servings: 1, ingredients: [{ ingredientId: "egg", quantity: 10 }] }],
      ingredients: [
        { id: "egg", name: "Яйцо", group: "Яйца", unit: "pcs", packSize: 10, pricePerPack: 200 },
      ],
    });
    expect(liveAfterPriceHike.totalCost).toBe(200); // живой список — по новой цене
    expect(snap.totalCost).toBe(250); // снапшот — по цене на момент покупки, не изменился
  });
});

describe("cookableFromPantry — приготовить из того, что дома", () => {
  const recipes: ShoppingRecipe[] = [
    // Омлет: на 1 порцию 3 яйца + 100 мл молока.
    { id: "omelet", servings: 1, ingredients: [
      { ingredientId: "egg", quantity: 3 },
      { ingredientId: "milk", quantity: 100 },
    ] },
    // Блины: на 2 порции 4 яйца + 500 мл молока + 300 г муки.
    { id: "pancakes", servings: 2, ingredients: [
      { ingredientId: "egg", quantity: 4 },
      { ingredientId: "milk", quantity: 500 },
      { ingredientId: "flour", quantity: 300 },
    ] },
  ];

  it("возвращает только рецепты, полностью покрытые real-запасом, с числом порций", () => {
    // Дома: 6 яиц, 400 мл молока, муки нет.
    const lots = [real("l1", "egg", 6), real("l2", "milk", 400)];
    const cookable = cookableFromPantry({ recipes, realLots: lots });
    // Блины нельзя — нет муки. Омлет: min(6/3, 400/100) = min(2, 4) = 2 порции.
    expect(cookable).toEqual([{ recipeId: "omelet", servings: 2 }]);
  });

  it("pending-запас не даёт готовить (учитывается только real)", () => {
    const lots = [pending("p1", "egg", 100), pending("p2", "milk", 1000)];
    expect(cookableFromPantry({ recipes, realLots: lots })).toEqual([]);
  });

  it("не хватает даже на одну порцию → рецепт исключён", () => {
    const lots = [real("l1", "egg", 2), real("l2", "milk", 50)]; // < 3 яиц
    expect(cookableFromPantry({ recipes, realLots: lots })).toEqual([]);
  });
});
