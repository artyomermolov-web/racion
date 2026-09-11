// Русские подписи для тегов и единиц базы (тикет 13). Общий модуль без Prisma —
// используется и серверными, и клиентскими компонентами. Канонические ключи
// хранятся в БД (см. schema.prisma / core), подписи — здесь.

import type { DiaryEntry } from "@/core/diary";

export const SLOT_LABELS: Record<string, string> = {
  breakfast: "Завтрак",
  lunch: "Обед",
  dinner: "Ужин",
  snack: "Перекус",
};

export const DIET_LABELS: Record<string, string> = {
  vegetarian: "Вегетарианское",
  vegan: "Веганское",
  pescatarian: "Пескетарианское",
};

export const ALLERGEN_LABELS: Record<string, string> = {
  milk: "Молочка",
  gluten: "Глютен",
  egg: "Яйца",
  fish: "Рыба",
  meat: "Мясо",
  poultry: "Птица",
  nuts: "Орехи",
  soy: "Соя",
};

export const EQUIPMENT_LABELS: Record<string, string> = {
  stove: "Плита",
  oven: "Духовка",
  blender: "Блендер",
  multicooker: "Мультиварка",
  none: "Без техники",
};

/**
 * Значок группы продукта (эмодзи-плейсхолдер, тикет 12) — визуальная опора для
 * пикера добавления «как в Yazio». Реальных фото нет (Out of scope), значок это
 * эмодзи по группе. Ключи — 13 групп сида (prisma/seed-data.ts, объект G);
 * канонический маппинг из spec.md.
 */
export const GROUP_ICONS: Record<string, string> = {
  cereal: "🌾",
  dairy: "🥛",
  meat: "🍗",
  fish: "🐟",
  veg: "🥦",
  fruit: "🍎",
  grocery: "🫙",
  egg: "🥚",
  nuts: "🥜",
  bread: "🍞",
  beverage: "🥤",
  canned: "🥫",
  frozen: "🧊",
};

/** Значок для рецепта (группы нет) и неизвестной/пустой группы — тарелка. */
export const GROUP_ICON_FALLBACK = "🍽️";

/**
 * Тотальная функция «группа → значок»: любая известная группа даёт свой значок,
 * рецепт (группы нет) и неизвестная/пустая группа → fallback (тарелка).
 */
export function groupIcon(group?: string | null): string {
  if (!group) return GROUP_ICON_FALLBACK;
  return GROUP_ICONS[group] ?? GROUP_ICON_FALLBACK;
}

const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Просто",
  2: "Средне",
  3: "Сложно",
};

/**
 * Единица массы для отображения нутриентов и граммовок. Нутриенты хранятся на
 * 100 г (для мл — на 100 мл, плотность ~1), а штучные (яйца) считаются в граммах
 * съедобной части. Поэтому показываем «мл» только для жидкостей, иначе «г»
 * (не «шт» — «шт» это единица продажи для списка покупок, тикет 18).
 */
export const massUnit = (unit: string) => (unit === "ml" ? "мл" : "г");

export const label = (map: Record<string, string>, key: string) => map[key] ?? key;
export const difficultyLabel = (n: number) => DIFFICULTY_LABELS[n] ?? `Сложность ${n}`;

/** «45 мин» или «1 ч 10 мин». */
export function formatTime(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** Число без хвостовых нулей: 100 → «100», 12.5 → «12.5», 0.5 → «0.5». */
export const trimNum = (n: number) => Number(n.toFixed(n % 1 === 0 ? 0 : 1));

/** Граммовка без хвостовых нулей (частный случай trimNum). */
export const formatGrams = trimNum;

/**
 * Подпись количества записи дневника: продукт — «120 г» (штуки уже сведены в
 * граммы при записи), рецепт — «1 порция» с корректным склонением (тикет 09).
 */
export function formatAmount(entry: DiaryEntry, unit: string): string {
  if (entry.source === "recipe") {
    const s = entry.servings ?? 0;
    return `${trimNum(s)} ${pluralServings(s)}`;
  }
  return `${trimNum(entry.grams ?? 0)} ${massUnit(unit)}`;
}

/** Склонение слова «порция» по числу (1 порция / 2 порции / 5 порций). */
function pluralServings(n: number): string {
  const abs = Math.abs(n);
  if (!Number.isInteger(abs)) return "порции";
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "порция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "порции";
  return "порций";
}
