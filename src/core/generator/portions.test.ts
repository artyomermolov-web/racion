import { describe, it, expect } from "vitest";
import { PORTION_STEPS, bestPortion } from "./portions";

// Порции — множитель размера блюда из {0.25 … 2.0, шаг 0.25} (CONTEXT.md, тикет
// 06 шаг 2). Тест «на утечки»: порция всегда в диапазоне; подбор минимизирует
// расстояние ккал до цели приёма.

describe("PORTION_STEPS — сетка порций 0.25–2.0", () => {
  it("строго в диапазоне 0.25–2.0 с шагом 0.25 (8 значений)", () => {
    expect(PORTION_STEPS).toEqual([0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]);
    for (const p of PORTION_STEPS) {
      expect(p).toBeGreaterThanOrEqual(0.25);
      expect(p).toBeLessThanOrEqual(2.0);
    }
  });
});

describe("bestPortion — подбор порции под цель ккал приёма", () => {
  it("для блюда 500 ккал/порция и цели 500 берёт 1.0", () => {
    expect(bestPortion(500, 500)).toBe(1.0);
  });

  it("для блюда 250 ккал/порция и цели 500 берёт 2.0", () => {
    expect(bestPortion(250, 500)).toBe(2.0);
  });

  it("для блюда 1000 ккал/порция и цели 250 берёт 0.25", () => {
    expect(bestPortion(1000, 250)).toBe(0.25);
  });

  it("выбирает ближайший шаг, не выходя за диапазон (цель 300, блюдо 400)", () => {
    // 400×0.75=300 — точное попадание на 0.75.
    expect(bestPortion(400, 300)).toBe(0.75);
  });

  it("не делит на ноль: блюдо 0 ккал → минимальная порция", () => {
    expect(bestPortion(0, 500)).toBe(0.25);
  });
});
