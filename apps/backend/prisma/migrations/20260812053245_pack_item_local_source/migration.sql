-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PackItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'modrinth',
    "projectId" TEXT,
    "projectSlug" TEXT,
    "projectName" TEXT NOT NULL,
    "versionId" TEXT,
    "versionNumber" TEXT,
    "localFilePath" TEXT,
    "filename" TEXT NOT NULL,
    "downloadUrl" TEXT,
    "sha1" TEXT NOT NULL,
    "sha512" TEXT,
    "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "isDependency" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PackItem_packId_fkey" FOREIGN KEY ("packId") REFERENCES "Pack" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PackItem" ("createdAt", "downloadUrl", "fileSizeBytes", "filename", "id", "isDependency", "packId", "projectId", "projectName", "projectSlug", "sha1", "sha512", "versionId", "versionNumber") SELECT "createdAt", "downloadUrl", "fileSizeBytes", "filename", "id", "isDependency", "packId", "projectId", "projectName", "projectSlug", "sha1", "sha512", "versionId", "versionNumber" FROM "PackItem";
DROP TABLE "PackItem";
ALTER TABLE "new_PackItem" RENAME TO "PackItem";
CREATE UNIQUE INDEX "PackItem_packId_filename_key" ON "PackItem"("packId", "filename");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
