"use server";

// Действия слоя еды (тикет 11): ленивый догруз карточки рецепта по refId для
// инлайн-аккордеона ленты дня. Тонкий слой — requireUser() → src/lib/food.ts;
// расчёт КБЖУ и доступ к данным живут там.
import { requireUser } from "@/lib/auth";
import { getRecipeDetail, type RecipeDetail } from "@/lib/food";

/** Полная карточка рецепта (состав/шаги/время) по id; null — не найдено. */
export async function getRecipeDetailAction(
  id: string,
): Promise<RecipeDetail | null> {
  const user = await requireUser();
  return getRecipeDetail(id, user.id);
}
