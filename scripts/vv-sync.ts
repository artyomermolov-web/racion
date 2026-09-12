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
//  4. Импорт рецептов ВВ (тикет 05): ингредиенты рецепта мэтчатся к каталогу по
//     id/xml_id товара; при сопоставлении ≥80% рецепт заводится/обновляется как
//     `Recipe` Racion (source="vkusvill", vvId — ключ upsert), иначе пропускается.
//     Меню-КБЖУ считается из состава; аллергены — по сопоставленным ингредиентам.
// Провенанс, таким образом, проставлен по всему каталогу. Сеть изолирована в
// адаптере lib/vkusvill/client; вся трансформация — чистые модули core/vkusvill.

import { PrismaClient } from "@prisma/client";
import { productToIngredient } from "../src/core/vkusvill/map";
import { matchIngredient } from "../src/core/vkusvill/match";
import { recipeToRecipe } from "../src/core/vkusvill/recipe";
import type {
  CatalogIndex,
  RecipeImport,
  VvIngredient,
  VvProduct,
  VvRecipe,
} from "../src/core/vkusvill/types";
import { SAMPLE_PRODUCTS, SAMPLE_RECIPES } from "../src/core/vkusvill/fixtures";
import { productsSearchAll, recipesList } from "../src/lib/vkusvill/client";

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

/** Похоже ли значение на рецепт ВВ (лёгкая проверка перед импортом). */
function isRecipe(x: unknown): x is VvRecipe {
  const r = x as VvRecipe;
  return !!r && typeof r === "object" && typeof r.name === "string" && Array.isArray(r.ingredients);
}

/** Живой сбор рецептов ВВ (ограниченный стартовый набор, бережём rate-limit). */
async function fetchLiveRecipes(): Promise<VvRecipe[]> {
  const res = await recipesList({ maxPages: 3 });
  const recipes = res.recipes.filter(isRecipe);
  const note = res.incomplete
    ? ` ⚠ неполно (${res.error ? `${res.error.code}` : "лимит страниц"})`
    : "";
  console.log(`  рецептов получено: ${recipes.length} (${res.pages} стр.)${note}`);
  return recipes;
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

/**
 * Индекс каталога для мэтча ингредиентов рецепта: строка каталога с настоящим
 * vvXmlId, доступная по ОБОИМ ключам товара ВВ (числовой id и строковый xml_id) —
 * рецепт может ссылаться на любой из них. Строится из синканутых товаров (у них
 * есть оба ключа) в паре со строкой БД (её id/аллергены ищем по vvXmlId).
 */
async function buildCatalogIndex(products: VvProduct[]): Promise<CatalogIndex> {
  const rows = await prisma.ingredient.findMany({
    where: { vvXmlId: { not: null } },
    select: { id: true, vvXmlId: true, allergens: { select: { allergen: true } } },
  });
  const byXmlId = new Map(
    rows.map((r) => [r.vvXmlId!, { ingredientId: r.id, allergens: r.allergens.map((a) => a.allergen) }]),
  );
  const index: CatalogIndex = new Map();
  for (const p of products) {
    const entry = byXmlId.get(String(p.xml_id));
    if (!entry) continue;
    index.set(String(p.id), entry);
    index.set(String(p.xml_id), entry);
  }
  return index;
}

/** Идемпотентный upsert одного импортируемого рецепта (ключ — vvId). */
async function upsertRecipe(recipe: RecipeImport, now: Date): Promise<void> {
  const fields = {
    name: recipe.name,
    steps: recipe.steps.join("\n"),
    timeMin: recipe.timeMin,
    difficulty: recipe.difficulty,
    servings: recipe.servings,
    source: recipe.source,
    vvUpdatedAt: now,
  };
  const nested = {
    ingredients: { create: recipe.items.map((it) => ({ ingredientId: it.ingredientId, grams: it.grams })) },
    slots: { create: recipe.slots.map((slot) => ({ slot })) },
  };
  const existing = await prisma.recipe.findUnique({ where: { vvId: recipe.vvId }, select: { id: true } });
  if (existing) {
    // Пересобираем состав/слоты начисто, чтобы правки в источнике доезжали.
    await prisma.recipe.update({
      where: { vvId: recipe.vvId },
      data: {
        ...fields,
        ingredients: { deleteMany: {}, create: nested.ingredients.create },
        slots: { deleteMany: {}, create: nested.slots.create },
      },
    });
  } else {
    await prisma.recipe.create({ data: { id: `vv-${recipe.vvId}`, vvId: recipe.vvId, ...fields, ...nested } });
  }
}

/** Импорт рецептов ВВ по индексу каталога: ≥80% — upsert, иначе пропуск. */
async function importRecipes(
  recipes: VvRecipe[],
  catalogIndex: CatalogIndex,
  now: Date,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  for (const vv of recipes) {
    const { recipe, matchedRatio } = recipeToRecipe(vv, catalogIndex);
    if (!recipe) {
      skipped++;
      console.log(`  ✗ «${vv.name}» пропущен (мэтч ${(matchedRatio * 100).toFixed(0)}% < 80%)`);
      continue;
    }
    await upsertRecipe(recipe, now);
    imported++;
    console.log(`  ✓ «${recipe.name}» импортирован (мэтч ${(matchedRatio * 100).toFixed(0)}%, ${recipe.items.length} ингр.)`);
  }
  return { imported, skipped };
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
    `Каталог: ре-сорс seed ${tally.resourced}, новых ${tally.inserted}, ` +
      `обновлено ${tally.updated}, пропущено ${tally.skipped}. ` +
      `seed-фолбэком осталось ${seedPool.length}.`,
  );

  // Импорт рецептов ВВ поверх обновлённого каталога (тикет 05).
  const recipes = offline ? SAMPLE_RECIPES : await fetchLiveRecipes();
  const catalogIndex = await buildCatalogIndex(products);
  const rec = await importRecipes(recipes, catalogIndex, now);
  console.log(`Рецепты: импортировано ${rec.imported}, пропущено ${rec.skipped}.`);

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
