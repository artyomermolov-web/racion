// Сид базы продуктов и рецептов (тикет 13). Запуск: `npm run seed`.
// Идемпотентен: id = slug из seed-data, повторный запуск обновляет записи и
// пересобирает теги/состав. Наполняет стартовый набор, достаточный для сборки
// недели меню; КБЖУ рецептов в БД не хранится — считается из состава на чтении.
import { PrismaClient } from "@prisma/client";
import { INGREDIENTS, RECIPES } from "./seed-data";

const prisma = new PrismaClient();

async function seedIngredients() {
  for (const ing of INGREDIENTS) {
    const fields = {
      name: ing.name,
      group: ing.group,
      unit: ing.unit,
      kcalPer100: ing.kcal,
      proteinPer100: ing.protein,
      fatPer100: ing.fat,
      carbPer100: ing.carb,
      fiberPer100: ing.fiber,
      sodiumPer100: ing.sodium,
      packSize: ing.packSize,
      pricePerPack: ing.pricePerPack,
      shelfLifeDays: ing.shelfLifeDays,
      gramsPerPiece: ing.gramsPerPiece ?? null,
    };
    const allergens = { create: ing.allergens.map((allergen) => ({ allergen })) };
    await prisma.ingredient.upsert({
      where: { id: ing.slug },
      create: { id: ing.slug, ...fields, allergens },
      // Пересобираем теги начисто, чтобы правки в seed-data доезжали.
      update: { ...fields, allergens: { deleteMany: {}, create: allergens.create } },
    });
  }
}

async function seedRecipes() {
  for (const r of RECIPES) {
    const fields = {
      name: r.name,
      steps: r.steps.join("\n"),
      timeMin: r.timeMin,
      difficulty: r.difficulty,
      servings: r.servings,
    };
    const nested = {
      ingredients: {
        create: r.items.map((it) => ({ ingredientId: it.ingredient, grams: it.grams })),
      },
      slots: { create: r.slots.map((slot) => ({ slot })) },
      dietTags: { create: r.diet.map((tag) => ({ tag })) },
      equipment: { create: r.equipment.map((equipment) => ({ equipment })) },
    };
    await prisma.recipe.upsert({
      where: { id: r.slug },
      create: { id: r.slug, ...fields, ...nested },
      update: {
        ...fields,
        ingredients: { deleteMany: {}, create: nested.ingredients.create },
        slots: { deleteMany: {}, create: nested.slots.create },
        dietTags: { deleteMany: {}, create: nested.dietTags.create },
        equipment: { deleteMany: {}, create: nested.equipment.create },
      },
    });
  }
}

async function main() {
  await seedIngredients();
  await seedRecipes();
  console.log(
    `Сид: продуктов ${INGREDIENTS.length}, рецептов ${RECIPES.length}. Готово.`,
  );
}

main()
  .catch((e) => {
    console.error("Ошибка сида:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
