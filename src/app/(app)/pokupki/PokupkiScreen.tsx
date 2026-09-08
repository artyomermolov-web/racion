"use client";

// Экран «Покупки» с двумя сегментами (тикет 19): «Список» (проекция плана за
// вычетом кладовки) и «Кладовка» (что дома + приготовить из дома). Состояние
// списка/кладовки/готовки живёт здесь, чтобы подтверждение покупки на «Списке»
// сразу обновляло «Кладовку», а удаление лота — пересобирало список.

import { useState } from "react";
import type { ShoppingList } from "@/core/shopping";
import type { PantryView, CookableView } from "@/lib/pantry";
import type { PantryRefresh } from "@/app/actions/pantry";
import { SegmentedControl } from "@/components/ios/SegmentedControl";
import { EmptyState } from "@/components/ios/EmptyState";
import { PokupkiContent } from "./PokupkiContent";
import { PantryContent } from "./PantryContent";

const EMPTY_LIST: ShoppingList = { lines: [], totalCost: 0 };

interface Props {
  initialList: ShoppingList | null;
  initialPantry: PantryView[];
  initialCookable: CookableView[];
}

export function PokupkiScreen({ initialList, initialPantry, initialCookable }: Props) {
  const [seg, setSeg] = useState<"list" | "pantry">("list");
  const [list, setList] = useState<ShoppingList>(initialList ?? EMPTY_LIST);
  const [pantry, setPantry] = useState<PantryView[]>(initialPantry);
  const [cookable, setCookable] = useState<CookableView[]>(initialCookable);

  const applyRefresh = (r: PantryRefresh) => {
    if (r.list) setList(r.list);
    setPantry(r.pantry);
    setCookable(r.cookable);
  };

  const hasList = list.lines.length > 0;

  return (
    <>
      <div className="shop-controls no-print">
        <SegmentedControl
          options={[
            { key: "list", label: "Список" },
            { key: "pantry", label: pantry.length > 0 ? `Кладовка · ${pantry.length}` : "Кладовка" },
          ]}
          value={seg}
          onChange={(k) => setSeg(k as "list" | "pantry")}
          ariaLabel="Раздел покупок"
        />
      </div>

      {seg === "list" ? (
        hasList ? (
          <PokupkiContent
            list={list}
            onList={setList}
            onConfirmed={applyRefresh}
            onGoToPantry={() => setSeg("pantry")}
          />
        ) : (
          <EmptyState
            icon="🛒"
            title="Список покупок пуст"
            description="Когда появится план питания, список покупок соберётся сам — целыми пачками, за вычетом кладовки и с суммой в ₽."
          />
        )
      ) : (
        <PantryContent pantry={pantry} cookable={cookable} onRefresh={applyRefresh} />
      )}
    </>
  );
}
