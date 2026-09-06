import { describe, it, expect } from "vitest";
import { validateTargetsDraft } from "./validation";

const VALID = {
  kcalMin: "2000",
  kcalMax: "2200",
  proteinMin: "120",
  proteinMax: "160",
  fatMin: "60",
  fatMax: "80",
  carbMin: "180",
  carbMax: "250",
  fiberMin: "28",
};

describe("validateTargetsDraft", () => {
  it("принимает корректные диапазоны и парсит числа", () => {
    const r = validateTargetsDraft(VALID);
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({
      kcalMin: 2000,
      kcalMax: 2200,
      proteinMin: 120,
      proteinMax: 160,
      fatMin: 60,
      fatMax: 80,
      carbMin: 180,
      carbMax: 250,
      fiberMin: 28,
    });
  });

  it("требует min ≤ max в каждом диапазоне", () => {
    const r = validateTargetsDraft({ ...VALID, kcalMin: "2300" });
    expect(r.errors.kcalMax).toBeTruthy();
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

  it("требует все поля", () => {
    const r = validateTargetsDraft({ kcalMin: "2000" });
    expect(Object.keys(r.errors).length).toBeGreaterThanOrEqual(8);
  });

  it("отклоняет нереалистично большие значения", () => {
    expect(validateTargetsDraft({ ...VALID, kcalMax: "99999" }).errors.kcalMax).toBeTruthy();
  });
});
