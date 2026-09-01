import AdmZip from 'adm-zip';
import crypto from 'node:crypto';
import { getProject, getVersion, lookupVersionsBySha1, searchMods, type ModrinthVersion, type ModrinthSupportLevel } from './client.js';
import { resolveModFileDownloadUrl } from '../curseforge/scraper.js';

const CURSEFORGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface ImportedItem {
  source: 'modrinth' | 'local';
  projectId: string | null;
  projectSlug: string | null;
  projectName: string;
  versionId: string | null;
  versionNumber: string | null;
  filename: string;
  downloadUrl: string | null;
  sha1: string;
  sha512: string | null;
  fileSizeBytes: number;
  /** Set whenever the actual jar bytes were already in hand at import time (an embedded jar in a
   *  CurseForge instance/server-pack zip, or an entry in a raw jars zip) — including for a
   *  source: 'modrinth' item, where the hash happened to also match a Modrinth project. Modrinth is
   *  only borrowed for identification (a real name/version instead of a raw filename) in that case;
   *  the route handler persists this buffer to disk and the server deploys from it directly rather
   *  than re-fetching the same file from Modrinth's CDN. Never sent on to the frontend as JSON. */
  fileBuffer?: Buffer;
  /** True when this item was pulled in automatically to satisfy another mod's required-dependency
   *  chain rather than picked directly — see resolveDependencyItems. */
  isDependency?: boolean;
}

export interface UnresolvedEntry {
  label: string;
  reason: string;
}

export interface ImportResult {
  format: 'mrpack' | 'curseforge' | 'jars';
  suggestedName: string | null;
  mcVersion: string | null;
  loader: string | null;
  matched: ImportedItem[];
  unresolved: UnresolvedEntry[];
  // Mods Modrinth itself marks server_side: "unsupported" (client-only rendering/cosmetic mods —
  // shaders, tooltips, video players, etc.) — left out of `matched` entirely rather than installed
  // and left to crash a dedicated server the way a real DREAD pack import once did (see minecraft.ts
  // and the itzg image's own imperfect client-mod auto-skip, which several of these slip past).
  clientOnly: UnresolvedEntry[];
  // Non-mod files from a CurseForge pack's overrides/ folder (configs, resourcepacks, scripts) —
  // only ever populated for format 'curseforge'. Not sent to the frontend as JSON; the route
  // handler writes these to disk the same way it does ImportedItem.fileBuffer.
  overrideFiles?: { path: string; buffer: Buffer }[];
}

export class ImportError extends Error {}

export type ImportProgress = (current: number, total: number) => void;

/** Runs `fn` over `items` with at most `limit` in flight at once instead of one giant Promise.all
 *  (which would slam Modrinth's API with hundreds of simultaneous requests) or a plain sequential
 *  loop (which is what made a 500-mod CurseForge pack take minutes — each mod waited on the
 *  previous one's two full round trips before starting its own). */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const LOADER_DEPENDENCY_KEY: Record<string, string> = {
  fabric: 'fabric-loader',
  quilt: 'quilt-loader',
  forge: 'forge',
  neoforge: 'neoforge',
};

export function detectFormat(zip: AdmZip): 'mrpack' | 'curseforge' | 'jars' {
  const names = zip.getEntries().map((e) => e.entryName);
  if (names.includes('modrinth.index.json')) return 'mrpack';
  if (names.includes('manifest.json')) {
    try {
      const manifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf8'));
      if (manifest.manifestType === 'minecraftModpack' || manifest.overrides) return 'curseforge';
    } catch {
      /* fall through */
    }
  }
  if (names.some((n) => n.toLowerCase().endsWith('.jar'))) return 'jars';
  throw new ImportError(
    "Couldn't recognize this file — expected a .mrpack, a CurseForge modpack zip (manifest.json), or a zip of .jar mods.",
  );
}

interface ProjectMeta {
  slug: string;
  title: string;
  serverSide: ModrinthSupportLevel;
}

