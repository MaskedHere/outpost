/** Factorio Mod Portal client. */

const API_BASE = 'https://mods.factorio.com/api';
const SITE_BASE = 'https://mods.factorio.com';

/** The index changes slowly (new releases, not new structure), so this is generous. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface FactorioModSummary {
  /** The mod's internal name. */
  name: string;
  title: string;
  owner: string;
  summary: string;
  downloadsCount: number;
  category: string;
  latestVersion: string | null;
  /** Which Factorio version the latest release targets, e.g. "2.0". */
  factorioVersion: string | null;
  /** Where the user finishes the job: their browser, already signed in to factorio.com. */
  downloadPageUrl: string;
  pageUrl: string;
}

export const FACTORIO_CATEGORIES: { value: string; label: string }[] = [
  { value: 'content', label: 'Content' },
  { value: 'overhaul', label: 'Overhaul' },
  { value: 'tweaks', label: 'Tweaks' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'mod-packs', label: 'Mod packs' },
  { value: 'scenarios', label: 'Scenarios' },
  { value: 'localizations', label: 'Localizations' },
];

interface RawMod {
  name: string;
  title: string;
  owner: string;
  summary?: string;
  downloads_count?: number;
  category?: string;
  latest_release?: { version?: string; info_json?: { factorio_version?: string } };
}

let cache: { at: number; mods: RawMod[] } | null = null;
let inFlight: Promise<RawMod[]> | null = null;

async function loadIndex(): Promise<RawMod[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.mods;
  // Collapse concurrent misses onto one request rather than pulling 13MB several times over.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await fetch(`${API_BASE}/mods?page_size=max`);
    if (!res.ok) throw new Error(`Factorio mod portal returned ${res.status}`);
    const body = (await res.json()) as { results?: RawMod[] };
    const mods = body.results ?? [];
    cache = { at: Date.now(), mods };
    return mods;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

function toSummary(m: RawMod): FactorioModSummary {
  return {
    name: m.name,
    title: m.title,
    owner: m.owner,
    summary: m.summary ?? '',
    downloadsCount: m.downloads_count ?? 0,
    category: m.category ?? 'no-category',
    latestVersion: m.latest_release?.version ?? null,
    factorioVersion: m.latest_release?.info_json?.factorio_version ?? null,
    downloadPageUrl: `${SITE_BASE}/mod/${encodeURIComponent(m.name)}/downloads`,
    pageUrl: `${SITE_BASE}/mod/${encodeURIComponent(m.name)}`,
  };
}

/** Ranks by how well the text matches, then by popularity. */
function rank(m: RawMod, q: string): number {
  const name = m.name.toLowerCase();
  const title = m.title.toLowerCase();
  if (name === q || title === q) return 0;
  if (name.startsWith(q) || title.startsWith(q)) return 1;
  if (name.includes(q) || title.includes(q)) return 2;
  if ((m.summary ?? '').toLowerCase().includes(q)) return 3;
  return 4;
}

export async function searchFactorioMods(params: {
  query: string;
  category?: string;
  offset?: number;
  limit?: number;
}): Promise<{ hits: FactorioModSummary[]; total: number }> {
  const all = await loadIndex();
  const q = params.query.trim().toLowerCase();
  const offset = params.offset ?? 0;
  const limit = params.limit ?? 20;

  let pool = all;
  if (params.category) pool = pool.filter((m) => m.category === params.category);
  // "internal" and "no-category" are mostly libraries and abandoned uploads.
  if (!q)
    pool = pool.filter(
      (m) => m.category && m.category !== 'internal' && m.category !== 'no-category',
    );

  const scored = q
    ? pool.map((m) => ({ m, r: rank(m, q) })).filter((s) => s.r < 4)
    : pool.map((m) => ({ m, r: 0 }));
  scored.sort((a, b) => a.r - b.r || (b.m.downloads_count ?? 0) - (a.m.downloads_count ?? 0));

  return {
    hits: scored.slice(offset, offset + limit).map((s) => toSummary(s.m)),
    total: scored.length,
  };
}

/**
 * A mod's required dependencies, so someone adding one can see what else it needs before their
 * server refuses to start.
 */
export async function getFactorioModDependencies(name: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/mods/${encodeURIComponent(name)}/full`);
  if (!res.ok) throw new Error(`Factorio mod portal returned ${res.status}`);
  const body = (await res.json()) as {
    releases?: { info_json?: { dependencies?: string[] } }[];
  };
  const releases = body.releases ?? [];
  const deps = releases[releases.length - 1]?.info_json?.dependencies ?? [];

  return (
    deps
      .map((d) => d.trim())
      .filter((d) => !d.startsWith('!') && !d.startsWith('?') && !d.startsWith('(?)'))
      // Strip the required-dependency markers so what's left is the mod's actual name.
      .map((d) => d.replace(/^[~+]\s*/, ''))
      // Strip the version constraint.
      .map((d) => d.split(/\s*[<>=]/)[0]!.trim())
      .filter((d) => d && d !== 'base')
  );
}
