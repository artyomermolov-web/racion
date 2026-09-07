import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { InsetGroupedList, Row } from "@/components/ios/InsetGroupedList";
import { RecipePreferences } from "@/components/RecipePreferences";
import { getRecipeDetail } from "@/lib/food";
import { getRecipePreference } from "@/lib/preferences";
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
  { key: "fiber", label: "Клетчатка", color: "var(--fb)" },
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
  const user = await requireUser();
  const recipe = await getRecipeDetail(id, user.id);
  if (!recipe) notFound();

  const { perServing } = recipe;
  const preference = await getRecipePreference(user.id, recipe.id);
  const isOwn = recipe.ownerUserId === user.id;
  const isBase = recipe.ownerUserId === null;

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
        {/* Персонализация базового рецепта (тикет 17): своя версия заменит
            оригинал в новых планах. Для своих рецептов — управление в «Своё». */}
        {isBase ? (
          <div className="group">
            <Link
              href={`/svoe/recept/new?base=${recipe.id}`}
              className="row"
              style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
            >
              <span className="grow">Персонализировать рецепт</span>
              <span className="chev">›</span>
            </Link>
          </div>
        ) : isOwn ? (
          <div className="group">
            <Link
              href="/svoe"
              className="row"
              style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
            >
              <span className="grow">
                Ваш рецепт{recipe.baseRecipeId ? " (моя версия)" : ""} — управлять в «Своё»
              </span>
              <span className="chev">›</span>
            </Link>
          </div>
        ) : null}

        {/* Действия предпочтений (тикет 16): избранное, блок, recurring. */}
        <div className="g-title">Ваши предпочтения</div>
        <div className="group">
          <RecipePreferences recipeId={recipe.id} initial={preference} />
        </div>

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
            Натрий <span className="num">{perServing.sodium} мг</span>
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
