"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ios/SegmentedControl";
import { EmptyState } from "@/components/ios/EmptyState";

const OPTIONS = [
  { key: "today", label: "Сегодня" },
  { key: "week", label: "Неделя" },
];

/** Пустой домашний экран: segmented control + осмысленное пустое состояние. */
export function HomeContent() {
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
        {segment === "today" ? (
          <EmptyState
            icon="🍽️"
            title="Плана на сегодня пока нет"
            description="Заполните профиль и рассчитайте норму — и мы соберём рацион под ваши КБЖУ. Это следующий шаг."
          />
        ) : (
          <EmptyState
            icon="🗓️"
            title="Неделя ещё не собрана"
            description="Как только появится норма, здесь появится план на всю неделю с меню по дням."
          />
        )}
      </main>
    </>
  );
}
