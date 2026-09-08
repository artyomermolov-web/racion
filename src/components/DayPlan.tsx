"use client";

// Экран дня (тикеты 14, 20): приёмы с блюдами и КБЖУ, кольца Б/Ж/У против цели.
// Трекинг (тикет 20): отметка «съел» списывает кладовку по факту (списание — на
// сервере, идемпотентно по ключу приёма), снятие возвращает списанное; несъеденное
// можно удалить, съеденное — добавить из поиска; кнопка пересобирает ОСТАТОК дня
// под остаточные цели, оставляя съеденное нетронутым.
//
// План живёт в состоянии клиента (не персистится), поэтому ключ приёма выводится
// из его содержимого (mealKey) — тогда после перезагрузки отметки восстанавливаются
// по применённым списаниям, а повторная отметка не вычитает кладовку дважды.

import { useMemo, useState, useTransition } from "react";
import type { Slot } from "@/core/generator";
import { sumNutrients, scalePortion } from "@/core/generator";
import type { FoodNutrients } from "@/core/nutrition";
import type { DisplayDay } from "@/lib/generator";
import type { FoodSearchResult } from "@/lib/track";
import { mealKey } from "@/lib/mealKey";
import { MacroRings } from "@/components/MacroRings";
import { SLOT_LABELS, formatTime, label } from "@/lib/food-labels";
import { replaceMealAction } from "@/app/actions/plan";
import {
  markEatenAction,
  unmarkEatenAction,
  regenerateRemainderAction,
  searchFoodAction,
} from "@/app/actions/track";

/** Случайный seed для «свежего» варианта (генерация детерминирована по seed). */
const freshSeed = () => Math.floor(Math.random() * 0x7fffffff);

/** Уведомление, когда кладовки не хватило: списываем «по факту», сколько было дома. */
const SHORTFALL_NOTICE = "Кладовки хватило не на всё — списали, что было дома.";

/** Порция как «×1», «×0.5». */
const portionLabel = (p: number) => `×${p}`;

/** Форматирование ккал с разбивкой разрядов — как в NormCard. */
const fmt = (n: number) => n.toLocaleString("ru-RU");

/** Приём дня в состоянии клиента: показ + трекинг (ключ, съеден, вне раскладки). */
interface DayMealItem {
  key: string;
  slot: Slot;
  recipeId: string;
  name: string;
  timeMin: number;
  portion: number;
  nutrients: FoodNutrients;
  eaten: boolean;
  /** Добавлен из поиска (вне раскладки) — всегда съеден, не участвует в замене. */
  extra: boolean;
}

/** Приём вне раскладки идёт в конце — единый порядок для показа и ключей. */
const EXTRA_ORDER = 99;
const SLOT_ORDER: Record<Slot, number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
const order = (m: { slot: Slot; extra: boolean }) => (m.extra ? EXTRA_ORDER : SLOT_ORDER[m.slot]);

