"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SegmentedControl } from "@/components/ios/SegmentedControl";
import { EmptyState } from "@/components/ios/EmptyState";
import type { IngredientRow, RecipeRow } from "@/lib/food";
import {
  ALLERGEN_LABELS,
  SLOT_LABELS,
  formatTime,
  label,
  massUnit,
} from "@/lib/food-labels";

const TABS = [
  { key: "recipes", label: "Рецепты" },
  { key: "products", label: "Продукты" },
];

// Ключи сортировки: по названию (по возрастанию) и по нутриентам (по убыванию —
// «сначала самое белковое/калорийное», удобно подбирать под КБЖУ, тикет 13).
type SortKey = "name" | "kcal" | "protein" | "fat" | "carb";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "По названию" },
  { key: "kcal", label: "Калории" },
  { key: "protein", label: "Белки" },
  { key: "fat", label: "Жиры" },
  { key: "carb", label: "Углеводы" },
];

const collator = new Intl.Collator("ru");

function Macros({ p, f, c }: { p: number; f: number; c: number }) {
  return (
    <span className="food-macros num">
      <span style={{ color: "var(--p)" }}>Б {p}</span>
      <span style={{ color: "var(--f)" }}>Ж {f}</span>
      <span style={{ color: "var(--c)" }}>У {c}</span>
    </span>
  );
}

export function BazaContent({
  recipes,
  ingredients,
}: {
  recipes: RecipeRow[];
  ingredients: IngredientRow[];
}) {
  const [tab, setTab] = useState("recipes");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("name");

  const q = query.trim().toLowerCase();

  const shownRecipes = useMemo(() => {
    const list = recipes.filter((r) => r.name.toLowerCase().includes(q));
    return list.sort((a, b) =>
      sort === "name"
        ? collator.compare(a.name, b.name)
        : b.perServing[sort] - a.perServing[sort],
    );
  }, [recipes, q, sort]);

  const shownIngredients = useMemo(() => {
    const list = ingredients.filter((i) => i.name.toLowerCase().includes(q));
    return list.sort((a, b) =>
      sort === "name"
        ? collator.compare(a.name, b.name)
        : b.per100[sort] - a.per100[sort],
    );
  }, [ingredients, q, sort]);

  const isRecipes = tab === "recipes";
  const empty = isRecipes ? shownRecipes.length === 0 : shownIngredients.length === 0;

  return (
    <>
      <SegmentedControl
        options={TABS}
        value={tab}
        onChange={setTab}
        ariaLabel="Раздел базы"
      />
      <main>
        <input
          className="input"
          type="search"
          placeholder={isRecipes ? "Поиск рецепта" : "Поиск продукта"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск"
          style={{ marginBottom: 12 }}
        />
        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="baza-sort">Сортировка</label>
          <select
            id="baza-sort"
            className="input"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {empty ? (
          <EmptyState
            icon="🔍"
            title="Ничего не найдено"
            description="Попробуйте изменить запрос или сбросить поиск."
          />
        ) : isRecipes ? (
          <div className="group">
            {shownRecipes.map((r) => (
              <Link key={r.id} href={`/baza/recept/${r.id}`} className="row food-row">
                <div className="grow">
                  <div className="food-title">{r.name}</div>
                  <div className="food-sub num">
                    {r.perServing.kcal} ккал · {formatTime(r.timeMin)}
                    {r.slots.length
                      ? ` · ${r.slots.map((s) => label(SLOT_LABELS, s)).join(", ")}`
                      : ""}
                  </div>
                  <Macros
                    p={r.perServing.protein}
                    f={r.perServing.fat}
                    c={r.perServing.carb}
                  />
                </div>
                <span className="chev">›</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="group">
            {shownIngredients.map((i) => (
              <div key={i.id} className="row food-row">
                <div className="grow">
                  <div className="food-title">{i.name}</div>
                  <div className="food-sub num">
                    {i.per100.kcal} ккал · на 100 {massUnit(i.unit)}
                    {i.allergens.length
                      ? ` · ${i.allergens.map((a) => label(ALLERGEN_LABELS, a)).join(", ")}`
                      : ""}
                  </div>
                  <Macros p={i.per100.protein} f={i.per100.fat} c={i.per100.carb} />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
