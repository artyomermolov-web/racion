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
import { useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/ios/EmptyState";
import { DaySummary } from "@/components/DaySummary";
import { getDayLogAction } from "@/app/actions/diary";
import type { DayLogResult } from "@/lib/diary";
import type { IngredientRow, RecipeRow } from "@/lib/food";
import { nextEmptySlot, type DiaryEntry } from "@/core/diary";
import type { Slot } from "@/core/generator";
import { LogSheet, type LogSheetMode } from "./LogSheet";
import { SuggestionsBlock } from "./SuggestionsBlock";
import { DayFeed } from "./DayFeed";
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

/** Валидный ключ дня из URL (?date=YYYY-MM-DD), иначе null. Проверка не только формы,
 *  но и существования даты: несуществующие (2025-13-45) отсеиваем round-trip через
 *  toKey — иначе битый ?date= увёл бы Дневник на нормализованный «фантомный» день. */
function dateParam(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  return toKey(new Date(y, m - 1, d)) === raw ? raw : null;
}

export function DiaryScreen({
  ingredients,
  recipes,
}: {
  ingredients: IngredientRow[];
  recipes: RecipeRow[];
}) {
  // ?date= из экрана «Неделя»: открыть Дневник сразу на этом дне. Читаем реактивно
  // на клиенте — клиентская <Link>-навигация обновляет query, а не подменённый из
  // кэша сегмент (тикет 13).
  const searchParams = useSearchParams();
  const urlDate = dateParam(searchParams.get("date"));
  // Локальная дата инициализируется на клиенте после монтирования (SSR не знает
  // таймзону пользователя) — до этого держим null и не рендерим содержимое.
  const [todayKey, setTodayKey] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<DayLogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Ручной триггер перезагрузки дня (кнопка «Повторить» после ошибки).
  const [nonce, setNonce] = useState(0);
  const [sheet, setSheet] = useState<LogSheetMode | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const t = toKey(new Date());
    setTodayKey(t);
    // «Сегодня» — всегда локальная дата (для подписей Сегодня/Вчера/Завтра); стартовый
    // день берём из ?date= (переход с экрана «Неделя»), иначе — сегодня. Эффект
    // пересинхронизирует день при смене значения ?date= (переход на другой день недели);
    // повторный переход на тот же ?date= — no-op (день уже открыт на нём).
    setDate(urlDate ?? t);
  }, [urlDate]);

  useEffect(() => {
    if (!date) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(false);
    getDayLogAction(date)
      .then((res) => {
        // Гонка при быстром листании: применяем только последний запрос.
        if (id === reqId.current) {
          setData(res);
          setLoading(false);
        }
      })
      .catch(() => {
        // Иначе loading залипнет true и день навсегда останется на «Загрузка…».
        if (id === reqId.current) {
          setError(true);
          setLoading(false);
        }
      });
  }, [date, nonce]);

  // Результат мутации — свежий день целиком. Помечаем как последний запрос, чтобы
  // не перетёрся долетевшим фоновым getDayLog.
  function applyResult(res: DayLogResult) {
    reqId.current += 1;
    setData(res);
    setLoading(false);
    setError(false);
  }

  /** Повторить загрузку дня после ошибки. */
  const retry = () => setNonce((n) => n + 1);

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

      {error && (
        <div className="form-error" role="alert">
          Не удалось обновить дневник.{" "}
          <button type="button" className="sheet-back" onClick={retry}>
            Повторить
          </button>
        </div>
      )}

      <DayBody
        data={data}
        loading={loading && !data}
        error={error}
        date={date}
        ingredients={ingredients}
        recipes={recipes}
        onAdd={(slot) => setSheet({ kind: "add", slot })}
        onEdit={(entry) => setSheet({ kind: "edit", entry })}
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
  error,
  date,
  ingredients,
  recipes,
  onAdd,
  onEdit,
  onDayResult,
}: {
  data: DayLogResult | null;
  loading: boolean;
  error: boolean;
  date: string;
  ingredients: IngredientRow[];
  recipes: RecipeRow[];
  onAdd: (slot: Slot) => void;
  onEdit: (entry: DiaryEntry) => void;
  onDayResult: (r: DayLogResult) => void;
}) {
  // Ошибка загрузки без данных — сообщение и «Повторить» показывает родитель;
  // здесь не крутим бесконечную «Загрузка…».
  if (error && !data) return null;
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

  // Токен обновления блока подсказок: меняется с остатком дня (лог/правка/удаление/
  // «съел» двигают КБЖУ → блок перезапрашивается под новый остаток).
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

      {/* Единая лента дня: предложенные приёмы плана + съеденное (тикет 09). key по
          дате — смена дня заново грузит план и сбрасывает его состояние. */}
      <DayFeed
        key={date}
        date={date}
        day={data}
        ingredients={ingredients}
        recipes={recipes}
        onAdd={onAdd}
        onEdit={onEdit}
        onDayResult={onDayResult}
      />
    </>
  );
}
