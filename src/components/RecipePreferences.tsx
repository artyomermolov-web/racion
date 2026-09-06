"use client";

// Действия предпочтений с карточки блюда (тикет 16): избранное, блок, recurring
// (часто/всегда). Состояние живёт на сервере (БД); действия возвращают свежее
// состояние, которым обновляем UI. Избранное/recurring и блок взаимоисключающи —
// сервер это гарантирует, клиент лишь отражает результат.

import { useState, useTransition } from "react";
import type { RecipePreferenceState, RecurringFrequency } from "@/lib/preferences";
import {
  toggleFavoriteAction,
  toggleBlockAction,
  setRecurringAction,
} from "@/app/actions/preferences";

export function RecipePreferences({
  recipeId,
  initial,
}: {
  recipeId: string;
  initial: RecipePreferenceState;
}) {
  const [state, setState] = useState<RecipePreferenceState>(initial);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<RecipePreferenceState>) =>
    startTransition(async () => setState(await fn()));

  const setRecurring = (freq: RecurringFrequency) =>
    run(() => setRecurringAction(recipeId, freq));

  return (
    <div className={pending ? "prefs is-busy" : "prefs"}>
      <div className="prefs-row">
        <button
          type="button"
          className={state.favorite ? "pref-btn on fav" : "pref-btn"}
          aria-pressed={state.favorite}
          disabled={pending}
          onClick={() => run(() => toggleFavoriteAction(recipeId))}
        >
          <span aria-hidden="true">{state.favorite ? "★" : "☆"}</span>
          {state.favorite ? "В избранном" : "В избранное"}
        </button>
        <button
          type="button"
          className={state.blocked ? "pref-btn on block" : "pref-btn"}
          aria-pressed={state.blocked}
          disabled={pending}
          onClick={() => run(() => toggleBlockAction(recipeId))}
        >
          <span aria-hidden="true">⊘</span>
          {state.blocked ? "Заблокировано" : "Не предлагать"}
        </button>
      </div>

      <div className="prefs-recurring">
        <span className="prefs-label">Регулярно</span>
        <div className="seg" role="tablist" aria-label="Как часто предлагать блюдо">
          <button
            role="tab"
            aria-selected={state.recurring === null}
            disabled={pending || state.blocked}
            onClick={() => run(() => setRecurringAction(recipeId, null))}
          >
            Нет
          </button>
          <button
            role="tab"
            aria-selected={state.recurring === "often"}
            disabled={pending || state.blocked}
            onClick={() => setRecurring("often")}
          >
            Часто
          </button>
          <button
            role="tab"
            aria-selected={state.recurring === "always"}
            disabled={pending || state.blocked}
            onClick={() => setRecurring("always")}
          >
            Всегда
          </button>
        </div>
      </div>
      <p className="prefs-hint">
        {state.blocked
          ? "Блюдо не попадёт в план."
          : state.recurring === "always"
            ? "Будет в плане каждый день."
            : state.recurring === "often"
              ? "Будет попадать в план чаще."
              : state.favorite
                ? "Предлагается чаще обычного."
                : "Настройте, как часто предлагать это блюдо."}
      </p>
    </div>
  );
}
