"use client";

import { useState } from "react";
import Link from "next/link";
import { SegmentedControl } from "@/components/ios/SegmentedControl";
import { EmptyState } from "@/components/ios/EmptyState";
import type { NormRanges } from "@/components/NormCard";
import { DayPlan } from "@/components/DayPlan";
import { WeekPlan } from "@/components/WeekPlan";
import type { DisplayDay, DisplayWeek } from "@/lib/generator";

const OPTIONS = [
  { key: "today", label: "Сегодня" },
  { key: "week", label: "Неделя" },
];

/** Домашний экран: норма + план дня/недели (если собраны) + пустые состояния. */
export function HomeContent({
  norm,
  day,
  week,
  dateKey,
  eatenKeys,
}: {
  norm: NormRanges | null;
  day: DisplayDay | null;
  week: DisplayWeek | null;
  /** Дата дня (yyyy-mm-dd) — для стабильных ключей приёмов (трекинг, тикет 20). */
  dateKey: string;
  /** Ключи приёмов, уже отмеченных съеденными — для восстановления отметок. */
  eatenKeys: string[];
}) {
  const [segment, setSegment] = useState("today");

  // Подсказка «что сделать» в пустом состоянии: нет нормы — ведём в профиль.
  const fillProfileCta = (
    <Link href="/profil" className="btn tinted">
      Заполнить профиль
    </Link>
  );

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
          day ? (
            <DayPlan initial={day} dateKey={dateKey} eatenKeys={eatenKeys} />
          ) : (
            <EmptyState
              icon="🍽️"
              title="Плана на сегодня пока нет"
              description={
                norm
                  ? "Не удалось собрать день из базы — проверьте, что база наполнена (npm run seed)."
                  : "Заполните профиль и рассчитайте норму — и мы соберём рацион под ваши КБЖУ."
              }
              action={norm ? undefined : fillProfileCta}
            />
          )
        ) : week ? (
          <WeekPlan initial={week} />
        ) : (
          <EmptyState
            icon="🗓️"
            title="Неделя ещё не собрана"
            description={
              norm
                ? "Не удалось собрать неделю из базы — проверьте, что база наполнена (npm run seed)."
                : "Как только появится норма, здесь появится план на всю неделю с меню по дням."
            }
            action={norm ? undefined : fillProfileCta}
          />
        )}
      </main>
    </>
  );
}
