"use client";

// Экран списка покупок (тикеты 18, 19). Список — проекция недельного плана за
// вычетом real-запаса кладовки: строки целыми пачками с суммой ₽ и остатком по
// позиции. Как и план, он не персистится в «тонком» слое, поэтому ручные правки и
// чекбоксы «куплено» живут на клиенте (localStorage):
//   • живой синк — «Обновить из плана» собирает свежий план и список под норму;
//   • ручная правка числа пачек ЗАМОРАЖИВАЕТ строку (не пересчитывается) до
//     кнопки «Сбросить правки» — правило заморозки из решения 07;
//   • чекбоксы «куплено» и режим (полный/компакт) — тоже на клиенте.
// «Подтвердить покупку» (тикет 19) переносит купленное в кладовку real-лотами и
// показывает замороженный снапшот суммы; список сам себя обновит (запас вычтется).

import { useMemo, useState, useTransition } from "react";
import type { ShoppingList, ShoppingLine } from "@/core/shopping";
import type { PurchaseLineInput, PurchaseSnapshot } from "@/core/pantry";
import { SegmentedControl } from "@/components/ios/SegmentedControl";
import { syncShoppingListAction } from "@/app/actions/shopping";
import { confirmPurchaseAction, type PantryRefresh } from "@/app/actions/pantry";
import { createCartLinksAction, type CartLinksResult } from "@/app/actions/cart";
import { useClientMap } from "./useClientMap";
import { qty, unitLabel } from "./format";

const OVERRIDES_KEY = "racion-shopping-overrides";
const PURCHASED_KEY = "racion-shopping-purchased";

/** ₽ целым числом с разбивкой разрядов. */
const rub = (n: number) => Math.round(n).toLocaleString("ru-RU");

/** Слово «пачка» в правильной форме для 1/2–4/5+ (1 пачка, 2 пачки, 5 пачек). */
function packsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "пачка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "пачки";
  return "пачек";
}

/** Эффективная строка: число пачек с учётом ручной правки + пересчёт остатка/₽. */
interface EffectiveLine extends ShoppingLine {
  /** Пачек к покупке с учётом ручной правки (или расчётное значение плана). */
  effectivePacks: number;
  /** Строка заморожена ручной правкой (не синкается до сброса). */
  frozen: boolean;
  /** Остаток и стоимость, пересчитанные под effectivePacks. */
  effLeftover: number;
  effCost: number;
}

interface Props {
  list: ShoppingList;
  /** Заменить список (после ре-синка с планом). */
  onList: (list: ShoppingList) => void;
  /** Подтверждение покупки обновило кладовку/список — прокинуть родителю. */
  onConfirmed: (refresh: PantryRefresh) => void;
  /** Открыть вкладку «Кладовка» (после подтверждения). */
  onGoToPantry: () => void;
}