async function projectMeta(projectId: string, fallbackName: string): Promise<ProjectMeta> {
  try {
    const project = await getProject(projectId);
    return { slug: project.slug, title: project.title, serverSide: project.server_side };
  } catch {
    // Unknown — assume it's fine rather than silently dropping a mod we can't classify.
    return { slug: projectId, title: fallbackName, serverSide: 'required' };
  }
}

/** True for mods Modrinth itself marks as not running on a dedicated server — shaders, tooltips,
 *  video players, and similar client-only cosmetics. This is the same signal Modrinth's own site
 *  uses for its client/server badges, curated independently of whatever (often missing or wrong)
 *  side declaration the mod's own jar carries — see the ImportResult.clientOnly doc comment. */
function isServerUnsupported(serverSide: ModrinthSupportLevel): boolean {
  return serverSide === 'unsupported';
}

function toItem(version: ModrinthVersion, file: ModrinthVersion['files'][number], meta: { slug: string; title: string }): ImportedItem {
  return {
    source: 'modrinth',
    projectId: version.project_id,
    projectSlug: meta.slug,
    projectName: meta.title,
    versionId: version.id,
    versionNumber: version.version_number,
    filename: file.filename,
    downloadUrl: file.url,
    sha1: file.hashes.sha1,
    sha512: file.hashes.sha512,
    fileSizeBytes: file.size,
  };
}

/** Best-effort mod name from a jar's filename — strips the extension and everything from the first
 *  version-number-or-loader-name segment onward, then splits any camelCase/PascalCase run into
 *  separate words (CurseForge filenames often glue a display name together with no separator at
 *  all — "LegendaryTooltips-1.19.2-forge-1.4.0.jar" needs to become "Legendary Tooltips" before
 *  Modrinth's search will find it; searching the glued form returns zero hits, confirmed directly
 *  against their API). "entity_model_features_forge_1.19.2-2.0.2.jar" -> "entity model features". */
function guessModName(filename: string): string {
  const base = filename.replace(/\.jar$/i, '');
  const parts = base.split(/[-_]+/);
  const nameParts: string[] = [];
  for (const part of parts) {
    if (/^v?\d/i.test(part) || /^(forge|fabric|neoforge|quilt)$/i.test(part)) break;
    nameParts.push(part);
  }
  const raw = nameParts.length > 0 ? nameParts.join(' ') : base;
  return raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
}

/** Safety net for a jar Modrinth doesn't recognize by hash (so isServerUnsupported never got a
 *  chance to run on it at all) — e.g. a build never uploaded to Modrinth under this exact hash, the
 *  actual cause of a real crash loop this caught: CurseForge's LegendaryTooltips-1.19.2-forge-1.4.0
 *  didn't hash-match Modrinth's build, installed with zero side information, and crashed a
 *  dedicated server the same way Oculus/WaterMedia did before hash-matching started catching those.
 *  Falls back to a name search — only trusted when the title matches closely enough to be confident
 *  it's the same mod, not just topically similar. Returns false (assume installable) on any
 *  uncertainty; missing a client-only mod here is the pre-existing gap, not a new risk, but wrongly
 *  excluding an installable mod would silently break the pack instead. */
async function isLikelyClientOnlyByName(filename: string): Promise<boolean> {
  const guess = guessModName(filename);
  if (!guess) return false;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  try {
    const results = await searchMods({ query: guess, limit: 3 });
    const hit = results.hits.find((h) => normalize(h.title) === normalize(guess));
    return hit ? isServerUnsupported(hit.server_side) : false;
  } catch {
    return false;
  }
}

/** Used when a mod jar's actual bytes are in hand (an embedded jar in a CurseForge instance zip,
 *  or an entry in a raw jars zip) but Modrinth doesn't recognize it by hash — rather than dropping
 *  the mod, keep the file itself so the pack still deploys with everything intact. */
function toLocalItem(filename: string, buffer: Buffer, sha1: string): ImportedItem {
  return {
    source: 'local',
    projectId: null,
    projectSlug: null,
    projectName: filename.replace(/\.jar$/i, ''),
    versionId: null,
    versionNumber: null,
    filename,
    downloadUrl: null,
    sha1,
    sha512: null,
    fileSizeBytes: buffer.length,
    fileBuffer: buffer,
  };
}

