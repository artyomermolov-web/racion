"use client";

import { useActionState } from "react";
import { saveProfileAction, type ProfileFormState } from "@/app/actions/profile";
import type { BodyInputDraft } from "@/core/nutrition";

const SEX_OPTIONS = [
  { value: "male", label: "Мужской" },
  { value: "female", label: "Женский" },
];

const ACTIVITY_OPTIONS = [
  { value: "sedentary", label: "Сидячий — почти без спорта" },
  { value: "light", label: "Лёгкая — спорт 1–3 раза в неделю" },
  { value: "moderate", label: "Умеренная — спорт 3–5 раз в неделю" },
  { value: "high", label: "Высокая — спорт 6–7 раз в неделю" },
];

const GOAL_OPTIONS = [
  { value: "lose", label: "Похудеть" },
  { value: "maintain", label: "Держать вес" },
  { value: "gain", label: "Набрать массу" },
];

export function ProfileForm({ defaults }: { defaults: BodyInputDraft }) {
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(
    saveProfileAction,
    { errors: {}, values: defaults },
  );
  const v = state.values;

  return (
    <form action={formAction} noValidate>
      {state.saved ? (
        <div className="save-note" role="status">
          Данные сохранены, норма пересчитана ✓
        </div>
      ) : null}
      {state.errors.form ? (
        <div className="form-error" role="alert">
          {state.errors.form}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="sex">Пол</label>
        <select
          id="sex"
          name="sex"
          className="input"
          defaultValue={v.sex ?? ""}
          aria-invalid={state.errors.sex ? true : undefined}
        >
          <option value="" disabled>
            Выберите
          </option>
          {SEX_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {state.errors.sex ? <div className="error">{state.errors.sex}</div> : null}
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="age">Возраст</label>
          <input
            id="age"
            name="age"
            type="number"
            inputMode="numeric"
            className="input"
            placeholder="лет"
            defaultValue={v.age ?? ""}
            aria-invalid={state.errors.age ? true : undefined}
          />
          {state.errors.age ? <div className="error">{state.errors.age}</div> : null}
        </div>
        <div className="field">
          <label htmlFor="heightCm">Рост, см</label>
          <input
            id="heightCm"
            name="heightCm"
            type="number"
            inputMode="decimal"
            className="input"
            placeholder="см"
            defaultValue={v.heightCm ?? ""}
            aria-invalid={state.errors.heightCm ? true : undefined}
          />
          {state.errors.heightCm ? (
            <div className="error">{state.errors.heightCm}</div>
          ) : null}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="weightKg">Вес, кг</label>
          <input
            id="weightKg"
            name="weightKg"
            type="number"
            inputMode="decimal"
            className="input"
            placeholder="кг"
            defaultValue={v.weightKg ?? ""}
            aria-invalid={state.errors.weightKg ? true : undefined}
          />
          {state.errors.weightKg ? (
            <div className="error">{state.errors.weightKg}</div>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="bodyFatPct">% жира (необяз.)</label>
          <input
            id="bodyFatPct"
            name="bodyFatPct"
            type="number"
            inputMode="decimal"
            className="input"
            placeholder="если знаете"
            defaultValue={v.bodyFatPct ?? ""}
            aria-invalid={state.errors.bodyFatPct ? true : undefined}
          />
          {state.errors.bodyFatPct ? (
            <div className="error">{state.errors.bodyFatPct}</div>
          ) : null}
        </div>
      </div>

      <div className="field">
        <label htmlFor="activityLevel">Активность</label>
        <select
          id="activityLevel"
          name="activityLevel"
          className="input"
          defaultValue={v.activityLevel ?? ""}
          aria-invalid={state.errors.activityLevel ? true : undefined}
        >
          <option value="" disabled>
            Выберите
          </option>
          {ACTIVITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {state.errors.activityLevel ? (
          <div className="error">{state.errors.activityLevel}</div>
        ) : null}
      </div>

      <div className="field">
        <label htmlFor="goal">Цель</label>
        <select
          id="goal"
          name="goal"
          className="input"
          defaultValue={v.goal ?? ""}
          aria-invalid={state.errors.goal ? true : undefined}
        >
          <option value="" disabled>
            Выберите
          </option>
          {GOAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {state.errors.goal ? <div className="error">{state.errors.goal}</div> : null}
      </div>

      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Считаем…" : "Рассчитать и сохранить"}
      </button>
    </form>
  );
}
