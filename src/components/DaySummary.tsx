// Сводка остатка дня (тикет 08): кольцо «осталось ккал» + бары Б/Ж/У + клетчатка,
// с подсветкой отстающего макроса. Презентационный компонент над DayProgress из
// ядра /core/diary — вся логика остатка/выбора макроса уже посчитана в ядре.

import type { DayProgress, Macro } from "@/core/diary";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

const MACRO_COLOR: Record<Macro, string> = {
  protein: "var(--p)",
  fat: "var(--f)",
  carb: "var(--c)",
};
const MACRO_LABEL: Record<Macro, string> = {
  protein: "Белки",
  fat: "Жиры",
  carb: "Углеводы",
};

const RING = 132;
const CENTER = RING / 2;
const STROKE = 12;
const RADIUS = CENTER - STROKE / 2;

/** Кольцо ккал: заполнено на долю «съедено/цель», в центре — остаток. */
function KcalRing({
  target,
  eaten,
  remaining,
}: {
  target: number;
  eaten: number;
  remaining: number;
}) {
  const circ = 2 * Math.PI * RADIUS;
  const frac = target > 0 ? Math.min(Math.max(eaten / target, 0), 1) : 0;
  const over = remaining < 0;
  return (
    <div className="kcal-ring">
      <svg viewBox={`0 0 ${RING} ${RING}`} role="img" aria-label={`Съедено ${fmt(eaten)} из ${fmt(target)} ккал`}>
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={over ? "var(--danger)" : "var(--tint)"}
          strokeOpacity={0.16}
          strokeWidth={STROKE}
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={over ? "var(--danger)" : "var(--tint)"}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${circ * frac} ${circ}`}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />
      </svg>
      <div className="kcal-ring-center">
        <div className={over ? "kcal-ring-num num over" : "kcal-ring-num num"}>
          {over ? `+${fmt(-remaining)}` : fmt(remaining)}
        </div>
        <div className="kcal-ring-label">{over ? "перебор, ккал" : "осталось, ккал"}</div>
      </div>
    </div>
  );
}

/** Бар одного макроса: заполнение «съедено/цель» + подсветка, если отстающий. */
function MacroBar({
  macro,
  eaten,
  target,
  lagging,
}: {
  macro: Macro;
  eaten: number;
  target: number;
  lagging: boolean;
}) {
  const pct = target > 0 ? Math.min(Math.max((eaten / target) * 100, 0), 100) : 0;
  return (
    <div className={lagging ? "macro-bar is-lagging" : "macro-bar"}>
      <div className="macro-bar-head">
        <span className="macro-dot" style={{ background: MACRO_COLOR[macro] }} />
        <span className="macro-name">{MACRO_LABEL[macro]}</span>
        {lagging ? <span className="macro-flag">добрать</span> : null}
        <span className="macro-val num">
          {fmt(eaten)}
          <span className="macro-target"> / {fmt(target)} г</span>
        </span>
      </div>
      <div className="macro-track">
        <div
          className="macro-fill"
          style={{ width: `${pct}%`, background: MACRO_COLOR[macro] }}
        />
      </div>
    </div>
  );
}

export function DaySummary({ progress }: { progress: DayProgress }) {
  const macros: Macro[] = ["protein", "fat", "carb"];
  const fiberMet = progress.fiber.remaining <= 0;
  return (
    <div className="group diary-summary">
      <div className="diary-summary-top">
        <KcalRing
          target={progress.kcal.target}
          eaten={progress.kcal.eaten}
          remaining={progress.kcal.remaining}
        />
        <div className="macro-bars">
          {macros.map((m) => (
            <MacroBar
              key={m}
              macro={m}
              eaten={progress[m].eaten}
              target={progress[m].target}
              lagging={progress.laggingMacro === m}
            />
          ))}
        </div>
      </div>
      <div className="day-fiber">
        <span className="ring-dot" style={{ background: "var(--fb)" }} />
        <span className="ring-label">Клетчатка</span>
        <span className="ring-val num">
          {fmt(progress.fiber.eaten)}
          <span className="ring-target"> / от {fmt(progress.fiber.target)} г</span>
          {fiberMet ? <span className="fiber-ok"> ✓</span> : null}
        </span>
      </div>
    </div>
  );
}
