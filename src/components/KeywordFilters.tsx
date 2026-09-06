"use client";

// Экран фильтров «не хочу есть» (тикет 16): пользователь добавляет термины
// (свободным вводом или чипом-группой), генератор жёстко отсекает блюда, чьи
// ключевые слова совпадают — с разворачиванием синонимов на сервере («курица» →
// грудка/бедро/…). Состояние — в БД; здесь оптимистичное отражение.

import { useState, useTransition } from "react";
import {
  addKeywordFilterAction,
  removeKeywordFilterAction,
} from "@/app/actions/preferences";

export function KeywordFilters({
  initialTerms,
  groups,
}: {
  initialTerms: string[];
  groups: string[];
}) {
  const [terms, setTerms] = useState<string[]>(initialTerms);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();

  const add = (raw: string) => {
    const term = raw.trim().toLowerCase();
    if (!term || terms.includes(term)) return;
    setTerms((t) => [...t, term].sort());
    startTransition(() => addKeywordFilterAction(term));
  };

  const remove = (term: string) => {
    setTerms((t) => t.filter((x) => x !== term));
    startTransition(() => removeKeywordFilterAction(term));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    add(input);
    setInput("");
  };

  // Группы, которые ещё не добавлены (по совпадению термина с названием группы).
  const availableGroups = groups.filter((g) => !terms.includes(g.toLowerCase()));

  return (
    <div className="kwf">
      <form className="kwf-add" onSubmit={submit}>
        <input
          className="input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Например: курица, грибы, лук"
          aria-label="Добавить продукт в фильтр «не хочу есть»"
          enterKeyHint="done"
        />
        <button type="submit" className="btn tinted kwf-add-btn" disabled={!input.trim()}>
          Добавить
        </button>
      </form>

      {terms.length > 0 ? (
        <div className="kwf-chips" aria-label="Активные фильтры">
          {terms.map((term) => (
            <button
              key={term}
              type="button"
              className="chip removable"
              onClick={() => remove(term)}
              disabled={pending}
              aria-label={`Убрать фильтр: ${term}`}
            >
              {term}
              <span aria-hidden="true"> ✕</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="kwf-empty">Фильтров нет — в план попадают любые блюда.</p>
      )}

      {availableGroups.length > 0 ? (
        <>
          <div className="kwf-sub">Быстро по группам</div>
          <div className="kwf-chips">
            {availableGroups.map((g) => (
              <button
                key={g}
                type="button"
                className="chip add"
                onClick={() => add(g.toLowerCase())}
                disabled={pending}
                aria-label={`Добавить группу в фильтр: ${g}`}
              >
                + {g}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
