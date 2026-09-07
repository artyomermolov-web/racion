"use client";

// Экран списка покупок (тикет 18). Список — проекция недельного плана: строки
// целыми пачками с суммой ₽ и остатком по позиции. Как и план, он не персистится
// в «тонком» слое, поэтому ручные правки и чекбоксы «куплено» живут на клиенте
// (localStorage):
//   • живой синк — «Пересобрать неделю» собирает свежий план и список под норму;
//   • ручная правка числа пачек ЗАМОРАЖИВАЕТ строку (не пересчитывается) до
//     кнопки «Сбросить правки» — правило заморозки из решения 07;
//   • чекбоксы «куплено» и режим (полный/компакт) — тоже на клиенте.
// Кладовка (вычет запаса) — тикет 19; здесь запас всегда пуст.

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ShoppingList, ShoppingLine } from "@/core/shopping";
import { SegmentedControl } from "@/components/ios/SegmentedControl";
import { syncShoppingListAction } from "@/app/actions/shopping";

const OVERRIDES_KEY = "racion-shopping-overrides";
const PURCHASED_KEY = "racion-shopping-purchased";

/** Количество без хвостовых нулей: 900 → «900», 5.5 → «5.5». */
const qty = (n: number) => Number(n.toFixed(2)).toLocaleString("ru-RU");

/** ₽ целым числом с разбивкой разрядов. */
const rub = (n: number) => Math.round(n).toLocaleString("ru-RU");

/** Единица продажи для подписи: штучные — «шт», жидкости — «мл», иначе «г». */
const unitLabel = (unit: string) => (unit === "pcs" ? "шт" : unit === "ml" ? "мл" : "г");

/** Слово «пачка» в правильной форме для 1/2–4/5+ (1 пачка, 2 пачки, 5 пачек). */
function packsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "пачка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "пачки";
  return "пачек";
}

function loadMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Record<string, T>;
  } catch {
    /* localStorage может быть недоступен */
  }
  return {};
}

function saveMap(key: string, map: Record<string, unknown>) {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    /* игнорируем */
  }
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

export function PokupkiContent({ initial }: { initial: ShoppingList }) {
  const [list, setList] = useState<ShoppingList>(initial);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [purchased, setPurchased] = useState<Record<string, boolean>>({});
  const [compact, setCompact] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pending, startTransition] = useTransition();

  // Ручные правки и чекбоксы читаем после монтирования (как ThemeToggle) —
  // серверный рендер идёт без них, гидрация совпадает.
  useEffect(() => {
    setOverrides(loadMap<number>(OVERRIDES_KEY));
    setPurchased(loadMap<boolean>(PURCHASED_KEY));
    setMounted(true);
  }, []);

  const persistOverrides = (next: Record<string, number>) => {
    setOverrides(next);
    saveMap(OVERRIDES_KEY, next);
  };
  const persistPurchased = (next: Record<string, boolean>) => {
    setPurchased(next);
    saveMap(PURCHASED_KEY, next);
  };

  /** Обновить из плана: ре-синк с текущей неделей (не-замороженные строки). */
  const sync = () => {
    startTransition(async () => {
      const fresh = await syncShoppingListAction();
      if (fresh) setList(fresh);
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
  const { lines, total, remaining, boughtCount, editsCount } = useMemo(() => {
    const eff: EffectiveLine[] = list.lines.map((l) => {
      const override = overrides[l.ingredientId];
      const frozen = override !== undefined;
      const effectivePacks = frozen ? override : l.packsToBuy;
      const effLeftover = Math.max(0, effectivePacks * l.packSize - l.netNeed);
      const effCost = effectivePacks * l.pricePerPack;
      return { ...l, effectivePacks, frozen, effLeftover, effCost };
    });
    let total = 0;
    let remaining = 0;
    let boughtCount = 0;
    for (const l of eff) {
      total += l.effCost;
      if (purchased[l.ingredientId]) boughtCount += 1;
      else remaining += l.effCost;
    }
    const editsCount = eff.filter((l) => l.frozen).length;
    return { lines: eff, total, remaining, boughtCount, editsCount };
  }, [list, overrides, purchased]);

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

  return (
    <div className={`shop${compact ? " is-compact" : ""}${pending ? " is-busy" : ""}`}>
      {/* Сводка: итог ₽ и остаток к покупке + режим просмотра. */}
      <div className="group shop-summary">
        <div className="shop-total">
          <div className="shop-total-rub num">{rub(total)} ₽</div>
          <div className="shop-total-of num">
            {lines.length} поз.
            {boughtCount > 0 ? ` · куплено ${boughtCount}` : ""}
          </div>
        </div>
        {mounted && remaining !== total ? (
          <div className="shop-remaining num">Осталось купить: {rub(remaining)} ₽</div>
        ) : null}
        <div className="shop-hint">
          Список собран из плана недели целыми пачками. Правка числа пачек
          замораживает позицию до сброса.
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
                    <div className="shop-cost num">{rub(l.effCost)} ₽</div>
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
        <button type="button" className="btn" onClick={sync} disabled={pending}>
          {pending ? "Обновляем…" : "Обновить из плана"}
        </button>
      </div>
    </div>
  );
}
