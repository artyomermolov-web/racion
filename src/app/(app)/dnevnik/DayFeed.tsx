"use client";

// Единая лента дня (тикет 09): сливает предложенные приёмы сгенерированного плана
// и залогированные записи `DiaryEntry` в один таймлайн со статусами приёма
// (suggested / eaten / extra) и подытогами по слотам. Проекция на лету (план не
// персистится) — сборка чистой `assembleDayFeed` из /core/diary (тикет 08).
//
// Два «съел» ортогональны, но триггерятся одним тапом (spec решение 01): тап «съел»
// по предложенному приёму одной серверной операцией создаёт `DiaryEntry` (двигает
// остаток дня) и списывает кладовку; снятие обратимо. Заменить / Удалить /
// Перегенерировать остаток работают над предложенными приёмами (состояние клиента,
// как на /home) и не трогают съеденное. Продукт (не рецепт): «съел» без списания
// кладовки, «заменить» у него нет. Действия пока текстовые (иконки — тикет 11).
//
// План держим в состоянии клиента и грузим детерминированным по дате экшеном
// (`getDayPlanAction`) — перезагрузка даёт тот же план, связка «предложение ↔
// запись» (suggestedRecipeId) не рвётся. Записи (`day`) приходят из родителя и
// обновляются после «съел»/«снять»; лента пересобирается на каждый рендер.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { SwipeRow } from "@/components/ios/SwipeRow";
import { SLOT_LABELS, label, formatAmount, formatTime } from "@/lib/food-labels";
import {
  getDayPlanAction,
  eatPlanMealAction,
  uneatPlanMealAction,
  deleteEntryAction,
} from "@/app/actions/diary";
import { replaceMealAction } from "@/app/actions/plan";
import { regenerateRemainderAction as regeneratePlanRemainderAction } from "@/app/actions/track";
import type { DayLogResult } from "@/lib/diary";
import type { DayMeal, MealRef, LayoutMealRef, ExtraMealRef } from "@/lib/generator";
import type { IngredientRow, RecipeRow } from "@/lib/food";
import {
  assembleDayFeed,
  type DiaryEntry,
  type DayFeedItem,
  type PlanMeal,
} from "@/core/diary";
import { mealKey } from "@/lib/mealKey";

/** Случайный seed для «свежего» варианта (генерация детерминирована по seed). */
const freshSeed = () => Math.floor(Math.random() * 0x7fffffff);

/** Уведомление, когда кладовки не хватило: списали «по факту», сколько было дома. */
const SHORTFALL_NOTICE = "Кладовки хватило не на всё — списали, что было дома.";

const fmt = (n: number) => n.toLocaleString("ru-RU");

/** КБЖУ приёма плана (6 нутриентов) → 5 отслеживаемых дневником (натрий не трогаем). */
function toPlanMeal(m: DayMeal): PlanMeal {
  return {
    slot: m.slot,
    recipeId: m.recipeId,
    portion: m.portion,
    nutrients: {
      kcal: m.nutrients.kcal,
      protein: m.nutrients.protein,
      fat: m.nutrients.fat,
      carb: m.nutrients.carb,
      fiber: m.nutrients.fiber,
    },
  };
}

