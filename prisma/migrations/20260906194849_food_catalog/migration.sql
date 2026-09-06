-- CreateTable
CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "kcalPer100" REAL NOT NULL,
    "proteinPer100" REAL NOT NULL,
    "fatPer100" REAL NOT NULL,
    "carbPer100" REAL NOT NULL,
    "fiberPer100" REAL NOT NULL DEFAULT 0,
    "sodiumPer100" REAL NOT NULL DEFAULT 0,
    "packSize" REAL NOT NULL,
    "pricePerPack" REAL NOT NULL,
    "shelfLifeDays" INTEGER NOT NULL,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "IngredientAllergen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ingredientId" TEXT NOT NULL,
    "allergen" TEXT NOT NULL,
    CONSTRAINT "IngredientAllergen_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "timeMin" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "servings" INTEGER NOT NULL DEFAULT 1,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT,
    "baseRecipeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RecipeIngredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "grams" REAL NOT NULL,
    CONSTRAINT "RecipeIngredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecipeIngredient_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecipeSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    CONSTRAINT "RecipeSlot_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecipeDietTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    CONSTRAINT "RecipeDietTag_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecipeEquipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipeId" TEXT NOT NULL,
    "equipment" TEXT NOT NULL,
    CONSTRAINT "RecipeEquipment_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Ingredient_group_idx" ON "Ingredient"("group");

-- CreateIndex
CREATE INDEX "Ingredient_ownerUserId_idx" ON "Ingredient"("ownerUserId");

-- CreateIndex
CREATE INDEX "IngredientAllergen_allergen_idx" ON "IngredientAllergen"("allergen");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientAllergen_ingredientId_allergen_key" ON "IngredientAllergen"("ingredientId", "allergen");

-- CreateIndex
CREATE INDEX "Recipe_ownerUserId_idx" ON "Recipe"("ownerUserId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_recipeId_idx" ON "RecipeIngredient"("recipeId");

-- CreateIndex
CREATE INDEX "RecipeIngredient_ingredientId_idx" ON "RecipeIngredient"("ingredientId");

-- CreateIndex
CREATE INDEX "RecipeSlot_slot_idx" ON "RecipeSlot"("slot");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeSlot_recipeId_slot_key" ON "RecipeSlot"("recipeId", "slot");

-- CreateIndex
CREATE INDEX "RecipeDietTag_tag_idx" ON "RecipeDietTag"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeDietTag_recipeId_tag_key" ON "RecipeDietTag"("recipeId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "RecipeEquipment_recipeId_equipment_key" ON "RecipeEquipment"("recipeId", "equipment");
