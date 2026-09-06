// Карточка нормы: диапазон ккал + Б/Ж/У + клетчатка (тикеты 09, 12).
// Презентационный компонент — показывает сохранённые диапазоны как есть.

import type { EditableTargets } from "@/core/nutrition";

// Диапазоны для показа совпадают с редактируемыми (одна форма данных).
export type NormRanges = EditableTargets;

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function NormCard({ norm }: { norm: NormRanges }) {
  const macros = [
    { label: "Белки", min: norm.proteinMin, max: norm.proteinMax, color: "var(--p)" },
    { label: "Жиры", min: norm.fatMin, max: norm.fatMax, color: "var(--f)" },
    { label: "Углеводы", min: norm.carbMin, max: norm.carbMax, color: "var(--c)" },
  ];

  return (
    <div className="group">
      <div className="norm-head">
        <div className="norm-kcal num">
          {fmt(norm.kcalMin)}–{fmt(norm.kcalMax)}
        </div>
        <div className="norm-kcal-unit">ккал в день</div>
      </div>
      <div className="norm-macros">
        {macros.map((m) => (
          <div className="norm-macro" key={m.label}>
            <span className="norm-dot" style={{ background: m.color }} />
            <div className="l">{m.label}</div>
            <div className="v num">
              {m.min}–{m.max} г
            </div>
          </div>
        ))}
      </div>
      <div className="norm-fiber">
        Клетчатка — не меньше <span className="num">{norm.fiberMin} г</span>
      </div>
    </div>
  );
}
