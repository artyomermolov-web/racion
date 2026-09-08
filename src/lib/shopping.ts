// Серверный клей списка покупок (тикет 18): собирает недельный план пользователя,
// разворачивает рецепты в потребность по продуктам и приводит ко входу чистого
// ядра /core/shopping. Бизнес-логика (агрегация, округление до пачек, остаток,
// сумма ₽) — в ядре; здесь только доступ к данным и проекция для UI.
import "server-only";
import { prisma } from "@/lib/db";
import { buildWeek } from "@/lib/generator";
import { realOnHandForUser } from "@/lib/pantry";
import { hashString } from "@/core/generator";
import {
  buildShoppingList,
  saleQuantity,
  type ShoppingIngredient,
  type ShoppingList,
  type ShoppingPlanItem,
  type ShoppingRecipe,
  type Unit,
} from "@/core/shopping";

/**
 * Строит список покупок из приёмов плана: грузит рецепты плана с составом и
 * данными продуктов-пачек, переводит количества в единицу продажи и зовёт ядро.
 * Кастом-ПРОДУКТЫ (не рецепты) в плане пропускаются ядром как неизвестные
 * рецепты — у продукта нет разложимого на пачки состава (задел, кладовка/своё —
 * тикеты 19/17). `onHand` — запас кладовки (тикет 19); по умолчанию пусто.
 */
export async function buildShoppingListForPlan(
  plan: ShoppingPlanItem[],
  onHand: Record<string, number> = {},
): Promise<ShoppingList> {
  const recipeIds = [...new Set(plan.map((p) => p.recipeId))];
  if (recipeIds.length === 0) return { lines: [], totalCost: 0 };

  const rows = await prisma.recipe.findMany({
    where: { id: { in: recipeIds } },
    include: { ingredients: { include: { ingredient: true } } },
  });

  const recipes: ShoppingRecipe[] = rows.map((r) => ({
    id: r.id,
    servings: r.servings,
    ingredients: r.ingredients.map((ri) => ({
      ingredientId: ri.ingredientId,
      quantity: saleQuantity(ri.grams, ri.ingredient.unit, ri.ingredient.gramsPerPiece),
    })),
  }));

  // Уникальные продукты-пачки из состава рецептов плана.
  const ingredients = new Map<string, ShoppingIngredient>();
  for (const r of rows) {
    for (const ri of r.ingredients) {
      const i = ri.ingredient;
      if (ingredients.has(i.id)) continue;
      ingredients.set(i.id, {
        id: i.id,
        name: i.name,
        group: i.group,
        unit: i.unit as Unit,
        packSize: i.packSize,
        pricePerPack: i.pricePerPack,
      });
    }
  }

  return buildShoppingList({
    plan,
    recipes,
    ingredients: [...ingredients.values()],
    onHand,
  });
}

/** Приёмы всей недели как приёмы плана (людей пока 1, схемы MealType.people нет). */
function planItemsFromWeek(
  days: { meals: { recipeId: string; portion: number }[] }[],
): ShoppingPlanItem[] {
  return days.flatMap((d) => d.meals.map((m) => ({ recipeId: m.recipeId, portion: m.portion })));
}

/**
 * Стабильный seed недели пользователя — тот же, что на главной (userId + дата +
 * "week"): и главная, и список покупок берут ОДНУ И ТУ ЖЕ неделю. Кнопка «обновить
 * из плана» на экране списка тоже зовёт этот seed — это ре-синк с текущим планом,
 * а не случайная перегенерация (иначе список разошёлся бы с неделей на главной).
 */
export function currentWeekSeed(userId: string): number {
  const dateKey = new Date().toISOString().slice(0, 10);
  return hashString(userId + dateKey + "week");
}

/**
 * Список покупок для пользователя за текущую неделю. null — если нормы ещё нет.
 * Из потребности вычитается real-запас кладовки (тикет 19): список покупает лишь
 * недостающее. Pending-лоты НЕ вычитаются (иначе двойной счёт, решение 07).
 */
export async function shoppingListForCurrentWeek(userId: string): Promise<ShoppingList | null> {
  const [week, onHand] = await Promise.all([
    buildWeek(userId, currentWeekSeed(userId)),
    realOnHandForUser(userId),
  ]);
  if (!week) return null;
  return buildShoppingListForPlan(planItemsFromWeek(week.days), onHand);
}