export function DayFeed({
  date,
  day,
  ingredients,
  recipes,
  onAdd,
  onEdit,
  onDayResult,
}: {
  date: string;
  day: DayLogResult;
  ingredients: IngredientRow[];
  recipes: RecipeRow[];
  onAdd: (slot: DayMeal["slot"]) => void;
  onEdit: (entry: DiaryEntry) => void;
  onDayResult: (r: DayLogResult) => void;
}) {
  // Предложенный план дня: состояние клиента. Грузим один раз на дату (компонент
  // монтируется с key=date у родителя, поэтому смена дня = свежий монтаж и загрузка).
  const [plan, setPlan] = useState<DayMeal[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    getDayPlanAction(date)
      .then((res) => {
        if (id === reqId.current) setPlan(res?.meals ?? []);
      })
      // План опционален — при ошибке лента показывает только записи (план пуст).
      .catch(() => {
        if (id === reqId.current) setPlan([]);
      });
  }, [date]);

  // Имя и единица еды записи резолвятся из базы (снапшот хранит только refId).
  const ingName = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  );
  const recName = useMemo(
    () => new Map(recipes.map((r) => [r.id, r.name])),
    [recipes],
  );
  const foodName = (e: DiaryEntry) =>
    e.source === "recipe"
      ? (recName.get(e.refId) ?? "Рецепт")
      : (ingName.get(e.refId)?.name ?? "Продукт");
  const foodUnit = (e: DiaryEntry) => ingName.get(e.refId)?.unit ?? "g";

  // Приём плана по (слот|рецепт) — для source/названия/времени позиций ленты.
  const planByKey = useMemo(() => {
    const m = new Map<string, DayMeal>();
    for (const meal of plan ?? []) m.set(`${meal.slot}|${meal.recipeId}`, meal);
    return m;
  }, [plan]);

  const feed = useMemo(
    () => assembleDayFeed((plan ?? []).map(toPlanMeal), day.entries),
    [plan, day.entries],
  );

  /** Ключ приёма для идемпотентного списания кладовки (как в DayPlan на /home). */
  const keyFor = (meal: { slot: DayMeal["slot"]; recipeId: string; portion: number }) =>
    mealKey(date, meal.slot, meal.recipeId, meal.portion);

  /** Тап «съел» по предложенному приёму: запись + списание кладовки одной операцией. */
  const eat = (meal: DayMeal) => {
    if (pending) return;
    const key = keyFor(meal);
    setBusyKey(key);
    setNotice(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await eatPlanMealAction({
          date,
          slot: meal.slot,
          source: meal.source,
          refId: meal.recipeId,
          portion: meal.portion,
          mealKey: key,
        });
        onDayResult(res.day);
        if (res.shortfall) setNotice(SHORTFALL_NOTICE);
      } catch {
        setError("Не удалось отметить «съел». Попробуйте ещё раз.");
      } finally {
        setBusyKey(null);
      }
    });
  };

  /** Снять «съел» по приёму: удалить запись + вернуть списанную кладовку. */
  const uneat = (item: DayFeedItem) => {
    if (pending || !item.suggestion || !item.entry) return;
    const key = keyFor(item.suggestion);
    setBusyKey(key);
    setNotice(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await uneatPlanMealAction({
          date,
          slot: item.slot,
          suggestedRecipeId: item.suggestion!.recipeId,
          mealKey: key,
          source: item.entry!.source,
        });
        onDayResult(res);
      } catch {
        setError("Не удалось снять отметку. Попробуйте ещё раз.");
      } finally {
        setBusyKey(null);
      }
    });
  };

  /** Заменить предложенное блюдо под остаток дня (прочие приёмы учитываются). */
  const replace = (meal: DayMeal) => {
    if (pending) return;
    const key = keyFor(meal);
    setBusyKey(key);
    setError(null);
    startTransition(async () => {
      try {
        const refs: MealRef[] = (plan ?? []).map((m) => ({
          slot: m.slot,
          recipeId: m.recipeId,
          portion: m.portion,
        }));
        const next = await replaceMealAction(refs, meal.slot, freshSeed());
        if (next) {
          setPlan((p) =>
            (p ?? []).map((m) =>
              m.slot === meal.slot && m.recipeId === meal.recipeId ? next : m,
            ),
          );
        }
      } catch {
        setError("Не удалось заменить блюдо. Попробуйте ещё раз.");
      } finally {
        setBusyKey(null);
      }
    });
  };

  /** Удалить предложенный приём (только состояние клиента — съеденное не трогаем). */
  const removeSuggested = (meal: DayMeal) => {
    setPlan((p) =>
      (p ?? []).filter(
        (m) => !(m.slot === meal.slot && m.recipeId === meal.recipeId),
      ),
    );
  };

  /** Удалить запись вне плана (ручной лог). */
  const deleteEntry = (id: string) => {
    setError(null);
    startTransition(async () => {
      try {
        onDayResult(await deleteEntryAction(id));
      } catch {
        setError("Не удалось удалить запись. Попробуйте ещё раз.");
      }
    });
  };

  /**
   * Перегенерировать остаток дня: съеденные приёмы плана фиксируются (их слоты
   * залочены, статус `eaten` сохраняется), прочие — свежие под остаток. Съеденное
   * вне плана входит в остаток как потреблённое (baseline) и не повторяется.
   * Переиспользует существующий `regenerateRemainderAction` (/home, тикет 20).
   */
  const regenerate = () => {
    if (pending) return;
    // Слоты с уже съеденным приёмом плана — их фиксируем.
    const eatenSlots = new Set(
      feed.perSlot.flatMap((s) =>
        s.items
          .filter((it) => it.status === "eaten" && it.suggestion)
          .map((it) => `${it.slot}|${it.suggestion!.recipeId}`),
      ),
    );
    const layout: LayoutMealRef[] = (plan ?? []).map((m) => ({
      slot: m.slot,
      recipeId: m.recipeId,
      portion: m.portion,
      eaten: eatenSlots.has(`${m.slot}|${m.recipeId}`),
    }));
    // Съеденное вне плана (extra-рецепты) → baseline остатка; продукты ядро пересобрать
    // не умеет, они опускаются (та же граница, что у плана на /home).
    const extras: ExtraMealRef[] = feed.perSlot.flatMap((s) =>
      s.items
        .filter(
          (it) => it.status === "extra" && it.entry?.source === "recipe",
        )
        .map((it) => ({
          recipeId: it.entry!.refId,
          portion: it.entry!.servings ?? 1,
        })),
    );

    setNotice(null);
    setError(null);
    setRegenerating(true);
    startTransition(async () => {
      try {
        const fresh = await regeneratePlanRemainderAction(layout, extras, freshSeed());
        if (fresh) setPlan(fresh.meals);
      } catch {
        setError("Не удалось пересобрать остаток. Попробуйте ещё раз.");
      } finally {
        setRegenerating(false);
      }
    });
  };

  return (
    <div className={pending ? "diary-feed is-busy" : "diary-feed"}>
      <div className="g-title">Приёмы</div>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      <div className="diary-meals">
        {feed.perSlot.map((s) => (
          <section className="diary-meal" key={s.slot}>
            <div className="diary-meal-head">
              <span className="diary-slot-name">{label(SLOT_LABELS, s.slot)}</span>
              {s.items.length > 0 && (
                <span className="diary-meal-subtotal num">{s.totals.kcal} ккал</span>
              )}
              <button type="button" className="diary-add" onClick={() => onAdd(s.slot)}>
                + добавить
              </button>
            </div>

            {s.items.length === 0 ? (
              <div className="diary-slot-empty diary-meal-empty">Пока пусто</div>
            ) : (
              <div className="group diary-feed-items">
                {s.items.map((item, i) => (
                  <FeedRow
                    key={item.entry?.id ?? `${item.slot}-${item.suggestion?.recipeId}-${i}`}
                    item={item}
                    meal={
                      item.suggestion
                        ? planByKey.get(`${item.slot}|${item.suggestion.recipeId}`)
                        : undefined
                    }
                    busy={
                      item.suggestion ? busyKey === keyFor(item.suggestion) : false
                    }
                    disabled={pending}
                    foodName={foodName}
                    foodUnit={foodUnit}
                    onEat={eat}
                    onUneat={uneat}
                    onReplace={replace}
                    onRemove={removeSuggested}
                    onEditEntry={onEdit}
                    onDeleteEntry={deleteEntry}
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      {notice && <div className="day-notice">{notice}</div>}

      <button
        type="button"
        className="btn gray diary-feed-regen"
        onClick={regenerate}
        disabled={pending}
      >
        {regenerating ? "Собираем…" : "Перегенерировать остаток"}
      </button>
    </div>
  );
}

/** Одна позиция ленты: предложено / съедено / вне плана — со своими действиями. */
function FeedRow({
  item,
  meal,
  busy,
  disabled,
  foodName,
  foodUnit,
  onEat,
  onUneat,
  onReplace,
  onRemove,
  onEditEntry,
  onDeleteEntry,
}: {
  item: DayFeedItem;
  /** Приём плана под позицией (suggested/eaten) — источник source/названия/времени. */
  meal: DayMeal | undefined;
  busy: boolean;
  disabled: boolean;
  foodName: (e: DiaryEntry) => string;
  foodUnit: (e: DiaryEntry) => string;
  onEat: (meal: DayMeal) => void;
  onUneat: (item: DayFeedItem) => void;
  onReplace: (meal: DayMeal) => void;
  onRemove: (meal: DayMeal) => void;
  onEditEntry: (entry: DiaryEntry) => void;
  onDeleteEntry: (id: string) => void;
}) {
  const n = item.nutrients;

  // Предложено: карточка с КБЖУ и текстовыми действиями. Для продукта «заменить» нет.
  if (item.status === "suggested" && meal) {
    return (
      <div className="row diary-feed-item is-suggested">
        <div className="grow diary-feed-main">
          <div className="diary-feed-name">
            {meal.name}
            <span className="diary-feed-tag"> · предложено</span>
          </div>
          <div className="diary-feed-macros num">
            <b>{fmt(n.kcal)}</b> ккал · Б {n.protein} · Ж {n.fat} · У {n.carb} · Кл{" "}
            {n.fiber} · {formatTime(meal.timeMin)}
          </div>
        </div>
        <div className="diary-feed-actions">
          <button
            type="button"
            className="btn tinted diary-feed-eat"
            onClick={() => onEat(meal)}
            disabled={disabled}
          >
            {busy ? "…" : "Съел"}
          </button>
          {meal.source === "recipe" && (
            <button
              type="button"
              className="btn gray"
              onClick={() => onReplace(meal)}
              disabled={disabled}
              aria-label={`Заменить блюдо: ${meal.name}`}
            >
              Заменить
            </button>
          )}
          <button
            type="button"
            className="btn gray"
            onClick={() => onRemove(meal)}
            disabled={disabled}
            aria-label={`Удалить приём: ${meal.name}`}
          >
            Удалить
          </button>
        </div>
      </div>
    );
  }

  // Съедено по плану: запись есть, связка с предложением цела. Обратимо — «снять».
  if (item.status === "eaten" && item.entry) {
    const name = meal?.name ?? foodName(item.entry);
    return (
      <div className="row diary-feed-item is-eaten">
        <div className="grow diary-feed-main">
          <div className="diary-feed-name">
            <span className="diary-feed-check" aria-hidden="true">
              ✓
            </span>
            {name}
          </div>
          <div className="diary-feed-macros num">
            <b>{fmt(n.kcal)}</b> ккал · Б {n.protein} · Ж {n.fat} · У {n.carb} · Кл{" "}
            {n.fiber}
          </div>
        </div>
        <div className="diary-feed-actions">
          <button
            type="button"
            className="btn gray"
            onClick={() => onUneat(item)}
            disabled={disabled}
            aria-label="Снять отметку «съел»"
          >
            {busy ? "…" : "Снять"}
          </button>
        </div>
      </div>
    );
  }

  // Вне плана (ручной лог): тап по строке — правка, свайп — удаление (как в тикете 08).
  if (item.entry) {
    const entry = item.entry;
    return (
      <SwipeRow
        onTap={() => onEditEntry(entry)}
        onDelete={() => onDeleteEntry(entry.id)}
        deleteAriaLabel={`Удалить: ${foodName(entry)}`}
      >
        <div className="row diary-entry">
          <span className="diary-feed-check" aria-hidden="true">
            ✓
          </span>
          <span className="grow diary-entry-name">{foodName(entry)}</span>
          <span className="diary-entry-amount num">
            {formatAmount(entry, foodUnit(entry))}
          </span>
          <span className="diary-entry-kcal num">{entry.nutrients.kcal} ккал</span>
        </div>
      </SwipeRow>
    );
  }

  return null;
}
