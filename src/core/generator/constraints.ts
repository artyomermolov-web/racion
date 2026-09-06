// Жёсткие ограничения генератора (тикет 06, шаг 1; тикет 14). Отсекают
// кандидатов по слоту ДО скоринга — «нарушать нельзя» (kbju-master.md C):
// аллергены, совместимость слота, доступная техника, время готовки.
// Мягкие ограничения (штрафы/бонусы), бюджет, кладовка, повторы — не здесь
// (тикеты 15–19).

import type { GeneratorRecipe, MealSlot, GeneratorConstraints } from "./types";

/** Блюдо несёт хотя бы один исключённый аллерген? */
function hasExcludedAllergen(
  recipe: GeneratorRecipe,
  excluded: readonly string[],
): boolean {
  if (excluded.length === 0) return false;
  const set = new Set(excluded);
  return recipe.allergens.some((a) => set.has(a));
}

/** Вся требуемая рецептом техника доступна в приёме? («none» доступна всегда.) */
function equipmentAvailable(recipe: GeneratorRecipe, slot: MealSlot): boolean {
  const available = new Set<string>([...slot.availableEquipment, "none"]);
  return recipe.equipment.every((e) => available.has(e));
}

/**
 * Пул кандидатов на слот: оставляет только блюда, проходящие ВСЕ жёсткие
 * ограничения. Порядок кандидатов сохраняется (детерминизм; перемешивание для
 * разнообразия — на слое сборки дня).
 */
export function filterCandidates(
  recipes: GeneratorRecipe[],
  slot: MealSlot,
  constraints: GeneratorConstraints,
): GeneratorRecipe[] {
  return recipes.filter((r) => {
    // Совместимость слота: рецепт должен явно поддерживать текущий слот.
    if (!r.slots.includes(slot.slot)) return false;
    // Аллергены/стоп-лист.
    if (hasExcludedAllergen(r, constraints.excludedAllergens)) return false;
    // Приём «без готовки»: только блюда, которым не нужна техника.
    if (!slot.canCook && r.equipment.some((e) => e !== "none")) return false;
    // Требуемая техника должна быть доступна.
    if (!equipmentAvailable(r, slot)) return false;
    // Время готовки не превышает доступное для приёма.
    if (r.timeMin > slot.cookTimeMin) return false;
    return true;
  });
}
