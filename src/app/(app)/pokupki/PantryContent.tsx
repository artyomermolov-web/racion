"use client";

// Вкладка «Кладовка» (тикет 19): что физически дома (real-лоты) со сроком
// годности, и «приготовить из того, что дома» — рецепты, полностью покрытые
// домашним запасом. Real и pending различаются бейджем (pending — прогноз ещё не
// подтверждённой покупки). Данные приходят с сервера; удаление лота (израсходован
// / испортился) зовёт действие и обновляет экран.

import { useMemo, useTransition } from "react";
import type { PantryView, CookableView } from "@/lib/pantry";
import { removePantryLotAction, type PantryRefresh } from "@/app/actions/pantry";
import { EmptyState } from "@/components/ios/EmptyState";
import { qty, unitLabel } from "./format";

/** Дней до срока годности от сегодня (UTC-дата лота). null — без срока. */
function daysLeft(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").getTime();
  const exp = new Date(expiresAt + "T00:00:00.000Z").getTime();
  return Math.round((exp - today) / 86_400_000);
}

/** Подпись срока: «просрочено», «сегодня», «N дн.» с цветовым акцентом. */
function expiryLabel(expiresAt: string | null): { text: string; tone: "warn" | "soon" | "ok" } | null {
  const d = daysLeft(expiresAt);
  if (d === null) return null;
  if (d < 0) return { text: "просрочено", tone: "warn" };
  if (d === 0) return { text: "истекает сегодня", tone: "warn" };
  if (d <= 3) return { text: `${d} дн.`, tone: "soon" };
  return { text: `${d} дн.`, tone: "ok" };
}

/** Слово «порция» в правильной форме. */
function servingsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "порция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "порции";
  return "порций";
}

interface Props {
  pantry: PantryView[];
  cookable: CookableView[];
  onRefresh: (refresh: PantryRefresh) => void;
}

export function PantryContent({ pantry, cookable, onRefresh }: Props) {
  const [pending, startTransition] = useTransition();

  const remove = (lotId: string) => {
    startTransition(async () => {
      onRefresh(await removePantryLotAction(lotId));
    });
  };

  // Секции по группе продукта (лоты уже отсортированы сервером по группе+имени).
  const sections = useMemo(() => {
    const out: { group: string; lots: PantryView[] }[] = [];
    for (const l of pantry) {
      const last = out[out.length - 1];
      if (last && last.group === l.group) last.lots.push(l);
      else out.push({ group: l.group, lots: [l] });
    }
    return out;
  }, [pantry]);

  if (pantry.length === 0) {
    return (
      <EmptyState
        icon="🥫"
        title="Кладовка пуста"
        description="Подтвердите покупку в списке — купленное переедет сюда реальными лотами со сроком годности и будет вычитаться из следующих списков."
      />
    );
  }

  return (
    <div className={`shop${pending ? " is-busy" : ""}`}>
      {/* Приготовить из того, что дома. */}
      {cookable.length > 0 ? (
        <>
          <div className="g-title">Приготовить из того, что дома</div>
          <div className="group">
            {cookable.map((c) => (
              <div className="shop-row" key={c.recipeId}>
                <div className="shop-main">
                  <div className="shop-name">{c.name}</div>
                  <div className="shop-detail num">
                    хватит на {c.servings} {servingsWord(c.servings)}
                    {c.timeMin > 0 ? ` · ${c.timeMin} мин` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* Лоты кладовки по группам. */}
      {sections.map((section) => (
        <div key={section.group}>
          <div className="g-title">{section.group}</div>
          <div className="group">
            {section.lots.map((l) => {
              const exp = expiryLabel(l.expiresAt);
              return (
                <div className="shop-row" key={l.id}>
                  <div className="shop-main">
                    <div className="shop-name">
                      {l.name}
                      {l.kind === "pending" ? (
                        <span className="pantry-badge">ожидается</span>
                      ) : null}
                    </div>
                    <div className="shop-detail num">
                      {qty(l.qty)} {unitLabel(l.unit)}
                      {exp ? (
                        <>
                          {" · "}
                          <span className={`pantry-exp is-${exp.tone}`}>{exp.text}</span>
                        </>
                      ) : (
                        " · без срока"
                      )}
                    </div>
                  </div>
                  <div className="shop-side">
                    <button
                      type="button"
                      className="pantry-remove no-print"
                      onClick={() => remove(l.id)}
                      disabled={pending}
                      aria-label={`Убрать из кладовки: ${l.name}`}
                    >
                      Убрать
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
