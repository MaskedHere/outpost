/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { chromium, type Browser } from 'playwright';

// CurseForge's site sits behind Cloudflare's bot challenge for its search/listing pages — a plain
// HTTP request gets "Just a moment..." instead of real content (confirmed empirically), so search
// needs an actual rendered browser. Individual content pages (a specific pack's download page)
// aren't behind the same challenge, so those stay on plain fetch — see resolveDownloadUrl.
const BASE = 'https://www.curseforge.com';
const REAL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Headless Chromium takes ~1-2s to launch — reuse one instance across requests instead of paying
// that cost per search.
//
// In the production image there's no Playwright-downloaded browser: Playwright doesn't officially
// support Alpine, and bundling its own Chromium would roughly triple the image size. Instead the
// Dockerfile installs Alpine's system chromium package and points here at it via
// CHROMIUM_PATH. Locally the variable is unset and Playwright uses its own managed browser as usual.
let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = process.env.CHROMIUM_PATH || undefined;
    browserPromise = chromium.launch({ headless: true, executablePath });
  }
  return browserPromise;
}

export interface CurseForgeModSummary {
  slug: string;
  /** The file id CurseForge's own search card links to (its current default/latest download) —
   *  good enough to import directly; Outpost doesn't need the full per-version file list CurseForge's
   *  key-gated API would provide. */
  fileId: number;
  name: string;
  summary: string;
  logoUrl: string | null;
  gameVersion: string | null;
}

// CurseForge's search page filters mod loader via a numeric gameVersionTypeId, not a name — no
// documented mapping, confirmed directly from the site's own loader filter links.
const LOADER_TYPE_ID: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };

