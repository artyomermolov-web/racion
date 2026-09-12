// Типы ядра списка покупок (тикет 18, решения тикета 07). Чистый модуль без
// Prisma/Next — основной шов тестирования (spec.md, Testing Decisions).
//
// Важно про единицы: ядро работает в ЕДИНИЦЕ ПРОДАЖИ ингредиента (г/мл/шт).
// Потребность (`quantity`), запас (`onHand`) и размер пачки (`packSize`) — все в
// одной единице. Перевод «граммовый эквивалент рецепта → штуки» для штучных — это
// чистая функция `saleQuantity` (units.ts, тоже ядро); ПРИМЕНЯЕТ её слой данных
// (src/lib/shopping.ts) при маппинге состава из БД, до вызова `buildShoppingList`.

/** Единица продажи/учёта продукта. */
export type Unit = "g" | "ml" | "pcs";

/**
 * Провенанс ингредиента (тикет 01, ADR-0001): откуда взяты цена и КБЖУ.
 * `vkusvill` — сопоставлен с товаром ВВ, цена реальна и идёт в смету; `seed` —
 * фолбэк-ориентир, в стоимость НЕ попадает (частичная смета, тикет 03).
 */
export type IngredientSource = "seed" | "vkusvill";

/** Ингредиент в составе рецепта: количество на ВСЁ блюдо, в единице продажи. */
export interface ShoppingRecipeIngredient {
  ingredientId: string;
  /** Количество на все `servings` порций рецепта, в единице продажи ингредиента. */
  quantity: number;
}

/** Рецепт для разворота потребности: состав + на сколько порций рассчитан. */
export interface ShoppingRecipe {
  id: string;
  /** Число порций, на которое задан состав (делитель для порции плана). */
  servings: number;
  ingredients: ShoppingRecipeIngredient[];
}

/** Один запланированный приём: какой рецепт, порция и сколько едоков. */
export interface ShoppingPlanItem {
  recipeId: string;
  /** Множитель порции (0.25–2.0). */
  portion: number;
  /** Число едоков на приём (≥1). По умолчанию 1 (число людей — задел тикета 04). */
  people?: number;
}

/** Продукт-пачка: единица продажи, размер упаковки и цена-ориентир ₽. */
export interface ShoppingIngredient {
  id: string;
  name: string;
  /** Группа продукта — для сортировки/секций в UI. */
  group: string;
  unit: Unit;
  /** Размер магазинной упаковки (в единице продажи). */
  packSize: number;
  /** Цена за пачку, ₽. Реальна только при `source="vkusvill"`; иначе фолбэк. */
  pricePerPack: number;
  /**
   * Провенанс (тикет 03). Только `vkusvill` даёт цену в смету; всё прочее (`seed`
   * либо отсутствие поля — «сырой» продукт до ре-сорса) из стоимости исключается.
   */
  source?: IngredientSource;
  /**
   * SKU товара ВВ (тикет 04). Есть только у сопоставленных позиций; нужен для
   * ссылки-корзины ВкусВилл (несопоставленные в корзину не идут).
   */
  vvXmlId?: string | null;
}

export interface ShoppingListInput {
  /** Все приёмы за период списка (обычно неделя от дня закупки). */
  plan: ShoppingPlanItem[];
  recipes: ShoppingRecipe[];
  ingredients: ShoppingIngredient[];
  /**
   * Запас дома (real-лоты кладовки) по ingredientId, в единице продажи. Вычитается
   * из потребности. Кладовка — тикет 19; здесь только шов, по умолчанию пусто
   * (нет вычета). Pending-лоты сюда НЕ входят (иначе двойной счёт, решение 07).
   */
  onHand?: Record<string, number>;
}

/** Строка списка: сколько нужно, сколько купить пачек, что останется и почём. */
export interface ShoppingLine {
  ingredientId: string;
  name: string;
  group: string;
  unit: Unit;
  /** Потребность из плана (единица продажи), НЕ округлена. */
  need: number;
  /** Уже дома (вычитается из потребности), единица продажи. */
  onHand: number;
  /** Чистая потребность = max(0, need − onHand). */
  netNeed: number;
  packSize: number;
  pricePerPack: number;
  /** Пачек купить = ceil(netNeed / packSize), не меньше 0. */
  packsToBuy: number;
  /** Остаток позиции = packsToBuy·packSize − netNeed (≥0). */
  leftover: number;
  /**
   * Цена по позиции реальна (source=vkusvill) и учтена в смете. Для несопоставленных
   * (`priced=false`) `lineCost` всегда 0 — цена-фолбэк в смету не подставляется.
   */
  priced: boolean;
  /** Стоимость строки = priced ? packsToBuy · pricePerPack : 0, ₽. */
  lineCost: number;
  /**
   * SKU товара ВВ (тикет 04) для ссылки-корзины; null у несопоставленных позиций
   * (в корзину ВВ они не попадают).
   */
  vvXmlId: string | null;
}

/** Собранный список покупок: строки (отсортированы) и итоговая сумма ₽. */
export interface ShoppingList {
  lines: ShoppingLine[];
  /** Итого ₽ = Σ lineCost (только сопоставленные с ВВ позиции). */
  totalCost: number;
  /**
   * Смета частичная (тикет 03): есть покупаемые позиции без реальной цены ВВ,
   * поэтому итог занижен и приблизителен. false — все покупаемые позиции с ценой.
   */
  partial: boolean;
  /** Сколько покупаемых позиций (packsToBuy>0) исключено из стоимости. */
  excludedCount: number;
}
