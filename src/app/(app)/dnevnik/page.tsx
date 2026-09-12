import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { getIngredients, getRecipes } from "@/lib/food";
import { DiaryScreen } from "./DiaryScreen";

// Вкладка «Дневник» (тикеты 08–09): остаток КБЖУ за день + ручной лог. Доступ и
// requireUser — на уровне (app)/layout.tsx; здесь дополнительно грузим базу еды
// (продукты + рецепты) для сегмента «Поиск» и для показа названий записей —
// снапшоты записей хранят только refId (тикет 08), имя резолвится из базы.
// День и его данные держит клиент (локальная дата без UTC-дрейфа). Необязательный
// ?date=YYYY-MM-DD открывает Дневник сразу на этом дне — так экран «Неделя» ведёт
// тапом по дню недели в ленту этого дня (тикет 13). Параметр читается на клиенте
// (useSearchParams в DiaryScreen), чтобы клиентская навигация <Link> подхватывала
// свежую дату, а не залипший в Router Cache сегмент /dnevnik без параметра.
export default async function DiaryPage() {
  const user = await requireUser();
  const [ingredients, recipes] = await Promise.all([
    getIngredients(user.id),
    getRecipes(user.id),
  ]);

  return (
    <>
      <LargeTitleHeader
        title="Дневник"
        trailing={
          <div className="nav-actions">
            <Link
              href="/dnevnik/nedelya"
              className="nav-btn"
              aria-label="Планирование недели"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <rect
                  x="3"
                  y="4"
                  width="18"
                  height="17"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M3 9h18M8 2v4M16 2v4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </Link>
            <ThemeToggle />
          </div>
        }
      />
      {/* Suspense — обязателен для useSearchParams в клиентском DiaryScreen. */}
      <Suspense fallback={<main className="diary" aria-busy="true" />}>
        <DiaryScreen ingredients={ingredients} recipes={recipes} />
      </Suspense>
    </>
  );
}
