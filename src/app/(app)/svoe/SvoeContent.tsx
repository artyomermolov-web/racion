"use client";

// Экран «Своё» (тикет 17): кастом-продукты (ручной КБЖУ) и свои рецепты. Продукт
// генератор сам не берёт — он попадает в план только как recurring (отсюда
// переключатель «Регулярно» у продукта). Рецепты (кастом/персонализация) генератор
// использует наравне с базой. Состояние — на сервере; здесь оптимистичное
// отражение и вызовы серверных действий.

import { useState, useTransition } from "react";
import Link from "next/link";
import { SegmentedControl } from "@/components/ios/SegmentedControl";
import { EmptyState } from "@/components/ios/EmptyState";
import { CustomProductForm } from "./CustomProductForm";
import {
  deleteCustomProductAction,
  setProductRecurringAction,
  deleteCustomRecipeAction,
} from "@/app/actions/customFood";
import type { CustomProductRow, CustomRecipeRow } from "@/lib/customFood";
import type { RecurringFrequency } from "@/lib/preferences";
import { ALLERGEN_LABELS, label, massUnit, formatTime } from "@/lib/food-labels";

const TABS = [
  { key: "products", label: "Продукты" },
  { key: "recipes", label: "Рецепты" },
];

function Macros({ p, f, c }: { p: number; f: number; c: number }) {
  return (
    <span className="food-macros num">
      <span style={{ color: "var(--p)" }}>Б {p}</span>
      <span style={{ color: "var(--f)" }}>Ж {f}</span>
      <span style={{ color: "var(--c)" }}>У {c}</span>
    </span>
  );
}

/** Строка кастом-продукта: КБЖУ, переключатель recurring и удаление. */
function ProductRow({ product }: { product: CustomProductRow }) {
  const [recurring, setRecurring] = useState<RecurringFrequency | null>(
    product.recurring,
  );
  const [removed, setRemoved] = useState(false);
  const [pending, startTransition] = useTransition();

  if (removed) return null;

  const setFreq = (freq: RecurringFrequency | null) =>
    startTransition(async () => setRecurring(await setProductRecurringAction(product.id, freq)));

  const remove = () =>
    startTransition(async () => {
      setRemoved(true);
      await deleteCustomProductAction(product.id);
    });

  return (
    <div className="row" style={{ display: "block" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div className="grow">
          <div className="food-title">{product.name}</div>
          <div className="food-sub num">
            {product.per100.kcal} ккал · на 100 {massUnit(product.unit)}
            {product.allergens.length
              ? ` · ${product.allergens.map((a) => label(ALLERGEN_LABELS, a)).join(", ")}`
              : ""}
          </div>
          <Macros p={product.per100.protein} f={product.per100.fat} c={product.per100.carb} />
        </div>
        <button
          type="button"
          className="linklike danger"
          onClick={remove}
          disabled={pending}
          aria-label={`Удалить продукт ${product.name}`}
        >
          Удалить
        </button>
      </div>

      <div className="prefs-recurring" style={{ marginTop: 10 }}>
        <span className="prefs-label">В план</span>
        <div className="seg" role="tablist" aria-label="Как часто ставить продукт в план">
          <button
            role="tab"
            aria-selected={recurring === null}
            disabled={pending}
            onClick={() => setFreq(null)}
          >
            Нет
          </button>
          <button
            role="tab"
            aria-selected={recurring === "often"}
            disabled={pending}
            onClick={() => setFreq("often")}
          >
            Часто
          </button>
          <button
            role="tab"
            aria-selected={recurring === "always"}
            disabled={pending}
            onClick={() => setFreq("always")}
          >
            Всегда
          </button>
        </div>
      </div>
    </div>
  );
}

/** Строка своего рецепта: КБЖУ, пометка персонализации, ссылка и удаление. */
function RecipeRow({ recipe }: { recipe: CustomRecipeRow }) {
  const [removed, setRemoved] = useState(false);
  const [pending, startTransition] = useTransition();
  if (removed) return null;

  const remove = () =>
    startTransition(async () => {
      setRemoved(true);
      await deleteCustomRecipeAction(recipe.id);
    });

  return (
    <div className="row" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <Link href={`/baza/recept/${recipe.id}`} className="grow" style={{ color: "inherit" }}>
        <div className="food-title">
          {recipe.name}
          {recipe.baseName ? <span className="badge">моя версия</span> : null}
        </div>
        <div className="food-sub num">
          {recipe.perServing.kcal} ккал · {formatTime(recipe.timeMin)}
          {recipe.baseName ? ` · вместо «${recipe.baseName}»` : ""}
        </div>
        <Macros p={recipe.perServing.protein} f={recipe.perServing.fat} c={recipe.perServing.carb} />
      </Link>
      <button
        type="button"
        className="linklike danger"
        onClick={remove}
        disabled={pending}
        aria-label={`Удалить рецепт ${recipe.name}`}
      >
        Удалить
      </button>
    </div>
  );
}

export function SvoeContent({
  products,
  recipes,
}: {
  products: CustomProductRow[];
  recipes: CustomRecipeRow[];
}) {
  const [tab, setTab] = useState("products");

  return (
    <>
      <SegmentedControl options={TABS} value={tab} onChange={setTab} ariaLabel="Раздел своего" />
      <main>
        {tab === "products" ? (
          <>
            <div className="g-title">Новый продукт</div>
            <div className="group">
              <CustomProductForm />
            </div>
            <p className="g-note">
              Свой продукт с ручным КБЖУ. Генератор сам его не берёт — отметьте
              «В план: Часто/Всегда», чтобы он попадал в меню.
            </p>

            <div className="g-title">Мои продукты</div>
            {products.length === 0 ? (
              <EmptyState
                icon="🥫"
                title="Пока пусто"
                description="Добавьте продукт с ручным КБЖУ формой выше."
              />
            ) : (
              <div className="group">
                {products.map((p) => (
                  <ProductRow key={p.id} product={p} />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <Link href="/svoe/recept/new" className="btn" style={{ marginTop: 16 }}>
              + Создать рецепт
            </Link>
            <p className="g-note">
              Свой рецепт генератор использует наравне с базой. Персонализировать
              базовый рецепт можно с его карточки — ваша версия заменит оригинал.
            </p>

            <div className="g-title">Мои рецепты</div>
            {recipes.length === 0 ? (
              <EmptyState
                icon="🍲"
                title="Пока пусто"
                description="Создайте свой рецепт или персонализируйте базовый."
              />
            ) : (
              <div className="group">
                {recipes.map((r) => (
                  <RecipeRow key={r.id} recipe={r} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
