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

// ── Списание по факту «съел» (тикет 20, решение 07) ──────────────────────────

/** Потребность в списании: сколько единицы продажи одного продукта нужно взять. */
export interface ConsumeDemand {
  ingredientId: string;
  /** Количество в единице продажи (г/мл/шт), > 0. */
  qty: number;
}

/**
 * Отбор из одного лота: сколько единицы продажи взято. Слой данных применяет
 * `qty` к лоту (уменьшает запас) и сохраняет отбор — чтобы снятие отметки «съел»
 * вернуло РОВНО столько же в тот же лот (обратимость, решение по тикету 20).
 * Сохраняем `ingredientId`/`expiresAt` — на случай пересоздания лота при возврате,
 * если исходный лот к тому моменту удалён вручную.
 */
export interface LotDraw {
  lotId: string;
  ingredientId: string;
  /** Взято из лота (единица продажи), > 0. */
  qty: number;
  /** Срок годности лота на момент списания (ISO yyyy-mm-dd) или null. */
  expiresAt: string | null;
}

/** Результат FIFO-списания: отборы по лотам и непокрытый остаток по продуктам. */
export interface ConsumeResult {
  /** Отборы по лотам в порядке FIFO (по сроку годности). */
  draws: LotDraw[];
  /**
   * Непокрытая потребность по ingredientId (запаса не хватило), > 0. Списание «по
   * факту» берёт сколько есть; недостача не блокирует отметку «съел».
   */
  shortfall: Record<string, number>;
}

/** Один приём как основание для списания (recipe + порция + едоки). */
export interface TrackedMeal {
  /** Стабильный клиентский ключ приёма — против двойного списания (решение 07). */
  key: string;
  recipeId: string;
  /** Множитель порции (0.25–2.0). */
  portion: number;
  /** Число едоков (≥1). По умолчанию 1. */
  people?: number;
}

/** Рецепт для разворота в потребность списания — та же форма, что в /core/shopping. */
export type WriteOffRecipe = import("../shopping").ShoppingRecipe;

export interface WriteOffMealInput {
  meal: TrackedMeal;
  /**
   * Guard решения 07: списание этого приёма УЖЕ применено (по ключу). true →
   * ничего не списываем повторно. Состояние живёт в слое данных (MealWriteOff),
   * сюда приходит уже вычисленным — ядро остаётся чистым и детерминированным.
   */
  alreadyApplied: boolean;
  /** Состав рецепта в единице продажи (граммы→шт переводит слой данных). */
  recipe: WriteOffRecipe;
  /** Real-лоты пользователя (списываем только из них; pending не трогаем). */
  realLots: readonly PantryLot[];
}

export interface WriteOffMealResult {
  /** false — guard заблокировал (уже списано) либо списывать нечего. */
  apply: boolean;
  draws: LotDraw[];
  shortfall: Record<string, number>;
}
