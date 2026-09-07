"use server";

// Действия списка покупок (тикет 18). Список — проекция недельного плана; как и
// план, он не персистится в «тонком» слое. Ручные правки/чекбоксы живут на
// клиенте (localStorage); сервер лишь отдаёт свежий список под ТЕКУЩИЙ план.
import { requireUser } from "@/lib/auth";
import { shoppingListForCurrentWeek } from "@/lib/shopping";
import type { ShoppingList } from "@/core/shopping";

/**
 * Обновить список из текущего плана: пересобирает неделю тем же стабильным seed,
 * что и главная, и заново считает список. Это ре-синк с планом (не случайная
 * перегенерация): не-замороженные строки подтягиваются под текущий план, а
 * ручные правки клиент сохраняет до сброса.
 */
export async function syncShoppingListAction(): Promise<ShoppingList | null> {
  const user = await requireUser();
  return shoppingListForCurrentWeek(user.id);
}
