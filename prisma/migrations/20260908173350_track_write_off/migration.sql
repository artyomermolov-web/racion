-- CreateTable
CREATE TABLE "MealWriteOff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "mealKey" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "portion" REAL NOT NULL DEFAULT 1,
    "people" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MealWriteOff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MealWriteOffLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "writeOffId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "expiresAt" DATETIME,
    CONSTRAINT "MealWriteOffLot_writeOffId_fkey" FOREIGN KEY ("writeOffId") REFERENCES "MealWriteOff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MealWriteOff_userId_idx" ON "MealWriteOff"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MealWriteOff_userId_mealKey_key" ON "MealWriteOff"("userId", "mealKey");

-- CreateIndex
CREATE INDEX "MealWriteOffLot_writeOffId_idx" ON "MealWriteOffLot"("writeOffId");
