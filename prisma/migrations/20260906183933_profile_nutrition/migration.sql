-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "heightCm" REAL NOT NULL,
    "weightKg" REAL NOT NULL,
    "bodyFatPct" REAL,
    "activityLevel" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "shoppingWeekday" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NutritionProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Моя норма',
    "kcalMin" INTEGER NOT NULL,
    "kcalMax" INTEGER NOT NULL,
    "proteinMin" INTEGER NOT NULL,
    "proteinMax" INTEGER NOT NULL,
    "fatMin" INTEGER NOT NULL,
    "fatMax" INTEGER NOT NULL,
    "carbMin" INTEGER NOT NULL,
    "carbMax" INTEGER NOT NULL,
    "fiberMin" INTEGER NOT NULL,
    "sodiumMax" INTEGER,
    "cholesterolMax" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NutritionProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");

-- CreateIndex
CREATE INDEX "NutritionProfile_userId_idx" ON "NutritionProfile"("userId");
