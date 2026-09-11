"use client";

// Шит ручного лога дневника (тикет 09): добавление (Поиск → количество) и правка
// количества существующей записи. Живое превью КБЖУ считается тем же ядром
// (nutrientsForAmount), что и серверный снапшот — совпадение цифр до записи.
//
// Сегменты Поиск · Недавнее · Избранное · Своё (тикет 11). Поиск идёт по уже
// загруженной базе (getIngredients/getRecipes); остальные сегменты — ссылки
// (source+refId) из getLogSegmentsAction, которые резолвятся в те же строки базы
// (имя/КБЖУ/пометку «Своё» не дублируем). Выбор из любого сегмента ведёт на тот же
// экран количества. Штучный ввод скрыт для продукта без gramsPerPiece (item 13).

import { useEffect, useMemo, useState } from "react";
import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/ios/SegmentedControl";
import { EmptyState } from "@/components/ios/EmptyState";
import {
  nutrientsForAmount,
  presetsForFood,
  zeroNutrients,
  type AmountFood,
  type LoggedAmount,
  type DiaryEntry,
  type DiarySource,
  type SegmentRef,
} from "@/core/diary";
import type { Slot } from "@/core/generator";
import type { IngredientRow, RecipeRow } from "@/lib/food";
import type { DayLogResult, LogSegments } from "@/lib/diary";
import {
  addEntryAction,
  updateEntryAction,
  getLogSegmentsAction,
} from "@/app/actions/diary";
import { SLOT_LABELS, massUnit, label } from "@/lib/food-labels";

const collator = new Intl.Collator("ru");

/** Выбранная еда со всем, что нужно экрану количества. */
interface PickedFood {
  source: DiarySource;
  refId: string;
  name: string;
  /** Единица продукта (для подписи «г»/«мл»); у рецепта не используется. */
  unit: string;
  amountFood: AmountFood;
}

function ingredientToPick(i: IngredientRow): PickedFood {
  return {
    source: "ingredient",
    refId: i.id,
    name: i.name,
    unit: i.unit,
    amountFood: {
      source: "ingredient",
      per100: i.per100,
      gramsPerPiece: i.gramsPerPiece,
    },
  };
}

function recipeToPick(r: RecipeRow): PickedFood {
  return {
    source: "recipe",
    refId: r.id,
    name: r.name,
    unit: "",
    amountFood: { source: "recipe", perServing: r.perServing },
  };
}

/** Подпись строки: ккал продукта на 100 г/мл или ккал порции рецепта. */
const ingredientSub = (i: IngredientRow) =>
  `${i.per100.kcal} ккал · на 100 ${massUnit(i.unit)}`;
const recipeSub = (r: RecipeRow) => `${r.perServing.kcal} ккал · порция`;

/** Ключ ссылки (source+refId) — уникален между продуктами и рецептами. */
const refKey = (source: DiarySource, refId: string) => `${source}|${refId}`;

/** Начальное количество продукта/рецепта по умолчанию (для нового лога). */
function defaultAmount(food: AmountFood): LoggedAmount {
  return food.source === "recipe"
    ? { kind: "servings", servings: 1 }
    : { kind: "grams", grams: 100 };
}

/** Режим шита: добавление в приём или правка количества записи. */
export type LogSheetMode =
  | { kind: "add"; slot: Slot }
  | { kind: "edit"; entry: DiaryEntry };

interface LogSheetProps {
  ingredients: IngredientRow[];
  recipes: RecipeRow[];
  date: string;
  mode: LogSheetMode;
  onClose: () => void;
  onResult: (r: DayLogResult) => void;
}

