import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { EmptyState } from "@/components/ios/EmptyState";

export default function PokupkiPage() {
  return (
    <>
      <LargeTitleHeader title="Покупки" trailing={<ThemeToggle />} />
      <main>
        <EmptyState
          icon="🛒"
          title="Список покупок пуст"
          description="Когда появится план питания, список покупок соберётся сам — целыми пачками и с суммой в ₽."
        />
      </main>
    </>
  );
}
