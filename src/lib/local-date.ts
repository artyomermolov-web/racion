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
