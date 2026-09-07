import { requireUser } from "@/lib/auth";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { getIngredients, getRecipes } from "@/lib/food";
import { BazaContent } from "./BazaContent";

// КБЖУ рецептов считается из состава на сервере (getRecipes), в БД не хранится.
// Свои продукты и рецепты пользователя (тикет 17) показываются в базе с пометкой.
export default async function BazaPage() {
  const user = await requireUser();
  const [recipes, ingredients] = await Promise.all([
    getRecipes(user.id),
    getIngredients(user.id),
  ]);

  return (
    <>
      <LargeTitleHeader title="База" trailing={<ThemeToggle />} />
      <BazaContent recipes={recipes} ingredients={ingredients} />
    </>
  );
}
