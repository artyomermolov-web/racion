import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import {
  listSelectableIngredients,
  getRecipeDraft,
  getBaseRecipeName,
  type RecipeDraftData,
} from "@/lib/customFood";
import { RecipeEditor } from "./RecipeEditor";

// Редактор своего рецепта (тикет 17). Без ?base — создание кастом-рецепта;
// с ?base=<id базового> — персонализация: форма предзаполняется базовым рецептом,
// а сохранённая версия заменит оригинал в новых планах.
export default async function NewRecipePage({
  searchParams,
}: {
  searchParams: Promise<{ base?: string }>;
}) {
  const user = await requireUser();
  const { base } = await searchParams;

  let draft: RecipeDraftData | null = null;
  let baseRecipeId: string | null = null;
  let baseName: string | null = null;

  if (base) {
    baseName = await getBaseRecipeName(base);
    if (baseName) {
      baseRecipeId = base;
      draft = await getRecipeDraft(base);
    }
  }

  const ingredients = await listSelectableIngredients(user.id);

  return (
    <>
      <LargeTitleHeader
        title={baseRecipeId ? "Персонализация" : "Новый рецепт"}
        leading={
          <Link href="/svoe" className="back-link">
            ‹ Своё
          </Link>
        }
      />
      <main>
        <RecipeEditor
          ingredients={ingredients}
          draft={draft}
          baseRecipeId={baseRecipeId}
          baseName={baseName}
        />
      </main>
    </>
  );
}
