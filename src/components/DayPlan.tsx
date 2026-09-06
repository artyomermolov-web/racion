"use client";

// Экран дня (тикет 14): приёмы с блюдами и КБЖУ, кольца Б/Ж/У против цели,
// кнопки «перегенерировать день» и «заменить блюдо». План живёт в состоянии
// клиента; действия сервера возвращают свежий результат под норму. Изменение
// настроек план не трогает — перегенерация только по кнопке.

import { useState, useTransition } from "react";
import type { Slot } from "@/core/generator";
import { sumNutrients } from "@/core/generator";
import type { DisplayDay, MealRef } from "@/lib/generator";
import { MacroRings } from "@/components/MacroRings";
import { SLOT_LABELS, formatTime, label } from "@/lib/food-labels";
import { regenerateDayAction, replaceMealAction } from "@/app/actions/plan";

/** Случайный seed для «свежего» варианта (генерация детерминирована по seed). */
const freshSeed = () => Math.floor(Math.random() * 0x7fffffff);

/** Порция как «×1», «×0.5». */
const portionLabel = (p: number) => `×${p}`;

/** Форматирование ккал с разбивкой разрядов — как в NormCard. */
const fmt = (n: number) => n.toLocaleString("ru-RU");

export function DayPlan({ initial }: { initial: DisplayDay }) {
  const [day, setDay] = useState<DisplayDay>(initial);
  const [pending, startTransition] = useTransition();
  // Слот, чья замена сейчас выполняется (для точечного индикатора).
  const [replacing, setReplacing] = useState<Slot | null>(null);

  const regenerate = () => {
    startTransition(async () => {
      const fresh = await regenerateDayAction(freshSeed());
      if (fresh) setDay(fresh);
    });
  };

  const replace = (slot: Slot) => {
    setReplacing(slot);
    startTransition(async () => {
      const refs: MealRef[] = day.meals.map((m) => ({
        slot: m.slot,
        recipeId: m.recipeId,
        portion: m.portion,
      }));
      const next = await replaceMealAction(refs, slot, freshSeed());
      if (next) {
        const meals = day.meals.map((m) => (m.slot === slot ? next : m));
        setDay({ ...day, meals, totals: sumNutrients(meals) });
      }
      setReplacing(null);
    });
  };

  const kcalDelta = day.totals.kcal - day.target.kcal;
  const deltaLabel =
    kcalDelta === 0
      ? "точно в цель"
      : `${kcalDelta > 0 ? "+" : "−"}${fmt(Math.abs(kcalDelta))} ккал к цели`;

  return (
    <div className={pending ? "day is-busy" : "day"}>
      <div className="g-title">План на сегодня</div>

      {/* Сводка дня: калории + кольца Б/Ж/У против цели. */}
      <div className="group day-summary">
        <div className="day-kcal">
          <div className="day-kcal-now num">{fmt(day.totals.kcal)}</div>
          <div className="day-kcal-of num">из {fmt(day.target.kcal)} ккал</div>
          <div className="day-kcal-delta">{deltaLabel}</div>
        </div>
        <MacroRings totals={day.totals} target={day.target} />
      </div>

      {/* Приёмы пищи. */}
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
                {m.nutrients.fat} · У {m.nutrients.carb} · {formatTime(m.timeMin)}
              </div>
            </div>
            <button
              type="button"
              className="meal-replace"
              onClick={() => replace(m.slot)}
              disabled={pending}
              aria-label={`Заменить блюдо: ${label(SLOT_LABELS, m.slot)}`}
            >
              {replacing === m.slot ? "…" : "Заменить"}
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn"
        onClick={regenerate}
        disabled={pending}
      >
        {pending && replacing === null ? "Собираем день…" : "Перегенерировать день"}
      </button>
    </div>
  );
}
