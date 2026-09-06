import type { ReactNode } from "react";

interface LargeTitleHeaderProps {
  title: string;
  subtitle?: string;
  /** Элемент слева над заголовком (например, ссылка «назад»). */
  leading?: ReactNode;
  /** Кнопка/элемент справа (например, переключатель темы). */
  trailing?: ReactNode;
}

/** Крупный заголовок в стиле iOS large title (тикет 09). */
export function LargeTitleHeader({
  title,
  subtitle,
  leading,
  trailing,
}: LargeTitleHeaderProps) {
  return (
    <header className="nav">
      {leading ? <div className="nav-leading">{leading}</div> : null}
      <div className="nav-row">
        <h1 className="lt">{title}</h1>
        {trailing}
      </div>
      {subtitle ? <div className="lt-sub">{subtitle}</div> : null}
    </header>
  );
}
