import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { ThemeToggle } from "@/components/ios/ThemeToggle";
import { getIngredients, getRecipes } from "@/lib/food";
import { BazaContent } from "./BazaContent";

// КБЖУ рецептов считается из состава на сервере (getRecipes), в БД не хранится.
export default async function BazaPage() {
  const [recipes, ingredients] = await Promise.all([
    getRecipes(),
    getIngredients(),
  ]);

  return (
    <>
      <LargeTitleHeader title="База" trailing={<ThemeToggle />} />
      <BazaContent recipes={recipes} ingredients={ingredients} />
    </>
  );
}