async function searchProjects(params: {
  class: 'modpacks' | 'mc-mods';
  query: string;
  mcVersion?: string;
  loader?: string;
  offset?: number;
  limit?: number;
}): Promise<CurseForgeModSummary[]> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: REAL_UA });
  const page = await context.newPage();
  try {
    const pageSize = params.limit ?? 20;
    const pageNum = Math.floor((params.offset ?? 0) / pageSize) + 1;
    const qs = new URLSearchParams({
      class: params.class,
      page: String(pageNum),
      pageSize: String(pageSize),
      sortBy: 'relevancy',
    });
    if (params.query) qs.set('search', params.query);
    // `version`, not `gameVersion`. Verified against the live site: gameVersion= is accepted and
    // silently ignored, returning byte-identical results to no filter at all, which is why changing
    // the Minecraft version appeared to do nothing. Note the cards still show each project's newest
    // version rather than the matched one, so results must NOT be post-filtered on the badge text.
    if (params.mcVersion) qs.set('version', params.mcVersion);
    if (params.loader && LOADER_TYPE_ID[params.loader]) qs.set('gameVersionTypeId', String(LOADER_TYPE_ID[params.loader]));

    await page.goto(`${BASE}/minecraft/search?${qs.toString()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.project-card', { timeout: 15000 }).catch(() => null);

    return await page.$$eval('.project-card', (cards) =>
      cards
        .map((card) => {
          const nameLink = card.querySelector('a.name');
          const img = card.querySelector('.art img');
          const desc = card.querySelector('p.description');
          const dl = card.querySelector('a.download-cta');
          const gameVersion = card.querySelector('.detail-game-version');
          const href = nameLink?.getAttribute('href') ?? '';
          const slug = href.split('/').filter(Boolean).pop() ?? '';
          const dlHref = dl?.getAttribute('href') ?? '';
          const fileIdMatch = dlHref.match(/\/download\/(\d+)/);
          return {
            slug,
            fileId: fileIdMatch ? Number(fileIdMatch[1]) : 0,
            name: nameLink?.textContent?.trim() ?? slug,
            summary: desc?.textContent?.trim() ?? '',
            logoUrl: img?.getAttribute('src') ?? null,
            gameVersion: gameVersion?.textContent?.trim() ?? null,
          };
        })
        .filter((c) => c.slug && c.fileId),
    );
  } finally {
    await page.close();
    await context.close();
  }
}

export async function searchModpacks(params: {
  query: string;
  mcVersion?: string;
  offset?: number;
  limit?: number;
}): Promise<CurseForgeModSummary[]> {
  return searchProjects({ ...params, class: 'modpacks' });
}

export async function searchMods(params: {
  query: string;
  mcVersion?: string;
  loader?: string;
  offset?: number;
  limit?: number;
}): Promise<CurseForgeModSummary[]> {
  return searchProjects({ ...params, class: 'mc-mods' });
}

/** Where a modpack publishes a distinct "Server Pack"/"Server Files" download (common for actively
 *  maintained packs, e.g. All the Mods) — a zip built to drop straight onto a dedicated server,
 *  containing the actual mod jars directly rather than the numeric-ID-only manifest.json the
 *  default "Client" file ships (which needs CurseForge's key-gated API to resolve, so Outpost falls
 *  back to guessing by name against Modrinth for it — see import.ts). Preferring this file when it
 *  exists means every mod installs from its real bytes, no guessing, no "couldn't be matched"
 *  entries. Returns null if this pack doesn't publish one (most smaller/personal packs don't). */
export async function findServerPackFileId(slug: string): Promise<number | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: REAL_UA });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/minecraft/modpacks/${slug}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#recent-files', { timeout: 10000 }).catch(() => null);

    // #recent-files is a flat run of <h4> version-group headings and <a class="file-card"> siblings
    // (not nested) — a "Server Pack(s)"/"Server File(s)" heading's very next sibling is that file's
    // card, with the file id in its href (/minecraft/modpacks/<slug>/files/<id>).
    const href = await page.evaluate(() => {
      const container = document.querySelector('#recent-files');
      if (!container) return null;
      const children = [...container.children];
      for (let i = 0; i < children.length; i++) {
        const el = children[i]!;
        if (/^H[1-6]$/.test(el.tagName) && /server\s*(pack|file)/i.test(el.textContent ?? '')) {
          const card = children[i + 1];
          if (card?.tagName === 'A') return card.getAttribute('href');
        }
      }
      return null;
    });

    const match = href?.match(/\/files\/(\d+)/);
    return match ? Number(match[1]) : null;
  } finally {
    await page.close();
    await context.close();
  }
}

/** Extracts the real signed forgecdn.net URL from a CurseForge file-download page already loaded
 *  into `page`. Everything stays inside the browser context on purpose: a plain Node `fetch()` to
 *  curseforge.com gets challenged by Cloudflare even where curl doesn't (different TLS
 *  fingerprint), so this rides on Playwright's `context.request` instead — the same browser/TLS
 *  stack and cookies (including any Cloudflare clearance cookie) `page.goto` just earned. */
async function extractDownloadUrl(page: Awaited<ReturnType<Browser['newPage']>>): Promise<string | null> {
  const downloadLinkSelector = 'a[href*="/api/v1/mods/"][href*="/download"]';
  const href = await page
    .waitForSelector(downloadLinkSelector, { timeout: 15000 })
    .then(() => page.getAttribute(downloadLinkSelector, 'href'))
    .catch(() => null);
  if (!href) return null;
  const apiUrl = href.startsWith('http') ? href : `${BASE}${href}`;

  const resp = await page.context().request.get(apiUrl, { maxRedirects: 0, headers: { 'User-Agent': REAL_UA } });
  return resp.headers()['location'] ?? null;
}

/** Resolves a CurseForge file to its actual downloadable URL (a signed forgecdn.net link) — works
 *  for any project category (modpacks, mc-mods, ...), since the download-page structure and
 *  extraction logic is identical regardless. */
export async function resolveDownloadUrl(slug: string, fileId: number, category: string = 'modpacks'): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: REAL_UA });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/minecraft/${category}/${slug}/download/${fileId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const url = await extractDownloadUrl(page);
    if (!url) throw new Error("Couldn't find a download link on CurseForge's page for this file");
    return url;
  } finally {
    await page.close();
    await context.close();
  }
}

export interface CurseForgeDependency {
  slug: string;
  name: string;
}

/** Scrapes a project's own Relations > Dependencies page (e.g. curseforge.com/minecraft/mc-mods/
 *  waystones/relations/dependencies) for its "Required Dependency" relations — the real dependency
 *  graph CurseForge itself curates for every mod, confirmed directly against Waystones' page (lists
 *  Balm and Shogi as required). This is what makes dependency resolution possible for *any*
 *  CurseForge mod, not just ones that happen to also be hash-identical on Modrinth. Embedded
 *  Library/Optional Dependency/Tool/Incompatible/Include relations are deliberately excluded — only
 *  "Required Dependency" means the mod won't run without it. */
async function findRequiredDependenciesOnPage(
  page: Awaited<ReturnType<Browser['newPage']>>,
  slug: string,
  category: string,
): Promise<CurseForgeDependency[]> {
  await page.goto(`${BASE}/minecraft/${category}/${slug}/relations/dependencies`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('a.project-relation-card', { timeout: 10000 }).catch(() => null);
  return page.$$eval('a.project-relation-card', (cards) =>
    cards
      .filter((c) => c.querySelector('.type')?.textContent?.trim() === 'Required Dependency')
      .map((c) => ({
        slug: (c.getAttribute('href') ?? '').split('/').filter(Boolean).pop() ?? '',
        name: c.querySelector('.project-relation-card-title')?.textContent?.trim() ?? '',
      }))
      .filter((d) => d.slug),
  );
}

/** Finds the file id for a dependency that best matches the pack's own Minecraft version and loader
 *  — the dependency listing itself carries no file/version info, only a project slug, so this reads
 *  the project's own Files list (each file-card carries its version and loader as plain text, e.g.
 *  "26.1.2" / "NeoForge" — confirmed against Balm's files page) and picks the closest match. Prefers
 *  an exact version+loader match, then falls back to the newest file for the right loader (the files
 *  list is already sorted newest-first) — but never falls back across loaders, since installing e.g.
 *  a NeoForge jar into a Fabric pack would crash the server outright, which is worse than simply
 *  skipping a dependency Outpost couldn't confidently match. */
async function findBestFileIdOnPage(
  page: Awaited<ReturnType<Browser['newPage']>>,
  slug: string,
  mcVersion: string,
  loader: string,
  category: string,
): Promise<number | null> {
  await page.goto(`${BASE}/minecraft/${category}/${slug}/files/all?page=1&pageSize=20&showAlphaFiles=hide`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('a.file-card', { timeout: 10000 }).catch(() => null);
  const files = await page.$$eval('a.file-card', (cards) =>
    cards
      .map((c) => {
        const href = c.getAttribute('href') ?? '';
        const fileIdMatch = href.match(/\/files\/(\d+)$/);
        const items = [...c.querySelectorAll('.file-details-list > li')];
        return {
          fileId: fileIdMatch ? Number(fileIdMatch[1]) : 0,
          version: items[1]?.textContent?.trim() ?? '',
          loader: c.querySelector('.detail-flavor')?.textContent?.trim() ?? '',
        };
      })
      .filter((f) => f.fileId),
  );

  const exact = files.find((f) => f.version === mcVersion && f.loader.toLowerCase() === loader.toLowerCase());
  if (exact) return exact.fileId;
  const loaderMatch = files.find((f) => f.loader.toLowerCase() === loader.toLowerCase());
  return loaderMatch?.fileId ?? null;
}

/** Walks a mod's required-dependency tree (breadth-first, via CurseForge's own Relations page) and
 *  resolves each dependency to a concrete file id matching the pack's Minecraft version and loader —
 *  everything a caller needs to then download and install each one. Reuses a single browser
 *  page/context across the whole walk rather than opening a fresh one per navigation (a naive
 *  implementation could easily rack up a dozen+ page loads for a mod with a deep dependency chain).
 *  Capped at MAX_DEPENDENCIES total so a pathological or cyclic relation graph can't run away. */
export async function resolveRequiredDependencyChain(
  rootSlug: string,
  mcVersion: string,
  loader: string,
  category: string = 'mc-mods',
): Promise<(CurseForgeDependency & { fileId: number })[]> {
  const MAX_DEPENDENCIES = 25;
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: REAL_UA });
  const page = await context.newPage();
  const seen = new Set<string>([rootSlug]);
  const results: (CurseForgeDependency & { fileId: number })[] = [];
  const queue = [rootSlug];
  try {
    while (queue.length > 0 && results.length < MAX_DEPENDENCIES) {
      const currentSlug = queue.shift()!;
      const deps = await findRequiredDependenciesOnPage(page, currentSlug, category).catch(() => []);
      for (const dep of deps) {
        if (seen.has(dep.slug) || results.length >= MAX_DEPENDENCIES) continue;
        seen.add(dep.slug);
        const fileId = await findBestFileIdOnPage(page, dep.slug, mcVersion, loader, category).catch(() => null);
        if (!fileId) continue;
        results.push({ ...dep, fileId });
        queue.push(dep.slug);
      }
    }
    return results;
  } finally {
    await page.close();
    await context.close();
  }
}

export interface ResolvedCurseForgeMod {
  projectSlug: string;
  projectName: string;
  /** null if the project exists but this specific file no longer does (removed/renamed). */
  downloadUrl: string | null;
}

/** Resolves a single mod referenced by numeric {projectID, fileID} inside a CurseForge modpack's
 *  manifest.json — the "share export" format only carries these opaque IDs (which normally need
 *  CurseForge's key-gated API to resolve), but curseforge.com/projects/<id> redirects to the mod's
 *  real slugged page with no API key needed, and from there the same download-link extraction
 *  `resolveDownloadUrl` uses works for any project category, not just modpacks. This is what lets
 *  Outpost fetch every mod's REAL file — the same thing the official CurseForge app itself does when
 *  it resolves a "share" import locally — instead of guessing a same-named Modrinth mod (see
 *  import.ts's importCurseForge). Returns null only if the project itself no longer exists. */
export async function resolveModFileDownloadUrl(projectId: number, fileId: number): Promise<ResolvedCurseForgeMod | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: REAL_UA });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/projects/${projectId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // CurseForge's SPA serves a custom 404 page (with an empty <title>) rather than a real 404
    // status for a dead redirect target — checking the title is what actually works here, confirmed
    // empirically against both a real project id and a made-up one.
    const projectTitle = await page.title();
    if (!projectTitle) return null;

    const projectUrl = page.url();
    const projectSlug = projectUrl.split('/').filter(Boolean).pop() ?? String(projectId);
    const projectName = projectTitle.replace(/\s*-\s*Minecraft\s+(Mods|Modpacks|Resource Packs|Data Packs|Bukkit Plugins).*$/i, '').trim() || projectSlug;

    await page.goto(`${projectUrl}/download/${fileId}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!(await page.title())) return { projectSlug, projectName, downloadUrl: null };

    const downloadUrl = await extractDownloadUrl(page);
    return { projectSlug, projectName, downloadUrl };
  } catch {
    return null;
  } finally {
    await page.close();
    await context.close();
  }
}
