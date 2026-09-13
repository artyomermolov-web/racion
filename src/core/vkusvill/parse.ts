// Парсер КБЖУ-строк ВкусВилл (тикет 01, spec.md шов 1). Чистая функция без
// сети/БД — единственное место разбора формата ВВ, переиспользуется маппером и
// (позже) импортом рецептов.
//
// КБЖУ товара ВВ — НЕструктурная русская строка в `properties[].value` (ADR-0001):
// «Белки … г, жиры … г, углеводы … г, … ккал», десятичная запятая, мусор
// (&nbsp;/HTML-теги), у ряда товаров несколько поставщиков через <br>. Правило —
// усреднение по вариантам (ADR-0001). Клетчатка/натрий берём, только если явно
// есть в строке (обычно нет → 0), т.к. FoodNutrients требует все шесть полей.

import type { FoodNutrients } from "@/core/nutrition";
import type { ParsedNutrition } from "./types";

/**
 * Чистит разметку ВВ: &nbsp; → пробел, <br> → перевод строки (разделитель
 * поставщиков/шагов), прочие теги вырезаются, базовые HTML-сущности раскрываются.
 * Переиспользуется импортом рецептов (шаги приходят в том же грязном формате).
 * Пустое/невалидное на входе → "" (защита от undefined у неполных ответов ВВ).
 */
export function stripVvMarkup(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"');
}

/** Первое число после метки (десятичная запятая → точка); null — метки нет. */
function num(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const v = Number.parseFloat(m[1].replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

// Метки нутриентов. Число может идти как после слова («белки 2,9»), так и перед
// единицей («59 ккал») — для ккал ловим оба порядка.
const PROTEIN = /бел(?:ки|ок|ка)?[^\d-]*([\d]+(?:[.,]\d+)?)/i;
const FAT = /жир\w*[^\d-]*([\d]+(?:[.,]\d+)?)/i;
const CARB = /углевод\w*[^\d-]*([\d]+(?:[.,]\d+)?)/i;
const FIBER = /(?:клетчат\w*|пищевы\w+\s+волок\w*)[^\d-]*([\d]+(?:[.,]\d+)?)/i;
const SODIUM = /натри\w*[^\d-]*([\d]+(?:[.,]\d+)?)/i;
const KCAL = /([\d]+(?:[.,]\d+)?)\s*(?:ккал|ккал\.|kcal)|(?:ккал\w*|калорийн\w*|энергетическ\w*)[^\d-]*([\d]+(?:[.,]\d+)?)/i;

function kcalOf(text: string): number | null {
  const m = text.match(KCAL);
  if (!m) return null;
  const raw = m[1] ?? m[2];
  if (raw == null) return null;
  const v = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

/** Разбор одного варианта поставщика: null — ни одного нутриента не найдено. */
function parseVariant(text: string): FoodNutrients | null {
  const protein = num(text, PROTEIN);
  const fat = num(text, FAT);
  const carb = num(text, CARB);
  const kcal = kcalOf(text);
  const fiber = num(text, FIBER);
  const sodium = num(text, SODIUM);
  if (protein == null && fat == null && carb == null && kcal == null) return null;
  return {
    kcal: kcal ?? 0,
    protein: protein ?? 0,
    fat: fat ?? 0,
    carb: carb ?? 0,
    fiber: fiber ?? 0,
    sodium: sodium ?? 0,
  };
}

const KEYS: (keyof FoodNutrients)[] = [
  "kcal",
  "protein",
  "fat",
  "carb",
  "fiber",
  "sodium",
];

/** Среднее по вариантам, округление до 2 знаков (гасит артефакты плавающей точки). */
function average(variants: FoodNutrients[]): FoodNutrients {
  const out = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0, sodium: 0 };
  for (const v of variants) for (const k of KEYS) out[k] += v[k];
  for (const k of KEYS) out[k] = Math.round((out[k] / variants.length) * 100) / 100;
  return out;
}

/**
 * Разбирает КБЖУ-строку товара ВВ в усреднённые нутриенты на 100 г. При нескольких
 * поставщиках (через <br>) возвращает среднее по вариантам; сырьё и число вариантов
 * сохраняются для аудита. null — строки нет или в ней не нашлось ни одного нутриента.
 */
export function parseVkusvillNutrition(
  raw: string | null | undefined,
): ParsedNutrition | null {
  if (!raw || !raw.trim()) return null;
  const variants = stripVvMarkup(raw)
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseVariant)
    .filter((v): v is FoodNutrients => v !== null);
  if (variants.length === 0) return null;
  return { nutrients: average(variants), variants: variants.length, raw };
}
