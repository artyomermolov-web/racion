-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ingredient" (
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
    "gramsPerPiece" REAL,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "vvXmlId" TEXT,
    "vvPriceOld" REAL,
    "vvDiscountPct" REAL,
    "vvUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Ingredient" ("carbPer100", "createdAt", "fatPer100", "fiberPer100", "gramsPerPiece", "group", "id", "isCustom", "kcalPer100", "name", "ownerUserId", "packSize", "pricePerPack", "proteinPer100", "shelfLifeDays", "sodiumPer100", "unit", "updatedAt") SELECT "carbPer100", "createdAt", "fatPer100", "fiberPer100", "gramsPerPiece", "group", "id", "isCustom", "kcalPer100", "name", "ownerUserId", "packSize", "pricePerPack", "proteinPer100", "shelfLifeDays", "sodiumPer100", "unit", "updatedAt" FROM "Ingredient";
DROP TABLE "Ingredient";
ALTER TABLE "new_Ingredient" RENAME TO "Ingredient";
CREATE UNIQUE INDEX "Ingredient_vvXmlId_key" ON "Ingredient"("vvXmlId");
CREATE INDEX "Ingredient_group_idx" ON "Ingredient"("group");
CREATE INDEX "Ingredient_ownerUserId_idx" ON "Ingredient"("ownerUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
