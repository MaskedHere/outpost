/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { chromium, type Browser } from 'playwright';

// CurseForge's site sits behind Cloudflare's bot challenge for its search/listing pages.
const BASE = 'https://www.curseforge.com';
const REAL_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Headless Chromium takes ~1-2s to launch.
/** The scraping browser is shut down once it goes unused. */
const BROWSER_IDLE_MS = 3 * 60 * 1000;

let browserPromise: Promise<Browser> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
/** Searches can overlap, so the browser is only shut down once no scrape is using it. */
let activeUsers = 0;

async function getBrowser(): Promise<Browser> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!browserPromise) {
    const executablePath = process.env.CHROMIUM_PATH || undefined;
    browserPromise = chromium.launch({ headless: true, executablePath });
  }
  activeUsers += 1;
  return browserPromise;
}

/** Every getBrowser() must be paired with this, so the idle countdown can start once the last
 *  in-flight scrape finishes. */
function releaseBrowser(): void {
  activeUsers = Math.max(0, activeUsers - 1);
  if (activeUsers > 0 || idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (activeUsers > 0) return;
    const closing = browserPromise;
    browserPromise = null;
    closing?.then((b) => b.close()).catch(() => undefined);
  }, BROWSER_IDLE_MS);
  // Don't hold the process open just to close a browser later.
  idleTimer.unref?.();
}

export interface CurseForgeModSummary {
  slug: string;
  /** The file id CurseForge's own search card links to (its current default/latest download) */
  fileId: number;
  name: string;
  summary: string;
  logoUrl: string | null;
  gameVersion: string | null;
}

// CurseForge's search page filters mod loader via a numeric gameVersionTypeId, not a name.
const LOADER_TYPE_ID: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };

