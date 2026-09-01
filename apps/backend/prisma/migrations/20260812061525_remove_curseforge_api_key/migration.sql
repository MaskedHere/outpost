/*
  Warnings:

  - You are about to drop the column `curseforgeApiKey` on the `Settings` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "defaultPlayitKey" TEXT,
    "defaultMemoryMb" INTEGER NOT NULL DEFAULT 2048
);
INSERT INTO "new_Settings" ("defaultMemoryMb", "defaultPlayitKey", "id") SELECT "defaultMemoryMb", "defaultPlayitKey", "id" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
