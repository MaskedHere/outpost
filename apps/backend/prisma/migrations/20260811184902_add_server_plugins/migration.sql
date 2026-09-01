-- CreateTable
CREATE TABLE "ServerPlugin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerPlugin_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GameServer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ServerPlugin_serverId_projectId_key" ON "ServerPlugin"("serverId", "projectId");
