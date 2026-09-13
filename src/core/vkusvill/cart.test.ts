import { describe, it, expect } from "vitest";
import { buildCartChunks, MAX_ITEMS_PER_CART } from "./cart";
import type { CartLine } from "./cart";

// Разбиение списка покупок на группы для ссылок-корзин ВкусВилл (тикет 04,
// spec.md шов 1, Q2/Q11). Проверяем внешнее поведение чистой функции: только
// позиции с vvXmlId, группы ≤20, количество зажато в допустимый диапазон ВВ.
// Сеть (cart_link_create) сюда не входит — она в адаптере lib/vkusvill/client.ts.

const line = (vvXmlId: string | null, quantity: number): CartLine => ({ vvXmlId, quantity });

describe("buildCartChunks — одна группа", () => {
  it("несколько сопоставленных позиций → одна группа {xml_id,q}", () => {
    const chunks = buildCartChunks([
      line("0040100", 2),
      line("0020015", 1),
    ]);
    expect(chunks).toEqual([
      [
        { xml_id: "0040100", q: 2 },
        { xml_id: "0020015", q: 1 },
      ],
    ]);
  });

  it("ровно 20 позиций укладываются в одну группу", () => {
    const lines = Array.from({ length: 20 }, (_, i) => line(String(1000 + i), 1));
    const chunks = buildCartChunks(lines);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(20);
  });
});

describe("buildCartChunks — несколько групп (≤20 на ссылку)", () => {
  it("21 позиция бьётся на 20 + 1", () => {
    const lines = Array.from({ length: 21 }, (_, i) => line(String(1000 + i), 1));
    const chunks = buildCartChunks(lines);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(MAX_ITEMS_PER_CART);
    expect(chunks[1]).toHaveLength(1);
    // Порядок сохраняется: последний товар — в хвостовой группе.
    expect(chunks[1][0].xml_id).toBe("1020");
  });

  it("45 позиций → 20 + 20 + 5", () => {
    const lines = Array.from({ length: 45 }, (_, i) => line(String(i), 1));
    const chunks = buildCartChunks(lines);
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5]);
  });
});

describe("buildCartChunks — дробные количества", () => {
  it("дробное q сохраняется (весовой товар, пачки не целые)", () => {
    const chunks = buildCartChunks([line("0020015", 1.5)]);
    expect(chunks[0][0].q).toBe(1.5);
  });

  it("q округляется до 2 знаков (шум плавающей точки)", () => {
    const chunks = buildCartChunks([line("0020015", 0.1 + 0.2)]);
    expect(chunks[0][0].q).toBe(0.3);
  });
});

describe("buildCartChunks — фильтрация позиций", () => {
  it("позиции без vvXmlId пропускаются (несопоставленные с ВВ)", () => {
    const chunks = buildCartChunks([
      line(null, 3),
      line("0040100", 2),
      line("", 1),
    ]);
    expect(chunks).toEqual([[{ xml_id: "0040100", q: 2 }]]);
  });

  it("нулевое/отрицательное количество пропускается", () => {
    const chunks = buildCartChunks([
      line("0040100", 0),
      line("0020015", -1),
      line("0030440", 2),
    ]);
    expect(chunks).toEqual([[{ xml_id: "0030440", q: 2 }]]);
  });

  it("нет ни одной сопоставленной позиции → пустой список групп", () => {
    expect(buildCartChunks([line(null, 2), line("", 1)])).toEqual([]);
    expect(buildCartChunks([])).toEqual([]);
  });
});

describe("buildCartChunks — зажим количества в допустимый диапазон ВВ (0.01–40)", () => {
  it("q больше 40 зажимается до 40", () => {
    const chunks = buildCartChunks([line("0040100", 99)]);
    expect(chunks[0][0].q).toBe(40);
  });

  it("крошечное положительное q поднимается до минимума 0.01", () => {
    const chunks = buildCartChunks([line("0040100", 0.001)]);
    expect(chunks[0][0].q).toBe(0.01);
  });
});
