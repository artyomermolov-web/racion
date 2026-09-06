"use client";

import { useActionState, useState } from "react";
import { saveTargetsAction, type TargetsFormState } from "@/app/actions/profile";
import {
  kcalFromMacros,
  type TargetsDraft,
  type TargetsErrors,
} from "@/core/nutrition";

const MACROS: {
  label: string;
  min: keyof TargetsDraft;
  max: keyof TargetsDraft;
}[] = [
  { label: "Белки", min: "proteinMin", max: "proteinMax" },
  { label: "Жиры", min: "fatMin", max: "fatMax" },
  { label: "Углеводы", min: "carbMin", max: "carbMax" },
];

/** Парсит строку в неотрицательное число; пусто/мусор → 0 (для живого расчёта). */
function num(s: string | undefined): number {
  const n = Number((s ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function NumField({
  name,
  label,
  value,
  error,
  onChange,
}: {
  name: keyof TargetsDraft;
  label: string;
  value: string;
  error?: string;
  onChange: (v: string) => void;
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
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

  // Локальное состояние полей — источник для живого пересчёта калорий.
  const [v, setV] = useState<TargetsDraft>(defaults);
  const set = (key: keyof TargetsDraft) => (val: string) =>
    setV((prev) => ({ ...prev, [key]: val }));

  const e: TargetsErrors & { form?: string } = state.errors;

  // Калории — производные от макросов, пересчитываются вживую.
  const kcalMin = kcalFromMacros({
    protein: num(v.proteinMin),
    fat: num(v.fatMin),
    carb: num(v.carbMin),
  });
  const kcalMax = kcalFromMacros({
    protein: num(v.proteinMax),
    fat: num(v.fatMax),
    carb: num(v.carbMax),
  });

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

        <div className="calc-kcal">
          <span>Калории (считаются из Б/Ж/У)</span>
          <strong className="num">
            {kcalMin.toLocaleString("ru-RU")}–{kcalMax.toLocaleString("ru-RU")} ккал
          </strong>
        </div>

        {MACROS.map((m) => (
          <div className="field-row" key={m.min}>
            <NumField
              name={m.min}
              label={`${m.label}, от (г)`}
              value={v[m.min] ?? ""}
              error={e[m.min]}
              onChange={set(m.min)}
            />
            <NumField
              name={m.max}
              label={`до (г)`}
              value={v[m.max] ?? ""}
              error={e[m.max]}
              onChange={set(m.max)}
            />
          </div>
        ))}

        <NumField
          name="fiberMin"
          label="Клетчатка, минимум (г)"
          value={v.fiberMin ?? ""}
          error={e.fiberMin}
          onChange={set("fiberMin")}
        />

        <button type="submit" className="btn gray" disabled={pending}>
          {pending ? "Сохраняем…" : "Сохранить диапазоны"}
        </button>
      </form>
    </details>
  );
}
