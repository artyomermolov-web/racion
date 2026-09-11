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
// кладовки, «заменить» у него нет.
//
// Действия — иконки своего инлайн-SVG набора в стиле HIG (тикет 11): «съел» —
// галочка-в-круге-toggle с тремя состояниями (off/on/busy) через aria-pressed/busy,
// «заменить» — круговые стрелки, «удалить» — корзина. «Перегенерировать» остаётся
// текстовой кнопкой (первичное действие дня). Тап по телу строки разворачивает
// инлайн-аккордеон рецепта (состав/шаги/время; для продукта — КБЖУ/порция); тап по
// иконке-действию — отдельная зона (кнопки-соседи `.diary-feed-main`, не вложены).
// Данные рецепта тянутся по refId ленивым догрузом и кэшируются на время сессии.
//
// План держим в состоянии клиента и грузим детерминированным по дате экшеном
// (`getDayPlanAction`) — перезагрузка даёт тот же план, связка «предложение ↔
// запись» (suggestedRecipeId) не рвётся. Записи (`day`) приходят из родителя и
// обновляются после «съел»/«снять»; лента пересобирается на каждый рендер.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { SwipeRow } from "@/components/ios/SwipeRow";
import {
  AddIcon,
  TrashIcon,
  ReplaceIcon,
  EatIcon,
} from "@/components/ios/ActionIcon";
import {
  SLOT_LABELS,
  label,
  formatAmount,
  formatGrams,
  formatTime,
  massUnit,
} from "@/lib/food-labels";
import {
  getDayPlanAction,
  eatPlanMealAction,
  uneatPlanMealAction,
  deleteEntryAction,
} from "@/app/actions/diary";
import { getRecipeDetailAction } from "@/app/actions/food";
import { replaceMealAction } from "@/app/actions/plan";
import { regenerateRemainderAction as regeneratePlanRemainderAction } from "@/app/actions/track";
import type { DayLogResult } from "@/lib/diary";
import type { DayMeal, MealRef, LayoutMealRef, ExtraMealRef } from "@/lib/generator";
import type { IngredientRow, RecipeRow, RecipeDetail } from "@/lib/food";
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

