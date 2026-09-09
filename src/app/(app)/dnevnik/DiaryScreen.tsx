"use client";

// Экран дня дневника (тикет 08): шапка с датой + листание день назад/вперёд,
// сводка остатка (DaySummary) и пустые секции приёмов. Дату держит клиент —
// локальная календарная дата YYYY-MM-DD без UTC-дрейфа (spec: граница «сегодня»
// — локальная полночь). Данные тянет тонкий server action getDayLogAction.
//
// Ручной лог/правка/удаление — тикет 09; блок «Что поесть сейчас» — тикет 10.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ios/EmptyState";
import { DaySummary } from "@/components/DaySummary";
import { SLOT_LABELS, label } from "@/lib/food-labels";
import { getDayLogAction } from "@/app/actions/diary";
import type { DayLogResult } from "@/lib/diary";

/** Локальная дата → YYYY-MM-DD (по локальным полям, не через UTC/toISOString). */
function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Сдвиг даты на delta дней (арифметика по локальной полуночи, DST-безопасно). */
function shiftKey(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return toKey(new Date(y, m - 1, d + delta));
}

/** Разница в календарных днях (key − todayKey). */
function dayDiff(key: string, todayKey: string): number {
  const [y1, m1, d1] = key.split("-").map(Number);
  const [y2, m2, d2] = todayKey.split("-").map(Number);
  const a = new Date(y1, m1 - 1, d1).getTime();
  const b = new Date(y2, m2 - 1, d2).getTime();
  return Math.round((a - b) / 86_400_000);
}

function formatDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const s = new Date(y, m - 1, d).toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Относительная подпись дня: Сегодня / Вчера / Завтра / дата. */
function relLabel(key: string, todayKey: string): string {
  const diff = dayDiff(key, todayKey);
  if (diff === 0) return "Сегодня";
  if (diff === -1) return "Вчера";
  if (diff === 1) return "Завтра";
  return formatDate(key);
}

export function DiaryScreen() {
  // Локальная дата инициализируется на клиенте после монтирования (SSR не знает
  // таймзону пользователя) — до этого держим null и не рендерим содержимое.
  const [todayKey, setTodayKey] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<DayLogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  useEffect(() => {
    const t = toKey(new Date());
    setTodayKey(t);
    setDate(t);
  }, []);

  useEffect(() => {
    if (!date) return;
    const id = ++reqId.current;
    setLoading(true);
    getDayLogAction(date).then((res) => {
      // Гонка при быстром листании: применяем только последний запрос.
      if (id === reqId.current) {
        setData(res);
        setLoading(false);
      }
    });
  }, [date]);

  if (!date || !todayKey) {
    return <main className="diary" aria-busy="true" />;
  }

  return (
    <main className={loading ? "diary is-busy" : "diary"}>
      <div className="date-nav">
        <button
          type="button"
          className="date-nav-btn"
          onClick={() => setDate((d) => (d ? shiftKey(d, -1) : d))}
          aria-label="Предыдущий день"
        >
          ‹
        </button>
        <div className="date-nav-label">
          <div className="date-nav-title">{relLabel(date, todayKey)}</div>
          <div className="date-nav-sub">{formatDate(date)}</div>
        </div>
        <button
          type="button"
          className="date-nav-btn"
          onClick={() => setDate((d) => (d ? shiftKey(d, 1) : d))}
          aria-label="Следующий день"
        >
          ›
        </button>
      </div>

      <DayBody data={data} loading={loading && !data} />
    </main>
  );
}

/** Содержимое дня: пусто-состояния (нет нормы / загрузка) или сводка + секции. */
function DayBody({
  data,
  loading,
}: {
  data: DayLogResult | null;
  loading: boolean;
}) {
  if (loading || !data) {
    return <div className="diary-loading">Загрузка…</div>;
  }

  // Нет активной нормы — считать остаток не от чего (spec, User Story 36).
  if (!data.progress) {
    return (
      <EmptyState
        icon="🧮"
        title="Сначала заполните профиль"
        description="Без нормы КБЖУ остаток дня считать не от чего. Заполните профиль и рассчитайте норму — и здесь появится ваш остаток на день."
        action={
          <Link href="/profil" className="btn tinted">
            Заполнить профиль
          </Link>
        }
      />
    );
  }

  return (
    <>
      <DaySummary progress={data.progress} />

      {/* Секции приёмов. В тикете 08 они пусты по определению — ручной лог и
          показ записей приходят в тикете 09. */}
      <div className="g-title">Приёмы</div>
      <div className="group">
        {data.perSlot.map((slot) => (
          <div className="diary-slot" key={slot.slot}>
            <span className="diary-slot-name">{label(SLOT_LABELS, slot.slot)}</span>
            <span className="diary-slot-empty">Пока пусто</span>
          </div>
        ))}
      </div>
    </>
  );
}
