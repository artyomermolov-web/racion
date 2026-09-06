import { describe, it, expect } from "vitest";
import { validateTargetsDraft, kcalFromMacros } from "./validation";

// Калории — производные от макросов: 4·белки + 9·жиры + 4·углеводы.
const VALID = {
  proteinMin: "120",
  proteinMax: "160",
  fatMin: "60",
  fatMax: "80",
  carbMin: "180",
  carbMax: "250",
  fiberMin: "28",
};

describe("kcalFromMacros", () => {
  it("считает калории по 4/9/4", () => {
    // 4·120 + 9·60 + 4·180 = 480 + 540 + 720 = 1740
    expect(kcalFromMacros({ protein: 120, fat: 60, carb: 180 })).toBe(1740);
  });
});

describe("validateTargetsDraft", () => {
  it("принимает макросы и выводит калории из них", () => {
    const r = validateTargetsDraft(VALID);
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({
      // kcalMin = 4·120+9·60+4·180 = 1740 ; kcalMax = 4·160+9·80+4·250 = 2360
      kcalMin: 1740,
      kcalMax: 2360,
      proteinMin: 120,
      proteinMax: 160,
      fatMin: 60,
      fatMax: 80,
      carbMin: 180,
      carbMax: 250,
      fiberMin: 28,
    });
  });

  it("меньше белка → меньше калорий (динамический пересчёт)", () => {
    const more = validateTargetsDraft(VALID).value!;
    const less = validateTargetsDraft({ ...VALID, proteinMin: "50" }).value!;
    // 99→50 уменьшает нижнюю границу калорий на (120−50)·4 = 280
    expect(less.kcalMin).toBe(more.kcalMin - (120 - 50) * 4);
    expect(less.kcalMin).toBeLessThan(more.kcalMin);
  });

  it("требует min ≤ max в каждом диапазоне макросов", () => {
    const r = validateTargetsDraft({ ...VALID, proteinMin: "200" });
    expect(r.errors.proteinMax).toBeTruthy();
    expect(r.value).toBeUndefined();
  });

  it("отклоняет отрицательные значения", () => {
    const r = validateTargetsDraft({ ...VALID, fatMin: "-5" });
    expect(r.errors.fatMin).toBeTruthy();
  });

  it("отклоняет нечисловой и дробный ввод (граммы целые)", () => {
    expect(validateTargetsDraft({ ...VALID, proteinMin: "abc" }).errors.proteinMin).toBeTruthy();
    expect(validateTargetsDraft({ ...VALID, proteinMin: "120.5" }).errors.proteinMin).toBeTruthy();
  });

  it("требует все поля макросов и клетчатку", () => {
    const r = validateTargetsDraft({});
    expect(Object.keys(r.errors).length).toBeGreaterThanOrEqual(7);
  });

  it("отклоняет нереалистично большие значения макросов", () => {
    expect(validateTargetsDraft({ ...VALID, proteinMax: "5000" }).errors.proteinMax).toBeTruthy();
  });
});
