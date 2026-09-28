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
    "motd" TEXT,
    "workshopItemIds" TEXT,
    "modIds" TEXT,
    "extraSettings" TEXT,
    "tunnelContainerId" TEXT,
    "tunnelSecretKey" TEXT,
    "boreContainerId" TEXT,
    "borePort" INTEGER,
    CONSTRAINT "GameServer_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_GameServer" ("boreContainerId", "borePort", "containerId", "containerName", "createdAt", "dataPath", "extraSettings", "game", "gamePort", "id", "memoryMb", "modIds", "motd", "name", "packId", "rconPassword", "rconPort", "tunnelContainerId", "tunnelSecretKey", "updatedAt", "variant", "version", "workshopItemIds") SELECT "boreContainerId", "borePort", "containerId", "containerName", "createdAt", "dataPath", "extraSettings", "game", "gamePort", "id", "memoryMb", "modIds", "motd", "name", "packId", "rconPassword", "rconPort", "tunnelContainerId", "tunnelSecretKey", "updatedAt", "variant", "version", "workshopItemIds" FROM "GameServer";
DROP TABLE "GameServer";
ALTER TABLE "new_GameServer" RENAME TO "GameServer";
CREATE UNIQUE INDEX "GameServer_containerName_key" ON "GameServer"("containerName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
