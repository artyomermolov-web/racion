import { describe, it, expect } from "vitest";
import { validateBodyInput } from "./validation";

const VALID = {
  sex: "male",
  age: "30",
  heightCm: "180",
  weightKg: "80",
  activityLevel: "moderate",
  goal: "maintain",
};

describe("validateBodyInput", () => {
  it("для корректных данных ошибок нет и возвращает типизированный ввод", () => {
    const r = validateBodyInput(VALID);
    expect(r.errors).toEqual({});
    expect(r.value).toEqual({
      sex: "male",
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activityLevel: "moderate",
      goal: "maintain",
      bodyFatPct: null,
    });
  });

  it("принимает дробные рост и вес", () => {
    const r = validateBodyInput({ ...VALID, weightKg: "80.5", heightCm: "175.5" });
    expect(r.errors).toEqual({});
    expect(r.value?.weightKg).toBe(80.5);
    expect(r.value?.heightCm).toBe(175.5);
  });

  it("парсит опциональный процент жира", () => {
    const r = validateBodyInput({ ...VALID, bodyFatPct: "22" });
    expect(r.errors).toEqual({});
    expect(r.value?.bodyFatPct).toBe(22);
  });

  it("пустой процент жира считается «не указан» (null)", () => {
    const r = validateBodyInput({ ...VALID, bodyFatPct: "" });
    expect(r.errors).toEqual({});
    expect(r.value?.bodyFatPct).toBeNull();
  });

  it("отклоняет неизвестный пол", () => {
    const r = validateBodyInput({ ...VALID, sex: "" });
    expect(r.errors.sex).toBeTruthy();
    expect(r.value).toBeUndefined();
  });

  it("отклоняет возраст вне диапазона", () => {
    expect(validateBodyInput({ ...VALID, age: "5" }).errors.age).toBeTruthy();
    expect(validateBodyInput({ ...VALID, age: "130" }).errors.age).toBeTruthy();
  });

  it("отклоняет нечисловой возраст", () => {
    expect(validateBodyInput({ ...VALID, age: "abc" }).errors.age).toBeTruthy();
  });

  it("отклоняет рост вне диапазона", () => {
    expect(validateBodyInput({ ...VALID, heightCm: "100" }).errors.heightCm).toBeTruthy();
    expect(validateBodyInput({ ...VALID, heightCm: "300" }).errors.heightCm).toBeTruthy();
  });

  it("отклоняет вес вне диапазона", () => {
    expect(validateBodyInput({ ...VALID, weightKg: "20" }).errors.weightKg).toBeTruthy();
    expect(validateBodyInput({ ...VALID, weightKg: "400" }).errors.weightKg).toBeTruthy();
  });

  it("отклоняет процент жира вне диапазона", () => {
    expect(validateBodyInput({ ...VALID, bodyFatPct: "1" }).errors.bodyFatPct).toBeTruthy();
    expect(validateBodyInput({ ...VALID, bodyFatPct: "70" }).errors.bodyFatPct).toBeTruthy();
  });

  it("отклоняет неизвестный уровень активности и цель", () => {
    expect(validateBodyInput({ ...VALID, activityLevel: "x" }).errors.activityLevel).toBeTruthy();
    expect(validateBodyInput({ ...VALID, goal: "x" }).errors.goal).toBeTruthy();
  });

  it("собирает ошибки по всем полям независимо", () => {
    const r = validateBodyInput({});
    expect(Object.keys(r.errors).length).toBeGreaterThanOrEqual(5);
  });
});
