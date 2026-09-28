import { config } from '../config.js';

const USER_AGENT = 'MaskedHere/outpost (https://github.com/MaskedHere/outpost)';

async function modrinthFetch<T>(pathAndQuery: string): Promise<T> {
  const res = await fetch(`${config.modrinthApiBase}${pathAndQuery}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Modrinth API ${pathAndQuery} failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
  /** Every Minecraft version this project supports, oldest first. */
  versions?: string[];
  client_side: ModrinthSupportLevel;
  server_side: ModrinthSupportLevel;
}

export interface ModrinthSearchResult {
  hits: ModrinthSearchHit[];
  total_hits: number;
}

export interface ModrinthVersionFile {
  filename: string;
  primary: boolean;
  url: string;
  size: number;
  hashes: { sha1: string; sha512: string };
}

export interface ModrinthDependency {
  version_id: string | null;
  project_id: string | null;
  dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  dependencies: ModrinthDependency[];
  files: ModrinthVersionFile[];
}

export type ModrinthSupportLevel = 'required' | 'optional' | 'unsupported';

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  // Modrinth curates these independently of whatever a mod's own jar metadata claims.
  client_side: ModrinthSupportLevel;
  server_side: ModrinthSupportLevel;
}

/** Modrinth's own sort keys (their `index` parameter), in the order Outpost offers them. */
export type ModrinthSortIndex = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';

export async function searchMods(params: {
  query: string;
  mcVersion?: string;
  loader?: string;
  /** A Modrinth category slug ("technology", "magic", etc.) to narrow results to. */
  category?: string;
  sort?: ModrinthSortIndex;
  /** Drops mods Modrinth marks server_side: unsupported. */
  serverOnly?: boolean;
  offset?: number;
  limit?: number;
}): Promise<ModrinthSearchResult> {
  // Each inner array is OR'd and the outer array is AND'd, so loader and category go in separate
  // entries.
  const facets: string[][] = [['project_type:mod']];
  if (params.mcVersion) facets.push([`versions:${params.mcVersion}`]);
  if (params.loader) facets.push([`categories:${params.loader}`]);
  if (params.category) facets.push([`categories:${params.category}`]);
  // Modrinth has no "server_side != unsupported" facet, so request the two installable values
  // instead (server-side, so paging stays correct).
  if (params.serverOnly) facets.push(['server_side:required', 'server_side:optional']);

  const qs = new URLSearchParams({
    query: params.query,
    facets: JSON.stringify(facets),
    index: params.sort ?? 'relevance',
    offset: String(params.offset ?? 0),
    limit: String(params.limit ?? 20),
  });

  return modrinthFetch<ModrinthSearchResult>(`/search?${qs.toString()}`);
}

// Modrinth's own project_type distinct from "mod".
export async function searchPlugins(params: {
  query: string;
  mcVersion?: string;
  offset?: number;
  limit?: number;
}): Promise<ModrinthSearchResult> {
  const facets: string[][] = [['project_type:plugin']];
  if (params.mcVersion) facets.push([`versions:${params.mcVersion}`]);

  const qs = new URLSearchParams({
    query: params.query,
    facets: JSON.stringify(facets),
    offset: String(params.offset ?? 0),
    limit: String(params.limit ?? 20),
    // An empty query shows the most-downloaded plugins first, since relevance ranking means nothing
    // without a search term.
    ...(params.query ? {} : { index: 'downloads' }),
  });

  return modrinthFetch<ModrinthSearchResult>(`/search?${qs.toString()}`);
}

export async function searchModpacks(params: {
  query: string;
  mcVersion?: string;
  loader?: string;
  offset?: number;
  limit?: number;
}): Promise<ModrinthSearchResult> {
  const facets: string[][] = [['project_type:modpack']];
  if (params.mcVersion) facets.push([`versions:${params.mcVersion}`]);
  if (params.loader) facets.push([`categories:${params.loader}`]);

  const qs = new URLSearchParams({
    query: params.query,
    facets: JSON.stringify(facets),
    offset: String(params.offset ?? 0),
    limit: String(params.limit ?? 20),
  });

  return modrinthFetch<ModrinthSearchResult>(`/search?${qs.toString()}`);
}

export interface ModrinthGameVersion {
  version: string;
  version_type: 'release' | 'snapshot' | 'alpha' | 'beta';
  date: string;
  major: boolean;
}

/** The full list of Minecraft versions Modrinth recognizes. */
export async function getGameVersions(): Promise<ModrinthGameVersion[]> {
  return modrinthFetch<ModrinthGameVersion[]>('/tag/game_version');
}

export async function getProject(idOrSlug: string): Promise<ModrinthProject> {
  return modrinthFetch<ModrinthProject>(`/project/${encodeURIComponent(idOrSlug)}`);
}

/** Looks up many projects in one request. */
export async function getProjects(ids: string[]): Promise<ModrinthProject[]> {
  if (ids.length === 0) return [];
  return modrinthFetch<ModrinthProject[]>(
    `/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`,
  );
}

export async function getProjectVersions(
  idOrSlug: string,
  params: { mcVersion?: string; loader?: string } = {},
): Promise<ModrinthVersion[]> {
  const qs = new URLSearchParams();
  if (params.mcVersion) qs.set('game_versions', JSON.stringify([params.mcVersion]));
  if (params.loader) qs.set('loaders', JSON.stringify([params.loader]));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return modrinthFetch<ModrinthVersion[]>(
    `/project/${encodeURIComponent(idOrSlug)}/version${suffix}`,
  );
}

export async function getVersion(versionId: string): Promise<ModrinthVersion> {
  return modrinthFetch<ModrinthVersion>(`/version/${encodeURIComponent(versionId)}`);
}

/** Identifies files against Modrinth purely by content hash. */
export async function lookupVersionsBySha1(
  hashes: string[],
): Promise<Record<string, ModrinthVersion>> {
  if (hashes.length === 0) return {};
  const res = await fetch(`${config.modrinthApiBase}/version_files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ hashes, algorithm: 'sha1' }),
  });
  if (!res.ok) throw new Error(`Modrinth hash lookup failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<Record<string, ModrinthVersion>>;
}
