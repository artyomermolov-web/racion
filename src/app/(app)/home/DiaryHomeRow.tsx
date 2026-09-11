"use client";

// Опциональная строка дневника на главном экране (тикет 12, US 39): «залогировано
// X / цель Y ккал» + подсказка-ссылка «не хватает белка — что поесть?» в дневник,
// чтобы попасть к блоку «Что поесть сейчас» из любой точки. Строка опциональна:
// без активной нормы (нечего считать) не рендерится вовсе — главный экран сам
// показывает своё «заполни профиль».
//
// Остаток считает тот же тонкий server action дневника (getDayLogAction) под
// ЛОКАЛЬНУЮ дату пользователя (как экран дня) — без UTC-дрейфа границы «сегодня».

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DayLogResult } from "@/lib/diary";
import type { DayProgress, Macro } from "@/core/diary";
import { getDayLogAction } from "@/app/actions/diary";
import { todayKey } from "@/lib/local-date";

const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");

/** Родительный падеж макроса для «не хватает …» (Б/Ж/У). */
const MACRO_GENITIVE: Record<Macro, string> = {
  protein: "белка",
  fat: "жиров",
  carb: "углеводов",
};

/** Текст CTA-ссылки: отстающий макрос, иначе остаток ккал, иначе «план закрыт». */
function ctaLabel(p: DayProgress): string {
  if (p.laggingMacro) {
    return `Не хватает ${MACRO_GENITIVE[p.laggingMacro]} — что поесть?`;
  }
  if (p.kcal.remaining > 0) {
    return `Осталось ${fmt(p.kcal.remaining)} ккал — что поесть?`;
  }
  return "План на сегодня закрыт — открыть дневник";
}

/**
 * Строка дневника на главном. Тянет день после монтирования (локальная дата на
 * клиенте); до ответа и без активной нормы ничего не показывает (опциональность).
 */
export function DiaryHomeRow() {
  const [data, setData] = useState<DayLogResult | null>(null);

  useEffect(() => {
    let live = true;
    getDayLogAction(todayKey())
      .then((res) => {
        if (live) setData(res);
      })
      // Строка опциональна — при ошибке просто остаётся скрытой (data=null).
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // Нет данных ещё / нет активной нормы — строку не показываем (она опциональна).
  if (!data?.progress) return null;

  const { kcal } = data.progress;
  const over = kcal.remaining < 0;
  const pct =
    kcal.target > 0
      ? Math.min(Math.max((kcal.eaten / kcal.target) * 100, 0), 100)
      : 0;

  return (
    <Link href="/dnevnik" className="group diary-home-row" aria-label="Открыть дневник">
      <div className="diary-home-top">
        <span className="diary-home-label">Дневник сегодня</span>
        <span className="diary-home-kcal num">
          {fmt(kcal.eaten)}
          <span className="diary-home-target"> / {fmt(kcal.target)} ккал</span>
        </span>
      </div>
      <div className="diary-home-track">
        <div
          className={over ? "diary-home-fill over" : "diary-home-fill"}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="diary-home-cta">
        <span>{ctaLabel(data.progress)}</span>
        <span className="chev">›</span>
      </div>
    </Link>
  );
}
