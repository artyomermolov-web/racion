# 01: Настоящие КБЖУ и цена товара ВкусВилл в приложении

**What to build:** Тонкий сквозной путь: продукт в приложении показывает настоящие КБЖУ и цену из ВкусВилл с бейджем провенанса. Это трейсер-буллет — устанавливает весь хребет интеграции (сеть → схема → парсинг → маппинг → синк → UI) на узком наборе товаров.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Опора: [spec](../spec.md), [ADR-0001](../../../docs/adr/0001-vkusvill-edinyy-istochnik-sync.md), `CONTEXT.md` (Товар ВВ, Провенанс).

- [ ] Минимальный MCP-адаптер `src/lib/vkusvill/client.ts` (JSON-RPC, `tools/call`, конверт `{ok,data}`, UTF-8) — только методы, нужные этому слайсу; единственная точка сети.
- [ ] Поля на `Ingredient`: `source` (`seed|vkusvill`, default `seed`), `vvXmlId?` (индекс), `vvPriceOld?`, `vvDiscountPct?`, `vvUpdatedAt?` + миграция Prisma.
- [ ] Чистый парсер `core/vkusvill/parse.ts` (`parseVkusvillNutrition → FoodNutrients`, усреднение по поставщикам) + тест на фикстурах.
- [ ] Чистый маппер `core/vkusvill/map.ts` (`productToIngredient`, штучный/весовой, скидка в отдельные поля, категория→group) + тест на фикстурах.
- [ ] Синк небольшого набора товаров в Prisma (upsert по `vvXmlId`), проставляет `source="vkusvill"`.
- [ ] Карточка продукта показывает реальные КБЖУ/цену ВВ и бейдж «данные ВкусВилл».
- [ ] Демо: выбранный продукт «оживает» на данных ВВ; `npm run build` зелёный.
