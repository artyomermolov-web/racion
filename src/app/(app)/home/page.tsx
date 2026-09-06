import { requireUser } from "@/lib/auth";
import { getProfileData } from "@/lib/profile";
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

  return (
    <>
      <LargeTitleHeader
        title="Сегодня"
        subtitle={todayLabel()}
        trailing={<ThemeToggle />}
      />
      <HomeContent norm={norm} />
    </>
  );
}
