// Keyword-фильтр «не хочу есть»: сбор токенов рецепта и разворачивание синонимов
// (тикет 16, decision 06 шаг 1). Чистый модуль без Prisma/Next — «слой данных»,
// который упоминает types.ts: пользователь пишет одно слово («курица»), а поймать
// нужно все словоформы и продукты концепта (грудка/бедро/окорочок), не задев
// посторонние (говядина, рыба). Само совпадение по подстроке — в constraints.ts;
// здесь только подготовка терминов и ключевых слов.

/**
 * Токены строки: нижний регистр, разбивка по не-буквенным символам, длина ≥ 2
 * (одиночные предлоги «с»/«и» и знаки — мусор для фильтра). Годится для кириллицы,
 * латиницы и цифр.
 */
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
}

/**
 * Ключевые слова рецепта для keyword-фильтра: токены названия и названий
 * ингредиентов + группы продуктов (и как целые строки — для фильтра по группе,
 * и потокенно — чтобы «мясо» ловило и говядину, и птицу). Без пустых и дубликатов.
 */
export function recipeKeywords(
  name: string,
  ingredientNames: readonly string[],
  groups: readonly string[],
): string[] {
  const out = new Set<string>();
  for (const t of tokenize(name)) out.add(t);
  for (const ing of ingredientNames) for (const t of tokenize(ing)) out.add(t);
  for (const g of groups) {
    out.add(g.toLowerCase()); // группа целиком — для фильтра-чипа по группе
    for (const t of tokenize(g)) out.add(t); // и потокенно
  }
  return [...out];
}

/**
 * Концепт синонимов: если термин пользователя задевает любой `trigger` (по
 * подстроке в любую сторону), в фильтр добавляются все `stems` — корни словоформ
 * и родственных продуктов. Корни намеренно узкие, чтобы не задеть смежное (у
 * курицы нет «филе» — оно есть и у рыбы).
 */
interface Concept {
  triggers: string[];
  stems: string[];
}

const CONCEPTS: Concept[] = [
  {
    triggers: ["куриц", "курин", "кура", "курочк"],
    stems: ["куриц", "курин", "грудк", "бедро", "бёдр", "окорочок", "голен", "крыл"],
  },
  { triggers: ["говядин", "говяж"], stems: ["говядин", "говяж"] },
  { triggers: ["свинин", "свин"], stems: ["свинин", "свин"] },
  { triggers: ["индейк", "индюш"], stems: ["индейк", "индюш"] },
  {
    triggers: ["рыба", "рыб", "рыбн"],
    stems: ["рыб", "минтай", "горбуш", "лосос", "форел", "треск", "сельд", "сёмг", "семг", "тунец"],
  },
  { triggers: ["гриб"], stems: ["гриб", "шампиньон", "вёшенк", "вешенк"] },
  { triggers: ["молок", "молоч", "молочн"], stems: ["молок", "молоч"] },
  { triggers: ["лук", "лукови"], stems: ["лук"] },
  { triggers: ["творог", "творож"], stems: ["творог", "творож"] },
  { triggers: ["капуст"], stems: ["капуст"] },
];

/**
 * Разворачивает пользовательские термины фильтра в набор корней для подстрочного
 * совпадения: приводит к нижнему регистру, сохраняет сам термин и добавляет корни
 * концептов, чьи триггеры он задевает. Незнакомый термин остаётся собой.
 */
export function expandFilterTerms(terms: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of terms) {
    const term = raw.trim().toLowerCase();
    if (!term) continue;
    out.add(term);
    for (const c of CONCEPTS) {
      if (c.triggers.some((tr) => term.includes(tr) || tr.includes(term))) {
        for (const s of c.stems) out.add(s);
      }
    }
  }
  return [...out];
}
