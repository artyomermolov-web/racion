"use server";

// Действия вкусов и предпочтений (тикет 16): избранное, блок, recurring
// (often/always) с карточки блюда; keyword-фильтры «не хочу есть»; режим приёма
// «только recurring». План сами не перегенерируют (decision 06 шаг 9) —
// перегенерация остаётся отдельной кнопкой; здесь только сохранение предпочтений.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import {
  getRecipePreference,
  type RecipePreferenceState,
  type RecurringFrequency,
} from "@/lib/preferences";
import { ALL_SLOTS, type Slot } from "@/core/generator";

/** Пути, зависящие от предпочтений: план и экран вкусов. */
function revalidatePreferenceViews(recipeId?: string) {
  revalidatePath("/home");
  revalidatePath("/profil/vkusy");
  if (recipeId) revalidatePath(`/baza/recept/${recipeId}`);
}

const RECURRING: RecurringFrequency[] = ["often", "always"];

/**
 * Переключает избранное. Избранное и блок взаимоисключающи — при добавлении в
 * избранное снимаем блок. Возвращает новое состояние карточки.
 */
export async function toggleFavoriteAction(
  recipeId: string,
): Promise<RecipePreferenceState> {
  const user = await requireUser();
  const existing = await prisma.favoriteRecipe.findUnique({
    where: { userId_recipeId: { userId: user.id, recipeId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.favoriteRecipe.delete({ where: { id: existing.id } });
  } else {
    await prisma.$transaction([
      prisma.blockedRecipe.deleteMany({ where: { userId: user.id, recipeId } }),
      prisma.favoriteRecipe.create({ data: { userId: user.id, recipeId } }),
    ]);
  }

  revalidatePreferenceViews(recipeId);
  return getRecipePreference(user.id, recipeId);
}

/**
 * Переключает блок. Блок жёсткий (блюдо никогда не попадёт в план) и
 * взаимоисключающ с избранным/recurring — при блокировке снимаем их.
 */
export async function toggleBlockAction(
  recipeId: string,
): Promise<RecipePreferenceState> {
  const user = await requireUser();
  const existing = await prisma.blockedRecipe.findUnique({
    where: { userId_recipeId: { userId: user.id, recipeId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.blockedRecipe.delete({ where: { id: existing.id } });
  } else {
    await prisma.$transaction([
      prisma.favoriteRecipe.deleteMany({ where: { userId: user.id, recipeId } }),
      prisma.recurringRecipe.deleteMany({ where: { userId: user.id, recipeId } }),
      prisma.blockedRecipe.create({ data: { userId: user.id, recipeId } }),
    ]);
  }

  revalidatePreferenceViews(recipeId);
  return getRecipePreference(user.id, recipeId);
}

/**
 * Устанавливает recurring-режим блюда: often, always или снятие (null). Recurring
 * несовместим с блоком — при установке снимаем блок. Идемпотентно: повторный тот
 * же режим снимает recurring (тумблер).
 */
export async function setRecurringAction(
  recipeId: string,
  frequency: RecurringFrequency | null,
): Promise<RecipePreferenceState> {
  const user = await requireUser();
  if (frequency !== null && !RECURRING.includes(frequency)) {
    throw new Error(`Недопустимая частота recurring: ${frequency}`);
  }

  const current = await prisma.recurringRecipe.findUnique({
    where: { userId_recipeId: { userId: user.id, recipeId } },
    select: { frequency: true },
  });
  // Повторный клик по текущему режиму снимает recurring.
  const target = current?.frequency === frequency ? null : frequency;

  if (target === null) {
    await prisma.recurringRecipe.deleteMany({ where: { userId: user.id, recipeId } });
  } else {
    await prisma.$transaction([
      prisma.blockedRecipe.deleteMany({ where: { userId: user.id, recipeId } }),
      prisma.recurringRecipe.upsert({
        where: { userId_recipeId: { userId: user.id, recipeId } },
        create: { userId: user.id, recipeId, frequency: target },
        update: { frequency: target },
      }),
    ]);
  }

  revalidatePreferenceViews(recipeId);
  return getRecipePreference(user.id, recipeId);
}

/** Добавляет keyword-фильтр «не хочу есть». Пусто/дубликат — молча игнорирует. */
export async function addKeywordFilterAction(termRaw: string): Promise<void> {
  const user = await requireUser();
  const term = termRaw.trim().toLowerCase();
  if (!term) return;
  await prisma.keywordFilter.upsert({
    where: { userId_term: { userId: user.id, term } },
    create: { userId: user.id, term },
    update: {},
  });
  revalidatePreferenceViews();
}

/** Удаляет keyword-фильтр по термину. */
export async function removeKeywordFilterAction(termRaw: string): Promise<void> {
  const user = await requireUser();
  const term = termRaw.trim().toLowerCase();
  await prisma.keywordFilter.deleteMany({ where: { userId: user.id, term } });
  revalidatePreferenceViews();
}

/** Включает/выключает режим приёма «только recurring» для слота. */
export async function setOnlyRecurringAction(
  slot: Slot,
  onlyRecurring: boolean,
): Promise<void> {
  const user = await requireUser();
  if (!ALL_SLOTS.includes(slot)) throw new Error(`Недопустимый слот: ${slot}`);
  await prisma.mealSlotSetting.upsert({
    where: { userId_slot: { userId: user.id, slot } },
    create: { userId: user.id, slot, onlyRecurring },
    update: { onlyRecurring },
  });
  revalidatePreferenceViews();
}
