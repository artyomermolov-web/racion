"use client";

// Режим приёма «только recurring» (тикет 16, decision 06: MealType.onlyRecurring).
// Для отмеченных приёмов генератор ставит лишь блюда, которые пользователь сделал
// recurring (often/always). Состояние — в БД; здесь оптимистичное отражение.

import { useState, useTransition } from "react";
import { setOnlyRecurringAction } from "@/app/actions/preferences";
import { SLOT_LABELS, label } from "@/lib/food-labels";
import { ALL_SLOTS, type Slot } from "@/core/generator";

export function OnlyRecurringSlots({ initial }: { initial: Slot[] }) {
  const [on, setOn] = useState<Set<Slot>>(new Set(initial));
  const [pending, startTransition] = useTransition();

  const toggle = (slot: Slot) => {
    const next = new Set(on);
    const enabled = !next.has(slot);
    if (enabled) next.add(slot);
    else next.delete(slot);
    setOn(next);
    startTransition(() => setOnlyRecurringAction(slot, enabled));
  };

  return (
    <div className="group">
      {ALL_SLOTS.map((slot) => {
        const enabled = on.has(slot);
        return (
          <div className="row" key={slot}>
            <div className="grow">{label(SLOT_LABELS, slot)}</div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label={`Только recurring для приёма «${label(SLOT_LABELS, slot)}»`}
              className={enabled ? "switch on" : "switch"}
              disabled={pending}
              onClick={() => toggle(slot)}
            >
              <span className="switch-knob" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
