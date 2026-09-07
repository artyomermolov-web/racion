"use client";

// Форма создания кастом-продукта (тикет 17): ручной ввод КБЖУ на 100 г/мл/шт +
// аллергены. Валидация — на сервере (чистым ядром); здесь показ ошибок и сброс
// формы после успешного сохранения.

import { useActionState, useEffect, useRef } from "react";
import {
  createCustomProductAction,
  type ProductFormState,
} from "@/app/actions/customFood";
import { ALLERGEN_LABELS } from "@/lib/food-labels";

const UNIT_OPTIONS = [
  { value: "g", label: "граммы" },
  { value: "ml", label: "миллилитры" },
  { value: "pcs", label: "штуки" },
];

const ALLERGENS = Object.keys(ALLERGEN_LABELS);

export function CustomProductForm() {
  const [state, formAction, pending] = useActionState<ProductFormState, FormData>(
    createCustomProductAction,
    { errors: {}, values: {} },
  );
  const formRef = useRef<HTMLFormElement>(null);
  const v = state.values;

  // После сохранения очищаем нативные поля формы под следующий продукт.
  useEffect(() => {
    if (state.saved) formRef.current?.reset();
  }, [state.saved]);

  return (
    <form ref={formRef} action={formAction} noValidate>
      {state.saved ? (
        <div className="save-note" role="status">
          Продукт добавлен ✓
        </div>
      ) : null}
      {state.errors.form ? (
        <div className="form-error" role="alert">
          {state.errors.form}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="cp-name">Название</label>
        <input
          id="cp-name"
          name="name"
          type="text"
          className="input"
          placeholder="Например: протеиновый батончик"
          defaultValue={v.name ?? ""}
          aria-invalid={state.errors.name ? true : undefined}
        />
        {state.errors.name ? <div className="error">{state.errors.name}</div> : null}
      </div>

      <div className="field">
        <label htmlFor="cp-unit">Единица</label>
        <select
          id="cp-unit"
          name="unit"
          className="input"
          defaultValue={v.unit ?? "g"}
          aria-invalid={state.errors.unit ? true : undefined}
        >
          {UNIT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {state.errors.unit ? <div className="error">{state.errors.unit}</div> : null}
      </div>

      <p className="g-note" style={{ margin: "0 0 8px" }}>
        КБЖУ на 100 единиц (как в базе).
      </p>

      <div className="field-row">
        <div className="field">
          <label htmlFor="cp-kcal">Ккал</label>
          <input
            id="cp-kcal"
            name="kcal"
            type="number"
            inputMode="decimal"
            className="input"
            defaultValue={v.kcal ?? ""}
            aria-invalid={state.errors.kcal ? true : undefined}
          />
          {state.errors.kcal ? <div className="error">{state.errors.kcal}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="cp-protein">Белки, г</label>
          <input
            id="cp-protein"
            name="protein"
            type="number"
            inputMode="decimal"
            className="input"
            defaultValue={v.protein ?? ""}
            aria-invalid={state.errors.protein ? true : undefined}
          />
          {state.errors.protein ? (
            <div className="error">{state.errors.protein}</div>
          ) : null}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="cp-fat">Жиры, г</label>
          <input
            id="cp-fat"
            name="fat"
            type="number"
            inputMode="decimal"
            className="input"
            defaultValue={v.fat ?? ""}
            aria-invalid={state.errors.fat ? true : undefined}
          />
          {state.errors.fat ? <div className="error">{state.errors.fat}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="cp-carb">Углеводы, г</label>
          <input
            id="cp-carb"
            name="carb"
            type="number"
            inputMode="decimal"
            className="input"
            defaultValue={v.carb ?? ""}
            aria-invalid={state.errors.carb ? true : undefined}
          />
          {state.errors.carb ? <div className="error">{state.errors.carb}</div> : null}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="cp-fiber">Клетчатка, г</label>
          <input
            id="cp-fiber"
            name="fiber"
            type="number"
            inputMode="decimal"
            className="input"
            placeholder="0"
            defaultValue={v.fiber ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="cp-sodium">Натрий, мг</label>
          <input
            id="cp-sodium"
            name="sodium"
            type="number"
            inputMode="decimal"
            className="input"
            placeholder="0"
            defaultValue={v.sodium ?? ""}
          />
        </div>
      </div>

      <div className="field">
        <span className="field-legend">Аллергены (необязательно)</span>
        <div className="check-grid">
          {ALLERGENS.map((a) => (
            <label key={a} className="check">
              <input type="checkbox" name="allergens" value={a} />
              {ALLERGEN_LABELS[a]}
            </label>
          ))}
        </div>
      </div>

      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Сохраняем…" : "Добавить продукт"}
      </button>
    </form>
  );
}
