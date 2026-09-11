import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getProfileData } from "@/lib/profile";
import { buildWeek, currentWeekSeed } from "@/lib/generator";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { EmptyState } from "@/components/ios/EmptyState";
import { WeekPlan } from "@/components/WeekPlan";
import type { NormRanges } from "@/components/NormCard";

// Экран «Неделя» (тикет 10 — переезд из упразднённой «Меню»). Планирование недели
// живёт отдельным экраном, доступным из шапки Дневника, а не отдельной вкладкой.
// Поведение сохранено как было на /home: недельное среднее КБЖУ, переключение
// дней, «Заменить», перегенерация. Тикет 13 добавит иконки-действия и переход
// день недели → лента этого дня в Дневнике.
export default async function WeekPage() {
  const user = await requireUser();
  const { nutrition } = await getProfileData(user.id);
  const norm: NormRanges | null = nutrition;

  // Единый seed недели (тот же, что у списка покупок) — план держится при
  // перезагрузках, перегенерация только по кнопке. Без нормы неделю не собрать.
  const week = norm ? await buildWeek(user.id, currentWeekSeed(user.id)) : null;

  return (
    <>
      <LargeTitleHeader
        title="Неделя"
        leading={
          <Link href="/dnevnik" className="back-link">
            ‹ Дневник
          </Link>
        }
      />
      <main>
        {week ? (
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
            action={
              norm ? undefined : (
                <Link href="/profil" className="btn tinted">
                  Заполнить профиль
                </Link>
              )
            }
          />
        )}
      </main>
    </>
  );
}
