// Карточка нормы: диапазон ккал + Б/Ж/У + клетчатка (тикеты 09, 12).
// Презентационный компонент — показывает сохранённые диапазоны как есть.

import type { EditableTargets } from "@/core/nutrition";

// Диапазоны для показа совпадают с редактируемыми (одна форма данных).
export type NormRanges = EditableTargets;

const fmt = (n: number) => n.toLocaleString("ru-RU");

export function NormCard({ norm }: { norm: NormRanges }) {
  const macros = [
    { label: "Белки", value: `${norm.proteinMin}–${norm.proteinMax}`, color: "var(--p)" },
    { label: "Жиры", value: `${norm.fatMin}–${norm.fatMax}`, color: "var(--f)" },
    { label: "Углеводы", value: `${norm.carbMin}–${norm.carbMax}`, color: "var(--c)" },
    // Клетчатка — это минимум (max нет), поэтому «от N».
    { label: "Клетчатка", value: `от ${norm.fiberMin}`, color: "var(--fb)" },
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
            <div className="v num">{m.value} г</div>
          </div>
        ))}
      </div>
    </div>
  );
}