async function searchProjects(params: {
  /** CurseForge's own game slug. */
  game?: string;
  class: string;
  query: string;
  mcVersion?: string;
  loader?: string;
  /** CurseForge's second-level tag within a class (e.g. "server-mods", "quality-of-life"). */
  category?: string;
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
    // `version`, not `gameVersion`.
    if (params.mcVersion) qs.set('version', params.mcVersion);
    if (params.loader && LOADER_TYPE_ID[params.loader])
      qs.set('gameVersionTypeId', String(LOADER_TYPE_ID[params.loader]));
    if (params.category) qs.set('categories', params.category);

    await page.goto(`${BASE}/${params.game ?? 'minecraft'}/search?${qs.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
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
    releaseBrowser();
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
  category?: string;
  offset?: number;
  limit?: number;
}): Promise<CurseForgeModSummary[]> {
  return searchProjects({ ...params, class: 'mc-mods' });
}

/** CurseForge's Minecraft mod categories, trimmed to the ones worth offering. */
export const CURSEFORGE_MC_CATEGORIES: { value: string; label: string }[] = [
  { value: 'adventure-rpg', label: 'Adventure & RPG' },
  { value: 'technology', label: 'Technology' },
  { value: 'magic', label: 'Magic' },
  { value: 'utility-qol', label: 'Utility & QoL' },
  { value: 'server-utility', label: 'Server utility' },
  { value: 'performance', label: 'Performance' },
  { value: 'storage', label: 'Storage' },
  { value: 'mc-food', label: 'Food & farming' },
  { value: 'world-mobs', label: 'Mobs' },
  { value: 'world-gen', label: 'World generation' },
  { value: 'armor-weapons-tools', label: 'Armor, tools & weapons' },
  { value: 'library-api', label: 'Library / API' },
];

/** CurseForge's Palworld categories, and what each is. */
/** CurseForge's Palworld mod types, with whether Outpost can install one. */
export const PALWORLD_CATEGORIES: {
  value: string;
  label: string;
  installable: boolean;
  note: string;
}[] = [
  {
    value: 'patch-pak-mods',
    label: 'Pak mods',
    installable: true,
    note: 'Loaded straight from the game’s Paks directory — no mod loader needed. Only mods that say they are server-side change anything when installed here; purely cosmetic ones have to be installed by each player on their own machine.',
  },
  {
    value: 'miscellaneous',
    label: 'Miscellaneous',
    installable: true,
    note: 'Anything that does not fit the other types. Installed as a pak — check the mod’s own page for whether it belongs on the server or the client.',
  },
  {
    value: 'lua-code-mods',
    label: 'Lua code mods',
    installable: false,
    note: 'Needs UE4SS, which has no native Linux build — and this server runs the Linux dedicated binary. Browsable here, but installing one would do nothing.',
  },
  {
    value: 'blueprint-code-mods',
    label: 'Blueprint mods',
    installable: false,
    note: 'Needs UE4SS, which has no native Linux build — and this server runs the Linux dedicated binary. Browsable here, but installing one would do nothing.',
  },
  {
    value: 'cpp-code-mods',
    label: 'C++ code mods',
    installable: false,
    note: 'Needs UE4SS, which has no native Linux build — and this server runs the Linux dedicated binary. Browsable here, but installing one would do nothing.',
  },
];

/** Searches one of CurseForge's Palworld categories. */
export async function searchPalworldMods(params: {
  query: string;
  /** The mod type; CurseForge calls this the class (lua-code-mods, patch-pak-mods, etc.). */
  type?: string;
  /** An optional tag within that type (server-mods, quality-of-life, etc.). */
  category?: string;
  offset?: number;
  limit?: number;
}): Promise<CurseForgeModSummary[]> {
  return searchProjects({
    game: 'palworld',
    class: params.type || 'lua-code-mods',
    query: params.query,
    category: params.category,
    offset: params.offset,
    limit: params.limit,
  });
}

/**
 * The tag filters CurseForge offers within a Palworld mod type, taken from its own filter links.
 */
export const PALWORLD_FILTER_TAGS: { value: string; label: string }[] = [
  { value: 'server-mods', label: 'Server mods' },
  { value: 'gameplay', label: 'Gameplay' },
  { value: 'quality-of-life', label: 'Quality of life' },
  { value: 'settings', label: 'Settings' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'performance', label: 'Performance' },
  { value: 'pals', label: 'Pals' },
  { value: 'player', label: 'Player' },
  { value: 'ui', label: 'UI' },
  { value: 'graphics', label: 'Graphics' },
  { value: 'audio', label: 'Audio' },
];

/**
 * Where a modpack publishes a distinct "Server Pack"/"Server Files" download (common for actively
 * maintained packs, e.g. All the Mods)
 */
export async function findServerPackFileId(slug: string): Promise<number | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: REAL_UA });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/minecraft/modpacks/${slug}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForSelector('#recent-files', { timeout: 10000 }).catch(() => null);

    // #recent-files is a flat run of <h4> version-group headings and <a class="file-card"> siblings
    // (not nested)
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
    releaseBrowser();
  }
}

/**
 * Extracts the real signed forgecdn.net URL from a CurseForge file-download page already loaded
 * into `page`.
 */
async function extractDownloadUrl(
  page: Awaited<ReturnType<Browser['newPage']>>,
): Promise<string | null> {
  const downloadLinkSelector = 'a[href*="/api/v1/mods/"][href*="/download"]';
  const href = await page
    .waitForSelector(downloadLinkSelector, { timeout: 15000 })
    .then(() => page.getAttribute(downloadLinkSelector, 'href'))
    .catch(() => null);
  if (!href) return null;
  const apiUrl = href.startsWith('http') ? href : `${BASE}${href}`;

  const resp = await page
    .context()
    .request.get(apiUrl, { maxRedirects: 0, headers: { 'User-Agent': REAL_UA } });
  return resp.headers()['location'] ?? null;
}

/** Resolves a CurseForge file to its actual downloadable URL (a signed forgecdn.net link) */
export async function resolveDownloadUrl(
  slug: string,
  fileId: number,
  category: string = 'modpacks',
  game: string = 'minecraft',
): Promise<string> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: REAL_UA });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/${game}/${category}/${slug}/download/${fileId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const url = await extractDownloadUrl(page);
    if (!url) throw new Error("Couldn't find a download link on CurseForge's page for this file");
    return url;
  } finally {
    await page.close();
    await context.close();
    releaseBrowser();
  }
}

export interface CurseForgeDependency {
  slug: string;
  name: string;
}

/** Scrapes a project's Relations > Dependencies page for its required dependencies. */
async function findRequiredDependenciesOnPage(
  page: Awaited<ReturnType<Browser['newPage']>>,
  slug: string,
  category: string,
): Promise<CurseForgeDependency[]> {
  await page.goto(`${BASE}/minecraft/${category}/${slug}/relations/dependencies`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
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

/**
 * Finds the file id for a dependency that best matches the pack's own Minecraft version and loader.
 */
async function findBestFileIdOnPage(
  page: Awaited<ReturnType<Browser['newPage']>>,
  slug: string,
  mcVersion: string,
  loader: string,
  category: string,
): Promise<number | null> {
  await page.goto(
    `${BASE}/minecraft/${category}/${slug}/files/all?page=1&pageSize=20&showAlphaFiles=hide`,
    {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    },
  );
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

  const exact = files.find(
    (f) => f.version === mcVersion && f.loader.toLowerCase() === loader.toLowerCase(),
  );
  if (exact) return exact.fileId;
  const loaderMatch = files.find((f) => f.loader.toLowerCase() === loader.toLowerCase());
  return loaderMatch?.fileId ?? null;
}

/**
 * Resolves a mod's required-dependency tree breadth-first, picking each dependency's file for the
 * pack's Minecraft version and loader.
 */
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
      const deps = await findRequiredDependenciesOnPage(page, currentSlug, category).catch(
        () => [],
      );
      for (const dep of deps) {
        if (seen.has(dep.slug) || results.length >= MAX_DEPENDENCIES) continue;
        seen.add(dep.slug);
        const fileId = await findBestFileIdOnPage(
          page,
          dep.slug,
          mcVersion,
          loader,
          category,
        ).catch(() => null);
        if (!fileId) continue;
        results.push({ ...dep, fileId });
        queue.push(dep.slug);
      }
    }
    return results;
  } finally {
    await page.close();
    await context.close();
    releaseBrowser();
  }
}

export interface ResolvedCurseForgeMod {
  projectSlug: string;
  projectName: string;
  /** Null if the project exists but this specific file no longer does (removed/renamed). */
  downloadUrl: string | null;
}

/**
 * Resolves a single mod referenced by numeric {projectID, fileID} inside a CurseForge modpack's
 * manifest.json.
 */
export async function resolveModFileDownloadUrl(
  projectId: number,
  fileId: number,
): Promise<ResolvedCurseForgeMod | null> {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: REAL_UA });
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/projects/${projectId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    // CurseForge's SPA serves a custom 404 page (with an empty <title>) rather than a real 404
    // status for a dead redirect target.
    const projectTitle = await page.title();
    if (!projectTitle) return null;

    const projectUrl = page.url();
    const projectSlug = projectUrl.split('/').filter(Boolean).pop() ?? String(projectId);
    const projectName =
      projectTitle
        .replace(
          /\s*-\s*Minecraft\s+(Mods|Modpacks|Resource Packs|Data Packs|Bukkit Plugins).*$/i,
          '',
        )
        .trim() || projectSlug;

    await page.goto(`${projectUrl}/download/${fileId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    if (!(await page.title())) return { projectSlug, projectName, downloadUrl: null };

    const downloadUrl = await extractDownloadUrl(page);
    return { projectSlug, projectName, downloadUrl };
  } catch {
    return null;
  } finally {
    await page.close();
    await context.close();
    releaseBrowser();
  }
}
