// Типы ядра кладовки (тикет 19, решения тикетов 06/07). Чистый модуль без
// Prisma/Next — основной шов тестирования (spec.md, Testing Decisions).
//
// Единицы: всё количество лота (`qty`) — в ЕДИНИЦЕ ПРОДАЖИ ингредиента (г/мл/шт),
// как и потребность/пачки в /core/shopping. Перевод «граммовый эквивалент → шт»
// делает слой данных (saleQuantity), сюда попадает уже количество продажи.
//
// Три состояния запаса строго раздельны (решение 07, из разбора piknifood):
//  • real    — физически дома сейчас: список ВЫЧИТАЕТ, генератор приоритетно
//              использует;
//  • pending — прогноз неподтверждённой покупки: НЕ вычитается (иначе двойной
//              счёт), генератор не считает своим; при подтверждении промотится в
//              real;
//  • snapshot — замороженное состояние списка при подтверждении (не
//              пересчитывается при смене цен).

/** Состояние лота: реальный (дома) или ожидаемый (прогноз покупки). */
export type PantryLotKind = "real" | "pending";

/** Партия продукта в кладовке: количество (единица продажи) и срок годности. */
export interface PantryLot {
  id: string;
  ingredientId: string;
  /** Количество в единице продажи (г/мл/шт), > 0. */
  qty: number;
  kind: PantryLotKind;
  /** Срок годности (ISO yyyy-mm-dd) или null (без срока). */
  expiresAt: string | null;
}

/** Строка списка на момент подтверждения (эффективная — уже с ручными правками). */
export interface PurchaseLineInput {
  ingredientId: string;
  name: string;
  /** Пачек куплено (эффективное число к покупке; строки с 0 в снапшот не идут). */
  packsBought: number;
  packSize: number;
  pricePerPack: number;
}

export interface ConfirmPurchaseInput {
  /** Строки списка на момент подтверждения. */
  lines: PurchaseLineInput[];
  /** Дата покупки (ISO yyyy-mm-dd) — от неё считается срок годности лотов. */
  purchasedAt: string;
  /** Срок годности по ingredientId, дней (из карточки продукта). Нет ключа → без срока. */
  shelfLifeDays: Record<string, number>;
  /** Существующие pending-лоты пользователя — купленные ингредиенты промотятся в real. */
  pendingLots?: PantryLot[];
  /**
   * Генератор id нового real-лота (для детерминизма в тестах и стабильных ключей).
   * seq — порядковый номер (0,1,…). По умолчанию — простой суффикс времени покупки.
   */
  makeLotId?: (seq: number) => string;
}

/** Замороженная строка снапшота: цена и стоимость зафиксированы на момент покупки. */
export interface PurchaseSnapshotLine {
  ingredientId: string;
  name: string;
  packsBought: number;
  packSize: number;
  /** Цена за пачку на момент подтверждения — заморожена (смена цены не влияет). */
  pricePerPack: number;
  /** Количество в единице продажи = packsBought · packSize. */
  qty: number;
  /** Стоимость строки = packsBought · pricePerPack — заморожена. */
  lineCost: number;
}

/** Снапшот покупки: замороженные строки и сумма ₽ на момент подтверждения. */
export interface PurchaseSnapshot {
  /** Дата подтверждения (ISO yyyy-mm-dd). */
  confirmedAt: string;
  lines: PurchaseSnapshotLine[];
  /** Итого ₽ = Σ lineCost — не пересчитывается при последующей смене цен. */
  totalCost: number;
}

export interface ConfirmPurchaseResult {
  snapshot: PurchaseSnapshot;
  /** Новые real-лоты из купленного (по строке с packsBought > 0). */
  newRealLots: PantryLot[];
  /** id промотированных pending-лотов (стали real по факту покупки). */
  promotedPendingIds: string[];
  /** Промотированные лоты уже как real (kind = "real"). */
  promotedLots: PantryLot[];
}

/** Рецепт, который можно приготовить из кладовки, с максимумом порций. */
export interface CookableRecipe {
  recipeId: string;
  /** Максимум целых порций, доступных из real-запаса (≥ 1). */
  servings: number;
}