// cdn.modrinth.com/data/<projectId>/versions/<versionId>/<filename> — the URL shape Outpost's own
// exporter (and Modrinth's own client) produces, so most mrpacks carry it directly.
const MODRINTH_CDN_RE = /^https:\/\/cdn\.modrinth\.com\/data\/([^/]+)\/versions\/([^/]+)\//;

interface MrpackIndex {
  name?: string;
  dependencies?: Record<string, string>;
  files: {
    path: string;
    downloads: string[];
    hashes: { sha1: string; sha512?: string };
    fileSize?: number;
    env?: { client?: string; server?: string };
  }[];
}

export async function importMrpack(zip: AdmZip): Promise<ImportResult> {
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry) throw new ImportError('modrinth.index.json missing from .mrpack');
  const index = JSON.parse(entry.getData().toString('utf8')) as MrpackIndex;

  const deps = index.dependencies ?? {};
  const mcVersion = deps.minecraft ?? null;
  const loaderEntry = Object.entries(LOADER_DEPENDENCY_KEY).find(([, key]) => key in deps);
  const loader = loaderEntry?.[0] ?? null;

  // Only mod jars become pack items — resourcepacks/shaderpacks/config overrides aren't part of
  // Outpost's Pack model, which targets the mod-loader deploy flow specifically.
  const modFiles = index.files.filter((f) => f.path.startsWith('mods/'));

  const matched: ImportedItem[] = [];
  const unresolved: UnresolvedEntry[] = [];
  const clientOnly: UnresolvedEntry[] = [];
  const unmatchedByHash = new Map<string, (typeof modFiles)[number]>();

  for (const file of modFiles) {
    const label = file.path.split('/').pop() ?? file.path;
    // The mrpack format itself already records per-file client/server support (env.server) — no
    // need to consult Modrinth separately for files that declare it themselves.
    if (file.env?.server === 'unsupported') {
      clientOnly.push({ label, reason: "Client-only mod — doesn't run on a dedicated server" });
      continue;
    }
    const cdnMatch = file.downloads[0]?.match(MODRINTH_CDN_RE);
    const versionId = cdnMatch?.[2];
    if (versionId) {
      try {
        const version = await getVersion(versionId);
        const primary = version.files.find((f) => f.hashes.sha1 === file.hashes.sha1) ?? version.files[0];
        if (primary) {
          const meta = await projectMeta(version.project_id, label);
          if (isServerUnsupported(meta.serverSide)) {
            clientOnly.push({ label: meta.title, reason: "Client-only mod — doesn't run on a dedicated server" });
          } else {
            matched.push(toItem(version, primary, meta));
          }
          continue;
        }
      } catch {
        // fall through to hash lookup below
      }
    }
    unmatchedByHash.set(file.hashes.sha1, file);
  }

  if (unmatchedByHash.size > 0) {
    const found = await lookupVersionsBySha1([...unmatchedByHash.keys()]);
    for (const [sha1, file] of unmatchedByHash) {
      const version = found[sha1];
      const label = file.path.split('/').pop() ?? file.path;
      if (!version) {
        unresolved.push({ label, reason: 'Not found on Modrinth' });
        continue;
      }
      const primary = version.files.find((f) => f.hashes.sha1 === sha1) ?? version.files[0];
      if (!primary) {
        unresolved.push({ label, reason: 'Matched on Modrinth, but has no downloadable file' });
        continue;
      }
      const meta = await projectMeta(version.project_id, label);
      if (isServerUnsupported(meta.serverSide)) {
        clientOnly.push({ label: meta.title, reason: "Client-only mod — doesn't run on a dedicated server" });
        continue;
      }
      matched.push(toItem(version, primary, meta));
    }
  }

  return { format: 'mrpack', suggestedName: index.name ?? null, mcVersion, loader, matched, unresolved, clientOnly };
}

interface CurseForgeManifest {
  name?: string;
  minecraft?: { version?: string; modLoaders?: { id: string; primary?: boolean }[] };
  files?: { projectID: number; fileID: number; required?: boolean }[];
}

