"use server";

// Действие «Открыть корзину во ВкусВилл» (тикет 04, spec.md Q2/Q11). Собирает из
// списка покупок ссылку(и) `?share_basket=` на предзаполненную корзину ВВ. Это
// ССЫЛКА, не заказ и не оплата, авторизации не требует — под ограничения на
// финансовые действия не попадает (spec.md Out of Scope).
//
// Разбиение на группы ≤20 — чистое ядро `buildCartChunks`; здесь только live-вызов
// `cart_link_create` по каждой группе. При недоступности/лимите ВВ действие
// деградирует мягко: возвращаем уже полученные ссылки и честный признак сбоя, а не
// падаем (spec.md «Устойчивость»).
import { requireUser } from "@/lib/auth";
import { buildCartChunks, type CartLine } from "@/core/vkusvill";
import { createCartLink, cartLinkUrl } from "@/lib/vkusvill/client";

/** Результат сборки ссылок-корзин для UI. */
export interface CartLinksResult {
  /** Успешно созданные ссылки `?share_basket=` (в порядке групп). */
  links: string[];
  /**
   * Нет ни одной позиции, сопоставленной с ВВ (нечего класть в корзину). UI тогда
   * объясняет, что корзину собрать не из чего.
   */
  empty: boolean;
  /** Человеческое сообщение о сбое/частичном результате (для мягкой деградации). */
  error?: string;
}

/**
 * Собирает ссылки-корзины ВкусВилл из строк списка покупок. Требует авторизации
 * (действие пользователя), но самих денег/заказа не двигает — только ссылка.
 * Количества берутся с клиента (эффективные пачки с учётом ручных правок);
 * фильтрация несопоставленных, зажим q и разбиение на группы — в `buildCartChunks`.
 */
export async function createCartLinksAction(lines: CartLine[]): Promise<CartLinksResult> {
  await requireUser();

  const chunks = buildCartChunks(lines);
  if (chunks.length === 0) {
    return { links: [], empty: true };
  }

  const links: string[] = [];
  let failed = 0;
  let lastError = "";
  for (const chunk of chunks) {
    const res = await createCartLink(chunk);
    if (res.ok) {
      const url = cartLinkUrl(res.data);
      if (url) links.push(url);
      else {
        failed++;
        lastError = "ВкусВилл не вернул ссылку на корзину.";
      }
    } else {
      failed++;
      lastError =
        res.error.code === "rate_limited" || res.error.httpStatus === 429
          ? "ВкусВилл временно ограничил запросы — попробуйте чуть позже."
          : "Не удалось связаться с ВкусВилл. Попробуйте позже.";
    }
  }

  const error =
    failed === 0
      ? undefined
      : links.length === 0
        ? lastError
        : `Часть корзин не создалась (${failed} из ${chunks.length}). ${lastError}`;

  return { links, empty: false, error };
}
