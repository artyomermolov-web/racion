// Кольца Б/Ж/У против дневной цели (тикет 09/14, в духе «Активности» Apple).
// Презентационный компонент: три концентрических кольца (белки/жиры/углеводы),
// каждое заполнено на долю «съедено/цель», рядом — легенда с граммами и %.

import type { FoodNutrients } from "@/core/nutrition";
import type { DayTarget } from "@/core/generator";

interface RingSpec {
  key: string;
  label: string;
  actual: number;
  target: number;
  color: string;
  radius: number;
}

const SIZE = 120;
const CENTER = SIZE / 2;
const STROKE = 13;

function Ring({ spec }: { spec: RingSpec }) {
  const circ = 2 * Math.PI * spec.radius;
  const frac = spec.target > 0 ? Math.min(spec.actual / spec.target, 1) : 0;
  return (
    <>
      {/* Дорожка кольца (фон). */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={spec.radius}
        fill="none"
        stroke={spec.color}
        strokeOpacity={0.18}
        strokeWidth={STROKE}
      />
      {/* Заполнение — доля цели. */}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={spec.radius}
        fill="none"
        stroke={spec.color}
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${circ * frac} ${circ}`}
        transform={`rotate(-90 ${CENTER} ${CENTER})`}
      />
    </>
  );
}

export function MacroRings({
  totals,
  target,
}: {
  totals: FoodNutrients;
  target: DayTarget;
}) {
  const rings: RingSpec[] = [
    { key: "p", label: "Белки", actual: totals.protein, target: target.protein, color: "var(--p)", radius: 52 },
    { key: "f", label: "Жиры", actual: totals.fat, target: target.fat, color: "var(--f)", radius: 39 },
    { key: "c", label: "Углеводы", actual: totals.carb, target: target.carb, color: "var(--c)", radius: 26 },
  ];

  return (
    <div className="rings-wrap">
      <svg
        className="rings"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={rings
          .map((r) => `${r.label} ${r.actual} из ${r.target} г`)
          .join(", ")}
      >
        {rings.map((r) => (
          <Ring key={r.key} spec={r} />
        ))}
      </svg>
      <ul className="ring-legend">
        {rings.map((r) => {
          const pct = r.target > 0 ? Math.round((r.actual / r.target) * 100) : 0;
          return (
            <li key={r.key}>
              <span className="ring-dot" style={{ background: r.color }} />
              <span className="ring-label">{r.label}</span>
              <span className="ring-val num">
                {r.actual}
                <span className="ring-target"> / {r.target} г</span>
                <span className="ring-pct num"> · {pct}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
