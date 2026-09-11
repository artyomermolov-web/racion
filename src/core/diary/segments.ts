// Упорядочивание сегментов потока добавления (тикет 11) — чистое ядро без
// Prisma/Next (тестовый шов). Слой src/lib/diary.ts тянет строки из БД и передаёт
// сюда «плоские» ссылки на еду; здесь — только дедуп и сортировка «новизна/частота».
//
// Источники (факт тикета 01): Недавнее и частые продукты — агрегат по DiaryEntry;
// Избранное — FavoriteRecipe (рецепты) + частые продукты; Своё — кастом-еда (ссылки
// собирает слой БД). Отдельной модели избранного продукта нет (решение развилки).

import type { DiarySource } from "./types";

/** Ссылка на залогированную еду с моментом записи (мс, для «новизны»/частоты). */
export interface LoggedRef {
  source: DiarySource;
  refId: string;
  /** createdAt в миллисекундах (чем больше — тем свежее). */
  at: number;
}

/** Ссылка на еду в сегменте (резолвится в строку базы на клиенте). */
export interface SegmentRef {
  source: DiarySource;
  refId: string;
}

/** Лимиты по умолчанию: короткие списки для быстрого «дотянуться». */
const RECENT_LIMIT = 20;
const FREQUENT_LIMIT = 12;

/** Ключ уникальности еды (source+refId): продукт и рецепт с одним id различны. */
const refKey = (r: { source: DiarySource; refId: string }) =>
  `${r.source}|${r.refId}`;

/** Ссылка без момента записи (форма для UI). */
const toRef = (r: LoggedRef): SegmentRef => ({ source: r.source, refId: r.refId });

/**
 * Недавнее: уникальная еда, самая свежая первой (по последнему логу). Повторы
 * одной еды схлопываются в одну ссылку по самой свежей записи. Лимит — после
 * дедупа (ровно N разных позиций).
 */
export function recentRefs(
  logged: LoggedRef[],
  limit = RECENT_LIMIT,
): SegmentRef[] {
  const byRecency = [...logged].sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const out: SegmentRef[] = [];
  for (const r of byRecency) {
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(toRef(r));
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Частые продукты: ингредиенты по числу записей (убыв.); при равной частоте —
 * недавний первым. Рецепты игнорируются (частота продуктов — прообраз «избранного
 * продукта», которого как модели нет; тикет 01). Лимит ограничивает длину.
 */
export function frequentIngredientRefs(
  logged: LoggedRef[],
  limit = FREQUENT_LIMIT,
): SegmentRef[] {
  const stats = new Map<string, { ref: SegmentRef; count: number; last: number }>();
  for (const r of logged) {
    if (r.source !== "ingredient") continue;
    const k = refKey(r);
    const s = stats.get(k);
    if (s) {
      s.count += 1;
      if (r.at > s.last) s.last = r.at;
    } else {
      stats.set(k, { ref: toRef(r), count: 1, last: r.at });
    }
  }
  return [...stats.values()]
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, limit)
    .map((s) => s.ref);
}

/**
 * Избранное: избранные рецепты (в переданном порядке) первыми, затем частые
 * продукты. Дубли по (source+refId) убираются, порядок первого вхождения.
 */
export function favoriteRefs(
  favoriteRecipeIds: string[],
  frequentProducts: SegmentRef[],
): SegmentRef[] {
  const recipes: SegmentRef[] = favoriteRecipeIds.map((refId) => ({
    source: "recipe",
    refId,
  }));
  const seen = new Set<string>();
  const out: SegmentRef[] = [];
  for (const r of [...recipes, ...frequentProducts]) {
    const k = refKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
