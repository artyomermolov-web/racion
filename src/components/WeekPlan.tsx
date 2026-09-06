"use client";

// Экран недели (тикет 15): недельное среднее КБЖУ против диапазонов, честный
// показ компромисса (если в диапазоны не собрать), переключение дней, приёмы дня
// и перегенерация на трёх уровнях — неделя / день / приём (блюдо). План живёт в
// состоянии клиента; действия сервера возвращают свежий результат под норму.
// Изменение настроек план не трогает — перегенерация только по кнопке.

import { useState, useTransition } from "react";
import type { Slot } from "@/core/generator";
import type { DisplayWeek, MealRef } from "@/lib/generator";
import { MacroRings } from "@/components/MacroRings";
import { SLOT_LABELS, formatTime, label } from "@/lib/food-labels";
import {
  regenerateWeekAction,
  regenerateWeekDayAction,
  replaceWeekMealAction,
} from "@/app/actions/plan";

/** Случайный seed для «свежего» варианта (генерация детерминирована по seed). */
const freshSeed = () => Math.floor(Math.random() * 0x7fffffff);

/** Порция как «×1», «×0.5». */
const portionLabel = (p: number) => `×${p}`;

/** Форматирование числа с разбивкой разрядов. */
const fmt = (n: number) => n.toLocaleString("ru-RU");

/** Короткие подписи дней недели (в «тонком» слое даты старта нет). */
const DAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Строка недельного среднего одного нутриента против диапазона. */
function AvgRow({
  name,
  value,
  min,
  max,
  unit,
}: {
  name: string;
  value: number;
  min: number;
  max: number | null;
  unit: string;
}) {
  const inRange = value >= min && (max === null || value <= max);
  const range = max === null ? `от ${min}` : `${fmt(min)}–${fmt(max)}`;
  return (
    <div className="week-avg-row">
      <span className="ring-label">{name}</span>
      <span className="ring-val num">
        {fmt(value)}
        <span className="ring-target">
          {" "}
          / {range} {unit}
        </span>
        <span className={inRange ? "avg-ok" : "avg-warn"}>{inRange ? " ✓" : " ⚠"}</span>
      </span>
    </div>
  );
}

/** Ссылки на приёмы недели для сервера (КБЖУ пересчитываются на сервере). */
const weekRefs = (week: DisplayWeek): MealRef[][] =>
  week.days.map((d) =>
    d.meals.map((m) => ({ slot: m.slot, recipeId: m.recipeId, portion: m.portion })),
  );