export function DayPlan({
  initial,
  dateKey,
  eatenKeys,
}: {
  initial: DisplayDay;
  dateKey: string;
  eatenKeys: string[];
}) {
  const applied = useMemo(() => new Set(eatenKeys), [eatenKeys]);

  // Начальные приёмы раскладки: ключ из содержимого, отметка — из применённых списаний.
  const [meals, setMeals] = useState<DayMealItem[]>(() =>
    initial.meals.map((m) => {
      const key = mealKey(dateKey, m.slot, m.recipeId, m.portion);
      return { ...m, key, eaten: applied.has(key), extra: false };
    }),
  );
  const [target] = useState(initial.target);
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const totals = useMemo(() => sumNutrients(meals), [meals]);
  const anyEaten = meals.some((m) => m.eaten);
  const sorted = useMemo(
    () => [...meals].sort((a, b) => order(a) - order(b)),
    [meals],
  );

  const kcalDelta = totals.kcal - target.kcal;
  const deltaLabel =
    kcalDelta === 0
      ? "точно в цель"
      : `${kcalDelta > 0 ? "+" : "−"}${fmt(Math.abs(kcalDelta))} ккал к цели`;

  /** Ключ для нового приёма с учётом дублей слот+рецепт+порция (occurrence). */
  const keyFor = (slot: Slot, recipeId: string, portion: number): string => {
    const occ = meals.filter(
      (m) => m.slot === slot && m.recipeId === recipeId && m.portion === portion,
    ).length;
    return mealKey(dateKey, slot, recipeId, portion, occ);
  };

  /** Отметить/снять «съел»: списание/возврат кладовки на сервере. */
  const toggleEaten = (meal: DayMealItem) => {
    setNotice(null);
    setBusyKey(meal.key);
    startTransition(async () => {
      if (!meal.eaten) {
        const res = await markEatenAction({
          key: meal.key,
          recipeId: meal.recipeId,
          portion: meal.portion,
        });
        if (res.eaten) {
          setMeals((ms) => ms.map((m) => (m.key === meal.key ? { ...m, eaten: true } : m)));
          if (Object.keys(res.shortfall).length > 0) {
            setNotice(SHORTFALL_NOTICE);
          }
        }
      } else {
        await unmarkEatenAction(meal.key);
        // Приёмы вне раскладки при снятии отметки убираем (это лог съеденного).
        setMeals((ms) =>
          meal.extra
            ? ms.filter((m) => m.key !== meal.key)
            : ms.map((m) => (m.key === meal.key ? { ...m, eaten: false } : m)),
        );
      }
      setBusyKey(null);
    });
  };

  /** Удалить несъеденный приём из плана (только состояние клиента). */
  const remove = (meal: DayMealItem) => {
    if (meal.eaten) return;
    setMeals((ms) => ms.filter((m) => m.key !== meal.key));
  };

  /** Заменить блюдо в приёме под остаток дня (несъеденные приёмы раскладки). */
  const replace = (meal: DayMealItem) => {
    setBusyKey(meal.key);
    startTransition(async () => {
      const refs = meals
        .filter((m) => !m.extra)
        .map((m) => ({ slot: m.slot, recipeId: m.recipeId, portion: m.portion }));
      const next = await replaceMealAction(refs, meal.slot, freshSeed());
      if (next) {
        const key = mealKey(dateKey, next.slot, next.recipeId, next.portion);
        setMeals((ms) =>
          ms.map((m) =>
            m.key === meal.key ? { ...next, key, eaten: false, extra: false } : m,
          ),
        );
      }
      setBusyKey(null);
    });
  };

  /** Перегенерировать остаток дня: съеденное фиксируем, несъеденное — свежее. */
  const regenerate = () => {
    setNotice(null);
    setRegenerating(true);
    startTransition(async () => {
      const layout = meals
        .filter((m) => !m.extra)
        .map((m) => ({ slot: m.slot, recipeId: m.recipeId, portion: m.portion, eaten: m.eaten }));
      const extras = meals
        .filter((m) => m.extra)
        .map((m) => ({ recipeId: m.recipeId, portion: m.portion }));
      const fresh = await regenerateRemainderAction(layout, extras, freshSeed());
      if (fresh) {
        setMeals((ms) => {
          const keptExtras = ms.filter((m) => m.extra);
          const relaid: DayMealItem[] = fresh.meals.map((m) => {
            const eatenBefore = ms.find(
              (x) => !x.extra && x.slot === m.slot && x.eaten,
            );
            const key = mealKey(dateKey, m.slot, m.recipeId, m.portion);
            return { ...m, key, eaten: Boolean(eatenBefore), extra: false };
          });
          return [...relaid, ...keptExtras];
        });
      }
      setRegenerating(false);
    });
  };

  /** Добавить съеденное из поиска: приём вне раскладки, сразу списываем кладовку. */
  const addEaten = (r: FoodSearchResult) => {
    const slot: Slot = r.slots[0] ?? "snack";
    const portion = 1;
    const key = keyFor(slot, r.recipeId, portion);
    const meal: DayMealItem = {
      key,
      slot,
      recipeId: r.recipeId,
      name: r.name,
      timeMin: r.timeMin,
      portion,
      nutrients: scalePortion(r.perServing, portion),
      eaten: true,
      extra: true,
    };
    setMeals((ms) => [...ms, meal]);
    setNotice(null);
    setBusyKey(key);
    startTransition(async () => {
      const res = await markEatenAction({ key, recipeId: r.recipeId, portion });
      if (res.eaten && Object.keys(res.shortfall).length > 0) {
        setNotice(SHORTFALL_NOTICE);
      }
      setBusyKey(null);
    });
  };

  return (
    <div className={pending ? "day is-busy" : "day"}>
      <div className="g-title">План на сегодня</div>

      {/* Сводка дня: калории + кольца Б/Ж/У против цели + клетчатка (минимум). */}
      <div className="group">
        <div className="day-summary">
          <div className="day-kcal">
            <div className="day-kcal-now num">{fmt(totals.kcal)}</div>
            <div className="day-kcal-of num">из {fmt(target.kcal)} ккал</div>
            <div className="day-kcal-delta">{deltaLabel}</div>
          </div>
          <MacroRings totals={totals} target={target} />
        </div>
        <div className="day-fiber">
          <span className="ring-dot" style={{ background: "var(--fb)" }} />
          <span className="ring-label">Клетчатка</span>
          <span className="ring-val num">
            {totals.fiber}
            <span className="ring-target"> / от {target.fiber} г</span>
            {totals.fiber >= target.fiber ? <span className="fiber-ok"> ✓</span> : null}
          </span>
        </div>
      </div>

      {/* Приёмы пищи. */}
      <div className="g-title">Приёмы</div>
      <div className="group">
        {sorted.length === 0 ? (
          <div className="meal-row">
            <div className="meal-main">
              <div className="meal-name">Приёмов нет — добавьте съеденное или перегенерируйте день.</div>
            </div>
          </div>
        ) : (
          sorted.map((m) => (
            <div className={m.eaten ? "meal-row is-eaten" : "meal-row"} key={m.key}>
              <button
                type="button"
                className={m.eaten ? "meal-check is-on" : "meal-check"}
                onClick={() => toggleEaten(m)}
                disabled={pending}
                aria-pressed={m.eaten}
                aria-label={m.eaten ? "Снять отметку «съел»" : "Отметить «съел»"}
              >
                {busyKey === m.key ? "…" : m.eaten ? "✓" : ""}
              </button>
              <div className="meal-main">
                <div className="meal-slot">
                  {label(SLOT_LABELS, m.slot)}
                  {m.extra ? <span className="meal-portion"> · добавлено</span> : null}
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
              {!m.eaten && !m.extra ? (
                <button
                  type="button"
                  className="meal-replace"
                  onClick={() => replace(m)}
                  disabled={pending}
                  aria-label={`Заменить блюдо: ${label(SLOT_LABELS, m.slot)}`}
                >
                  {busyKey === m.key ? "…" : "Заменить"}
                </button>
              ) : null}
              {!m.eaten ? (
                <button
                  type="button"
                  className="meal-del"
                  onClick={() => remove(m)}
                  disabled={pending}
                  aria-label={`Удалить приём: ${m.name}`}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))
        )}
      </div>

      {notice ? <div className="day-notice">{notice}</div> : null}

      <AddEaten onAdd={addEaten} disabled={pending} />

      <button type="button" className="btn" onClick={regenerate} disabled={pending}>
        {regenerating
          ? "Собираем…"
          : anyEaten
            ? "Перегенерировать остаток дня"
            : "Перегенерировать день"}
      </button>
    </div>
  );
}

/** Поиск и добавление съеденного блюда из базы (тикет 20). */
function AddEaten({
  onAdd,
  disabled,
}: {
  onAdd: (r: FoodSearchResult) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searching, startSearch] = useTransition();

  const search = (q: string) => {
    setQuery(q);
    if (q.trim().length === 0) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      setResults(await searchFoodAction(q));
    });
  };

  if (!open) {
    return (
      <button type="button" className="btn gray" onClick={() => setOpen(true)} disabled={disabled}>
        Добавить съеденное
      </button>
    );
  }

  return (
    <div className="add-eaten group">
      <input
        className="add-eaten-input"
        type="search"
        inputMode="search"
        placeholder="Найти блюдо…"
        value={query}
        onChange={(e) => search(e.target.value)}
        aria-label="Поиск блюда для лога съеденного"
        autoFocus
      />
      {searching ? <div className="add-eaten-hint">Ищем…</div> : null}
      {!searching && query.trim().length > 0 && results.length === 0 ? (
        <div className="add-eaten-hint">Ничего не найдено.</div>
      ) : null}
      {results.map((r) => (
        <button
          key={r.recipeId}
          type="button"
          className="add-eaten-row"
          onClick={() => {
            onAdd(r);
            setOpen(false);
            setQuery("");
            setResults([]);
          }}
          disabled={disabled}
        >
          <span className="add-eaten-name">{r.name}</span>
          <span className="add-eaten-kcal num">{fmt(r.perServing.kcal)} ккал</span>
        </button>
      ))}
    </div>
  );
}
