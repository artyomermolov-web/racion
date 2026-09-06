"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "racion-theme";

/** Читает эффективную тему: ручной выбор или системная. */
function effectiveTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* localStorage может быть недоступен */
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Кнопка переключения светлой/тёмной темы (тикет 09). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(effectiveTheme());
    setMounted(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* игнорируем */
    }
  }

  return (
    <button
      type="button"
      className="nav-btn"
      onClick={toggle}
      aria-label="Переключить тему"
    >
      {/* до монтирования не знаем тему — показываем нейтральный символ */}
      {mounted ? (theme === "dark" ? "☀" : "☾") : "☾"}
    </button>
  );
}
