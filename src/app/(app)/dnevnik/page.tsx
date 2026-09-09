import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { DiaryScreen } from "./DiaryScreen";

// Вкладка «Дневник» (тикет 08): остаток КБЖУ за день против нормы. Доступ и
// requireUser — на уровне (app)/layout.tsx. День и его данные держит клиент
// (локальная дата без UTC-дрейфа), поэтому содержимое — в клиентском DiaryScreen.
export default function DiaryPage() {
  return (
    <>
      <LargeTitleHeader title="Дневник" trailing={<ThemeToggle />} />
      <DiaryScreen />
    </>
  );
}
