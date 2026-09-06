"use client";

import { useActionState } from "react";
import { saveTargetsAction, type TargetsFormState } from "@/app/actions/profile";
import type { TargetsDraft, TargetsErrors } from "@/core/nutrition";

const RANGES: {
  label: string;
  unit: string;
  min: keyof TargetsDraft;
  max: keyof TargetsDraft;
}[] = [
  { label: "Калории", unit: "ккал", min: "kcalMin", max: "kcalMax" },
  { label: "Белки", unit: "г", min: "proteinMin", max: "proteinMax" },
  { label: "Жиры", unit: "г", min: "fatMin", max: "fatMax" },
  { label: "Углеводы", unit: "г", min: "carbMin", max: "carbMax" },
];

function NumField({
  name,
  label,
  value,
  error,
}: {
  name: keyof TargetsDraft;
  label: string;
  value?: string;
  error?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type="number"
        inputMode="numeric"
        className="input"
        defaultValue={value ?? ""}
        aria-invalid={error ? true : undefined}
      />
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}

export function TargetsForm({ defaults }: { defaults: TargetsDraft }) {
  const [state, formAction, pending] = useActionState<TargetsFormState, FormData>(
    saveTargetsAction,
    { errors: {}, values: defaults },
  );
  const v = state.values;
  const e: TargetsErrors & { form?: string } = state.errors;

  return (
    <details className="disclosure">
      <summary>Подстроить вручную</summary>
      <form action={formAction} noValidate>
        {state.saved ? (
          <div className="save-note" role="status">
            Норма обновлена ✓
          </div>
        ) : null}
        {e.form ? (
          <div className="form-error" role="alert">
            {e.form}
          </div>
        ) : null}

        {RANGES.map((r) => (
          <div className="field-row" key={r.min}>
            <NumField
              name={r.min}
              label={`${r.label}, от (${r.unit})`}
              value={v[r.min]}
              error={e[r.min]}
            />
            <NumField
              name={r.max}
              label={`до (${r.unit})`}
              value={v[r.max]}
              error={e[r.max]}
            />
          </div>
        ))}

        <NumField
          name="fiberMin"
          label="Клетчатка, минимум (г)"
          value={v.fiberMin}
          error={e.fiberMin}
        />

        <button type="submit" className="btn gray" disabled={pending}>
          {pending ? "Сохраняем…" : "Сохранить диапазоны"}
        </button>
      </form>
    </details>
  );
}
