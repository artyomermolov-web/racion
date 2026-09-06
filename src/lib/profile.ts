// Серверный клей профиля: чтение физданных и активной нормы (тикет 12).
// Бизнес-логика расчёта — в /core/nutrition; здесь только доступ к БД.
import "server-only";
import { prisma } from "@/lib/db";
import type { NutritionTargets } from "@/core/nutrition";

/** Физданные пользователя + активная норма (или null, если ещё не заполнены). */
export async function getProfileData(userId: string) {
  const [profile, nutrition] = await Promise.all([
    prisma.userProfile.findUnique({ where: { userId } }),
    prisma.nutritionProfile.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { profile, nutrition };
}

/** Раскладывает рассчитанную норму в поля NutritionProfile. */
export function targetsToRecord(t: NutritionTargets) {
  return {
    kcalMin: t.kcal.min,
    kcalMax: t.kcal.max,
    proteinMin: t.protein.min,
    proteinMax: t.protein.max,
    fatMin: t.fat.min,
    fatMax: t.fat.max,
    carbMin: t.carb.min,
    carbMax: t.carb.max,
    fiberMin: t.fiberMin,
  };
}
