import Link from "next/link";
import { notFound } from "next/navigation";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { InsetGroupedList, Row } from "@/components/ios/InsetGroupedList";
import { getRecipeDetail } from "@/lib/food";
import {
  ALLERGEN_LABELS,
  DIET_LABELS,
  EQUIPMENT_LABELS,
  SLOT_LABELS,
  difficultyLabel,
  formatGrams,
  formatTime,
  label,
  massUnit,
} from "@/lib/food-labels";

const MACROS = [
  { key: "protein", label: "Белки", color: "var(--p)" },
  { key: "fat", label: "Жиры", color: "var(--f)" },
  { key: "carb", label: "Углеводы", color: "var(--c)" },
] as const;

// Мета-строка «ключ — значение».
function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <Row>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ color: "var(--label2)" }}>{k}</span>
        <span className="num" style={{ textAlign: "right" }}>{v}</span>
      </div>
    </Row>
  );
}

export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const recipe = await getRecipeDetail(id);
  if (!recipe) notFound();

  const { perServing } = recipe;

  return (
    <>
      <LargeTitleHeader
        title={recipe.name}
        leading={
          <Link href="/baza" className="back-link">
            ‹ База
          </Link>
        }
      />
      <main>
        {/* КБЖУ на порцию — считается из состава (тикет 13). */}
        <div className="g-title">КБЖУ на порцию</div>
        <div className="group">
          <div className="norm-head">
            <div className="norm-kcal num">{perServing.kcal}</div>
            <div className="norm-kcal-unit">ккал в порции</div>
          </div>
          <div className="norm-macros">
            {MACROS.map((m) => (
              <div className="norm-macro" key={m.key}>
                <span className="norm-dot" style={{ background: m.color }} />
                <div className="l">{m.label}</div>
                <div className="v num">{perServing[m.key]} г</div>
              </div>
            ))}
          </div>
          <div className="norm-fiber">
            Клетчатка <span className="num">{perServing.fiber} г</span> · натрий{" "}
            <span className="num">{perServing.sodium} мг</span>
          </div>
        </div>

        <InsetGroupedList title="О рецепте">
          <MetaRow k="Время" v={formatTime(recipe.timeMin)} />
          <MetaRow k="Сложность" v={difficultyLabel(recipe.difficulty)} />
          <MetaRow k="Порций" v={String(recipe.servings)} />
          {recipe.slots.length ? (
            <MetaRow
              k="Приёмы"
              v={recipe.slots.map((s) => label(SLOT_LABELS, s)).join(", ")}
            />
          ) : null}
          {recipe.diet.length ? (
            <MetaRow
              k="Диета"
              v={recipe.diet.map((d) => label(DIET_LABELS, d)).join(", ")}
            />
          ) : null}
          {recipe.equipment.length ? (
            <MetaRow
              k="Техника"
              v={recipe.equipment.map((e) => label(EQUIPMENT_LABELS, e)).join(", ")}
            />
          ) : null}
          <MetaRow
            k="Аллергены"
            v={
              recipe.allergens.length
                ? recipe.allergens.map((a) => label(ALLERGEN_LABELS, a)).join(", ")
                : "нет"
            }
          />
        </InsetGroupedList>

        <InsetGroupedList title={`Ингредиенты · на ${recipe.servings} порц.`}>
          {recipe.ingredients.map((ing, i) => (
            <Row key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{ing.name}</span>
                <span className="num" style={{ color: "var(--label2)" }}>
                  {formatGrams(ing.grams)} {massUnit(ing.unit)}
                </span>
              </div>
            </Row>
          ))}
        </InsetGroupedList>

        <div className="g-title">Приготовление</div>
        <ol className="steps">
          {recipe.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </main>
    </>
  );
}
