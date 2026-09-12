// Локальная календарная дата пользователя как YYYY-MM-DD — общий хелпер для
// дневника (экран дня и строка на главном). Правило load-bearing (spec US 32):
// граница «сегодня» — ЛОКАЛЬНАЯ полночь, ключ формируется по локальным полям Date
// и НЕ прогоняется через UTC/toISOString (иначе поздний вечерний приём уезжает в
// другой день). Держим правило в одном месте, чтобы не разъезжалось между
// экранами. Чистый модуль (без server-only) — используется клиентскими компонентами.

/** Локальная дата → YYYY-MM-DD (по локальным полям, не через UTC). */
export function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Ключ локального «сегодня». */
export function todayKey(): string {
  return toKey(new Date());
}

/**
 * Ключи семи дней недели (Пн..Вс), содержащей дату `from` — локальная календарная
 * неделя пользователя. Экран «Неделя» показывает дни по индексу (Пн=0..Вс=6), а
 * тап ведёт в ленту этого дня Дневника, значит индексу нужна реальная дата (тикет
 * 13). Понедельник — первый день (как подписи DAY_LABELS). Арифметика по локальным
 * полям (DST-безопасно), без UTC-дрейфа — то же правило, что у toKey.
 */
export function weekDateKeys(from: Date): string[] {
  // getDay(): 0=Вс..6=Сб. Сдвиг до понедельника: Пн→0, Вт→1, …, Вс→6.
  const sinceMonday = (from.getDay() + 6) % 7;
  const monday = new Date(from.getFullYear(), from.getMonth(), from.getDate() - sinceMonday);
  return Array.from({ length: 7 }, (_, i) =>
    toKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)),
  );
}
