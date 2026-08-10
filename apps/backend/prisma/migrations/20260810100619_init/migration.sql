-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GameServer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'minecraft',
    "loader" TEXT NOT NULL,
    "mcVersion" TEXT NOT NULL,
    "containerId" TEXT,
    "containerName" TEXT NOT NULL,
    "gamePort" INTEGER NOT NULL,
    "memoryMb" INTEGER NOT NULL DEFAULT 2048,
    "dataPath" TEXT NOT NULL,
    "packId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GameServer_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mcVersion" TEXT NOT NULL,
    "loader" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PackItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectSlug" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionNumber" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "downloadUrl" TEXT NOT NULL,
    "sha1" TEXT NOT NULL,
    "sha512" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "isDependency" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackItem_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Backup_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GameServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "GameServer_containerName_key" ON "GameServer"("containerName");

-- CreateIndex
CREATE UNIQUE INDEX "PackItem_packId_projectId_key" ON "PackItem"("packId", "projectId");
