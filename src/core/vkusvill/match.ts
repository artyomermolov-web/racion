// Мэтчер «seed-ингредиент ↔ товар ВВ» (тикет 02, spec.md шов 1, Q5=b/Q9=c).
// Чистая функция без сети/БД — синк применяет её при ре-сорсе seed-каталога:
// сопоставленное берёт настоящие КБЖУ/цену ВВ (source=vkusvill), несопоставленное
// остаётся seed-фолбэком. Осторожность важнее охвата: при неоднозначности (два
// одинаково близких кандидата) возвращаем null и оставляем фолбэк, а не угадываем.

/** Минимальная форма для мэтча: имя обязательно, группа — необязательный сигнал. */
export interface MatchTarget {
  name: string;
  /** Русская подпись группы каталога (Ingredient.group); необязательна. */
  group?: string;
}

/**
 * Нормализует название продукта к сравнимому виду: нижний регистр, ё→е, десятичная
 * запятая→точка, кавычки/скобки/прочая пунктуация → пробелы, схлопывание пробелов.
 * Проценты и цифры (жирность, «3.2%») сохраняются — они различают близкие товары.
 */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/(\d),(\d)/g, "$1.$2") // десятичная запятая внутри числа → точка
    .replace(/[«»"'()]/g, " ") // кавычки/скобки — прочь
    .replace(/[^a-zа-я0-9.%]+/gi, " ") // остальная пунктуация → пробел
    .replace(/\s+/g, " ")
    .trim();
}

/** Минимальный коэффициент Дайса, ниже которого мэтч не считается уверенным. */
const MATCH_THRESHOLD = 0.6;
// Минимальный отрыв лидера от второго кандидата. Если два кандидата над порогом
// стоят ближе этого — выбор неоднозначен, возвращаем null (не угадываем): при
// ре-сорсе безопаснее оставить seed-фолбэк, чем повесить чужие КБЖУ/цену.
const AMBIGUITY_MARGIN = 0.05;

/** Нормализованные значимые токены названия (слова длиной ≥1). */
function tokens(name: string): Set<string> {
  return new Set(normalizeName(name).split(" ").filter(Boolean));
}

/** Коэффициент Дайса двух множеств токенов: 2·|A∩B| / (|A|+|B|), в [0,1]. */
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/**
 * Сопоставляет seed-ингредиент с наиболее близким товаром ВВ из кандидатов.
 * Возвращает выбранного кандидата или null (ничего не прошло порог / неоднозначно).
 */
export function matchIngredient<T extends MatchTarget>(
  seed: MatchTarget,
  candidates: T[],
): T | null {
  const seedTokens = tokens(seed.name);
  const scored = candidates
    .map((c) => ({ c, score: dice(seedTokens, tokens(c.name)) }))
    .filter((s) => s.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null; // ничего уверенного по имени
  const bestScore = scored[0].score;

  // Лидеры «вплотную» (в пределах отрыва) — кандидаты на неоднозначность.
  const leaders = scored.filter((s) => bestScore - s.score < AMBIGUITY_MARGIN);
  if (leaders.length === 1) return leaders[0].c; // явный лидер по имени

  // Ничья по имени: разрешаем совпадением группы, если оно единственное.
  const seedGroup = seed.group ? normalizeName(seed.group) : null;
  if (seedGroup) {
    const byGroup = leaders.filter((s) => s.c.group && normalizeName(s.c.group) === seedGroup);
    if (byGroup.length === 1) return byGroup[0].c;
  }
  return null; // неоднозначно — оставляем seed-фолбэк
}
