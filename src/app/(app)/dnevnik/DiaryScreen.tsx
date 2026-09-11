"use client";

// Экран дня дневника (тикеты 08–09): шапка с датой + листание, сводка остатка
// (DaySummary), секции приёмов с записями и ручной лог (LogSheet). Дату держит
// клиент — локальная календарная дата YYYY-MM-DD без UTC-дрейфа (spec: граница
// «сегодня» — локальная полночь). Данные тянет тонкий server action; мутации
// возвращают обновлённый день целиком (без второго запроса).
//
// Блок «Что поесть сейчас» — тикет 10; сегменты Недавнее/Избранное/Своё — тикет 11.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ios/EmptyState";
import { SwipeRow } from "@/components/ios/SwipeRow";
import { DaySummary } from "@/components/DaySummary";
import { SLOT_LABELS, label, formatAmount } from "@/lib/food-labels";
import {
  getDayLogAction,
  deleteEntryAction,
} from "@/app/actions/diary";
import type { DayLogResult } from "@/lib/diary";
import type { IngredientRow, RecipeRow } from "@/lib/food";
import type { DiaryEntry, SlotSummary } from "@/core/diary";
import type { Slot } from "@/core/generator";
import { LogSheet, type LogSheetMode } from "./LogSheet";
import { SuggestionsBlock } from "./SuggestionsBlock";
import { toKey } from "@/lib/local-date";

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

/** Следующий незаполненный приём дня, иначе перекус (item 6, дефолт слота). */
function nextEmptySlot(perSlot: SlotSummary[]): Slot {
  return perSlot.find((s) => s.entries.length === 0)?.slot ?? "snack";
}

export function DiaryScreen({
  ingredients,
  recipes,
}: {
  ingredients: IngredientRow[];
  recipes: RecipeRow[];
}) {
  // Локальная дата инициализируется на клиенте после монтирования (SSR не знает
  // таймзону пользователя) — до этого держим null и не рендерим содержимое.
  const [todayKey, setTodayKey] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<DayLogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<LogSheetMode | null>(null);
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

  // Результат мутации — свежий день целиком. Помечаем как последний запрос, чтобы
  // не перетёрся долетевшим фоновым getDayLog.
  function applyResult(res: DayLogResult) {
    reqId.current += 1;
    setData(res);
    setLoading(false);
  }

  async function handleDelete(id: string) {
    const res = await deleteEntryAction(id);
    applyResult(res);
  }

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

      <DayBody
        data={data}
        loading={loading && !data}
        date={date}
        ingredients={ingredients}
        recipes={recipes}
        onAdd={(slot) => setSheet({ kind: "add", slot })}
        onEdit={(entry) => setSheet({ kind: "edit", entry })}
        onDelete={handleDelete}
        onDayResult={applyResult}
      />

      {sheet && data && (
        <LogSheet
          ingredients={ingredients}
          recipes={recipes}
          date={date}
          mode={sheet}
          onClose={() => setSheet(null)}
          onResult={applyResult}
        />
      )}
    </main>
  );
}

/** Содержимое дня: пусто-состояния (нет нормы / загрузка) или сводка + секции. */
function DayBody({
  data,
  loading,
  date,
  ingredients,
  recipes,
  onAdd,
  onEdit,
  onDelete,
  onDayResult,
}: {
  data: DayLogResult | null;
  loading: boolean;
  date: string;
  ingredients: IngredientRow[];
  recipes: RecipeRow[];
  onAdd: (slot: Slot) => void;
  onEdit: (entry: DiaryEntry) => void;
  onDelete: (id: string) => void;
  onDayResult: (r: DayLogResult) => void;
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

  // Имя и единица еды резолвятся из базы (снапшот хранит только refId).
  const ingName = new Map(ingredients.map((i) => [i.id, i]));
  const recName = new Map(recipes.map((r) => [r.id, r.name]));
  const foodName = (e: DiaryEntry) =>
    e.source === "recipe"
      ? (recName.get(e.refId) ?? "Рецепт")
      : (ingName.get(e.refId)?.name ?? "Продукт");
  const foodUnit = (e: DiaryEntry) => ingName.get(e.refId)?.unit ?? "g";

  // Токен обновления блока подсказок: меняется с остатком дня (ручной лог/правка/
  // удаление двигают КБЖУ → блок перезапрашивается под новый остаток).
  const refreshToken = `${data.entries.length}|${data.totals.kcal}|${data.totals.protein}|${data.totals.fat}|${data.totals.carb}`;

  return (
    <>
      <DaySummary progress={data.progress} />

      {/* Килфича «Что поесть сейчас» — сразу под сводкой остатка (тикет 10). */}
      <SuggestionsBlock
        date={date}
        refreshToken={refreshToken}
        onDayResult={onDayResult}
      />

      {/* Быстрое добавление: приём предзаполнен следующим незаполненным (иначе
          перекус), меняется в шите (item 6). Плюс у каждого приёма — свой «+». */}
      <button
        type="button"
        className="btn tinted diary-add-primary"
        onClick={() => onAdd(nextEmptySlot(data.perSlot))}
      >
        + Добавить еду
      </button>

      <div className="g-title">Приёмы</div>
      <div className="diary-meals">
        {data.perSlot.map((s) => (
          <section className="diary-meal" key={s.slot}>
            <div className="diary-meal-head">
              <span className="diary-slot-name">
                {label(SLOT_LABELS, s.slot)}
              </span>
              {s.entries.length > 0 && (
                <span className="diary-meal-subtotal num">
                  {s.totals.kcal} ккал
                </span>
              )}
              <button
                type="button"
                className="diary-add"
                onClick={() => onAdd(s.slot)}
              >
                + добавить
              </button>
            </div>

            {s.entries.length === 0 ? (
              <div className="diary-slot-empty diary-meal-empty">Пока пусто</div>
            ) : (
              <div className="group diary-entries">
                {s.entries.map((e) => (
                  <SwipeRow
                    key={e.id}
                    onTap={() => onEdit(e)}
                    onDelete={() => onDelete(e.id)}
                    deleteAriaLabel={`Удалить: ${foodName(e)}`}
                  >
                    <div className="row diary-entry">
                      <span className="grow diary-entry-name">
                        {foodName(e)}
                      </span>
                      <span className="diary-entry-amount num">
                        {formatAmount(e, foodUnit(e))}
                      </span>
                      <span className="diary-entry-kcal num">
                        {e.nutrients.kcal} ккал
                      </span>
                    </div>
                  </SwipeRow>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
