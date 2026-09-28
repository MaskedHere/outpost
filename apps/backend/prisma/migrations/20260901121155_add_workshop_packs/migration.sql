-- CreateTable
CREATE TABLE "WorkshopPack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkshopPackItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "workshopItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "modId" TEXT,
    "previewUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkshopPackItem_packId_fkey" FOREIGN KEY ("packId") REFERENCES "WorkshopPack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WorkshopPackItem_packId_idx" ON "WorkshopPackItem"("packId");
