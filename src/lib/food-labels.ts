// Русские подписи для тегов и единиц базы (тикет 13). Общий модуль без Prisma —
// используется и серверными, и клиентскими компонентами. Канонические ключи
// хранятся в БД (см. schema.prisma / core), подписи — здесь.

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

/** Граммовка без хвостовых нулей: 100 → «100», 12.5 → «12.5». */
export const formatGrams = (g: number) => Number(g.toFixed(g % 1 === 0 ? 0 : 1));
