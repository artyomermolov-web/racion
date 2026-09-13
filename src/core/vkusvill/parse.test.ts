import { describe, it, expect } from "vitest";
import { parseVkusvillNutrition } from "./parse";

// Разбор неструктурной КБЖУ-строки ВВ (spec.md, шов 1). Формат — реальный:
// «Белки … г, жиры … г, углеводы … г, … ккал», десятичная запятая, у ряда товаров
// несколько поставщиков через <br> (у молока ADR-0001 фиксирует 5 вариантов,
// 66.8–84.8 ккал), мусор &nbsp;/теги. Тест проверяет ВНЕШНЕЕ поведение: строка →
// усреднённые нутриенты + число вариантов, а не детали реализации.

describe("parseVkusvillNutrition — один поставщик", () => {
  it("разбирает Б/Ж/У/ккал с десятичной запятой", () => {
    const r = parseVkusvillNutrition(
      "Белки 2,9 г, жиры 3,2 г, углеводы 4,7 г, 59 ккал",
    );
    expect(r).not.toBeNull();
    expect(r!.variants).toBe(1);
    expect(r!.nutrients).toEqual({
      kcal: 59,
      protein: 2.9,
      fat: 3.2,
      carb: 4.7,
      fiber: 0,
      sodium: 0,
    });
  });

  it("чистит &nbsp; и HTML-теги, сохраняет сырьё", () => {
    const raw = "Белки&nbsp;3,0&nbsp;г,&nbsp;жиры&nbsp;3,2&nbsp;г,&nbsp;углеводы&nbsp;4,8&nbsp;г,&nbsp;<b>60</b>&nbsp;ккал";
    const r = parseVkusvillNutrition(raw);
    expect(r!.nutrients).toEqual({
      kcal: 60,
      protein: 3,
      fat: 3.2,
      carb: 4.8,
      fiber: 0,
      sodium: 0,
    });
    expect(r!.raw).toBe(raw); // сырьё для аудита не мутируется
  });
});

describe("parseVkusvillNutrition — несколько поставщиков через <br>", () => {
  it("усредняет по вариантам (молоко, ADR-0001)", () => {
    // Два поставщика: ккал 66.8 и 84.8 → среднее 75.8; белок 2,8/3,0 → 2.9.
    const r = parseVkusvillNutrition(
      "Белки 2,8 г, жиры 3,5 г, углеводы 4,6 г, 66,8 ккал<br>Белки 3,0 г, жиры 4,7 г, углеводы 4,8 г, 84,8 ккал",
    );
    expect(r!.variants).toBe(2);
    expect(r!.nutrients.kcal).toBeCloseTo(75.8, 5);
    expect(r!.nutrients.protein).toBeCloseTo(2.9, 5);
    expect(r!.nutrients.fat).toBeCloseTo(4.1, 5);
    expect(r!.nutrients.carb).toBeCloseTo(4.7, 5);
  });

  it("понимает <br/> и <br /> как разделитель поставщиков", () => {
    const r = parseVkusvillNutrition(
      "Белки 10 г, жиры 0 г, углеводы 0 г, 40 ккал<br/>Белки 20 г, жиры 0 г, углеводы 0 г, 80 ккал",
    );
    expect(r!.variants).toBe(2);
    expect(r!.nutrients.protein).toBe(15);
    expect(r!.nutrients.kcal).toBe(60);
  });
});

describe("parseVkusvillNutrition — крайние случаи", () => {
  it("отсутствующее поле считается нулём в этом варианте", () => {
    const r = parseVkusvillNutrition("Белки 12 г, жиры 5 г, 200 ккал");
    expect(r!.nutrients.carb).toBe(0);
    expect(r!.nutrients.protein).toBe(12);
    expect(r!.nutrients.kcal).toBe(200);
  });

  it("подхватывает клетчатку и натрий, если они есть в строке", () => {
    const r = parseVkusvillNutrition(
      "Белки 5 г, жиры 1 г, углеводы 20 г, клетчатка 8 г, натрий 60 мг, 120 ккал",
    );
    expect(r!.nutrients.fiber).toBe(8);
    expect(r!.nutrients.sodium).toBe(60);
  });

  it("возвращает null на строке без чисел/нутриентов", () => {
    expect(parseVkusvillNutrition("нет данных")).toBeNull();
    expect(parseVkusvillNutrition("")).toBeNull();
    expect(parseVkusvillNutrition(undefined)).toBeNull();
  });
});
