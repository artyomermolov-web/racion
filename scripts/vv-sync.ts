// CLI-синк каталога ВкусВилл в локальную Prisma (тикеты 01–02, ADR-0001).
// Запуск:
//   npm run vv:sync            — живой синк курируемого охвата через MCP;
//   npm run vv:sync -- --offline — оффлайн-демо на фикстурах core/vkusvill
//                                  (публичный MCP держит жёсткий rate-limit 429).
//
// Что делает прогон (идемпотентно, ключ — vvXmlId):
//  1. Сбор курируемого охвата товаров ВВ (нужные пищевые категории + стартовый
//     набор), постранично (client.productsSearchAll, 10/стр., cap, бэкофф на 429).
//  2. Маппинг каждого товара в поля Ingredient (core/vkusvill/map, чистый).
//  3. Ре-сорс seed-каталога: товар, уверенно сопоставленный с seed-ингредиентом
//     (core/vkusvill/match), ЗАМЕЩАЕТ его данные настоящими КБЖУ/ценой ВВ прямо в
//     той же строке (id сохраняется, source="vkusvill", проставляется vvXmlId);
//     несопоставленный товар заводится новой строкой каталога (id = vv-<xmlId>).
//     Несопоставленные seed-ингредиенты остаются с фолбэком (source="seed").
// Провенанс, таким образом, проставлен по всему каталогу. Сеть изолирована в
// адаптере lib/vkusvill/client; вся трансформация — чистые модули core/vkusvill.

import { PrismaClient } from "@prisma/client";
import { productToIngredient } from "../src/core/vkusvill/map";
import { matchIngredient } from "../src/core/vkusvill/match";
import type { VvIngredient, VvProduct } from "../src/core/vkusvill/types";
import { SAMPLE_PRODUCTS } from "../src/core/vkusvill/fixtures";
import { productsSearchAll } from "../src/lib/vkusvill/client";

const prisma = new PrismaClient();

// Курируемый охват (ADR-0001, Q4=a/Q8): узкий, но покрывающий нужные пищевые
// категории и стартовый набор — а не весь каталог ВВ. Так бережём rate-limit и
// держим объём предсказуемым. Расширять список — точечно по мере надобности.
const CURATED_QUERIES = [
  // Молочное и яйцо
  "молоко", "кефир", "творог", "сметана", "йогурт", "сыр", "масло сливочное", "яйцо куриное",
  // Крупы, макароны, бакалея
  "гречка", "рис", "овсяные хлопья", "макароны", "масло растительное",
  // Мясо, птица, рыба
  "куриное филе", "индейка", "говядина", "лосось", "треска",
  // Овощи, фрукты
  "огурцы", "помидоры", "капуста", "банан", "яблоко",
  // Хлеб, орехи
  "хлеб", "орехи",
];

/** Похоже ли значение на товар ВВ (лёгкая проверка перед маппингом). */
function isProduct(x: unknown): x is VvProduct {
  const p = x as VvProduct;
  return !!p && typeof p === "object" && p.price != null && typeof p.name === "string";
}

/** Живой сбор товаров по курируемому охвату (постранично, mode=full). */
async function fetchLive(): Promise<VvProduct[]> {
  const collected: VvProduct[] = [];
  for (const q of CURATED_QUERIES) {
    const res = await productsSearchAll(q, { mode: "full" });
    const products = res.products.filter(isProduct);
    const note = res.incomplete
      ? ` ⚠ неполно (${res.error ? `${res.error.code}` : "лимит страниц"})`
      : "";
    console.log(`  «${q}»: ${products.length} товаров (${res.pages} стр.)${note}`);
    collected.push(...products);
  }
  return collected;
}

/** seed-строка каталога как кандидат для ре-сорса (имя+группа — сигналы мэтча). */
interface SeedRow {
  id: string;
  name: string;
  group: string;
}

/**
 * Применяет один смаппленный товар к базе.
 *  • Строка с таким vvXmlId уже есть (повторный прогон / уже сопоставлено) → update.
 *  • Иначе ищем уверенный мэтч среди ещё не занятых seed-строк → ре-сорс той строки
 *    (id сохраняется), занятую убираем из пула.
 *  • Иначе — новая строка каталога id = vv-<xmlId>.
 * Возвращает вид применения для сводки.
 */
async function apply(
  ing: VvIngredient,
  seedPool: SeedRow[],
  now: Date,
): Promise<"resourced" | "inserted" | "updated"> {
  const { vvXmlId, ...fields } = ing;
  const data = { ...fields, vvUpdatedAt: now };

  const existing = await prisma.ingredient.findUnique({ where: { vvXmlId }, select: { id: true } });
  if (existing) {
    await prisma.ingredient.update({ where: { vvXmlId }, data });
    return "updated";
  }

  const match = matchIngredient({ name: ing.name, group: ing.group }, seedPool);
  if (match) {
    // Занимаем seed-строку: ре-сорсим её данные и вешаем провенанс ВВ.
    const idx = seedPool.findIndex((s) => s.id === match.id);
    if (idx >= 0) seedPool.splice(idx, 1); // одна seed-строка — не более одного товара
    await prisma.ingredient.update({ where: { id: match.id }, data: { ...data, vvXmlId } });
    return "resourced";
  }

  await prisma.ingredient.create({ data: { id: `vv-${vvXmlId}`, vvXmlId, ...data } });
  return "inserted";
}

async function main() {
  const offline = process.argv.includes("--offline");
  console.log(offline ? "Синк ВкусВилл (оффлайн, фикстуры):" : "Синк ВкусВилл (live MCP):");

  const products = offline ? SAMPLE_PRODUCTS : await fetchLive();
  const now = new Date();

  // Пул seed-строк для ре-сорса (ещё не сопоставленные с ВВ). Занятые убираются.
  const seedPool: SeedRow[] = await prisma.ingredient.findMany({
    where: { source: "seed" },
    select: { id: true, name: true, group: true },
  });

  const tally = { resourced: 0, inserted: 0, updated: 0, skipped: 0 };
  for (const p of products) {
    const ing = productToIngredient(p);
    if (!ing) {
      tally.skipped++;
      continue; // нет парсибельного КБЖУ — не источим из ВВ
    }
    tally[await apply(ing, seedPool, now)]++;
  }

  console.log(
    `Готово: ре-сорс seed ${tally.resourced}, новых ${tally.inserted}, ` +
      `обновлено ${tally.updated}, пропущено ${tally.skipped}. ` +
      `seed-фолбэком осталось ${seedPool.length}.`,
  );
  if (!offline && tally.resourced + tally.inserted + tally.updated === 0) {
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
