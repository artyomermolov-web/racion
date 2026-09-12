// Фикстуры товаров ВкусВилл (тикет 01, spec.md шов 1). Форма — реальный ответ
// `vkusvill_products_search` (mode=full): поля id/xml_id/name/price/unit/weight/
// category/properties подтверждены `tools/list` на живом MCP; КБЖУ-строки в
// `properties[].value` — в задокументированном формате ВВ (ADR-0001): русская
// строка «Белки … г, жиры … г, углеводы … г, … ккал», десятичная запятая, у
// молока несколько поставщиков через <br> (ADR-0001: 5 вариантов, 66.8–84.8 ккал).
//
// Публичный MCP держит жёсткий per-IP rate-limit (429 на повторных вызовах —
// ровно как в ADR-0001), поэтому этот курируемый набор служит и оффлайн-демо
// синка (`npm run vv:sync -- --offline`), и покрытием маппера. Живой снапшот —
// когда лимит отпустит: `npm run vv:sync`.

import type { VvProduct } from "./types";

export const SAMPLE_PRODUCTS: VvProduct[] = [
  {
    id: 40100,
    xml_id: "0040100",
    name: "Молоко пастеризованное 3,2%",
    slug: "moloko-pasterizovannoe-3-2",
    price: { current: 89.9, old: 99.9, discount_percent: 10 },
    unit: "шт",
    weight: 0.93,
    category: { id: 12, name: "Молоко, сыр, яйцо" },
    properties: [
      {
        name: "Пищевая ценность в 100 г",
        // Два поставщика через <br>: усредняется (ADR-0001).
        value:
          "Белки&nbsp;2,8&nbsp;г, жиры&nbsp;3,2&nbsp;г, углеводы&nbsp;4,7&nbsp;г, 58&nbsp;ккал<br>Белки 3,0 г, жиры 3,2 г, углеводы 4,8 г, 60 ккал",
      },
    ],
  },
  {
    id: 41220,
    xml_id: "0041220",
    name: "Яйцо куриное С0",
    slug: "yaico-kurinoe-s0",
    price: { current: 129 },
    unit: "шт",
    weight: 0.06, // 60 г — одна штука
    category: { id: 13, name: "Яйцо и яичные продукты" },
    properties: [
      { name: "Пищевая ценность в 100 г", value: "Белки 12,7 г, жиры 11,5 г, углеводы 0,7 г, 157 ккал" },
    ],
  },
  {
    id: 20015,
    xml_id: "0020015",
    name: "Гречка ядрица",
    slug: "grechka-yadrica",
    price: { current: 99, old: 115, discount_percent: 14 },
    unit: "кг",
    weight: 0.9,
    category: { id: 5, name: "Бакалея, крупы и макароны" },
    properties: [
      { name: "Пищевая ценность в 100 г", value: "Белки 12,6 г, жиры 3,3 г, углеводы 62 г, 343 ккал" },
    ],
  },
  {
    id: 30440,
    xml_id: "0030440",
    name: "Творог 5%",
    slug: "tvorog-5",
    price: { current: 109 },
    unit: "шт",
    weight: 0.2,
    category: { id: 12, name: "Молоко, сыр, яйцо" },
    properties: [
      { name: "Пищевая ценность в 100 г", value: "Белки 17,2 г, жиры 5 г, углеводы 3 г, 121 ккал" },
    ],
  },
  {
    id: 51002,
    xml_id: "0051002",
    name: "Филе грудки цыплёнка-бройлера",
    slug: "file-grudki-cyplenka",
    price: { current: 379, old: 429, discount_percent: 12 },
    unit: "кг",
    weight: 0.5,
    category: { id: 8, name: "Мясо и птица" },
    properties: [
      { name: "Пищевая ценность в 100 г", value: "Белки 23,1 г, жиры 1,9 г, углеводы 0,4 г, 113 ккал" },
    ],
  },
  {
    id: 60310,
    xml_id: "0060310",
    name: "Огурцы гладкие",
    slug: "ogurcy-gladkie",
    price: { current: 149 },
    unit: "кг",
    weight: 0.4,
    category: { id: 3, name: "Овощи и зелень" },
    properties: [
      { name: "Пищевая ценность в 100 г", value: "Белки 0,8 г, жиры 0,1 г, углеводы 2,8 г, 15 ккал" },
    ],
  },
];
