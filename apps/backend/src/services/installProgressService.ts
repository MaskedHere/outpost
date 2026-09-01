import fs from 'node:fs/promises';
import path from 'node:path';

/** Recursively sums file sizes under a directory — used to show a live-growing "downloaded so
 *  far" number while a modded server's loader/mods are still installing (see
 *  readinessService.ts's 'installing' state), since dataPath is the same bind mount the game
 *  container writes into, so Outpost can just read it directly with no docker exec involved.
 *  Missing/unreadable entries are skipped rather than failing the whole walk — a file can
 *  legitimately disappear mid-walk if it's still being written. */
export async function getDirectorySizeBytes(dirPath: string): Promise<number> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) return await getDirectorySizeBytes(entryPath);
        if (entry.isFile()) return (await fs.stat(entryPath)).size;
        return 0;
      } catch {
        return 0;
      }
    }),
  );

  return sizes.reduce((sum, size) => sum + size, 0);
}
