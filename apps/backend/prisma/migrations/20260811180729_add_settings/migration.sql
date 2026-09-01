-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "defaultPlayitKey" TEXT,
    "defaultMemoryMb" INTEGER NOT NULL DEFAULT 2048
);
