"use client";

// Редактор своего рецепта (тикет 17): создание кастом-рецепта и персонализация
// базового (baseRecipeId). Состав выбирается из базы + своих продуктов; КБЖУ
// считается из состава живьём (тем же ядром, что и на сервере) — вручную не
// вводится. Валидация — на сервере; здесь показ ошибок и живой расчёт.

import { useActionState, useMemo, useState } from "react";
import { computeRecipeNutrition } from "@/core/nutrition";
import {
  saveCustomRecipeAction,
  type RecipeFormState,
} from "@/app/actions/customFood";
import type { SelectableIngredient, RecipeDraftData } from "@/lib/customFood";
import {
  SLOT_LABELS,
  EQUIPMENT_LABELS,
  DIET_LABELS,
  massUnit,
} from "@/lib/food-labels";

const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
const EQUIPMENT = ["stove", "oven", "blender", "multicooker"];
const DIETS = ["vegetarian", "vegan", "pescatarian"];

interface IngredientRow {
  ingredientId: string;
  grams: string;
}

export function RecipeEditor({
  ingredients,
  draft,
  baseRecipeId,
  baseName,
}: {
  ingredients: SelectableIngredient[];
  draft: RecipeDraftData | null;
  baseRecipeId: string | null;
  baseName: string | null;
}) {
  const [state, formAction, pending] = useActionState<RecipeFormState, FormData>(
    saveCustomRecipeAction,
    { errors: {}, values: draft ?? {} },
  );

  const byId = useMemo(
    () => new Map(ingredients.map((i) => [i.id, i])),
    [ingredients],
  );

  const [rows, setRows] = useState<IngredientRow[]>(
    draft?.ingredients?.length
      ? draft.ingredients.map((r) => ({ ingredientId: r.ingredientId, grams: r.grams }))
      : [{ ingredientId: "", grams: "" }],
  );
  const [servings, setServings] = useState<string>(draft?.servings ?? "1");

  const setRow = (i: number, patch: Partial<IngredientRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { ingredientId: "", grams: "" }]);
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : rs));

  // Живой расчёт КБЖУ порции из выбранного состава (тем же ядром, что на сервере).
  const preview = useMemo(() => {
    const components = rows
      .map((r) => {
        const ing = byId.get(r.ingredientId);
        const grams = Number(String(r.grams).replace(",", "."));
        if (!ing || !Number.isFinite(grams) || grams <= 0) return null;
        return { grams, per100: ing.per100 };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    const s = Math.max(1, Math.round(Number(servings) || 1));
    return computeRecipeNutrition(components, s).perServing;
  }, [rows, servings, byId]);

  const has = (list: string[] | undefined, key: string) => (list ?? []).includes(key);
  const v = state.values;

  return (
    <form action={formAction} noValidate>
      {baseRecipeId ? (
        <>
          <input type="hidden" name="baseRecipeId" value={baseRecipeId} />
          <div className="save-note" role="status">
            Персонализация «{baseName}» — ваша версия заменит оригинал в новых планах.
          </div>
        </>
      ) : null}
      {/* Состав уходит на сервер JSON-полем: source of truth — состояние rows. */}
      <input type="hidden" name="ingredients" value={JSON.stringify(rows)} />

      {state.errors.form ? (
        <div className="form-error" role="alert">
          {state.errors.form}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="r-name">Название</label>
        <input
          id="r-name"
          name="name"
          type="text"
          className="input"
          placeholder="Например: мой овсяноблин"
          defaultValue={v.name ?? ""}
          aria-invalid={state.errors.name ? true : undefined}
        />
        {state.errors.name ? <div className="error">{state.errors.name}</div> : null}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="r-time">Время, мин</label>
          <input
            id="r-time"
            name="timeMin"
            type="number"
            inputMode="numeric"
            className="input"
            defaultValue={v.timeMin ?? "15"}
            aria-invalid={state.errors.timeMin ? true : undefined}
          />
          {state.errors.timeMin ? (
            <div className="error">{state.errors.timeMin}</div>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="r-serv">Порций</label>
          <input
            id="r-serv"
            name="servings"
            type="number"
            inputMode="numeric"
            className="input"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            aria-invalid={state.errors.servings ? true : undefined}
          />
          {state.errors.servings ? (
            <div className="error">{state.errors.servings}</div>
          ) : null}
        </div>
      </div>

      <div className="field">
        <label htmlFor="r-diff">Сложность</label>
        <select
          id="r-diff"
          name="difficulty"
          className="input"
          defaultValue={v.difficulty ?? "1"}
        >
          <option value="1">Просто</option>
          <option value="2">Средне</option>
          <option value="3">Сложно</option>
        </select>
      </div>

      <div className="field">
        <span className="field-legend">Приёмы (слоты)</span>
        {state.errors.slots ? <div className="error">{state.errors.slots}</div> : null}
        <div className="check-grid">
          {SLOTS.map((s) => (
            <label key={s} className="check">
              <input
                type="checkbox"
                name="slots"
                value={s}
                defaultChecked={has(v.slots, s)}
              />
              {SLOT_LABELS[s]}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-legend">Техника (необязательно)</span>
        <div className="check-grid">
          {EQUIPMENT.map((e) => (
            <label key={e} className="check">
              <input
                type="checkbox"
                name="equipment"
                value={e}
                defaultChecked={has(v.equipment, e)}
              />
              {EQUIPMENT_LABELS[e]}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-legend">Диета (необязательно)</span>
        <div className="check-grid">
          {DIETS.map((d) => (
            <label key={d} className="check">
              <input
                type="checkbox"
                name="diet"
                value={d}
                defaultChecked={has(v.diet, d)}
              />
              {DIET_LABELS[d]}
            </label>
          ))}
        </div>
      </div>

      <div className="g-title">Состав</div>
      {state.errors.ingredients ? (
        <div className="error" style={{ marginBottom: 8 }}>
          {state.errors.ingredients}
        </div>
      ) : null}
      <div className="group">
        {rows.map((row, i) => {
          const ing = byId.get(row.ingredientId);
          return (
            <div key={i} className="row ing-row">
              <select
                className="input"
                aria-label={`Ингредиент ${i + 1}`}
                value={row.ingredientId}
                onChange={(e) => setRow(i, { ingredientId: e.target.value })}
              >
                <option value="">— продукт —</option>
                {ingredients.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>
              <div className="ing-grams">
                <input
                  className="input"
                  type="number"
                  inputMode="decimal"
                  placeholder="г"
                  aria-label={`Масса ингредиента ${i + 1}`}
                  value={row.grams}
                  onChange={(e) => setRow(i, { grams: e.target.value })}
                />
                <span className="ing-unit">{ing ? massUnit(ing.unit) : "г"}</span>
              </div>
              <button
                type="button"
                className="linklike danger ing-del"
                onClick={() => removeRow(i)}
                aria-label={`Убрать ингредиент ${i + 1}`}
                disabled={rows.length <= 1}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="btn gray" onClick={addRow} style={{ marginTop: 8 }}>
        + Ингредиент
      </button>

      <div className="g-title">КБЖУ на порцию (расчёт)</div>
      <div className="group">
        <div className="row" style={{ display: "flex", justifyContent: "space-between" }}>
          <span className="num">{preview.kcal} ккал</span>
          <span className="food-macros num">
            <span style={{ color: "var(--p)" }}>Б {preview.protein}</span>
            <span style={{ color: "var(--f)" }}>Ж {preview.fat}</span>
            <span style={{ color: "var(--c)" }}>У {preview.carb}</span>
            <span style={{ color: "var(--fb)" }}>К {preview.fiber}</span>
          </span>
        </div>
      </div>

      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="r-steps">Приготовление (по шагу на строку)</label>
        <textarea
          id="r-steps"
          name="steps"
          className="input"
          rows={5}
          placeholder={"Смешать ингредиенты\nВыпекать 10 минут"}
          defaultValue={v.steps ?? ""}
        />
      </div>

      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Сохраняем…" : baseRecipeId ? "Сохранить мою версию" : "Создать рецепт"}
      </button>
    </form>
  );
}
