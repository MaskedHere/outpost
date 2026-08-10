import { config } from '../config.js';

const USER_AGENT = 'outpost-panel/0.1.0 (https://github.com/outpost-panel/outpost)';

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

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
}

export async function searchMods(params: {
  query: string;
  mcVersion?: string;
  loader?: string;
  offset?: number;
  limit?: number;
}): Promise<ModrinthSearchResult> {
  const facets: string[][] = [['project_type:mod']];
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

export async function getProject(idOrSlug: string): Promise<ModrinthProject> {
  return modrinthFetch<ModrinthProject>(`/project/${encodeURIComponent(idOrSlug)}`);
}

export async function getProjectVersions(
  idOrSlug: string,
  params: { mcVersion?: string; loader?: string } = {},
): Promise<ModrinthVersion[]> {
  const qs = new URLSearchParams();
  if (params.mcVersion) qs.set('game_versions', JSON.stringify([params.mcVersion]));
  if (params.loader) qs.set('loaders', JSON.stringify([params.loader]));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return modrinthFetch<ModrinthVersion[]>(`/project/${encodeURIComponent(idOrSlug)}/version${suffix}`);
}

export async function getVersion(versionId: string): Promise<ModrinthVersion> {
  return modrinthFetch<ModrinthVersion>(`/version/${encodeURIComponent(versionId)}`);
}
