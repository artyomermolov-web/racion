// Тотальность маппинга группы продукта → значок (тикет 12). Пример чистой
// функции семьи food-labels — тестируется по входу/выходу, как label-мапперы.

import { describe, it, expect } from "vitest";
import { GROUP_ICONS, GROUP_ICON_FALLBACK, groupIcon } from "./food-labels";

// 13 групп сида (prisma/seed-data.ts, объект G) — источник истины для базы.
const SEED_GROUPS = [
  "cereal",
  "dairy",
  "meat",
  "fish",
  "veg",
  "fruit",
  "grocery",
  "egg",
  "nuts",
  "bread",
  "beverage",
  "canned",
  "frozen",
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
    expect(groupIcon("cereal")).toBe("🌾");
    expect(groupIcon("dairy")).toBe("🥛");
    expect(groupIcon("meat")).toBe("🍗");
    expect(groupIcon("fish")).toBe("🐟");
    expect(groupIcon("veg")).toBe("🥦");
    expect(groupIcon("fruit")).toBe("🍎");
    expect(groupIcon("grocery")).toBe("🫙");
    expect(groupIcon("egg")).toBe("🥚");
    expect(groupIcon("nuts")).toBe("🥜");
    expect(groupIcon("bread")).toBe("🍞");
    expect(groupIcon("beverage")).toBe("🥤");
    expect(groupIcon("canned")).toBe("🥫");
    expect(groupIcon("frozen")).toBe("🧊");
  });

  it("у разных групп разные значки (нет коллизий)", () => {
    const icons = SEED_GROUPS.map((g) => groupIcon(g));
    expect(new Set(icons).size).toBe(SEED_GROUPS.length);
  });

  it("неизвестная группа → fallback", () => {
    expect(groupIcon("unknown")).toBe(GROUP_ICON_FALLBACK);
    expect(groupIcon("")).toBe(GROUP_ICON_FALLBACK);
    expect(groupIcon("Cereal")).toBe(GROUP_ICON_FALLBACK); // регистр важен
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
