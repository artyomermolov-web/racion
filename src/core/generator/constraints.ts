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
 * Ловит ли keyword-фильтр это блюдо? Совпадение без учёта регистра, по
 * подстроке: термин фильтра «куриц» отсекает keyword «Куриный суп». Синонимы
 * приходят в keywords уже как общий тег группы (тикет 06 шаг 1).
 */
function matchesKeywordFilter(
  recipe: GeneratorRecipe,
  filter: readonly string[],
): boolean {
  if (!filter || filter.length === 0) return false;
  const keywords = (recipe.keywords ?? []).map((k) => k.toLowerCase());
  return filter.some((term) => {
    const t = term.toLowerCase();
    return keywords.some((k) => k.includes(t));
  });
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
  const blocked = new Set(constraints.blockedRecipeIds ?? []);
  const keywordFilter = constraints.keywordFilter ?? [];
  return recipes.filter((r) => {
    // Совместимость слота: рецепт должен явно поддерживать текущий слот.
    if (!r.slots.includes(slot.slot)) return false;
    // Аллергены.
    if (hasExcludedAllergen(r, constraints.excludedAllergens)) return false;
    // Стоп-лист по id (заблокированное блюдо).
    if (blocked.has(r.id)) return false;
    // Keyword-фильтр (совпадение по синонимам названия).
    if (matchesKeywordFilter(r, keywordFilter)) return false;
    // Приём «без готовки»: только блюда, которым не нужна техника.
    if (!slot.canCook && r.equipment.some((e) => e !== "none")) return false;
    // Требуемая техника должна быть доступна.
    if (!equipmentAvailable(r, slot)) return false;
    // Время готовки не превышает доступное для приёма.
    if (r.timeMin > slot.cookTimeMin) return false;
    return true;
  });
}
