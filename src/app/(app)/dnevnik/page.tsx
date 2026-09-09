import { requireUser } from "@/lib/auth";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { getIngredients, getRecipes } from "@/lib/food";
import { DiaryScreen } from "./DiaryScreen";

// Вкладка «Дневник» (тикеты 08–09): остаток КБЖУ за день + ручной лог. Доступ и
// requireUser — на уровне (app)/layout.tsx; здесь дополнительно грузим базу еды
// (продукты + рецепты) для сегмента «Поиск» и для показа названий записей —
// снапшоты записей хранят только refId (тикет 08), имя резолвится из базы.
// День и его данные держит клиент (локальная дата без UTC-дрейфа).
export default async function DiaryPage() {
  const user = await requireUser();
  const [ingredients, recipes] = await Promise.all([
    getIngredients(user.id),
    getRecipes(user.id),
  ]);

  return (
    <>
      <LargeTitleHeader title="Дневник" trailing={<ThemeToggle />} />
      <DiaryScreen ingredients={ingredients} recipes={recipes} />
    </>
  );
}
