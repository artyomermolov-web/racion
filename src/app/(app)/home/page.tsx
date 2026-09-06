import { requireUser } from "@/lib/auth";
import { getProfileData } from "@/lib/profile";
import { buildDay } from "@/lib/generator";
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

  // Стабильный seed дня от (userId + дата): один и тот же план на дату держится
  // при перезагрузках и не меняется от правок настроек — перегенерация только по
  // кнопке (тикет 06 шаг 9). Сборка дня возвращает null, если норма не рассчитана.
  const dateKey = new Date().toISOString().slice(0, 10);
  const day = norm ? await buildDay(user.id, hashString(user.id + dateKey)) : null;

  return (
    <>
      <LargeTitleHeader
        title="Сегодня"
        subtitle={todayLabel()}
        trailing={<ThemeToggle />}
      />
      <HomeContent norm={norm} day={day} />
    </>
  );
}
