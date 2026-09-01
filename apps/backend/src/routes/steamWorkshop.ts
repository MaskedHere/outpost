import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';

// Both of these Steam Web API endpoints are public reads — no API key needed, confirmed directly
// against real collection/item IDs. This is what makes resolving a whole collection viable without
// asking the user for a Steam Web API key the way the deploy flow itself never has to.
const STEAM_API = 'https://api.steampowered.com';

interface CollectionDetailsResponse {
  response?: {
    collectiondetails?: { result: number; children?: { publishedfileid: string }[] }[];
  };
}

interface PublishedFileDetailsResponse {
  response?: {
    publishedfiledetails?: { publishedfileid: string; title?: string; description?: string; result: number }[];
  };
}

async function fetchCollectionChildren(collectionId: string): Promise<string[]> {
  const res = await fetch(`${STEAM_API}/ISteamRemoteStorage/GetCollectionDetails/v1/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `collectioncount=1&publishedfileids[0]=${encodeURIComponent(collectionId)}`,
  });
  if (!res.ok) throw new Error("Failed to reach Steam's Workshop API");
  const data = (await res.json()) as CollectionDetailsResponse;
  const detail = data.response?.collectiondetails?.[0];
  if (!detail || detail.result !== 1) throw new Error("Couldn't find that collection — check the ID and that it's public");
  return (detail.children ?? []).map((c) => c.publishedfileid);
}

async function fetchItemDetails(ids: string[]): Promise<{ publishedfileid: string; title: string; description: string }[]> {
  if (ids.length === 0) return [];
  const params = new URLSearchParams({ itemcount: String(ids.length) });
  ids.forEach((id, i) => params.set(`publishedfileids[${i}]`, id));
  const res = await fetch(`${STEAM_API}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error("Failed to reach Steam's Workshop API");
  const data = (await res.json()) as PublishedFileDetailsResponse;
  return (data.response?.publishedfiledetails ?? [])
    .filter((d) => d.result === 1)
    .map((d) => ({ publishedfileid: d.publishedfileid, title: d.title ?? '', description: d.description ?? '' }));
}

// Project Zomboid mod authors overwhelmingly self-report their mod's internal id in the Workshop
// description as "Mod ID: <value>" (a long-standing community convention, since Steam's own item
// metadata has no field for it) — confirmed directly against real Workshop pages. A single item can
// bundle more than one mod, in which case authors list multiple ids comma/semicolon-separated.
const MOD_ID_RE = /Mod\s*ID[:\s]+([^\r\n]+)/i;

// A real mod id is a clean identifier — letters/digits/underscore/dot/hyphen, no spaces or
// brackets, and short. Free-text descriptions produce two kinds of bad captures a plain regex
// can't tell apart from a real one: an unrelated sentence that happens to contain the words "Mod
// ID" (e.g. a mod manager's own changelog bullet), and a real id line with extra decorative
// bracketed text tacked on that isn't part of the actual id. Rejecting anything that doesn't look
// like a plausible id — rather than accepting it and quietly breaking that mod at boot — routes
// both cases into `unresolved` for a human to sort out instead of silently corrupting MOD_NAMES.
const PLAUSIBLE_MOD_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

function extractModIds(description: string): string[] {
  const match = description.match(MOD_ID_RE);
  if (!match) return [];
  const candidates = match[1]!
    // Authors format this line with Steam BBCode all the time — "[b]Mod ID:[/b] Foo" is common
    // enough that a stray "[/b]" ended up captured as part of a real mod id before this was added.
    .replace(/\[\/?[a-z0-9=]*\]/gi, '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return candidates.every((c) => PLAUSIBLE_MOD_ID_RE.test(c)) ? candidates : [];
}

export async function steamWorkshopRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Resolves a Steam Workshop collection into the same {workshopItemIds, modIds} shape the manual
  // Project Zomboid fields already take — paste one collection URL's id instead of visiting every
  // mod's page by hand to copy its Workshop id and Mod id separately. Mods whose description didn't
  // match the convention come back in `unresolved` so they can still be added manually rather than
  // silently dropped.
  app.post('/api/steam-workshop/resolve-collection', async (request, reply) => {
    const body = (request.body ?? {}) as { collectionId?: string };
    const collectionId = body.collectionId?.trim();
    if (!collectionId || !/^\d+$/.test(collectionId)) {
      return reply.code(400).send({ error: 'Enter a numeric Steam Workshop collection ID' });
    }

    try {
      const childIds = await fetchCollectionChildren(collectionId);
      if (childIds.length === 0) return reply.code(400).send({ error: 'This collection is empty' });

      // Steam's own API isn't documented to accept an unlimited item count per call — chunk large
      // collections rather than risk one oversized request failing the whole resolution.
      const CHUNK = 100;
      const details: { publishedfileid: string; title: string; description: string }[] = [];
      for (let i = 0; i < childIds.length; i += CHUNK) {
        details.push(...(await fetchItemDetails(childIds.slice(i, i + CHUNK))));
      }

      const workshopItemIds: string[] = [];
      const modIds: string[] = [];
      const unresolved: { workshopId: string; title: string }[] = [];

      for (const item of details) {
        const found = extractModIds(item.description);
        if (found.length === 0) {
          unresolved.push({ workshopId: item.publishedfileid, title: item.title || item.publishedfileid });
          continue;
        }
        // Both lists have to stay position-matched 1:1 (see projectzomboid.ts's buildContainerSpec)
        // — an item with multiple mod ids repeats its workshop id once per mod id so the pairing
        // still lines up correctly.
        for (const modId of found) {
          workshopItemIds.push(item.publishedfileid);
          modIds.push(modId);
        }
      }

      return { workshopItemIds, modIds, unresolved, total: details.length };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Failed to resolve collection' });
    }
  });
}
