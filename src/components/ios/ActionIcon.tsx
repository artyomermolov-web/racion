// Свой набор инлайн-SVG иконок-действий в стиле Apple HIG (тикет 11). Без внешних
// зависимостей — как TabBar.tsx: сетка 24×24, обводка currentColor, fill none,
// толщина линии задаётся в CSS (.icon-btn svg). Иконки — только глифы; тап-таргет
// (≥ 44pt) и доступное имя (aria-label) даёт кнопка-обёртка (.icon-btn), а не SVG.

/** Плюс — «добавить еду». */
export function AddIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Корзина — «удалить приём». */
export function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** Круговые стрелки — «заменить блюдо». */
export function ReplaceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8" />
      <path d="M20 3v5h-5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 16" />
      <path d="M4 21v-5h5" />
    </svg>
  );
}

/**
 * Галочка-в-круге — «съел», три состояния (spec, тикет 02):
 *  • off — не съедено: пустой контур круга;
 *  • on — съедено: залитый круг + галочка цветом карточки;
 *  • busy — в процессе: полупрозрачный круг + вращающаяся дуга.
 * Доступность (aria-pressed/aria-busy) задаёт кнопка-обёртка, не глиф.
 */
export function EatIcon({ state }: { state: "off" | "on" | "busy" }) {
  if (state === "on") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="eat-icon is-on">
        <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
        <path d="M8 12.5l2.6 2.6 5.4-5.8" stroke="var(--card)" />
      </svg>
    );
  }
  if (state === "busy") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="eat-icon is-busy">
        <circle cx="12" cy="12" r="9" opacity="0.25" />
        <path d="M12 3a9 9 0 0 1 9 9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="eat-icon is-off">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
