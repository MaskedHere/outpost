// Looks up official map artwork from the Official Team Fortress Wiki (wiki.teamfortress.com, a
// MediaWiki instance) so the server banner can show the actual current map instead of a generic TF2
// splash.
const WIKI_API = 'https://wiki.teamfortress.com/w/api.php';
const REQUEST_TIMEOUT_MS = 5000;

interface CacheEntry {
  url: string | null;
  expires: number;
}

// Map art doesn't change, so hits are cached for a long time; misses get a shorter TTL in case the
// wiki had a transient error.
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

/** Returns `unknown` rather than `any`. */
async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Splits a mapControl label like "Capture the Flag — 2Fort" into wiki page title guesses: the plain
 * name first, then "Name (Category)" for disambiguated pages.
 */
function candidateTitles(optionLabel: string): string[] {
  const sep = optionLabel.indexOf(' — ');
  if (sep === -1) return [optionLabel];
  const category = optionLabel.slice(0, sep);
  const name = optionLabel.slice(sep + 3);
  return [name, `${name} (${category})`];
}

async function fetchInfobox(title: string): Promise<{ fileName: string; image: string } | null> {
  const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(title)}&redirects=1&prop=wikitext&section=0&format=json`;
  const data = (await fetchJson(url)) as { parse?: { wikitext?: Record<string, string> } } | null;
  const wikitext = data?.parse?.wikitext?.['*'];
  if (!wikitext) return null;

  const fileNameMatch = wikitext.match(/\|\s*map-file-name\s*=\s*(\S+)/);
  const imageMatch = wikitext.match(/\|\s*map-image\s*=\s*([^\n|}]+)/);
  if (!fileNameMatch || !imageMatch) return null;
  return { fileName: fileNameMatch[1]!.trim(), image: imageMatch[1]!.trim() };
}

async function resolveFileUrl(fileName: string): Promise<string | null> {
  const url = `${WIKI_API}?action=query&titles=${encodeURIComponent(`File:${fileName}`)}&prop=imageinfo&iiprop=url&format=json`;
  const data = (await fetchJson(url)) as {
    query?: { pages?: Record<string, { imageinfo?: { url?: string }[] }> };
  } | null;
  const pages = data?.query?.pages;
  if (!pages) return null;
  return Object.values(pages)[0]?.imageinfo?.[0]?.url ?? null;
}

/**
 * Resolves the wiki's banner image for a currently-loaded TF2 map, or null if no matching article
 * could be found.
 */
export async function getTf2MapBannerUrl(map: string, optionLabel: string): Promise<string | null> {
  const cached = cache.get(map);
  if (cached && cached.expires > Date.now()) return cached.url;

  let url: string | null = null;
  for (const title of candidateTitles(optionLabel)) {
    const infobox = await fetchInfobox(title);
    if (!infobox || infobox.fileName.toLowerCase() !== map.toLowerCase()) continue;
    url = await resolveFileUrl(infobox.image);
    if (url) break;
  }

  cache.set(map, { url, expires: Date.now() + (url ? SUCCESS_TTL_MS : MISS_TTL_MS) });
  return url;
}
