/*
  Warnings:

  - You are about to drop the column `loader` on the `GameServer` table. All the data in the column will be lost.
  - You are about to drop the column `mcVersion` on the `GameServer` table. All the data in the column will be lost.
  - Added the required column `variant` to the `GameServer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `version` to the `GameServer` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GameServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'minecraft',
    "variant" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "containerId" TEXT,
    "containerName" TEXT NOT NULL,
    "gamePort" INTEGER NOT NULL,
    "rconPort" INTEGER,
    "rconPassword" TEXT,
    "memoryMb" INTEGER NOT NULL DEFAULT 2048,
    "dataPath" TEXT NOT NULL,
    "packId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameServer_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GameServer" ("containerId", "containerName", "createdAt", "dataPath", "game", "gamePort", "id", "memoryMb", "name", "packId", "updatedAt") SELECT "containerId", "containerName", "createdAt", "dataPath", "game", "gamePort", "id", "memoryMb", "name", "packId", "updatedAt" FROM "GameServer";
DROP TABLE "GameServer";
ALTER TABLE "new_GameServer" RENAME TO "GameServer";
CREATE UNIQUE INDEX "GameServer_containerName_key" ON "GameServer"("containerName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
