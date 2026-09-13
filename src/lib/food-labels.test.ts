// Тотальность маппинга группы продукта → значок (тикет 12). Пример чистой
// функции семьи food-labels — тестируется по входу/выходу, как label-мапперы.

import { describe, it, expect } from "vitest";
import { GROUP_ICONS, GROUP_ICON_FALLBACK, groupIcon } from "./food-labels";

// 13 групп сида — фактические значения Ingredient.group в БД (русские подписи из
// объекта G в prisma/seed-data.ts, которыми seed.ts заполняет колонку group).
const SEED_GROUPS = [
  "Крупы и макароны",
  "Молочные продукты",
  "Мясо и птица",
  "Рыба и морепродукты",
  "Овощи",
  "Фрукты и ягоды",
  "Бакалея",
  "Яйца",
  "Орехи и семечки",
  "Хлеб и выпечка",
  "Напитки",
  "Консервы",
  "Замороженное",
] as const;

describe("groupIcon", () => {
  it("даёт значок для каждой из 13 групп сида (тотальность)", () => {
    for (const g of SEED_GROUPS) {
      const icon = groupIcon(g);
      expect(icon).toBeTruthy();
      // Известная группа не должна проваливаться в fallback.
      expect(icon).not.toBe(GROUP_ICON_FALLBACK);
    }
  });

  it("покрывает ровно 13 групп сида и ничего лишнего", () => {
    expect(Object.keys(GROUP_ICONS).sort()).toEqual([...SEED_GROUPS].sort());
  });

  it("совпадает с таблицей spec.md по каждой группе", () => {
    expect(groupIcon("Крупы и макароны")).toBe("🌾");
    expect(groupIcon("Молочные продукты")).toBe("🥛");
    expect(groupIcon("Мясо и птица")).toBe("🍗");
    expect(groupIcon("Рыба и морепродукты")).toBe("🐟");
    expect(groupIcon("Овощи")).toBe("🥦");
    expect(groupIcon("Фрукты и ягоды")).toBe("🍎");
    expect(groupIcon("Бакалея")).toBe("🫙");
    expect(groupIcon("Яйца")).toBe("🥚");
    expect(groupIcon("Орехи и семечки")).toBe("🥜");
    expect(groupIcon("Хлеб и выпечка")).toBe("🍞");
    expect(groupIcon("Напитки")).toBe("🥤");
    expect(groupIcon("Консервы")).toBe("🥫");
    expect(groupIcon("Замороженное")).toBe("🧊");
  });

  it("у разных групп разные значки (нет коллизий)", () => {
    const icons = SEED_GROUPS.map((g) => groupIcon(g));
    expect(new Set(icons).size).toBe(SEED_GROUPS.length);
  });

  it("неизвестная группа → fallback", () => {
    expect(groupIcon("unknown")).toBe(GROUP_ICON_FALLBACK);
    expect(groupIcon("")).toBe(GROUP_ICON_FALLBACK);
    expect(groupIcon("egg")).toBe(GROUP_ICON_FALLBACK); // ключ, а не подпись — fallback
    expect(groupIcon("овощи")).toBe(GROUP_ICON_FALLBACK); // регистр важен
  });

  it("нет группы (рецепт / null / undefined) → fallback", () => {
    expect(groupIcon(null)).toBe(GROUP_ICON_FALLBACK);
    expect(groupIcon(undefined)).toBe(GROUP_ICON_FALLBACK);
    expect(groupIcon()).toBe(GROUP_ICON_FALLBACK);
  });

  it("fallback — тарелка (рецепт / без группы)", () => {
    expect(GROUP_ICON_FALLBACK).toBe("🍽️");
  });
});
