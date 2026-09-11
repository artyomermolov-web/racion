import { describe, it, expect } from "vitest";
import {
  recentRefs,
  frequentIngredientRefs,
  favoriteRefs,
  type LoggedRef,
} from "./segments";
import type { DiarySource } from "./types";

// Хелпер: ссылка на залогированную еду с моментом записи (at — мс, «новизна»).
function logged(source: DiarySource, refId: string, at: number): LoggedRef {
  return { source, refId, at };
}

describe("recentRefs", () => {
  it("уникальная еда, недавняя первой (по последнему логу)", () => {
    const refs = recentRefs([
      logged("ingredient", "egg", 100),
      logged("recipe", "soup", 300),
      logged("ingredient", "rice", 200),
    ]);
    expect(refs).toEqual([
      { source: "recipe", refId: "soup" },
      { source: "ingredient", refId: "rice" },
      { source: "ingredient", refId: "egg" },
    ]);
  });

  it("повтор одной еды схлопывается в один ref по самой свежей записи", () => {
    const refs = recentRefs([
      logged("ingredient", "egg", 100),
      logged("recipe", "soup", 250),
      logged("ingredient", "egg", 400), // тот же egg, но свежее
    ]);
    expect(refs).toEqual([
      { source: "ingredient", refId: "egg" },
      { source: "recipe", refId: "soup" },
    ]);
  });

  it("продукт и рецепт с одинаковым id — разные ссылки (ключ учитывает source)", () => {
    const refs = recentRefs([
      logged("ingredient", "x", 100),
      logged("recipe", "x", 200),
    ]);
    expect(refs).toHaveLength(2);
  });

  it("ограничивает число ссылок лимитом (самые свежие)", () => {
    const refs = recentRefs(
      [
        logged("ingredient", "a", 100),
        logged("ingredient", "b", 200),
        logged("ingredient", "c", 300),
      ],
      2,
    );
    expect(refs).toEqual([
      { source: "ingredient", refId: "c" },
      { source: "ingredient", refId: "b" },
    ]);
  });

  it("пустой вход → пустой список", () => {
    expect(recentRefs([])).toEqual([]);
  });
});

describe("frequentIngredientRefs", () => {
  it("продукты по числу записей (убыв.), рецепты игнорируются", () => {
    const refs = frequentIngredientRefs([
      logged("ingredient", "egg", 10),
      logged("ingredient", "egg", 20),
      logged("ingredient", "egg", 30),
      logged("ingredient", "rice", 40),
      logged("ingredient", "rice", 50),
      logged("ingredient", "oats", 60),
      logged("recipe", "soup", 70), // рецепт — не «частый продукт»
    ]);
    expect(refs).toEqual([
      { source: "ingredient", refId: "egg" }, // 3 раза
      { source: "ingredient", refId: "rice" }, // 2 раза
      { source: "ingredient", refId: "oats" }, // 1 раз
    ]);
  });

  it("при равной частоте — недавний первым", () => {
    const refs = frequentIngredientRefs([
      logged("ingredient", "old", 10),
      logged("ingredient", "new", 90),
    ]);
    expect(refs).toEqual([
      { source: "ingredient", refId: "new" },
      { source: "ingredient", refId: "old" },
    ]);
  });

  it("ограничивает число ссылок лимитом", () => {
    const refs = frequentIngredientRefs(
      [
        logged("ingredient", "a", 10),
        logged("ingredient", "a", 11),
        logged("ingredient", "a", 12),
        logged("ingredient", "b", 20),
        logged("ingredient", "b", 21),
        logged("ingredient", "c", 30),
      ],
      2,
    );
    expect(refs).toEqual([
      { source: "ingredient", refId: "a" },
      { source: "ingredient", refId: "b" },
    ]);
  });

  it("нет продуктов в логе → пустой список", () => {
    expect(frequentIngredientRefs([logged("recipe", "soup", 10)])).toEqual([]);
  });
});

describe("favoriteRefs", () => {
  it("избранные рецепты первыми, затем частые продукты", () => {
    const refs = favoriteRefs(
      ["r1", "r2"],
      [
        { source: "ingredient", refId: "egg" },
        { source: "ingredient", refId: "rice" },
      ],
    );
    expect(refs).toEqual([
      { source: "recipe", refId: "r1" },
      { source: "recipe", refId: "r2" },
      { source: "ingredient", refId: "egg" },
      { source: "ingredient", refId: "rice" },
    ]);
  });

  it("без избранных рецептов — только частые продукты", () => {
    const refs = favoriteRefs([], [{ source: "ingredient", refId: "egg" }]);
    expect(refs).toEqual([{ source: "ingredient", refId: "egg" }]);
  });

  it("без избранного и частого — пусто", () => {
    expect(favoriteRefs([], [])).toEqual([]);
  });
});
