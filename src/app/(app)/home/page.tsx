import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { HomeContent } from "./HomeContent";

function todayLabel(): string {
  const s = new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function HomePage() {
  return (
    <>
      <LargeTitleHeader
        title="Сегодня"
        subtitle={todayLabel()}
        trailing={<ThemeToggle />}
      />
      <HomeContent />
    </>
  );
}
