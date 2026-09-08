import { requireUser } from "@/lib/auth";
import { shoppingListForCurrentWeek } from "@/lib/shopping";
import { loadPantryView, cookFromPantry } from "@/lib/pantry";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { PokupkiScreen } from "./PokupkiScreen";

/**
 * Экран покупок (тикеты 18, 19): сегмент «Список» (проекция недельного плана за
 * вычетом кладовки) и сегмент «Кладовка» (real-лоты дома + приготовить из дома).
 * Список соответствует той же неделе, что видна на главной (общий стабильный seed).
 */
export default async function PokupkiPage() {
  const user = await requireUser();

  const [list, pantry, cookable] = await Promise.all([
    shoppingListForCurrentWeek(user.id),
    loadPantryView(user.id),
    cookFromPantry(user.id),
  ]);

  return (
    <>
      <LargeTitleHeader title="Покупки" trailing={<ThemeToggle />} />
      <main>
        <PokupkiScreen initialList={list} initialPantry={pantry} initialCookable={cookable} />
      </main>
    </>
  );
}
