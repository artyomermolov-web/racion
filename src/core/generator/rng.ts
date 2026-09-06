// Детерминированный ГПСЧ для генератора (тикет 06/14: «детерминизм при
// фиксированном seed»). mulberry32 — быстрый, стабильный, воспроизводимый на
// любой платформе; нам не нужна крипто-стойкость, нужна повторяемость.

/** Возвращает функцию-генератор чисел [0;1) от 32-битного seed (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Хеш строки в 32-битное беззнаковое число (FNV-1a) — для seed от userId/даты. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Индекс из [0;count) по значению rng [0;1). */
export function pickIndex(rng: () => number, count: number): number {
  return Math.min(count - 1, Math.floor(rng() * count));
}
