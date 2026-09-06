import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: string;
  title: string;
  description: string;
  action?: ReactNode;
}

/** Осмысленное пустое состояние (тикет 09; пустой домашний экран в срезе 11). */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div style={{ marginTop: 20 }}>{action}</div> : null}
    </div>
  );
}
