import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getPreferencesOverview } from "@/lib/preferences";
import { LargeTitleHeader } from "@/components/ios/LargeTitleHeader";
import { KeywordFilters } from "@/components/KeywordFilters";
import { OnlyRecurringSlots } from "@/components/OnlyRecurringSlots";

const RECURRING_LABEL: Record<string, string> = { often: "Часто", always: "Всегда" };

/** Список рецептов-предпочтений: строки со ссылкой на карточку блюда. */
function RecipeList({
  items,
  empty,
}: {
  items: { recipeId: string; name: string; tag?: string }[];
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <div className="group">
        <div className="row">
          <div className="grow" style={{ color: "var(--label2)" }}>{empty}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="group">
      {items.map((it) => (
        <Link key={it.recipeId} href={`/baza/recept/${it.recipeId}`} className="row">
          <div className="grow" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span>{it.name}</span>
            {it.tag ? <span style={{ color: "var(--label2)" }}>{it.tag}</span> : null}
          </div>
          <span className="chev">›</span>
        </Link>
      ))}
    </div>
  );
}

export default async function VkusyPage() {
  const user = await requireUser();
  const overview = await getPreferencesOverview(user.id);

  return (
    <>
      <LargeTitleHeader
        title="Вкусы"
        leading={
          <Link href="/profil" className="back-link">
            ‹ Профиль
          </Link>
        }
      />
      <main>
        <div className="g-title">Не хочу есть</div>
        <div className="group">
          <KeywordFilters initialTerms={overview.keywordTerms} groups={overview.groups} />
        </div>
        <p className="g-note">
          Блюдо выбывает, если совпадает продукт или его синоним: «курица» уберёт и
          грудку, и бедро, и суп с курицей.
        </p>

        <div className="g-title">Только recurring</div>
        <OnlyRecurringSlots initial={overview.onlyRecurringSlots} />
        <p className="g-note">
          В отмеченные приёмы попадут только блюда, отмеченные «Регулярно» на карточке.
        </p>

        <div className="g-title">Регулярные блюда</div>
        <RecipeList
          items={overview.recurring.map((r) => ({
            recipeId: r.recipeId,
            name: r.name,
            tag: RECURRING_LABEL[r.frequency] ?? r.frequency,
          }))}
          empty="Пока нет. Отметьте блюдо «Регулярно» на его карточке."
        />

        <div className="g-title">Избранное</div>
        <RecipeList
          items={overview.favorites}
          empty="Пока нет. Отметьте блюдо звёздочкой на его карточке."
        />

        <div className="g-title">Заблокированные</div>
        <RecipeList
          items={overview.blocks}
          empty="Пока нет. Заблокировать можно на карточке блюда."
        />
      </main>
    </>
  );
}
