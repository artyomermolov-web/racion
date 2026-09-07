import { describe, it, expect } from "vitest";
import { saleQuantity } from "./units";

// Перевод количества ингредиента рецепта в ЕДИНИЦУ ПРОДАЖИ (тикет 18). Состав
// рецепта задаётся в граммах/мл (для штучных — «граммовый эквивалент»), а список
// покупок и пачки считаются в единице продажи: г/мл совпадают с массой, штучные
// переводятся в штуки через массу одной штуки (gramsPerPiece).

describe("saleQuantity — количество в единице продажи", () => {
  it("для г/мл возвращает массу как есть", () => {
    expect(saleQuantity(250, "g", null)).toBe(250);
    expect(saleQuantity(100, "ml", null)).toBe(100);
  });

  it("для штучных делит граммовый эквивалент на массу штуки", () => {
    // 110 г яйца при 55 г/шт → 2 шт.
    expect(saleQuantity(110, "pcs", 55)).toBe(2);
    expect(saleQuantity(55, "pcs", 55)).toBe(1);
  });

  it("штучный без массы штуки (0/undefined) — падать не должен, берёт массу", () => {
    // Защита от неполных данных: без gramsPerPiece трактуем как есть (не делим на 0).
    expect(saleQuantity(110, "pcs", null)).toBe(110);
    expect(saleQuantity(110, "pcs", 0)).toBe(110);
  });
});