/** Hashes each jar, batch-checks the lot against Modrinth in one call, and classifies each as a
 *  Modrinth-identified match (bytes kept and deployed locally regardless — see
 *  ImportedItem.fileBuffer), a client-only mod (excluded), or a local item Modrinth doesn't
 *  recognize (bytes kept as-is). Shared by every import path that ends up with actual jar bytes in
 *  hand: a CurseForge instance zip's embedded mods/, each mod in a "share" export resolved
 *  individually via CurseForge's own pages, and a raw jars zip. */
export async function classifyJarsByHash(
  jars: { filename: string; buffer: Buffer }[],
  matched: ImportedItem[],
  clientOnly: UnresolvedEntry[],
  onProgress?: ImportProgress,
): Promise<void> {
  if (jars.length === 0) return;
  const byHash = new Map<string, { filename: string; buffer: Buffer }>();
  for (const jar of jars) {
    byHash.set(crypto.createHash('sha1').update(jar.buffer).digest('hex'), jar);
  }
  const found = await lookupVersionsBySha1([...byHash.keys()]);
  let completed = 0;
  const total = byHash.size;
  await mapWithConcurrency([...byHash], 8, async ([sha1, jar]) => {
    const version = found[sha1];
    const primary = version?.files.find((f) => f.hashes.sha1 === sha1) ?? version?.files[0];
    if (version && primary) {
      const meta = await projectMeta(version.project_id, jar.filename);
      if (isServerUnsupported(meta.serverSide)) {
        clientOnly.push({ label: meta.title, reason: "Client-only mod — doesn't run on a dedicated server" });
      } else {
        // The hash match confirms this is byte-for-byte the same file Modrinth has — borrow its
        // name/version for display, but keep the bytes already in hand rather than have the server
        // re-download this exact file from Modrinth's CDN at deploy time.
        matched.push({ ...toItem(version, primary, meta), fileBuffer: jar.buffer });
      }
    } else if (await isLikelyClientOnlyByName(jar.filename)) {
      // No hash match, so the usual server_side check never got a chance to run — but a confident
      // name match against a different build of the same mod is still enough signal to catch it
      // (see isLikelyClientOnlyByName's doc comment for the real crash this closes).
      clientOnly.push({ label: guessModName(jar.filename), reason: "Client-only mod — doesn't run on a dedicated server" });
    } else {
      // Not on Modrinth at all (by hash or by name), so there's genuinely no side information
      // available — keep the jar itself rather than guess wrong and drop a mod that was fine.
      matched.push(toLocalItem(jar.filename, jar.buffer, sha1));
    }
    onProgress?.(++completed, total);
  });
}

