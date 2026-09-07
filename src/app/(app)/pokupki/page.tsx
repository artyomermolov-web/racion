import { requireUser } from "@/lib/auth";
import { shoppingListForCurrentWeek } from "@/lib/shopping";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { EmptyState } from "@/components/ios/EmptyState";
import { PokupkiContent } from "./PokupkiContent";

/** Экран списка покупок (тикет 18). Список собирается из недельного плана. */
export default async function PokupkiPage() {
  const user = await requireUser();

  // Список соответствует той же неделе, что видна на главной (общий стабильный
  // seed внутри shoppingListForCurrentWeek) — список и план не расходятся.
  const list = await shoppingListForCurrentWeek(user.id);

  return (
    <>
      <LargeTitleHeader title="Покупки" trailing={<ThemeToggle />} />
      <main>
        {list && list.lines.length > 0 ? (
          <PokupkiContent initial={list} />
        ) : (
          <EmptyState
            icon="🛒"
            title="Список покупок пуст"
            description="Когда появится план питания, список покупок соберётся сам — целыми пачками и с суммой в ₽."
          />
        )}
      </main>
    </>
  );
}
