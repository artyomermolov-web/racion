-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Recipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "timeMin" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "servings" INTEGER NOT NULL DEFAULT 1,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT,
    "baseRecipeId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'seed',
    "vvId" TEXT,
    "vvUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Recipe" ("baseRecipeId", "createdAt", "difficulty", "id", "isCustom", "name", "ownerUserId", "servings", "steps", "timeMin", "updatedAt") SELECT "baseRecipeId", "createdAt", "difficulty", "id", "isCustom", "name", "ownerUserId", "servings", "steps", "timeMin", "updatedAt" FROM "Recipe";
DROP TABLE "Recipe";
ALTER TABLE "new_Recipe" RENAME TO "Recipe";
CREATE UNIQUE INDEX "Recipe_vvId_key" ON "Recipe"("vvId");
CREATE INDEX "Recipe_ownerUserId_idx" ON "Recipe"("ownerUserId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
