import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { resolveDownloadUrl, PALWORLD_CATEGORIES } from '../curseforge/scraper.js';

/** Installs a CurseForge Palworld mod into a server's own files. */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Where each category's files belong, relative to the server's data directory. */
const INSTALL_DIRS: Record<string, string> = {
  'patch-pak-mods': 'Pal/Content/Paks/~mods',
  miscellaneous: 'Pal/Content/Paks/~mods',
};

export class PalworldModError extends Error {}

export interface InstalledPalworldMod {
  /**
   * Paths written, relative to the server's data directory, so the UI can say exactly what landed
   * where.
   */
  files: string[];
  installDir: string;
}

export async function installPalworldMod(
  dataPath: string,
  slug: string,
  fileId: number,
  category: string,
): Promise<InstalledPalworldMod> {
  const relativeDir = INSTALL_DIRS[category];
  if (!relativeDir) {
    // Say *why* rather than "unknown category".
    const known = PALWORLD_CATEGORIES.find((c) => c.value === category);
    throw new PalworldModError(
      known
        ? `${known.label} cannot be installed on this server. ${known.note}`
        : `Unknown mod type "${category}"`,
    );
  }

  const downloadUrl = await resolveDownloadUrl(slug, fileId, category, 'palworld');
  const res = await fetch(downloadUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new PalworldModError('Failed to download this mod from CurseForge');
  const buffer = Buffer.from(await res.arrayBuffer());

  const targetDir = path.join(dataPath, relativeDir);
  await fs.mkdir(targetDir, { recursive: true });

  const filename = decodeURIComponent(
    new URL(downloadUrl).pathname.split('/').pop() || `${slug}.pak`,
  );
  const written: string[] = [];

  // Mods ship either as a bare .pak/.lua or as a zip that already contains the folder layout the
  // game expects.
  if (filename.toLowerCase().endsWith('.zip')) {
    let zip: AdmZip;
    try {
      zip = new AdmZip(buffer);
    } catch {
      throw new PalworldModError('That download was not a readable zip');
    }
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const entryPath = entry.entryName.replace(/\\/g, '/');
      // Refuse anything trying to escape the target directory.
      if (entryPath.split('/').includes('..')) continue;
      const dest = path.join(targetDir, entryPath);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, entry.getData());
      written.push(path.posix.join(relativeDir, entryPath));
    }
    if (written.length === 0) throw new PalworldModError('That zip contained no files');
  } else {
    await fs.writeFile(path.join(targetDir, filename), buffer);
    written.push(path.posix.join(relativeDir, filename));
  }

  return { files: written, installDir: relativeDir };
}
