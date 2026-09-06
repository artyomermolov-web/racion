import type { ReactNode } from "react";

interface InsetGroupedListProps {
  /** Заголовок группы над списком (uppercase, как в iOS). */
  title?: string;
  children: ReactNode;
}

/** Контейнер inset grouped list (тикет 09). */
export function InsetGroupedList({ title, children }: InsetGroupedListProps) {
  return (
    <>
      {title ? <div className="g-title">{title}</div> : null}
      <div className="group">{children}</div>
    </>
  );
}

interface RowProps {
  children: ReactNode;
  /** Показать шеврон «›» справа. */
  chevron?: boolean;
  onClick?: () => void;
}

/** Строка списка. Кнопка, если задан onClick — иначе обычный контейнер. */
export function Row({ children, chevron, onClick }: RowProps) {
  const content = (
    <>
      <div className="grow">{children}</div>
      {chevron ? <span className="chev">›</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="row" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="row">{content}</div>;
}
