// Сборка ленты дня (тикет 08): чистая, тотальная, детерминированная функция —
// сливает предложенные приёмы сгенерированного плана и залогированные записи
// `DiaryEntry` одного дня в единый упорядоченный таймлайн со статусами и
// подытогами по слотам. Без Prisma/Next (spec.md, Testing Decisions) — высший
// тестируемый шов дневник-центричного редизайна.
//
// Модель (spec, тикет 01): план не персистится, дневник персистится → лента это
// проекция на лету. Связка «предложение ↔ запись» — `DiaryEntry.suggestedRecipeId`
// (тот же ключ, что у `logDecision` и @@unique([userId,date,slot,suggestedRecipeId])):
//  • под предложение нашлась запись → одна позиция `eaten` (не дубль);
//  • предложение без записи → `suggested`;
//  • запись без предложения → `extra` (съедено вне плана / ручной лог, в т.ч.
//    продукт без рецепта — у него suggestedRecipeId=null, поэтому всегда extra).

import { DIARY_NUTRIENT_KEYS, DIARY_SLOTS } from "./types";
import { zeroNutrients } from "./aggregate";
import type {
  DayFeed,
  DayFeedItem,
  DayFeedSlot,
  DiaryEntry,
  DiaryNutrients,
  PlanMeal,
} from "./types";

/** Сумма снапшотов позиций (по 5 отслеживаемым нутриентам). */
function sumItems(items: readonly DayFeedItem[]): DiaryNutrients {
  const acc = zeroNutrients();
  for (const it of items) {
    for (const k of DIARY_NUTRIENT_KEYS) acc[k] += it.nutrients[k];
  }
  return acc;
}

/**
 * Плановый приём съеден записью iff они в одном слоте и запись помечена
 * происхождением из этого предложения (`suggestedRecipeId`). Ручной лог того же
 * рецепта (suggestedRecipeId=null) не «закрывает» предложение — это extra.
 */
function matches(meal: PlanMeal, entry: DiaryEntry): boolean {
  return entry.slot === meal.slot && entry.suggestedRecipeId === meal.recipeId;
}

/**
 * Лента дня из плана и записей. Порядок позиций внутри приёма: сначала плановые
 * (в порядке входного плана; съеденные показаны как `eaten`, не задвоены), затем
 * `extra`-записи в порядке входа. Все 4 приёма присутствуют (включая пустые — под
 * секции UI). Тотальна: любые входы дают корректную ленту; детерминирована:
 * порядок целиком задан порядком входов.
 */
export function assembleDayFeed(
  plan: readonly PlanMeal[],
  entries: readonly DiaryEntry[],
): DayFeed {
  // Запись, занятую предложением, помечаем потреблённой — так она не задвоится
  // ещё и как extra. Первым подходящим предложением: при коллизии (которой
  // @@unique и так не даёт случиться) лишнее уходит в extra, а не теряется.
  const consumed = new Set<DiaryEntry>();

  const itemForMeal = (meal: PlanMeal): DayFeedItem => {
    const hit = entries.find((e) => !consumed.has(e) && matches(meal, e));
    if (hit) {
      consumed.add(hit);
      return {
        status: "eaten",
        slot: meal.slot,
        suggestion: meal,
        entry: hit,
        nutrients: hit.nutrients,
      };
    }
    return {
      status: "suggested",
      slot: meal.slot,
      suggestion: meal,
      entry: null,
      nutrients: meal.nutrients,
    };
  };

  // Плановые позиции считаем первым проходом — он и наполняет `consumed`, от
  // которого зависит, какие записи станут extra.
  const planItems = plan.map(itemForMeal);
  const extraItems: DayFeedItem[] = entries
    .filter((e) => !consumed.has(e))
    .map((e) => ({
      status: "extra",
      slot: e.slot,
      suggestion: null,
      entry: e,
      nutrients: e.nutrients,
    }));

  const perSlot: DayFeedSlot[] = DIARY_SLOTS.map((slot) => {
    const items = [
      ...planItems.filter((it) => it.slot === slot),
      ...extraItems.filter((it) => it.slot === slot),
    ];
    return { slot, items, totals: sumItems(items) };
  });

  return { perSlot, totals: sumItems([...planItems, ...extraItems]) };
}
