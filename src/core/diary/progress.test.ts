import { describe, it, expect } from "vitest";
import { remaining } from "./progress";
import type { DayTarget } from "@/core/generator";
import type { DiaryNutrients } from "./types";

const target: DayTarget = {
  kcal: 2000,
  protein: 150,
  fat: 70,
  carb: 200,
  fiber: 25,
};

const eaten = (n: Partial<DiaryNutrients>): DiaryNutrients => ({
  kcal: 0,
  protein: 0,
  fat: 0,
  carb: 0,
  fiber: 0,
  ...n,
});

describe("remaining — остаток со знаком", () => {
  it("недобор: остаток положительный (target − eaten)", () => {
    const p = remaining(target, eaten({ kcal: 1200, protein: 90 }));
    expect(p.kcal).toEqual({ target: 2000, eaten: 1200, remaining: 800 });
    expect(p.protein).toEqual({ target: 150, eaten: 90, remaining: 60 });
  });

  it("перебор считается честно (отрицательный остаток, не обрезается в ноль)", () => {
    const p = remaining(target, eaten({ kcal: 2200, carb: 260 }));
    expect(p.kcal.remaining).toBe(-200);
    expect(p.carb.remaining).toBe(-60);
  });
});

describe("remaining — клетчатка min-only", () => {
  it("недобор клетчатки — остаток положительный", () => {
    const p = remaining(target, eaten({ fiber: 10 }));
    expect(p.fiber).toEqual({ target: 25, eaten: 10, remaining: 15 });
  });

  it("перебор клетчатки не уходит в минус (нет верхней границы)", () => {
    const p = remaining(target, eaten({ fiber: 40 }));
    expect(p.fiber.remaining).toBe(0);
    expect(p.fiber.eaten).toBe(40);
  });
});

describe("remaining — отстающий макрос", () => {
  it("при дефиците белка отстающий — белок (приоритет), даже если у углеводов дефицит относительно больше", () => {
    // белок: дефицит 10/150 ≈ 0.07; углеводы: дефицит 100/200 = 0.5.
    const p = remaining(target, eaten({ protein: 140, fat: 70, carb: 100 }));
    expect(p.laggingMacro).toBe("protein");
  });

  it("белок добран → отстающий = макрос с наибольшим относительным дефицитом", () => {
    // белок добран; жир дефицит 21/70 = 0.3; углеводы дефицит 20/200 = 0.1 → жир.
    const p = remaining(target, eaten({ protein: 160, fat: 49, carb: 180 }));
    expect(p.laggingMacro).toBe("fat");
  });

  it("все макросы добраны → отстающего нет (null)", () => {
    const p = remaining(target, eaten({ protein: 150, fat: 80, carb: 210 }));
    expect(p.laggingMacro).toBeNull();
  });
});
