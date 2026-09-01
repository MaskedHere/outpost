import archiver from 'archiver';
import type { Pack, PackItem } from '../../generated/prisma/index.js';

const LOADER_DEPENDENCY_KEY: Record<string, string> = {
  fabric: 'fabric-loader',
  quilt: 'quilt-loader',
  forge: 'forge',
  neoforge: 'neoforge',
};

/**
 * Builds a standard Modrinth .mrpack (a zip with a modrinth.index.json manifest referencing
 * official Modrinth CDN download URLs). Outpost never rehosts mod jars itself, so this is a pure
 * metadata export — friends open the resulting file with the Modrinth App or Prism Launcher.
 */
export function buildMrpack(
  pack: Pack & { items: PackItem[] },
  loaderVersion: string | null,
): NodeJS.ReadableStream {
  const archive = archiver('zip', { zlib: { level: 9 } });

  const dependencies: Record<string, string> = { minecraft: pack.mcVersion };
  const loaderKey = LOADER_DEPENDENCY_KEY[pack.loader];
  if (loaderKey && loaderVersion) dependencies[loaderKey] = loaderVersion;

  // "local" items (a jar Outpost has the actual bytes for but never matched on Modrinth — see
  // PackItem.source) have no downloadUrl at all, since there's nowhere on Modrinth's CDN to point
  // to; a pure-URL mrpack has no way to represent them, so they're left out of the export rather
  // than emitting a broken `downloads: [null]` entry. They still deploy fine directly from Outpost.
  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: `${pack.mcVersion}-${pack.id.slice(0, 8)}`,
    name: pack.name,
    summary: `Modpack built with Outpost for Minecraft ${pack.mcVersion} (${pack.loader}).`,
    files: pack.items
      .filter((item) => item.source === 'modrinth' && item.downloadUrl)
      .map((item) => ({
        path: `mods/${item.filename}`,
        hashes: { sha1: item.sha1, sha512: item.sha512 },
        env: { client: 'required', server: 'required' },
        downloads: [item.downloadUrl],
        fileSize: item.fileSizeBytes,
      })),
    dependencies,
  };

  archive.append(JSON.stringify(index, null, 2), { name: 'modrinth.index.json' });
  archive.append('', { name: 'overrides/.gitkeep' });
  void archive.finalize();

  return archive;
}