export function LogSheet(props: LogSheetProps) {
  const { mode } = props;
  const isAdd = mode.kind === "add";
  // В режиме правки еда и стартовое количество восстанавливаются из записи.
  const editPick = useMemo(() => {
    if (mode.kind !== "edit") return null;
    return resolveEntryPick(mode.entry, props.ingredients, props.recipes);
  }, [mode, props.ingredients, props.recipes]);

  const [picked, setPicked] = useState<PickedFood | null>(
    editPick?.food ?? null,
  );

  // Сегмент и его данные живут здесь, чтобы переживать «‹ К поиску» без перезапроса.
  // Недавнее/Избранное/Своё — ссылки из экшена; Поиск работает по базе из пропсов.
  const [segment, setSegment] = useState<SegmentKey>("search");
  const [segments, setSegments] = useState<LogSegments | null>(null);

  useEffect(() => {
    if (!isAdd) return;
    let live = true;
    getLogSegmentsAction().then((s) => {
      if (live) setSegments(s);
    });
    return () => {
      live = false;
    };
  }, [isAdd]);

  const title =
    mode.kind === "edit"
      ? "Изменить количество"
      : picked
        ? "Количество"
        : "Добавить в дневник";

  return (
    <div className="sheet-overlay" onClick={props.onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div className="sheet-title">{title}</div>
          <button
            type="button"
            className="sheet-close"
            aria-label="Закрыть"
            onClick={props.onClose}
          >
            ✕
          </button>
        </div>

        {picked ? (
          <AmountStep
            {...props}
            picked={picked}
            initialAmount={
              mode.kind === "edit" && editPick
                ? editPick.amount
                : defaultAmount(picked.amountFood)
            }
            fixedSlot={mode.kind === "edit" ? mode.entry.slot : undefined}
            initialSlot={mode.kind === "add" ? mode.slot : undefined}
            entryId={mode.kind === "edit" ? mode.entry.id : undefined}
            onBack={mode.kind === "add" ? () => setPicked(null) : undefined}
          />
        ) : (
          <PickStep
            {...props}
            segment={segment}
            onSegment={setSegment}
            segments={segments}
            onPick={setPicked}
          />
        )}
      </div>
    </div>
  );
}

/** Восстановить еду и стартовое количество из записи (для правки). */
function resolveEntryPick(
  entry: DiaryEntry,
  ingredients: IngredientRow[],
  recipes: RecipeRow[],
): { food: PickedFood; amount: LoggedAmount } | null {
  if (entry.source === "ingredient") {
    const i = ingredients.find((x) => x.id === entry.refId);
    if (!i) return null;
    return {
      food: ingredientToPick(i),
      // Штуки при записи резолвятся в граммы (тикет 09) — правим в граммах.
      amount: { kind: "grams", grams: entry.grams ?? 100 },
    };
  }
  const r = recipes.find((x) => x.id === entry.refId);
  if (!r) return null;
  return {
    food: recipeToPick(r),
    amount: { kind: "servings", servings: entry.servings ?? 1 },
  };
}

/** Сегменты шита добавления (порядок канонический, Поиск — дефолт). */
type SegmentKey = "search" | "recent" | "favorites" | "own";

const SEGMENT_OPTIONS: SegmentedOption[] = [
  { key: "search", label: "Поиск" },
  { key: "recent", label: "Недавнее" },
  { key: "favorites", label: "Избранное" },
  { key: "own", label: "Своё" },
];

/** Строка выбора еды: название (+пометка «Своё») · подпись КБЖУ · шеврон. */
function FoodRow({
  name,
  own,
  sub,
  onClick,
}: {
  name: string;
  own: boolean;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="row food-row pick-row"
      onClick={onClick}
    >
      <div className="grow">
        <div className="food-title">
          {name}
          {own ? <span className="badge">Своё</span> : null}
        </div>
        <div className="food-sub num">{sub}</div>
      </div>
      <span className="chev">›</span>
    </button>
  );
}

/**
 * Шаг выбора еды: сегмент-контрол Поиск · Недавнее · Избранное · Своё + содержимое
 * активного сегмента. Выбор из любого сегмента ведёт на тот же экран количества.
 */
function PickStep({
  ingredients,
  recipes,
  segment,
  onSegment,
  segments,
  onPick,
}: LogSheetProps & {
  segment: SegmentKey;
  onSegment: (s: SegmentKey) => void;
  segments: LogSegments | null;
  onPick: (f: PickedFood) => void;
}) {
  const ingById = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  );
  const recById = useMemo(
    () => new Map(recipes.map((r) => [r.id, r])),
    [recipes],
  );

  return (
    <div className="sheet-body">
      <SegmentedControl
        options={SEGMENT_OPTIONS}
        value={segment}
        onChange={(k) => onSegment(k as SegmentKey)}
        ariaLabel="Раздел добавления"
      />
      {segment === "search" ? (
        <SearchContent
          ingredients={ingredients}
          recipes={recipes}
          onPick={onPick}
        />
      ) : (
        <SegmentContent
          segment={segment}
          segments={segments}
          ingById={ingById}
          recById={recById}
          onPick={onPick}
        />
      )}
    </div>
  );
}

