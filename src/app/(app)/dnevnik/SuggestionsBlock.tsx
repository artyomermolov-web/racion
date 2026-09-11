"use client";

// Блок «Что поесть сейчас» (тикет 10) — килфича дневника под сводкой остатка.
// 2–3 конкретных варианта закрывают остаток КБЖУ с приоритетом на отстающий
// макрос; чипсы быстро/готовить/не готовить фильтруют по времени и технике; тап
// «съел» логирует вариант в один тап (идемпотентно на сервере) и двигает остаток;
// «показать рецепт» открывает карточку; вторичная «пересобрать остаток дня» даёт
// свежий набор приёмов под остаток. Повторный тап не дублирует (guard на сервере),
// удаление залогированной подсказки возвращает её в блок (остаток пересчитан).
//
// Данные тянет тонкий server action; блок перезапрашивается при смене дня, фильтра
// или после любой мутации дня (refreshToken меняется вслед за остатком).

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { SuggestedMeal } from "@/core/diary";
import type { DayMeal } from "@/lib/generator";
import type { DayLogResult, EffortFilter, SuggestionBlock } from "@/lib/diary";
import { formatTime } from "@/lib/food-labels";
import {
  getSuggestionsAction,
  logSuggestionAction,
  regenerateRemainderAction,
} from "@/app/actions/diary";

/** Случайный seed для «свежего» варианта остатка (генерация детерминирована по seed). */
const freshSeed = () => Math.floor(Math.random() * 0x7fffffff);

const fmt = (n: number) => n.toLocaleString("ru-RU");

const EFFORTS: { key: EffortFilter; label: string }[] = [
  { key: "quick", label: "Быстро" },
  { key: "cook", label: "Готовить" },
  { key: "nocook", label: "Не готовить" },
];

export function SuggestionsBlock({
  date,
  refreshToken,
  onDayResult,
}: {
  date: string;
  /** Меняется при любой мутации дня — триггер перезапроса блока. */
  refreshToken: string;
  /** Лифт обновлённого дня в родителя (после лога подсказки остаток двигается). */
  onDayResult: (r: DayLogResult) => void;
}) {
  const [effort, setEffort] = useState<EffortFilter>("cook");
  const [block, setBlock] = useState<SuggestionBlock | null>(null);
  const [loading, setLoading] = useState(true);
  const [remainder, setRemainder] = useState<DayMeal[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regenPending, setRegenPending] = useState(false);
  const [pending, startTransition] = useTransition();
  const reqId = useRef(0);

  // Перезапрос блока при смене дня/фильтра/остатка. Гонку гасим по reqId.
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    getSuggestionsAction(date, effort).then((res) => {
      if (id === reqId.current) {
        setBlock(res);
        setLoading(false);
      }
    });
  }, [date, effort, refreshToken]);

  /** Лог подсказки/варианта в один тап: двигаем остаток через onDayResult. */
  const log = (slot: SuggestionBlock["slot"], meal: SuggestedMeal | DayMeal) => {
    if (pending) return;
    setBusyId(meal.recipeId);
    startTransition(async () => {
      const res = await logSuggestionAction({
        date,
        slot,
        recipeId: meal.recipeId,
        portion: meal.portion,
        effort,
      });
      // Обновлённый день двигает остаток; refreshToken сменится и блок обновится.
      onDayResult(res.day);
      // Вариант остатка, если был показан, убираем после лога (он ушёл в дневник).
      setRemainder((r) => r?.filter((m) => m.recipeId !== meal.recipeId) ?? null);
      setBusyId(null);
    });
  };

  /** Пересобрать остаток дня: свежий набор приёмов под текущий остаток. */
  const regenerate = () => {
    setRegenPending(true);
    startTransition(async () => {
      const fresh = await regenerateRemainderAction(date, freshSeed());
      setRemainder(fresh?.meals ?? []);
      setRegenPending(false);
    });
  };

  const meals = block?.meals ?? [];

  return (
    <section className={pending ? "suggest is-busy" : "suggest"}>
      <div className="g-title">Что поесть сейчас</div>

      <div className="suggest-chips" role="group" aria-label="Фильтр усилий">
        {EFFORTS.map((e) => (
          <button
            key={e.key}
            type="button"
            className="chip add"
            aria-pressed={effort === e.key}
            onClick={() => setEffort(e.key)}
            disabled={pending}
          >
            {e.label}
          </button>
        ))}
      </div>

      {loading && !block ? (
        <div className="suggest-loading">Подбираем варианты…</div>
      ) : meals.length === 0 ? (
        <div className="suggest-empty">
          Под этот фильтр варианта не нашлось. Смените чипсы усилий или пересоберите
          остаток дня.
        </div>
      ) : (
        <div className="suggest-cards">
          {meals.map((m) => (
            <SuggestCard
              key={m.recipeId}
              meal={m}
              busy={busyId === m.recipeId}
              disabled={pending}
              onEat={() => log(block!.slot, m)}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        className="btn gray suggest-regen"
        onClick={regenerate}
        disabled={pending}
      >
        {regenPending ? "Собираем…" : "Пересобрать остаток дня"}
      </button>

      {remainder && remainder.length > 0 && (
        <div className="suggest-remainder">
          <div className="g-title">Вариант на остаток дня</div>
          <div className="suggest-cards">
            {remainder.map((m) => (
              <SuggestCard
                key={`${m.slot}-${m.recipeId}`}
                meal={m}
                busy={busyId === m.recipeId}
                disabled={pending}
                onEat={() => log(m.slot, m)}
              />
            ))}
          </div>
        </div>
      )}
      {remainder && remainder.length === 0 && !regenPending && (
        <div className="suggest-empty">
          Не удалось собрать остаток из базы — проверьте, что база наполнена.
        </div>
      )}
    </section>
  );
}

/** Карточка варианта: КБЖУ + время + честная пометка, «съел» и «показать рецепт». */
function SuggestCard({
  meal,
  busy,
  disabled,
  onEat,
}: {
  meal: SuggestedMeal | DayMeal;
  busy: boolean;
  disabled: boolean;
  onEat: () => void;
}) {
  const n = meal.nutrients;
  const note = "note" in meal ? meal.note : undefined;
  return (
    <div className="group suggest-card">
      <div className="suggest-card-head">
        <div className="suggest-card-name">{meal.name}</div>
        {meal.portion !== 1 ? (
          <span className="suggest-card-portion num">×{meal.portion}</span>
        ) : null}
      </div>
      <div className="suggest-card-macros num">
        <b>{fmt(n.kcal)}</b> ккал · Б {n.protein} · Ж {n.fat} · У {n.carb} · Кл{" "}
        {n.fiber} · {formatTime(meal.timeMin)}
      </div>
      {note ? <div className="suggest-card-note">{note}</div> : null}
      <div className="suggest-card-actions">
        <button
          type="button"
          className="btn tinted suggest-eat"
          onClick={onEat}
          disabled={disabled}
        >
          {busy ? "…" : "Съел"}
        </button>
        <Link
          href={`/baza/recept/${meal.recipeId}`}
          className="btn gray suggest-recipe"
        >
          Показать рецепт
        </Link>
      </div>
    </div>
  );
}
