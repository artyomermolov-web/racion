// «Своё» и персонализация (тикет 17; decision 04 — флаги isCustom/baseRecipeId).
// Чистые правила формирования пула кандидатов, без Prisma/Next — шов тестирования.
//
// Два правила:
//  • resolvePersonalization — своя версия базового рецепта (baseRecipeId)
//    ВЫТЕСНЯЕТ оригинал из пула, чтобы новые планы брали персонализацию, а не
//    базовый рецепт (тикет 17, «подменяет оригинал»).
//  • productCandidates — кастом-продукт (ручной КБЖУ) сам генератором не берётся;
//    он попадает в кандидаты ТОЛЬКО когда пользователь отметил его recurring
//    (often/always). Обычные кастом-РЕЦЕПТЫ так не ограничены — они кандидаты
//    наравне с базой (просто добавляются в пул до resolvePersonalization).

import type { FoodNutrients } from "@/core/nutrition";
import type { GeneratorRecipe, Allergen, Slot } from "./types";

/** Слоты кастом-продукта-кандидата: продукт универсален по времени суток. */
const PRODUCT_SLOTS: Slot[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * Убирает из пула базовые рецепты, у которых есть персональная версия. Правило
 * простое и не зависит от порядка: рецепт с id X выбывает, если в пуле есть
 * другой рецепт с baseRecipeId = X. Персональная версия и обычные кастом-рецепты
 * (без baseRecipeId) остаются; если базового рецепта в пуле нет (отсеян раньше),
 * убирать нечего — своя версия просто живёт дальше.
 */
export function resolvePersonalization(
  recipes: GeneratorRecipe[],
): GeneratorRecipe[] {
  const overridden = new Set<string>();
  for (const r of recipes) if (r.baseRecipeId) overridden.add(r.baseRecipeId);
  if (overridden.size === 0) return recipes;
  return recipes.filter((r) => !overridden.has(r.id));
}

/** Кастом-продукт для генератора: id, КБЖУ порции, аллергены и ключевые слова. */
export interface CustomProduct {
  id: string;
  /** КБЖУ одной порции продукта (в MVP — на 100 г/мл/шт, введено вручную). */
  perServing: FoodNutrients;
  /** Аллергены продукта — жёсткий отсев работает и для своего продукта. */
  allergens: Allergen[];
  /** Ключевые слова (название/группа) — keyword-фильтр действует и на продукт. */
  keywords?: string[];
}

/**
 * Оборачивает кастом-продукты в кандидатов генератора, но ТОЛЬКО те, что
 * отмечены recurring (id есть в `recurringIds`). Остальные не возвращаются —
 * «генератор сам его не берёт». Продукт-кандидат не требует готовки (timeMin 0,
 * без техники) и доступен во всех слотах; в план он попадает механизмом recurring
 * (бонус often / гарантия always), а не обычным подбором.
 */
export function productCandidates(
  products: CustomProduct[],
  recurringIds: string[],
): GeneratorRecipe[] {
  if (recurringIds.length === 0) return [];
  const recurring = new Set(recurringIds);
  return products
    .filter((p) => recurring.has(p.id))
    .map((p) => ({
      id: p.id,
      slots: PRODUCT_SLOTS,
      timeMin: 0,
      equipment: [],
      allergens: p.allergens,
      perServing: p.perServing,
      keywords: p.keywords,
    }));
}
