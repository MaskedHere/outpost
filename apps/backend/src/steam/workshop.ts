/** Steam Workshop client. */

const STEAM_API = 'https://api.steampowered.com';
const COMMUNITY = 'https://steamcommunity.com';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface WorkshopItem {
  workshopItemId: string;
  title: string;
  description: string;
  previewUrl: string | null;
  subscriptions: number | null;
  /** The app this item was published for. */
  appId: number | null;
  /** The app the item's content was authored under. */
  creatorAppId: number | null;
}

/** Steam's generic community app. */
const STEAM_COMMUNITY_APP_ID = 766;

interface PublishedFileDetail {
  publishedfileid: string;
  title?: string;
  description?: string;
  preview_url?: string;
  subscriptions?: number;
  consumer_app_id?: number;
  creator_app_id?: number;
  result: number;
}

/** Steam's own API isn't documented to accept an unlimited item count per call. */
const DETAILS_CHUNK = 100;

export async function fetchItemDetails(ids: string[]): Promise<WorkshopItem[]> {
  if (ids.length === 0) return [];

  const out: WorkshopItem[] = [];
  for (let i = 0; i < ids.length; i += DETAILS_CHUNK) {
    const slice = ids.slice(i, i + DETAILS_CHUNK);
    const params = new URLSearchParams({ itemcount: String(slice.length) });
    slice.forEach((id, index) => params.set(`publishedfileids[${index}]`, id));

    const res = await fetch(`${STEAM_API}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!res.ok) throw new Error("Failed to reach Steam's Workshop API");
    const data = (await res.json()) as {
      response?: { publishedfiledetails?: PublishedFileDetail[] };
    };

    for (const d of data.response?.publishedfiledetails ?? []) {
      if (d.result !== 1) continue;
      out.push({
        workshopItemId: d.publishedfileid,
        title: d.title ?? '',
        description: d.description ?? '',
        previewUrl: d.preview_url ?? null,
        subscriptions: d.subscriptions ?? null,
        appId: d.consumer_app_id ?? null,
        creatorAppId: d.creator_app_id ?? null,
      });
    }
  }
  return out;
}

export async function fetchCollectionChildren(collectionId: string): Promise<string[]> {
  const res = await fetch(`${STEAM_API}/ISteamRemoteStorage/GetCollectionDetails/v1/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `collectioncount=1&publishedfileids[0]=${encodeURIComponent(collectionId)}`,
  });
  if (!res.ok) throw new Error("Failed to reach Steam's Workshop API");
  const data = (await res.json()) as {
    response?: {
      collectiondetails?: { result: number; children?: { publishedfileid: string }[] }[];
    };
  };
  const detail = data.response?.collectiondetails?.[0];
  if (!detail || detail.result !== 1) {
    throw new Error("Couldn't find that collection — check the ID and that it's public");
  }
  return (detail.children ?? []).map((c) => c.publishedfileid);
}

/** Searches one game's Workshop. */
export async function searchWorkshop(params: {
  appId: number;
  query: string;
  page?: number;
  /** Steam's own sort keys: 'trend' (popular recently), 'mostrecent', 'totaluniquesubscribers'. */
  sort?: string;
}): Promise<WorkshopItem[]> {
  const qs = new URLSearchParams({
    appid: String(params.appId),
    searchtext: params.query,
    browsesort: params.sort ?? 'trend',
    actualsort: params.sort ?? 'trend',
    section: 'readytouseitems',
    p: String(params.page ?? 1),
  });

  const res = await fetch(`${COMMUNITY}/workshop/browse/?${qs.toString()}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error('Failed to reach the Steam Workshop');
  const html = await res.text();

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/sharedfiles\/filedetails\/\?id=(\d+)/g)) {
    const id = match[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) return [];

  const details = await fetchItemDetails(ids);
  const filtered = details.filter(
    (d) =>
      (d.appId === null || d.appId === params.appId) && d.creatorAppId !== STEAM_COMMUNITY_APP_ID,
  );
  // fetchItemDetails answers in Steam's order, not ours.
  const rank = new Map(ids.map((id, i) => [id, i]));
  return filtered.sort(
    (a, b) => (rank.get(a.workshopItemId) ?? 0) - (rank.get(b.workshopItemId) ?? 0),
  );
}

// Zomboid authors conventionally list the internal id in the Workshop description as "Mod ID:
// <value>", since Steam has no field for it.
const MOD_ID_RE = /Mod\s*ID[:\s]+([^\r\n]+)/i;

// A real mod id is a clean identifier.
const PLAUSIBLE_MOD_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export function extractModIds(description: string): string[] {
  const match = description.match(MOD_ID_RE);
  if (!match) return [];
  const candidates = match[1]!
    // Authors format this line with Steam BBCode all the time.
    .replace(/\[\/?[a-z0-9=]*\]/gi, '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return candidates.every((c) => PLAUSIBLE_MOD_ID_RE.test(c)) ? candidates : [];
}
