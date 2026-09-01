// Looks up official map artwork from the Official Team Fortress Wiki (wiki.teamfortress.com, a
// MediaWiki instance) so the server banner can show the actual current map instead of a generic
// TF2 splash. Every stock map article shares the same {{Map infobox}} template — confirmed live —
// whose `map-file-name` parameter holds the exact internal map name (e.g. "ctf_2fort") and whose
// `map-image` parameter names the banner file to display. There's no predictable file-naming
// convention across maps (e.g. 2Fort's is "Ctf 2fort bridge ss.png"), so this reads the parameter
// out of the page's wikitext rather than guessing a URL.
const WIKI_API = 'https://wiki.teamfortress.com/w/api.php';
const REQUEST_TIMEOUT_MS = 5000;

interface CacheEntry {
  url: string | null;
  expires: number;
}

// Map art never changes at runtime, so a resolved URL is cached for a long time; a miss (page not
// found, infobox didn't match) gets a shorter TTL in case it was a transient wiki hiccup rather
// than a genuinely missing article.
const SUCCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

/** Returns `unknown` rather than `any` — every caller has to narrow the wiki's untyped JSON before
 *  using it, which is the point: the response shape is whatever MediaWiki felt like returning. */
async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Splits a mapControl option label like "Capture the Flag — 2Fort" into wiki-page-title guesses:
 *  the plain name first (matches the large majority of stock maps), then "Name (Category)" for the
 *  handful of maps that share a name across game modes and live on a disambiguated wiki title
 *  (e.g. "Well (Control Point)"). */
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
  const data = (await fetchJson(url)) as
    | { query?: { pages?: Record<string, { imageinfo?: { url?: string }[] }> } }
    | null;
  const pages = data?.query?.pages;
  if (!pages) return null;
  return Object.values(pages)[0]?.imageinfo?.[0]?.url ?? null;
}

/** Resolves the wiki's banner image for a currently-loaded TF2 map, or null if no matching article
 *  could be found — callers should fall back to the game's default banner in that case. Only TF2
 *  is wired up to a wiki today; other games' `mapControl` (if any are added later) would need their
 *  own resolver rather than reusing this one, since the lookup is tied to wiki.teamfortress.com's
 *  specific template shape. */
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
