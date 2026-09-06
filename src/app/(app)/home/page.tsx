import { requireUser } from "@/lib/auth";
import { getProfileData } from "@/lib/profile";
import { buildDay, buildWeek } from "@/lib/generator";
import { hashString } from "@/core/generator";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import type { NormRanges } from "@/components/NormCard";
import { HomeContent } from "./HomeContent";

function todayLabel(): string {
  const s = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default async function HomePage() {
  const user = await requireUser();
  const { nutrition } = await getProfileData(user.id);
  const norm: NormRanges | null = nutrition;

  // Стабильный seed от (userId + дата): один и тот же план держится при
  // перезагрузках и не меняется от правок настроек — перегенерация только по
  // кнопке (тикет 06 шаг 9). Сборка возвращает null, если норма не рассчитана.
  // Неделя получает свой seed-суффикс, чтобы не повторять день-в-день.
  const dateKey = new Date().toISOString().slice(0, 10);
  const [day, week] = norm
    ? await Promise.all([
        buildDay(user.id, hashString(user.id + dateKey)),
        buildWeek(user.id, hashString(user.id + dateKey + "week")),
      ])
    : [null, null];

  return (
    <>
      <LargeTitleHeader
        title="Сегодня"
        subtitle={todayLabel()}
        trailing={<ThemeToggle />}
      />
      <HomeContent norm={norm} day={day} week={week} />
    </>
  );
}
