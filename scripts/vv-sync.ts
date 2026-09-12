// CLI-синк каталога ВкусВилл в локальную Prisma (тикет 01, ADR-0001).
// Запуск:
//   npm run vv:sync            — живой синк курируемого набора через MCP;
//   npm run vv:sync -- --offline — оффлайн-демо на фикстурах core/vkusvill
//                                  (публичный MCP держит жёсткий rate-limit).
//
// Спина слайса: сеть (client) → чистый маппер (core) → идемпотентный upsert по
// vvXmlId, source="vkusvill", vvUpdatedAt=now. Повторный прогон не плодит дубли.
// Несопоставленные/непарсибельные товары пропускаются (тикет 02 ре-сорсит seed).

import { PrismaClient } from "@prisma/client";
import { productToIngredient } from "../src/core/vkusvill/map";
import type { VvIngredient, VvProduct } from "../src/core/vkusvill/types";
import { SAMPLE_PRODUCTS } from "../src/core/vkusvill/fixtures";
import { productsSearch } from "../src/lib/vkusvill/client";

const prisma = new PrismaClient();

// Курируемый охват (ADR-0001): узкий набор запросов, а не весь каталог — бережём
// rate-limit и детерминированные тесты. Расширение — тикет 02.
const CURATED_QUERIES = ["молоко", "творог", "яйцо куриное", "гречка", "куриное филе", "огурцы"];

/** Похоже ли значение на товар ВВ (лёгкая проверка перед маппингом). */
function isProduct(x: unknown): x is VvProduct {
  const p = x as VvProduct;
  return !!p && typeof p === "object" && p.price != null && typeof p.name === "string";
}

/** Живой сбор товаров по курируемым запросам (страница 1, mode=full). */
async function fetchLive(): Promise<VvProduct[]> {
  const collected: VvProduct[] = [];
  for (const q of CURATED_QUERIES) {
    const res = await productsSearch(q, { page: 1, mode: "full" });
    if (!res.ok) {
      console.warn(`  ⚠ «${q}»: ${res.error.code} — ${res.error.message} (пропуск)`);
      continue;
    }
    const products = (res.data.products ?? []).filter(isProduct);
    console.log(`  «${q}»: ${products.length} товаров`);
    collected.push(...products);
  }
  return collected;
}

/** Upsert одного смаппленного товара по vvXmlId; id = vv-<xmlId> (стабилен). */
async function upsert(ing: VvIngredient, now: Date): Promise<void> {
  // VvIngredient задуман «готовым к upsert» (types.ts): все его поля, кроме
  // vvXmlId, — колонки Ingredient. Деструктуризация избавляет от ручного
  // перечисления, чтобы новое поле проекции не требовало правки в трёх местах.
  const { vvXmlId, ...fields } = ing;
  const data = { ...fields, vvUpdatedAt: now };
  await prisma.ingredient.upsert({
    where: { vvXmlId },
    create: { id: `vv-${vvXmlId}`, vvXmlId, ...data },
    update: data,
  });
}

async function main() {
  const offline = process.argv.includes("--offline");
  console.log(offline ? "Синк ВкусВилл (оффлайн, фикстуры):" : "Синк ВкусВилл (live MCP):");

  const products = offline ? SAMPLE_PRODUCTS : await fetchLive();
  const now = new Date();

  let upserted = 0;
  let skipped = 0;
  for (const p of products) {
    const ing = productToIngredient(p);
    if (!ing) {
      skipped++;
      continue; // нет парсибельного КБЖУ — не источим из ВВ
    }
    await upsert(ing, now);
    upserted++;
  }

  console.log(`Готово: обновлено ${upserted}, пропущено ${skipped}.`);
  if (!offline && upserted === 0) {
    console.log(
      "Живой синк ничего не принёс (вероятно rate-limit 429). Демо-набор: npm run vv:sync -- --offline",
    );
  }
}

main()
  .catch((e) => {
    console.error("Ошибка синка:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
