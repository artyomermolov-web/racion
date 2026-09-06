import { describe, it, expect } from "vitest";
import { computeTargets } from "./targets";
import { explainTargets } from "./explain";
import type { BodyInput } from "./targets";

const BASE: BodyInput = {
  sex: "male",
  age: 30,
  weightKg: 80,
  heightCm: 180,
  activityLevel: "moderate",
  goal: "maintain",
};

describe("explainTargets", () => {
  it("объясняет расход энергии простыми словами", () => {
    const t = computeTargets(BASE);
    const text = explainTargets(BASE, t).join(" ");
    expect(text).toContain("тратит");
    expect(text).toContain("ккал");
  });

  it("для похудения упоминает уменьшение калорий", () => {
    const t = computeTargets({ ...BASE, goal: "lose" });
    const text = explainTargets({ ...BASE, goal: "lose" }, t).join(" ");
    expect(text).toContain("худе");
  });

  it("для набора упоминает добавление калорий", () => {
    const t = computeTargets({ ...BASE, goal: "gain" });
    const text = explainTargets({ ...BASE, goal: "gain" }, t).join(" ");
    expect(text).toContain("набира");
  });

  it("перечисляет диапазоны макросов", () => {
    const t = computeTargets(BASE);
    const text = explainTargets(BASE, t).join(" ");
    expect(text).toContain("белок");
    expect(text).toContain("жир");
    expect(text).toContain("углевод");
  });

  it("при известном %жира отмечает расчёт по сухой массе", () => {
    const input = { ...BASE, bodyFatPct: 20 };
    const t = computeTargets(input);
    const text = explainTargets(input, t).join(" ");
    expect(text).toContain("сух");
  });

  it("при срабатывании защитного минимума показывает предупреждение", () => {
    const input: BodyInput = {
      sex: "female",
      age: 60,
      weightKg: 45,
      heightCm: 150,
      activityLevel: "sedentary",
      goal: "lose",
    };
    const t = computeTargets(input);
    expect(t.kcalFloorApplied).toBe(true);
    const warned = explainTargets(input, t).some((s) => s.includes("минимум"));
    expect(warned).toBe(true);
  });
});
