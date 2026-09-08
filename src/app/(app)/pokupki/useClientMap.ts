"use client";

// Небольшой хук клиентского localStorage-словаря (тикет 18/19). Список покупок не
// персистится на сервере, поэтому ручные правки и чекбоксы «куплено» живут в
// localStorage. Читаем ПОСЛЕ монтирования (как ThemeToggle) — серверный рендер
// идёт без них, гидрация совпадает; `ready` говорит, что клиентские данные учтены.

import { useEffect, useState } from "react";

function loadMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Record<string, T>;
  } catch {
    /* localStorage может быть недоступен */
  }
  return {};
}

/**
 * Словарь в localStorage: [значение, сохранить, готов]. `persist` пишет и в
 * состояние, и в хранилище; `ready` = данные прочитаны после монтирования.
 */
export function useClientMap<T>(
  key: string,
): [Record<string, T>, (next: Record<string, T>) => void, boolean] {
  const [map, setMap] = useState<Record<string, T>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMap(loadMap<T>(key));
    setReady(true);
  }, [key]);

  const persist = (next: Record<string, T>) => {
    setMap(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* игнорируем */
    }
  };

  return [map, persist, ready];
}
