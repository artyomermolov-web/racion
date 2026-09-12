// Публичный интерфейс чистого ядра интеграции ВкусВилл (тикет 01, spec.md шов 1):
// парсер КБЖУ-строк и маппер «Товар ВВ → Ingredient». Сеть/БД сюда не входят —
// они в адаптере src/lib/vkusvill/client.ts и синке scripts/vv-sync.ts.
export * from "./types";
export * from "./parse";
export * from "./map";
export * from "./match";
export * from "./cart";