export function WeekPlan({ initial }: { initial: DisplayWeek }) {
  const [week, setWeek] = useState<DisplayWeek>(initial);
  const [selected, setSelected] = useState(0);
  const [pending, startTransition] = useTransition();
  // Что именно перегенерируется сейчас: 'week' | 'day' | слот замены.
  const [busy, setBusy] = useState<"week" | "day" | Slot | null>(null);

  const day = week.days[selected] ?? week.days[0];
  const { ranges, dayTarget } = week;

  const regenerateWeek = () => {
    setBusy("week");
    startTransition(async () => {
      const fresh = await regenerateWeekAction(freshSeed());
      if (fresh) {
        setWeek(fresh);
        setSelected(0);
      }
      setBusy(null);
    });
  };

  const regenerateSelectedDay = () => {
    setBusy("day");
    startTransition(async () => {
      const fresh = await regenerateWeekDayAction(weekRefs(week), selected, freshSeed());
      if (fresh) setWeek(fresh);
      setBusy(null);
    });
  };

  const replace = (slot: Slot) => {
    setBusy(slot);
    startTransition(async () => {
      const fresh = await replaceWeekMealAction(weekRefs(week), selected, slot, freshSeed());
      if (fresh) setWeek(fresh);
      setBusy(null);
    });
  };

  return (
    <div className={pending ? "day is-busy" : "day"}>
      <div className="g-title">Среднее за день (за неделю)</div>

      {/* Недельное среднее против диапазонов + честный компромисс. */}
      <div className="group">
        <div className="week-avg">
          <div className="day-kcal">
            <div className="day-kcal-now num">{fmt(week.weeklyAverage.kcal)}</div>
            <div className="day-kcal-of num">
              из {fmt(ranges.kcalMin)}–{fmt(ranges.kcalMax)} ккал
            </div>
          </div>
          <div className="week-avg-rows">
            <AvgRow name="Белки" value={week.weeklyAverage.protein} min={ranges.proteinMin} max={ranges.proteinMax} unit="г" />
            <AvgRow name="Жиры" value={week.weeklyAverage.fat} min={ranges.fatMin} max={ranges.fatMax} unit="г" />
            <AvgRow name="Углеводы" value={week.weeklyAverage.carb} min={ranges.carbMin} max={ranges.carbMax} unit="г" />
            <AvgRow name="Клетчатка" value={week.weeklyAverage.fiber} min={ranges.fiberMin} max={null} unit="г" />
          </div>
        </div>
        {week.compromised ? (
          <div className="week-compromise">
            В идеальные диапазоны собрать не удалось — показываем ближайший
            вариант. Расширьте базу блюд или ослабьте ограничения, чтобы среднее
            попало точнее.
          </div>
        ) : (
          <div className="week-ok">Средние за неделю укладываются в диапазоны ✓</div>
        )}
      </div>

      {/* Переключатель дней. */}
      <div className="day-tabs" role="tablist" aria-label="Дни недели">
        {week.days.map((d, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === selected}
            className={i === selected ? "day-tab is-active" : "day-tab"}
            onClick={() => setSelected(i)}
            disabled={pending}
          >
            <span className="day-tab-name">{DAY_LABELS[i] ?? `Д${i + 1}`}</span>
            <span className="day-tab-kcal num">{fmt(d.totals.kcal)}</span>
          </button>
        ))}
      </div>

      {/* Сводка выбранного дня (день может отклоняться — важно среднее за неделю). */}
      <div className="group">
        <div className="day-summary">
          <div className="day-kcal">
            <div className="day-kcal-now num">{fmt(day.totals.kcal)}</div>
            <div className="day-kcal-of num">ккал за день</div>
          </div>
          <MacroRings totals={day.totals} target={dayTarget} />
        </div>
        <div className="day-fiber">
          <span className="ring-dot" style={{ background: "var(--fb)" }} />
          <span className="ring-label">Клетчатка</span>
          <span className="ring-val num">
            {day.totals.fiber}
            <span className="ring-target"> / от {dayTarget.fiber} г</span>
            {day.totals.fiber >= dayTarget.fiber ? <span className="fiber-ok"> ✓</span> : null}
          </span>
        </div>
      </div>
      <div className="week-note">
        Отдельные дни могут отклоняться от цели — генератор держит в диапазонах
        именно среднее за неделю.
      </div>

      {/* Приёмы выбранного дня. */}
      <div className="g-title">Приёмы</div>
      <div className="group">
        {day.meals.map((m) => (
          <div className="meal-row" key={m.slot}>
            <div className="meal-main">
              <div className="meal-slot">
                {label(SLOT_LABELS, m.slot)}
                {m.portion !== 1 ? (
                  <span className="meal-portion num"> · {portionLabel(m.portion)}</span>
                ) : null}
              </div>
              <div className="meal-name">{m.name}</div>
              <div className="meal-macros num">
                <b>{fmt(m.nutrients.kcal)}</b> ккал · Б {m.nutrients.protein} · Ж{" "}
                {m.nutrients.fat} · У {m.nutrients.carb} · Кл {m.nutrients.fiber} ·{" "}
                {formatTime(m.timeMin)}
              </div>
            </div>
            <button
              type="button"
              className="meal-replace"
              onClick={() => replace(m.slot)}
              disabled={pending}
              aria-label={`Заменить блюдо: ${label(SLOT_LABELS, m.slot)}`}
            >
              {busy === m.slot ? "…" : "Заменить"}
            </button>
          </div>
        ))}
      </div>

      <div className="week-actions">
        <button type="button" className="btn gray" onClick={regenerateSelectedDay} disabled={pending}>
          {busy === "day" ? "Собираем день…" : `Перегенерировать ${DAY_LABELS[selected] ?? "день"}`}
        </button>
        <button type="button" className="btn" onClick={regenerateWeek} disabled={pending}>
          {busy === "week" ? "Собираем неделю…" : "Перегенерировать неделю"}
        </button>
      </div>
    </div>
  );
}
