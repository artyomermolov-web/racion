// Разбиение списка покупок на группы для ссылок-корзин ВкусВилл (тикет 04,
// spec.md шов 1, Q2/Q11). Чистая функция без сети/БД — тестируется на списках,
// применяется server action'ом (по каждой группе live cart_link_create).
//
// Правила (CONTEXT.md «Ссылка-корзина», ограничения ВВ):
//  • В корзину идут только позиции, сопоставленные с товаром ВВ (есть vvXmlId);
//    несопоставленные фолбэк-позиции добавить в корзину ВВ нечем — пропускаем.
//  • Одна ссылка `?share_basket=` держит максимум 20 позиций → длинный список
//    бьётся на несколько групп по порядку.
//  • Количество q зажато в допустимый диапазон ВВ (0.01–40) и округлено до 2
//    знаков: дробное q осмысленно для весовых товаров, но шум плавающей точки и
//    выбросы за диапазон корзину ВВ ломают.

/** Максимум позиций на одну ссылку-корзину ВВ (CONTEXT.md «Ссылка-корзина»). */
export const MAX_ITEMS_PER_CART = 20;

/** Минимальное и максимальное количество одной позиции в корзине ВВ. */
const MIN_QTY = 0.01;
const MAX_QTY = 40;

/** Позиция списка покупок на входе: SKU ВВ (если сопоставлен) и сколько пачек. */
export interface CartLine {
  /** SKU товара ВВ; null/пусто — позиция не сопоставлена и в корзину не идёт. */
  vvXmlId?: string | null;
  /** Сколько пачек купить (packsToBuy с учётом ручных правок). */
  quantity: number;
}

/** Позиция в запросе `cart_link_create`: SKU ВВ и количество. */
export interface CartItem {
  xml_id: string;
  q: number;
}

/** Зажимает количество в диапазон ВВ и округляет до 2 знаков. */
function clampQty(quantity: number): number {
  const clamped = Math.min(MAX_QTY, Math.max(MIN_QTY, quantity));
  return Math.round(clamped * 100) / 100;
}

/**
 * Бьёт список покупок на группы позиций для ссылок-корзин ВВ. Оставляет только
 * сопоставленные (есть vvXmlId) позиции с положительным количеством, зажимает q в
 * допустимый диапазон и режет на группы ≤20 с сохранением порядка. Пустой вход или
 * полное отсутствие сопоставленных позиций → пустой список групп (кнопки корзины
 * тогда просто нет).
 */
export function buildCartChunks(lines: CartLine[]): CartItem[][] {
  const items: CartItem[] = [];
  for (const line of lines) {
    if (!line.vvXmlId) continue; // несопоставленная позиция — в корзину ВВ не идёт
    if (line.quantity <= 0) continue; // нечего покупать
    items.push({ xml_id: line.vvXmlId, q: clampQty(line.quantity) });
  }

  const chunks: CartItem[][] = [];
  for (let i = 0; i < items.length; i += MAX_ITEMS_PER_CART) {
    chunks.push(items.slice(i, i + MAX_ITEMS_PER_CART));
  }
  return chunks;
}