export async function importCurseForge(zip: AdmZip, onProgress?: ImportProgress): Promise<ImportResult> {
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) throw new ImportError('manifest.json missing from CurseForge pack');
  const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as CurseForgeManifest;

  const mcVersion = manifest.minecraft?.version ?? null;
  const primaryLoader = manifest.minecraft?.modLoaders?.find((l) => l.primary) ?? manifest.minecraft?.modLoaders?.[0];
  // CF loader ids look like "forge-47.2.0" / "fabric-0.15.11" — we only need the loader name.
  const loader = primaryLoader?.id.split('-')[0] ?? null;

  const unresolved: UnresolvedEntry[] = [];
  const clientOnly: UnresolvedEntry[] = [];
  const matched: ImportedItem[] = [];

  // Everything under overrides/ except mods/ (which is handled above/below as actual pack items) —
  // configs, resourcepacks, scripts, whatever the pack author shipped as-is. Previously discarded
  // entirely, which is why a mod like a server-side anticheat installed with none of its intended
  // configuration and defaulted to rejecting every player. Extracted once here since both branches
  // below (embedded jars or manifest-resolved) can carry one.
  const overrideFiles = zip
    .getEntries()
    .filter((e) => !e.isDirectory && /^overrides\//i.test(e.entryName.replace(/\\/g, '/')) && !/^overrides\/mods\//i.test(e.entryName.replace(/\\/g, '/')))
    .map((e) => ({ path: e.entryName.replace(/\\/g, '/').replace(/^overrides\//i, ''), buffer: e.getData() }));

  // A full local CurseForge App instance (as opposed to the lightweight "share" export CurseForge's
  // own Export button produces) has the actual mod jars sitting right in the zip under mods/ (some
  // exports nest it under overrides/mods/ instead) — when that's the case, use those files
  // directly instead of guessing from names: hash each one against Modrinth for an exact match,
  // and for anything Modrinth doesn't recognize, keep the jar itself as a locally-stored pack item
  // so the pack still deploys with every mod intact, not just the ones Outpost could identify.
  const embeddedJars = zip
    .getEntries()
    .filter((e) => !e.isDirectory && /^(overrides\/)?mods\/[^/]+\.jar$/i.test(e.entryName.replace(/\\/g, '/')));

  if (embeddedJars.length > 0) {
    const jars = embeddedJars.map((entry) => ({
      filename: entry.entryName.replace(/\\/g, '/').split('/').pop() ?? entry.entryName,
      buffer: entry.getData(),
    }));
    await classifyJarsByHash(jars, matched, clientOnly, onProgress);
    return { format: 'curseforge', suggestedName: manifest.name ?? null, mcVersion, loader, matched, unresolved, clientOnly, overrideFiles };
  }

  // No embedded jars — this is the lightweight "share" export, whose manifest.json only carries
  // opaque numeric {projectID, fileID} pairs. Those don't need CurseForge's key-gated API to
  // resolve, though: curseforge.com/projects/<projectID> redirects to the mod's real slugged page
  // with no key at all, and from there the same page CurseForge's own download button links to
  // gives the real signed file URL — exactly what the official CurseForge app itself does when it
  // resolves a "share" import locally. So every mod in the manifest gets its own real file
  // downloaded directly from CurseForge (resolved in parallel below), then classified against
  // Modrinth by hash exactly like an embedded jar would be — no name-guessing anywhere.
  const manifestFiles = manifest.files ?? [];
  if (manifestFiles.length === 0) {
    unresolved.push({
      label: 'mod list',
      reason: "This pack's manifest.json listed no mods — add them manually below.",
    });
    return { format: 'curseforge', suggestedName: manifest.name ?? null, mcVersion, loader, matched, unresolved, clientOnly, overrideFiles };
  }

  const jars: { filename: string; buffer: Buffer }[] = [];
  let resolved = 0;
  await mapWithConcurrency(manifestFiles, 8, async (file) => {
    try {
      const mod = await resolveModFileDownloadUrl(file.projectID, file.fileID);
      if (!mod) {
        unresolved.push({ label: `CurseForge project #${file.projectID}`, reason: 'This mod no longer exists on CurseForge' });
        return;
      }
      if (!mod.downloadUrl) {
        unresolved.push({ label: mod.projectName, reason: "Found the mod on CurseForge, but this specific file is gone" });
        return;
      }
      const fileRes = await fetch(mod.downloadUrl, { headers: { 'User-Agent': CURSEFORGE_UA } });
      if (!fileRes.ok) {
        unresolved.push({ label: mod.projectName, reason: 'Found on CurseForge, but downloading the file failed' });
        return;
      }
      const buffer = Buffer.from(await fileRes.arrayBuffer());
      const filename = new URL(mod.downloadUrl).pathname.split('/').pop() || `${mod.projectSlug}.jar`;
      jars.push({ filename, buffer });
    } catch {
      unresolved.push({ label: `CurseForge project #${file.projectID}`, reason: 'Lookup failed' });
    } finally {
      onProgress?.(++resolved, manifestFiles.length);
    }
  });

  await classifyJarsByHash(jars, matched, clientOnly);
  return { format: 'curseforge', suggestedName: manifest.name ?? null, mcVersion, loader, matched, unresolved, clientOnly };
}

/** Minecraft version numbers as they appear in paths: "1.21.1", "1.20", and the newer prefix-less
 *  scheme like "26.1.2". */
const MC_VERSION = String.raw`(\d+\.\d+(?:\.\d+)?)`;

/** Path shapes that identify the loader, and where present the Minecraft version alongside it. A
 *  loader lays its own artifacts down in predictable places, so these are read off the real files
 *  rather than inferred. */
const LOADER_SIGNATURES: { re: RegExp; loader: string; capturesVersion: boolean }[] = [
  // libraries/net/neoforged/neoforge/1.21.1-21.1.77/...
  { re: new RegExp(String.raw`libraries/net/neoforged/neoforge/${MC_VERSION}-`, 'i'), loader: 'neoforge', capturesVersion: true },
  // libraries/net/minecraftforge/forge/1.20.1-47.2.0/...
  { re: new RegExp(String.raw`libraries/net/minecraftforge/forge/${MC_VERSION}-`, 'i'), loader: 'forge', capturesVersion: true },
  // Forge names its installer <mcVersion>-<forgeVersion>, so the Minecraft version is right there.
  { re: new RegExp(String.raw`(?:^|/)forge-${MC_VERSION}-`, 'i'), loader: 'forge', capturesVersion: true },
  // NeoForge does NOT: "neoforge-21.1.249-installer.jar" is purely a NeoForge version. Matched here
  // for the loader only — deriveMinecraftFromNeoForge works out the Minecraft version separately.
  { re: /(?:^|\/)neoforge-\d+\.\d+\.\d+.*\.jar/i, loader: 'neoforge', capturesVersion: false },
  // Fabric's server launcher embeds the version it targets:
  // fabric-server-mc.1.21.1-loader.0.16.9-launcher.1.0.1.jar
  { re: new RegExp(String.raw`fabric-server-mc\.${MC_VERSION}-`, 'i'), loader: 'fabric', capturesVersion: true },
  // Loader present but the version lives elsewhere in the zip.
  { re: /libraries\/net\/neoforged\//i, loader: 'neoforge', capturesVersion: false },
  { re: /libraries\/net\/minecraftforge\//i, loader: 'forge', capturesVersion: false },
  { re: /(?:^|\/)fabric-server-launch\.jar/i, loader: 'fabric', capturesVersion: false },
  { re: /libraries\/net\/fabricmc\//i, loader: 'fabric', capturesVersion: false },
  { re: /(?:^|\/)quilt-server-launch\.jar|libraries\/org\/quiltmc\//i, loader: 'quilt', capturesVersion: false },
];

/** Where the vanilla server jar itself records the Minecraft version, for packs whose loader
 *  signature didn't carry one (Fabric and Quilt installs, mostly). */
const MC_VERSION_SIGNATURES: RegExp[] = [
  new RegExp(String.raw`libraries/net/minecraft/server/${MC_VERSION}[-/]`, 'i'),
  new RegExp(String.raw`(?:^|/)minecraft_server\.${MC_VERSION}\.jar`, 'i'),
  new RegExp(String.raw`(?:^|/)server-${MC_VERSION}\.jar`, 'i'),
];

/**
 * NeoForge's version encodes the Minecraft version it targets: 21.1.249 is for Minecraft 1.21.1,
 * 20.4.x for 1.20.4, and a trailing .0 minor means the base release (21.0.x -> 1.21). That mapping
 * is the whole point of their scheme, and it's the only Minecraft-version evidence a NeoForge server
 * pack contains — All the Mods 10 ships exactly one identifying file, "neoforge-21.1.249-installer.jar",
 * with no libraries tree and no vanilla jar (verified against the real 1.1GB download).
 */
function deriveMinecraftFromNeoForge(names: string[]): string | null {
  for (const name of names) {
    const match = name.match(/(?:^|\/)neoforge-(\d+)\.(\d+)\.\d+/i);
    if (!match) continue;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    // Guard the assumption rather than extrapolating it: this holds for the 1.x era NeoForge was
    // built around. If Minecraft's own numbering moves on, better to report nothing than a
    // confidently wrong version.
    if (major < 20 || major > 25) return null;
    return minor === 0 ? `1.${major}` : `1.${major}.${minor}`;
  }
  return null;
}

/**
 * Last resort: the Minecraft version a pack's mod filenames agree on.
 *
 * Mod jars are conventionally named like "ftb-chunks-forge-1.21.1-2101.1.10.jar" — carrying both the
 * Minecraft version and the mod's own. Individually that's ambiguous, but across hundreds of mods
 * only the Minecraft version repeats, so the most frequent token wins by a wide margin. Requires a
 * few independent agreements before it's trusted, so a handful of coincidences can't decide it.
 */
function inferMinecraftFromModNames(names: string[]): string | null {
  const counts = new Map<string, number>();
  for (const name of names) {
    if (!/^mods\/[^/]+\.jar$/i.test(name)) continue;
    const seen = new Set<string>();
    for (const match of name.matchAll(/(?:^|[-_.])(\d+\.\d+(?:\.\d+)?)(?=[-_.]|$)/g)) {
      const token = match[1]!;
      if (seen.has(token)) continue;
      seen.add(token);
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best && best[1] >= 5 ? best[0] : null;
}

/**
 * Reads the Minecraft version and mod loader out of a server pack's own file layout.
 *
 * CurseForge "Server Pack" downloads — which Outpost deliberately prefers, since they ship real mod
 * jars instead of a numeric-ID manifest — carry no manifest.json at all. They're a ready-to-run
 * server directory, so they land in the plain-jars import path, which used to report no version or
 * loader whatsoever. Everything downstream then fell back to whatever the wizard happened to be
 * preset to, which is how All the Mods 10 (1.21.1/NeoForge) got created as a Fabric server on the
 * newest Minecraft release. The loader's own artifacts are right there in the zip, so this reads
 * them rather than guessing.
 */
export function detectServerPackTarget(zip: AdmZip): { mcVersion: string | null; loader: string | null } {
  const names = zip.getEntries().map((e) => e.entryName.replace(/\\/g, '/'));

  let loader: string | null = null;
  let mcVersion: string | null = null;

  for (const signature of LOADER_SIGNATURES) {
    for (const name of names) {
      const match = name.match(signature.re);
      if (!match) continue;
      loader ??= signature.loader;
      if (signature.capturesVersion && match[1]) mcVersion ??= match[1];
      break;
    }
    // A version-bearing match is the best evidence available; stop once we have both.
    if (loader && mcVersion) break;
  }

  if (!mcVersion) {
    for (const re of MC_VERSION_SIGNATURES) {
      const hit = names.map((n) => n.match(re)).find(Boolean);
      if (hit?.[1]) {
        mcVersion = hit[1];
        break;
      }
    }
  }

  // NeoForge packs usually get this far: their only marker is the installer jar, whose version
  // implies the Minecraft one.
  if (!mcVersion && loader === 'neoforge') mcVersion = deriveMinecraftFromNeoForge(names);

  // And if nothing structural said so, let the mod filenames vote.
  mcVersion ??= inferMinecraftFromModNames(names);

  return { mcVersion, loader };
}

export async function importJarsZip(zip: AdmZip): Promise<ImportResult> {
  const jarEntries = zip.getEntries().filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.jar'));
  if (jarEntries.length === 0) throw new ImportError('No .jar files found in this zip');

  const jars = jarEntries.map((entry) => ({ filename: entry.entryName.split('/').pop() ?? entry.entryName, buffer: entry.getData() }));
  const matched: ImportedItem[] = [];
  const unresolved: UnresolvedEntry[] = [];
  const clientOnly: UnresolvedEntry[] = [];
  await classifyJarsByHash(jars, matched, clientOnly);

  // A CurseForge server pack arrives here (no manifest.json), and it knows perfectly well what it
  // targets — see detectServerPackTarget. A genuine bag-of-jars zip has no such markers and still
  // reports nulls, leaving the caller's values to stand in.
  const { mcVersion, loader } = detectServerPackTarget(zip);

  return { format: 'jars', suggestedName: null, mcVersion, loader, matched, unresolved, clientOnly };
}

export async function importPack(buffer: Buffer, onProgress?: ImportProgress): Promise<ImportResult> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new ImportError('Not a valid zip file');
  }
  const format = detectFormat(zip);
  if (format === 'mrpack') return importMrpack(zip);
  if (format === 'curseforge') return importCurseForge(zip, onProgress);
  return importJarsZip(zip);
}