/** Содержимое «Поиск»: строка поиска + группы «Рецепты»/«Продукты» по базе. */
function SearchContent({
  ingredients,
  recipes,
  onPick,
}: {
  ingredients: IngredientRow[];
  recipes: RecipeRow[];
  onPick: (f: PickedFood) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const shownRecipes = useMemo(
    () =>
      recipes
        .filter((r) => r.name.toLowerCase().includes(q))
        .sort((a, b) => collator.compare(a.name, b.name)),
    [recipes, q],
  );
  const shownIngredients = useMemo(
    () =>
      ingredients
        .filter((i) => i.name.toLowerCase().includes(q))
        .sort((a, b) => collator.compare(a.name, b.name)),
    [ingredients, q],
  );

  const empty = shownRecipes.length === 0 && shownIngredients.length === 0;

  return (
    <>
      <input
        className="input"
        type="search"
        placeholder="Поиск продукта или рецепта"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Поиск еды"
        autoFocus
        style={{ margin: "12px 0" }}
      />

      {empty ? (
        <EmptyState
          icon="🔍"
          title="Ничего не найдено"
          description="Измените запрос — в поиске базовые и ваши продукты и рецепты."
        />
      ) : (
        <div className="sheet-scroll">
          {shownRecipes.length > 0 && (
            <>
              <div className="g-title">Рецепты</div>
              <div className="group" style={{ marginBottom: 12 }}>
                {shownRecipes.map((r) => (
                  <FoodRow
                    key={r.id}
                    name={r.name}
                    own={r.own}
                    sub={recipeSub(r)}
                    onClick={() => onPick(recipeToPick(r))}
                  />
                ))}
              </div>
            </>
          )}
          {shownIngredients.length > 0 && (
            <>
              <div className="g-title">Продукты</div>
              <div className="group">
                {shownIngredients.map((i) => (
                  <FoodRow
                    key={i.id}
                    name={i.name}
                    own={i.own}
                    sub={ingredientSub(i)}
                    onClick={() => onPick(ingredientToPick(i))}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

/** Ключ сегмента данных (Поиск сюда не попадает — у него своя ветка). */
type DataSegment = Exclude<SegmentKey, "search">;

/** Строка выбора из сегмента: резолв ссылки в данные строки базы. */
interface ResolvedRef {
  key: string;
  name: string;
  own: boolean;
  sub: string;
  pick: PickedFood;
}

/** Ссылка сегмента → строка базы (или null, если еда удалена из базы). */
function resolveSegmentRef(
  ref: SegmentRef,
  ingById: Map<string, IngredientRow>,
  recById: Map<string, RecipeRow>,
): ResolvedRef | null {
  const key = refKey(ref.source, ref.refId);
  if (ref.source === "ingredient") {
    const i = ingById.get(ref.refId);
    if (!i) return null;
    return { key, name: i.name, own: i.own, sub: ingredientSub(i), pick: ingredientToPick(i) };
  }
  const r = recById.get(ref.refId);
  if (!r) return null;
  return { key, name: r.name, own: r.own, sub: recipeSub(r), pick: recipeToPick(r) };
}

/** Пустые состояния сегментов (нет истории / избранного / своей еды). */
const SEGMENT_EMPTY: Record<
  DataSegment,
  { icon: string; title: string; description: string }
> = {
  recent: {
    icon: "🕘",
    title: "Пока пусто",
    description:
      "Залогируйте еду — и она появится здесь, чтобы повторить её в один тап.",
  },
  favorites: {
    icon: "⭐️",
    title: "Нет избранного",
    description:
      "Добавляйте рецепты в избранное, а часто залогированные продукты появятся здесь сами.",
  },
  own: {
    icon: "✏️",
    title: "Своей еды пока нет",
    description:
      "Кастом-продукты и рецепты, которые вы заведёте, появятся в этом разделе.",
  },
};

/**
 * Содержимое сегмента Недавнее/Избранное/Своё: ссылки резолвятся в строки базы
 * (имя/КБЖУ/пометка «Своё» оттуда); несуществующая еда (удалённая из базы)
 * отсеивается. Пока ссылки грузятся — «Загрузка…»; пусто → подсказка сегмента.
 */
function SegmentContent({
  segment,
  segments,
  ingById,
  recById,
  onPick,
}: {
  segment: DataSegment;
  segments: LogSegments | null;
  ingById: Map<string, IngredientRow>;
  recById: Map<string, RecipeRow>;
  onPick: (f: PickedFood) => void;
}) {
  if (!segments) {
    return <div className="diary-loading">Загрузка…</div>;
  }

  // Несуществующая еда (удалённая из базы) отсеивается (resolveSegmentRef → null).
  const items = segments[segment]
    .map((ref) => resolveSegmentRef(ref, ingById, recById))
    .filter((it): it is ResolvedRef => it !== null);

  if (items.length === 0) {
    return <EmptyState {...SEGMENT_EMPTY[segment]} />;
  }

  return (
    <div className="sheet-scroll" style={{ marginTop: 12 }}>
      <div className="group">
        {items.map((it) => (
          <FoodRow
            key={it.key}
            name={it.name}
            own={it.own}
            sub={it.sub}
            onClick={() => onPick(it.pick)}
          />
        ))}
      </div>
    </div>
  );
}

/** Шаг «Количество»: ввод + пресеты + живое превью + выбор приёма + добавить. */
function AmountStep({
  picked,
  initialAmount,
  fixedSlot,
  initialSlot,
  entryId,
  date,
  onBack,
  onClose,
  onResult,
}: LogSheetProps & {
  picked: PickedFood;
  initialAmount: LoggedAmount;
  fixedSlot?: Slot;
  initialSlot?: Slot;
  entryId?: string;
  onBack?: () => void;
}) {
  const [amount, setAmount] = useState<LoggedAmount>(initialAmount);
  const [slot, setSlot] = useState<Slot>(fixedSlot ?? initialSlot ?? "snack");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const food = picked.amountFood;
  const isRecipe = food.source === "recipe";
  const hasPieces = food.source === "ingredient" && food.gramsPerPiece != null;
  const presets = presetsForFood(food);

  const value = amountValue(amount);
  const valid = value > 0;
  const preview = valid ? nutrientsForAmount(food, amount) : zeroNutrients();

  function setValue(raw: string) {
    const n = Number(raw.replace(",", "."));
    const v = Number.isFinite(n) ? n : 0;
    setAmount(withValue(amount, v));
  }

  async function confirm() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const result = entryId
        ? await updateEntryAction(entryId, amount)
        : await addEntryAction({
            date,
            slot,
            source: picked.source,
            refId: picked.refId,
            amount,
          });
      onResult(result);
      onClose();
    } catch {
      setError("Не удалось сохранить. Попробуйте ещё раз.");
      setPending(false);
    }
  }

  return (
    <div className="sheet-body">
      {onBack && (
        <button type="button" className="sheet-back" onClick={onBack}>
          ‹ Назад
        </button>
      )}
      <div className="amount-food">{picked.name}</div>

      {/* Переключатель граммы/штуки — только у продукта с грамм-эквивалентом. */}
      {hasPieces && (
        <SegmentedControl
          options={[
            { key: "grams", label: "Граммы" },
            { key: "pieces", label: "Штуки" },
          ]}
          value={amount.kind === "pieces" ? "pieces" : "grams"}
          onChange={(k) =>
            setAmount(
              k === "pieces"
                ? { kind: "pieces", pieces: 1 }
                : { kind: "grams", grams: 100 },
            )
          }
          ariaLabel="Единица количества"
        />
      )}

      <div className="field" style={{ margin: "12px 0" }}>
        <label htmlFor="amount-input">{amountLabel(amount)}</label>
        <input
          id="amount-input"
          className="input num"
          type="number"
          inputMode="decimal"
          min={0}
          step={isRecipe ? 0.5 : amount.kind === "pieces" ? 1 : 10}
          value={value === 0 ? "" : value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>

      <div className="amount-presets">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className="chip add"
            aria-pressed={sameAmount(amount, p.amount)}
            onClick={() => setAmount(p.amount)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="amount-preview" aria-live="polite">
        <span className="amount-kcal num">{preview.kcal} ккал</span>
        <span className="food-macros num">
          <span style={{ color: "var(--p)" }}>Б {preview.protein}</span>
          <span style={{ color: "var(--f)" }}>Ж {preview.fat}</span>
          <span style={{ color: "var(--c)" }}>У {preview.carb}</span>
          <span style={{ color: "var(--fb)" }}>К {preview.fiber}</span>
        </span>
      </div>

      {/* Приём предзаполнен (следующий незаполненный, иначе перекус), можно сменить.
          При правке приём фиксирован — меняем только количество. */}
      {!fixedSlot && (
        <div className="field" style={{ margin: "4px 0 12px" }}>
          <label htmlFor="amount-slot">Приём</label>
          <select
            id="amount-slot"
            className="input"
            value={slot}
            onChange={(e) => setSlot(e.target.value as Slot)}
          >
            {(["breakfast", "lunch", "dinner", "snack"] as Slot[]).map((s) => (
              <option key={s} value={s}>
                {label(SLOT_LABELS, s)}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <div className="form-error">{error}</div>}

      <button
        type="button"
        className="btn tinted"
        disabled={!valid || pending}
        onClick={confirm}
      >
        {pending ? "Сохраняю…" : entryId ? "Сохранить" : "Добавить"}
      </button>
    </div>
  );
}

/** Числовое значение текущего количества (граммы/штуки/порции). */
function amountValue(a: LoggedAmount): number {
  if (a.kind === "grams") return a.grams;
  if (a.kind === "pieces") return a.pieces;
  return a.servings;
}

/** Заменить числовое значение в количестве, сохранив вид (kind). */
function withValue(a: LoggedAmount, v: number): LoggedAmount {
  if (a.kind === "grams") return { kind: "grams", grams: v };
  if (a.kind === "pieces") return { kind: "pieces", pieces: v };
  return { kind: "servings", servings: v };
}

function sameAmount(a: LoggedAmount, b: LoggedAmount): boolean {
  return a.kind === b.kind && amountValue(a) === amountValue(b);
}

function amountLabel(a: LoggedAmount): string {
  if (a.kind === "grams") return "Граммы";
  if (a.kind === "pieces") return "Штуки";
  return "Порции";
}
