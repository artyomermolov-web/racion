-- CreateTable
CREATE TABLE "PantryLot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "qty" REAL NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'real',
    "expiresAt" DATETIME,
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PantryLot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PantryLot_userId_idx" ON "PantryLot"("userId");

-- CreateIndex
CREATE INDEX "PantryLot_userId_kind_idx" ON "PantryLot"("userId", "kind");

-- CreateIndex
CREATE INDEX "PantryLot_ingredientId_idx" ON "PantryLot"("ingredientId");
