"use client";

// Шит ручного лога дневника (тикет 09): добавление (Поиск → количество) и правка
// количества существующей записи. Живое превью КБЖУ считается тем же ядром
// (nutrientsForAmount), что и серверный снапшот — совпадение цифр до записи.
//
// Сегменты Недавнее/Избранное/Своё — тикет 11 (здесь только Поиск: базовые и свои
// продукты/рецепты уже приходят из getIngredients/getRecipes). Штучный ввод скрыт
// для продукта без gramsPerPiece (item 13).

import { useMemo, useState } from "react";
import { SegmentedControl } from "@/components/ios/SegmentedControl";
import { EmptyState } from "@/components/ios/EmptyState";
import {
  nutrientsForAmount,
  presetsForFood,
  zeroNutrients,
  type AmountFood,
  type LoggedAmount,
  type DiaryEntry,
  type DiarySource,
} from "@/core/diary";
import type { Slot } from "@/core/generator";
import type { IngredientRow, RecipeRow } from "@/lib/food";
import type { DayLogResult } from "@/lib/diary";
import {
  addEntryAction,
  updateEntryAction,
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
  // В режиме правки еда и стартовое количество восстанавливаются из записи.
  const editPick = useMemo(() => {
    if (mode.kind !== "edit") return null;
    return resolveEntryPick(mode.entry, props.ingredients, props.recipes);
  }, [mode, props.ingredients, props.recipes]);

  const [picked, setPicked] = useState<PickedFood | null>(
    editPick?.food ?? null,
  );

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
          <SearchStep {...props} onPick={setPicked} />
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

/** Шаг «Поиск»: сегмент Поиск + строка поиска + список продуктов и рецептов. */
function SearchStep({
  ingredients,
  recipes,
  onPick,
}: LogSheetProps & { onPick: (f: PickedFood) => void }) {
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
    <div className="sheet-body">
      <SegmentedControl
        options={[{ key: "search", label: "Поиск" }]}
        value="search"
        onChange={() => {}}
        ariaLabel="Раздел добавления"
      />
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
                  <button
                    key={r.id}
                    type="button"
                    className="row food-row pick-row"
                    onClick={() => onPick(recipeToPick(r))}
                  >
                    <div className="grow">
                      <div className="food-title">
                        {r.name}
                        {r.own ? <span className="badge">Своё</span> : null}
                      </div>
                      <div className="food-sub num">
                        {r.perServing.kcal} ккал · порция
                      </div>
                    </div>
                    <span className="chev">›</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {shownIngredients.length > 0 && (
            <>
              <div className="g-title">Продукты</div>
              <div className="group">
                {shownIngredients.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className="row food-row pick-row"
                    onClick={() => onPick(ingredientToPick(i))}
                  >
                    <div className="grow">
                      <div className="food-title">
                        {i.name}
                        {i.own ? <span className="badge">Своё</span> : null}
                      </div>
                      <div className="food-sub num">
                        {i.per100.kcal} ккал · на 100 {massUnit(i.unit)}
                      </div>
                    </div>
                    <span className="chev">›</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
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
          ‹ К поиску
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
