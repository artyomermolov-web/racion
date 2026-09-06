import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { EmptyState } from "@/components/ios/EmptyState";

export default function BazaPage() {
  return (
    <>
      <LargeTitleHeader title="База" trailing={<ThemeToggle />} />
      <main>
        <EmptyState
          icon="📖"
          title="База продуктов и рецептов"
          description="Скоро здесь появится каталог продуктов и рецептов с поиском и фильтрами по КБЖУ."
        />
      </main>
    </>
  );
}