/** Состояние догруза карточки рецепта для аккордеона (кэш по recipeId). */
type RecipeDetailState = RecipeDetail | "loading" | "error";

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

  // Раскрытие рецепта по тапу (тикет 11): раскрыт один за раз (аккордеон). `key` —
  // ключ строки, `recipeId` — рецепт для догруза (null у продукта: догружать нечего).
  const [expanded, setExpanded] = useState<{
    key: string;
    recipeId: string | null;
  } | null>(null);
  const [details, setDetails] = useState<Record<string, RecipeDetailState>>({});

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

  // Ленивый догруз карточки рецепта при раскрытии (тикет 11). Кэшируем по recipeId;
  // повторное раскрытие того же рецепта берёт из кэша. Ошибку разрешаем перезапросить
  // (повторное раскрытие после сбоя перезапускает загрузку).
  useEffect(() => {
    const rid = expanded?.recipeId;
    if (!rid) return;
    const cur = details[rid];
    if (cur && cur !== "error") return;
    let alive = true;
    setDetails((d) => ({ ...d, [rid]: "loading" }));
    getRecipeDetailAction(rid)
      .then((res) => {
        if (alive) setDetails((d) => ({ ...d, [rid]: res ?? "error" }));
      })
      .catch(() => {
        if (alive) setDetails((d) => ({ ...d, [rid]: "error" }));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded?.recipeId]);

  const toggleExpand = (key: string, recipeId: string | null) => {
    setExpanded((cur) => (cur?.key === key ? null : { key, recipeId }));
  };

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

  // Граммовка ещё не съеденного предложенного продукта для аккордеона: логируется
  // как portion×100 г (см. logSuggestion в lib/diary), поэтому и показываем столько.
  const suggestedProductAmount = (m: DayMeal | undefined): string | null => {
    if (!m || m.source !== "ingredient") return null;
    const unit = ingName.get(m.recipeId)?.unit ?? "g";
    return `${formatGrams(m.portion * 100)} ${massUnit(unit)}`;
  };

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
              <button
                type="button"
                className="icon-btn diary-add"
                onClick={() => onAdd(s.slot)}
                aria-label={`Добавить еду: ${label(SLOT_LABELS, s.slot)}`}
              >
                <AddIcon />
              </button>
            </div>

            {s.items.length === 0 ? (
              <div className="diary-slot-empty diary-meal-empty">Пока пусто</div>
            ) : (
              <div className="group diary-feed-items">
                {s.items.map((item, i) => {
                  const mealForItem = item.suggestion
                    ? planByKey.get(`${item.slot}|${item.suggestion.recipeId}`)
                    : undefined;
                  const rowKey =
                    item.suggestion
                      ? `${item.slot}|${item.suggestion.recipeId}`
                      : (item.entry?.id ?? `${item.slot}-extra-${i}`);
                  return (
                    <FeedRow
                      key={item.entry?.id ?? `${item.slot}-${item.suggestion?.recipeId}-${i}`}
                      item={item}
                      meal={mealForItem}
                      busy={
                        item.suggestion ? busyKey === keyFor(item.suggestion) : false
                      }
                      disabled={pending}
                      rowKey={rowKey}
                      expanded={expanded?.key === rowKey}
                      detail={expanded?.recipeId ? details[expanded.recipeId] : undefined}
                      suggestedProductAmount={suggestedProductAmount(mealForItem)}
                      onToggleExpand={toggleExpand}
                      foodName={foodName}
                      foodUnit={foodUnit}
                      onEat={eat}
                      onUneat={uneat}
                      onReplace={replace}
                      onRemove={removeSuggested}
                      onEditEntry={onEdit}
                      onDeleteEntry={deleteEntry}
                    />
                  );
                })}
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
  rowKey,
  expanded,
  detail,
  suggestedProductAmount,
  onToggleExpand,
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
  /** Стабильный ключ строки для аккордеона (раскрыт один за раз). */
  rowKey: string;
  expanded: boolean;
  /** Догруженная карточка рецепта раскрытой строки (иначе undefined). */
  detail: RecipeDetailState | undefined;
  /** Граммовка предложенного продукта (нет entry) для аккордеона, иначе null. */
  suggestedProductAmount: string | null;
  onToggleExpand: (key: string, recipeId: string | null) => void;
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

  // Предложено / съедено: карточка плана с телом-toggle (раскрытие рецепта) и
  // иконками-действиями. Обе делят разметку — статус меняет действия и вид. Приём
  // плана (`meal`) грузится асинхронно, поэтому имя/источник/refId берём из него с
  // фолбэком на запись (`entry`): съеденный приём не должен «мигать» ручной записью,
  // пока догружается план. Заменить/удалить/«съесть» требуют `meal` — они только у
  // предложенного (план к этому моменту уже загружен).
  if (item.suggestion) {
    const isEaten = item.status === "eaten";
    const entry = item.entry;
    const name = meal?.name ?? (entry ? foodName(entry) : "Блюдо");
    const source = meal?.source ?? entry?.source ?? "recipe";
    const isRecipe = source === "recipe";
    const recipeId = meal?.recipeId ?? entry?.refId ?? item.suggestion.recipeId;
    const eatState: "off" | "on" | "busy" = busy ? "busy" : isEaten ? "on" : "off";

    return (
      <div
        className={
          "diary-feed-item " + (isEaten ? "is-eaten" : "is-suggested") +
          (expanded ? " is-open" : "")
        }
      >
        <div className="diary-feed-row">
          <button
            type="button"
            className="diary-feed-main"
            aria-expanded={expanded}
            onClick={() => onToggleExpand(rowKey, isRecipe ? recipeId : null)}
          >
            <div className="diary-feed-name">
              {name}
              {!isEaten && <span className="diary-feed-tag"> · предложено</span>}
              <span className="diary-feed-chev" aria-hidden="true">
                {expanded ? "⌃" : "⌄"}
              </span>
            </div>
            <div className="diary-feed-macros num">
              <b>{fmt(n.kcal)}</b> ккал · Б {n.protein} · Ж {n.fat} · У {n.carb} · Кл{" "}
              {n.fiber}
              {!isEaten && meal && ` · ${formatTime(meal.timeMin)}`}
            </div>
          </button>

          <div className="diary-feed-actions">
            <button
              type="button"
              className="icon-btn eat-btn"
              aria-pressed={isEaten}
              aria-busy={busy}
              onClick={() => {
                if (isEaten) onUneat(item);
                else if (meal) onEat(meal);
              }}
              disabled={disabled}
              aria-label={
                isEaten
                  ? `Снять отметку «съел»: ${name}`
                  : `Отметить съеденным: ${name}`
              }
            >
              <EatIcon state={eatState} />
            </button>

            {/* Заменить/удалить — только над предложенным (съеденное не трогаем). */}
            {!isEaten && isRecipe && meal && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => onReplace(meal)}
                disabled={disabled}
                aria-label={`Заменить блюдо: ${name}`}
              >
                <ReplaceIcon />
              </button>
            )}
            {!isEaten && meal && (
              <button
                type="button"
                className="icon-btn"
                onClick={() => onRemove(meal)}
                disabled={disabled}
                aria-label={`Удалить приём: ${name}`}
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </div>

        {expanded && (
          <div className="diary-feed-detail">
            {isRecipe ? (
              <RecipeDetailBody detail={detail} />
            ) : (
              <ProductDetailBody
                nutrients={n}
                amount={
                  entry
                    ? formatAmount(entry, foodUnit(entry))
                    : suggestedProductAmount
                }
              />
            )}
          </div>
        )}
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

/** Аккордеон рецепта: время, состав (ингредиенты + граммовки), шаги. */
function RecipeDetailBody({ detail }: { detail: RecipeDetailState | undefined }) {
  if (!detail || detail === "loading") {
    return <div className="feed-detail-note">Загрузка рецепта…</div>;
  }
  if (detail === "error") {
    return <div className="feed-detail-note">Не удалось загрузить рецепт.</div>;
  }
  return (
    <>
      <div className="feed-detail-meta num">
        {formatTime(detail.timeMin)} · {detail.servings} порц.
      </div>
      <div className="feed-detail-sub">Состав</div>
      <ul className="feed-detail-ings">
        {detail.ingredients.map((ing, i) => (
          <li key={i}>
            <span className="grow">{ing.name}</span>
            <span className="num">
              {formatGrams(ing.grams)} {massUnit(ing.unit)}
            </span>
          </li>
        ))}
      </ul>
      {detail.steps.length > 0 && (
        <>
          <div className="feed-detail-sub">Приготовление</div>
          <ol className="feed-detail-steps">
            {detail.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/** Аккордеон продукта (нет рецепта): компактная сводка КБЖУ + порция/граммовка. */
function ProductDetailBody({
  nutrients,
  amount,
}: {
  nutrients: DiaryEntry["nutrients"];
  amount: string | null;
}) {
  return (
    <>
      {amount && <div className="feed-detail-meta num">{amount}</div>}
      <div className="feed-detail-macros num">
        <b>{fmt(nutrients.kcal)}</b> ккал · Б {nutrients.protein} · Ж {nutrients.fat} · У{" "}
        {nutrients.carb} · Кл {nutrients.fiber}
      </div>
    </>
  );
}
