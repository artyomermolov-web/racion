"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ios/SegmentedControl";
import { EmptyState } from "@/components/ios/EmptyState";
import { NormCard, type NormRanges } from "@/components/NormCard";

const OPTIONS = [
  { key: "today", label: "Сегодня" },
  { key: "week", label: "Неделя" },
];

/** Домашний экран: норма (если рассчитана) + пустое состояние плана. */
export function HomeContent({ norm }: { norm: NormRanges | null }) {
  const [segment, setSegment] = useState("today");

  return (
    <>
      <SegmentedControl
        options={OPTIONS}
        value={segment}
        onChange={setSegment}
        ariaLabel="Период плана"
      />
      <main>
        {norm ? (
          <>
            <div className="g-title">Ваша норма на день</div>
            <NormCard norm={norm} />
          </>
        ) : null}
        {segment === "today" ? (
          <EmptyState
            icon="🍽️"
            title="Плана на сегодня пока нет"
            description={
              norm
                ? "Норма рассчитана — генерация рациона под ваши КБЖУ появится в следующем шаге."
                : "Заполните профиль и рассчитайте норму — и мы соберём рацион под ваши КБЖУ. Это следующий шаг."
            }
          />
        ) : (
          <EmptyState
            icon="🗓️"
            title="Неделя ещё не собрана"
            description={
              norm
                ? "Норма готова. Здесь появится план на всю неделю с меню по дням."
                : "Как только появится норма, здесь появится план на всю неделю с меню по дням."
            }
          />
        )}
      </main>
    </>
  );
}