export function PokupkiContent({ list, onList, onConfirmed, onGoToPantry }: Props) {
  const [overrides, persistOverrides, overridesReady] = useClientMap<number>(OVERRIDES_KEY);
  const [purchased, persistPurchased, purchasedReady] = useClientMap<boolean>(PURCHASED_KEY);
  const mounted = overridesReady && purchasedReady;
  const [compact, setCompact] = useState(false);
  const [snapshot, setSnapshot] = useState<PurchaseSnapshot | null>(null);
  const [cart, setCart] = useState<CartLinksResult | null>(null);
  const [pending, startTransition] = useTransition();

  /** Обновить из плана: ре-синк с текущей неделей (не-замороженные строки). */
  const sync = () => {
    setSnapshot(null);
    setCart(null);
    startTransition(async () => {
      const fresh = await syncShoppingListAction();
      if (fresh) onList(fresh);
    });
  };

  /** Ручная правка числа пачек: замораживает строку (не меньше 0). */
  const setPacks = (line: ShoppingLine, packs: number) => {
    persistOverrides({ ...overrides, [line.ingredientId]: Math.max(0, packs) });
  };

  /** Сброс всех ручных правок → строки снова синкаются с планом. */
  const resetEdits = () => persistOverrides({});

  const togglePurchased = (id: string) => {
    const next = { ...purchased, [id]: !purchased[id] };
    if (!next[id]) delete next[id];
    persistPurchased(next);
  };

  // Эффективные строки (с учётом ручных правок) и итоги.
  const { lines, total, remaining, boughtCount, editsCount, approxCount } = useMemo(() => {
    const eff: EffectiveLine[] = list.lines.map((l) => {
      const override = overrides[l.ingredientId];
      const frozen = override !== undefined;
      const effectivePacks = frozen ? override : l.packsToBuy;
      const effLeftover = Math.max(0, effectivePacks * l.packSize - l.netNeed);
      // Несопоставленные с ВВ (l.priced=false) в смету не идут — цена приблизительна.
      const effCost = l.priced ? effectivePacks * l.pricePerPack : 0;
      return { ...l, effectivePacks, frozen, effLeftover, effCost };
    });
    let total = 0;
    let remaining = 0;
    let boughtCount = 0;
    // Дыры в смете: то же правило, что excludedCount в ядре (list.ts), но по
    // ЭФФЕКТИВНЫМ пачкам — с учётом ручных правок числа пачек на клиенте.
    let approxCount = 0;
    for (const l of eff) {
      total += l.effCost;
      if (purchased[l.ingredientId]) boughtCount += 1;
      else remaining += l.effCost;
      if (!l.priced && l.effectivePacks > 0) approxCount += 1;
    }
    const editsCount = eff.filter((l) => l.frozen).length;
    return { lines: eff, total, remaining, boughtCount, editsCount, approxCount };
  }, [list, overrides, purchased]);

  /** Подтвердить покупку: переносим купленное в кладовку, показываем снапшот. */
  const confirm = () => {
    const payload: PurchaseLineInput[] = lines
      .filter((l) => l.effectivePacks > 0)
      .map((l) => ({
        ingredientId: l.ingredientId,
        name: l.name,
        packsBought: l.effectivePacks,
        packSize: l.packSize,
        // Несопоставленные с ВВ (тикет 03): продукт уезжает в кладовку, но цены нет —
        // в снапшот кладём 0, чтобы зафиксированная сумма не выдумывала стоимость.
        pricePerPack: l.priced ? l.pricePerPack : 0,
      }));
    if (payload.length === 0) return;
    startTransition(async () => {
      const { snapshot, refresh } = await confirmPurchaseAction(payload);
      // Купленное уехало в кладовку — правки/чекбоксы больше не актуальны.
      persistOverrides({});
      persistPurchased({});
      setSnapshot(snapshot);
      setCart(null);
      onConfirmed(refresh);
    });
  };

  // Секции по группе продуктов (строки уже отсортированы ядром по группе+имени).
  const sections = useMemo(() => {
    const out: { group: string; lines: EffectiveLine[] }[] = [];
    for (const l of lines) {
      const last = out[out.length - 1];
      if (last && last.group === l.group) last.lines.push(l);
      else out.push({ group: l.group, lines: [l] });
    }
    return out;
  }, [lines]);

  const hasBuyable = lines.some((l) => l.effectivePacks > 0);
  // В корзину ВВ идут только сопоставленные позиции (есть vvXmlId) с пачками к покупке.
  const hasCartItems = lines.some((l) => l.vvXmlId && l.effectivePacks > 0);

  /** Собрать ссылку(и) на корзину ВкусВилл из покупаемых сопоставленных позиций. */
  const openCart = () => {
    const cartLines = lines.map((l) => ({ vvXmlId: l.vvXmlId, quantity: l.effectivePacks }));
    startTransition(async () => {
      const result = await createCartLinksAction(cartLines);
      setCart(result);
    });
  };

  return (
    <div className={`shop${compact ? " is-compact" : ""}${pending ? " is-busy" : ""}`}>
      {/* Снапшот последнего подтверждения — заморожен, не меняется при смене цен. */}
      {snapshot ? (
        <div className="group pantry-snapshot">
          <div className="pantry-snapshot-title">Покупка подтверждена</div>
          <div className="pantry-snapshot-sum num">{rub(snapshot.totalCost)} ₽</div>
          <div className="shop-hint">
            {snapshot.lines.length} поз. перенесено в кладовку. Сумма зафиксирована и
            не изменится при смене цен.
          </div>
          <button type="button" className="btn tinted no-print" onClick={onGoToPantry}>
            Открыть кладовку
          </button>
        </div>
      ) : null}

      {/* Сводка: итог ₽ и остаток к покупке + режим просмотра. */}
      <div className="group shop-summary">
        <div className="shop-total">
          <div className="shop-total-rub num">
            {approxCount > 0 ? "≈ " : ""}
            {rub(total)} ₽
          </div>
          <div className="shop-total-of num">
            {lines.length} поз.
            {boughtCount > 0 ? ` · куплено ${boughtCount}` : ""}
          </div>
        </div>
        {mounted && remaining !== total ? (
          <div className="shop-remaining num">Осталось купить: {rub(remaining)} ₽</div>
        ) : null}
        {approxCount > 0 ? (
          <div className="shop-approx">
            <span className="shop-approx-badge">приблизительно</span>
            <span>
              {approxCount} поз. без цены ВкусВилл — не учтены в сумме. Итог занижен.
            </span>
          </div>
        ) : null}
        <div className="shop-hint">
          Список собран из плана недели целыми пачками за вычетом кладовки. Правка
          числа пачек замораживает позицию до сброса.
        </div>
      </div>

      <div className="shop-controls no-print">
        <SegmentedControl
          options={[
            { key: "full", label: "Полный" },
            { key: "compact", label: "Компакт" },
          ]}
          value={compact ? "compact" : "full"}
          onChange={(k) => setCompact(k === "compact")}
          ariaLabel="Режим списка"
        />
      </div>

      {/* Секции продуктов по группам. */}
      {sections.map((section) => (
        <div key={section.group}>
          <div className="g-title">{section.group}</div>
          <div className="group">
            {section.lines.map((l) => {
              const bought = !!purchased[l.ingredientId];
              return (
                <div
                  className={`shop-row${bought ? " is-bought" : ""}`}
                  key={l.ingredientId}
                >
                  <label className="shop-check">
                    <input
                      type="checkbox"
                      checked={bought}
                      onChange={() => togglePurchased(l.ingredientId)}
                      aria-label={`Куплено: ${l.name}`}
                    />
                  </label>
                  <div className="shop-main">
                    <div className="shop-name">
                      {l.name}
                      {l.frozen ? (
                        <span className="shop-frozen no-print" title="Ручная правка">
                          {" "}
                          ✎
                        </span>
                      ) : null}
                    </div>
                    <div className="shop-detail num">
                      нужно {qty(l.netNeed)} {unitLabel(l.unit)} ·{" "}
                      {l.effectivePacks} {packsWord(l.effectivePacks)} ×{" "}
                      {qty(l.packSize)} {unitLabel(l.unit)}
                      {l.effLeftover > 0 ? (
                        <> · останется {qty(l.effLeftover)} {unitLabel(l.unit)}</>
                      ) : null}
                    </div>
                  </div>
                  <div className="shop-side">
                    {l.priced ? (
                      <div className="shop-cost num">{rub(l.effCost)} ₽</div>
                    ) : (
                      <div
                        className="shop-cost shop-cost-noprice"
                        title="Нет мэтча с ВкусВилл — цена неизвестна, в сумму не входит"
                      >
                        цена ?
                      </div>
                    )}
                    <div className="shop-stepper no-print">
                      <button
                        type="button"
                        onClick={() => setPacks(l, l.effectivePacks - 1)}
                        disabled={l.effectivePacks <= 0}
                        aria-label={`Меньше пачек: ${l.name}`}
                      >
                        −
                      </button>
                      <span className="shop-packs num">{l.effectivePacks}</span>
                      <button
                        type="button"
                        onClick={() => setPacks(l, l.effectivePacks + 1)}
                        aria-label={`Больше пачек: ${l.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="shop-actions no-print">
        {editsCount > 0 ? (
          <button type="button" className="btn gray" onClick={resetEdits} disabled={pending}>
            Сбросить правки ({editsCount})
          </button>
        ) : null}
        <button
          type="button"
          className="btn gray"
          onClick={() => window.print()}
          disabled={pending}
        >
          Печать
        </button>
        <button
          type="button"
          className="btn gray"
          onClick={sync}
          disabled={pending}
        >
          {pending ? "Обновляем…" : "Обновить из плана"}
        </button>
        {hasCartItems ? (
          <button type="button" className="btn tinted" onClick={openCart} disabled={pending}>
            {pending ? "Собираем корзину…" : "Открыть корзину во ВкусВилл"}
          </button>
        ) : null}
        <button type="button" className="btn" onClick={confirm} disabled={pending || !hasBuyable}>
          Подтвердить покупку
        </button>
      </div>

      {/* Ссылка(и) на предзаполненную корзину ВВ. Это ссылка, не заказ/оплата. */}
      {cart ? (
        <div className="group cart-links no-print">
          {cart.empty ? (
            <div className="shop-hint">
              В корзину ВкусВилл пока нечего добавить: ни одна покупаемая позиция не
              сопоставлена с товаром ВкусВилл.
            </div>
          ) : cart.links.length === 0 ? (
            <div className="shop-hint">{cart.error ?? "Не удалось собрать корзину."}</div>
          ) : (
            <>
              <div className="cart-links-title">
                {cart.links.length === 1
                  ? "Корзина ВкусВилл готова"
                  : `Корзина не влезла в одну ссылку — собрали ${cart.links.length} корзин`}
              </div>
              {cart.links.length > 1 ? (
                <div className="shop-hint">
                  Одна ссылка ВкусВилл держит до 20 позиций, поэтому список разбит на
                  части. Открывайте по очереди — каждая добавит свою порцию продуктов.
                </div>
              ) : null}
              <div className="cart-links-list">
                {cart.links.map((url, i) => (
                  <a
                    key={url}
                    className="btn"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {cart.links.length === 1 ? "Открыть корзину" : `Открыть корзину ${i + 1}`}
                  </a>
                ))}
              </div>
              {cart.error ? <div className="shop-hint">{cart.error}</div> : null}
              <div className="shop-hint">
                Это ссылка на корзину, а не заказ и не оплата — авторизация не нужна.
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
