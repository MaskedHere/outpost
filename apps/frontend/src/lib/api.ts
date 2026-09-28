async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      credentials: 'include',
      // Everything here reports live state.
      cache: 'no-store',
      headers: {
        ...(options.body && !(options.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers,
      },
    });
  } catch {
    // fetch() itself throws (not an HTTP error) when the backend process isn't reachable at all.
    throw new Error("Can't reach the Outpost server. Make sure it's running, then reload.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const json = (data: unknown) => JSON.stringify(data);

// ---- auth ----

export interface AuthStatus {
  needsSetup: boolean;
  authenticated: boolean;
  username: string | null;
}

export const authApi = {
  status: () => apiFetch<AuthStatus>('/api/auth/status'),
  setup: (username: string, password: string) =>
    apiFetch<{ username: string }>('/api/auth/setup', {
      method: 'POST',
      body: json({ username, password }),
    }),
  login: (username: string, password: string) =>
    apiFetch<{ username: string }>('/api/auth/login', {
      method: 'POST',
      body: json({ username, password }),
    }),
  logout: () => apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  updateAccount: (input: { username?: string; newPassword?: string; currentPassword: string }) =>
    apiFetch<{ username: string }>('/api/auth/account', { method: 'PATCH', body: json(input) }),
};

// ---- settings ----

export interface PanelSettings {
  id: string;
  defaultPlayitKey: string | null;
  defaultMemoryMb: number;
  useGameCache: boolean;
  /** Total RAM of the Docker host in MB. */
  hostMemoryMb: number;
}

export const settingsApi = {
  get: () => apiFetch<PanelSettings>('/api/settings'),
  update: (input: {
    defaultPlayitKey?: string | null;
    defaultMemoryMb?: number;
    useGameCache?: boolean;
  }) => apiFetch<PanelSettings>('/api/settings', { method: 'PATCH', body: json(input) }),
};

// ---- game content cache ----

export interface CachedGame {
  gameId: string;
  displayName: string;
  approxSizeLabel: string;
  cached: boolean;
  sizeBytes: number | null;
  cachedAt: string | null;
  busy: boolean;
}

export const gameCacheApi = {
  list: () => apiFetch<{ games: CachedGame[] }>('/api/game-cache'),
  prewarm: (gameId: string) =>
    apiFetch<{ started: boolean }>(`/api/game-cache/${gameId}/prewarm`, { method: 'POST' }),
  remove: (gameId: string) =>
    apiFetch<{ ok: boolean }>(`/api/game-cache/${gameId}`, { method: 'DELETE' }),
};

// ---- games / servers ----

/** One server option a game exposes. */
export interface GameSettingField {
  key: string;
  label: string;
  info: string;
  type: 'toggle' | 'number' | 'select' | 'text';
  default: string;
  onValue?: string;
  offValue?: string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  group?: string;
  newWorldOnly?: boolean;
}

export interface GameDef {
  id: string;
  displayName: string;
  variants: string[];
  variantLabels: Record<string, string> | null;
  variantFieldLabel: string | null;
  versionLabel: string | null;
  versionPlaceholder: string | null;
  moddable: boolean;
  moddingKind: 'minecraft' | 'workshop-items' | null;
  /** workshop-items only: whether this game also needs each mod's own internal Mod ID (Zomboid
   *  does; tModLoader enables by Workshop ID alone). */
  workshopRequiresModIds: boolean;
  moddedVariants: string[];
  bannerUrl: string | null;
  settings: GameSettingField[];
  playerManagement: { kill: boolean; banList: boolean; op: boolean } | null;
  /**
   * Value -> display label for games with live map switching (TF2), e.g. "cp_badlands" -> "Control
   * Point — Badlands". Null otherwise.
   */
  mapOptions: Record<string, string> | null;
  gamePortProtocol: 'tcp' | 'udp';
}

export interface ServerStatus {
  state: 'running' | 'exited' | 'created' | 'restarting' | 'paused' | 'dead' | 'unknown';
  running: boolean;
  startedAt: string | null;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
  exitCode: number | null;
  oomKilled: boolean;
}

export type ServerReadiness = 'offline' | 'crashed' | 'installing' | 'booting' | 'running';

export interface PlayerSummary {
  current: number;
  max: number | null;
  /**
   * Currently-loaded map, only when the game's RCON dialect reports one (Source engine's `status`
   * does).
   */
  map: string | null;
}

export interface GameServer {
  id: string;
  name: string;
  game: string;
  variant: string;
  version: string;
  containerId: string | null;
  gamePort: number;
  rconPort: number | null;
  rconPassword: string | null;
  memoryMb: number;
  dataPath: string;
  packId: string | null;
  tunnelContainerId: string | null;
  createdAt: string;
  status: ServerStatus | null;
  readiness: ServerReadiness;
  /** Which sub-phase of 'installing' this is. */
  installPhase: 'loader' | 'mods' | null;
  players: PlayerSummary | null;
  /** Wiki art for the currently-loaded map (TF2 only, when resolvable) */
  mapBannerUrl: string | null;
  /** Live-growing bytes in /data/mods while installPhase is 'mods'. */
  installBytes: number | null;
  /**
   * Sum of the file sizes itzg will fetch live during installPhase 'mods' (pack items Outpost
   * didn't already copy onto disk itself)
   */
  installTotalBytes: number | null;
  /**
   * Filenames removed by automatic crash recovery (see crashRecoveryService.ts). Only set on the
   * poll where recovery happened.
   */
  autoRecoveredMods: string[] | null;
  /**
   * JSON-encoded Record<string, string> of itzg env-var keys (ALLOW_FLIGHT, PVP, etc.). Null/empty
   * means game defaults.
   */
  extraSettings: string | null;
}

export const gamesApi = {
  list: () => apiFetch<GameDef[]>('/api/games'),
};

export interface LiveStats {
  running: boolean;
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
}

export const serversApi = {
  list: () => apiFetch<GameServer[]>('/api/servers'),
  get: (id: string) => apiFetch<GameServer>(`/api/servers/${id}`),
  /** Cheap, RCON-free docker stats only. */
  stats: (id: string) => apiFetch<LiveStats>(`/api/servers/${id}/stats`),
  create: (input: {
    name: string;
    game: string;
    variant: string;
    version: string;
    memoryMb: number;
    packId?: string;
    workshopItemIds?: string[];
    modIds?: string[];
    motd?: string;
  }) => apiFetch<GameServer>('/api/servers', { method: 'POST', body: json(input) }),
  start: (id: string) => apiFetch<{ ok: true }>(`/api/servers/${id}/start`, { method: 'POST' }),
  stop: (id: string) => apiFetch<{ ok: true }>(`/api/servers/${id}/stop`, { method: 'POST' }),
  restart: (id: string) => apiFetch<{ ok: true }>(`/api/servers/${id}/restart`, { method: 'POST' }),
  remove: (id: string, deleteData: boolean) =>
    apiFetch<{ ok: true }>(`/api/servers/${id}?deleteData=${deleteData}`, { method: 'DELETE' }),
  updateMemory: (id: string, memoryMb: number) =>
    apiFetch<GameServer>(`/api/servers/${id}/memory`, {
      method: 'PATCH',
      body: json({ memoryMb }),
    }),
  updateSettings: (id: string, extraSettings: Record<string, string>) =>
    apiFetch<GameServer>(`/api/servers/${id}/settings`, {
      method: 'PATCH',
      body: json({ extraSettings }),
    }),
};

export interface MapControlStatus {
  supported: boolean;
  options: Record<string, string> | null;
  current: string | null;
  installingExtraMaps: boolean;
}

export const mapApi = {
  get: (serverId: string) => apiFetch<MapControlStatus>(`/api/servers/${serverId}/map`),
  set: (serverId: string, map: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/map`, { method: 'POST', body: json({ map }) }),
  installExtra: (serverId: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/map/install-extra`, { method: 'POST' }),
};

export interface TunnelStatus {
  enabled: boolean;
  running?: boolean;
  connected?: boolean;
  claimUrl?: string | null;
  recentLogs?: string;
  keyUrl: string;
  tunnelsUrl: string;
  gamePort: number;
}

export const tunnelApi = {
  get: (serverId: string) => apiFetch<TunnelStatus>(`/api/servers/${serverId}/tunnel`),
  enable: (serverId: string, secretKey: string) =>
    apiFetch<{ enabled: true }>(`/api/servers/${serverId}/tunnel`, {
      method: 'POST',
      body: json({ secretKey }),
    }),
  disable: (serverId: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/tunnel`, { method: 'DELETE' }),
};

export interface BoreStatus {
  enabled: boolean;
  supported: boolean;
  running?: boolean;
  connected?: boolean;
  failed?: boolean;
  gamePort: number;
  borePort?: number | null;
}

export const boreApi = {
  get: (serverId: string) => apiFetch<BoreStatus>(`/api/servers/${serverId}/bore`),
  enable: (serverId: string) =>
    apiFetch<{ enabled: true; borePort: number }>(`/api/servers/${serverId}/bore`, {
      method: 'POST',
    }),
  disable: (serverId: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/bore`, { method: 'DELETE' }),
};

export interface PlayerRef {
  name: string;
  id: string;
  ping?: number;
  isOp?: boolean;
}

export type PlayerAction = 'kick' | 'ban' | 'kill' | 'unban' | 'op' | 'deop';

export interface SeenPlayer extends PlayerRef {
  lastSeenAt: string;
}

export const playersApi = {
  list: (serverId: string) =>
    apiFetch<{ players: PlayerRef[] }>(`/api/servers/${serverId}/players`),
  banned: (serverId: string) =>
    apiFetch<{ players: PlayerRef[] }>(`/api/servers/${serverId}/players/banned`),
  /** Everyone RCON has ever seen connect, minus who's online or banned right now. */
  offline: (serverId: string) =>
    apiFetch<{ players: SeenPlayer[] }>(`/api/servers/${serverId}/players/offline`),
  action: (serverId: string, action: PlayerAction, player: PlayerRef) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/players/action`, {
      method: 'POST',
      body: json({ action, player }),
    }),
};

// ---- world (Minecraft-only) ----

export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
export type Gamemode = 'survival' | 'creative' | 'adventure' | 'spectator';
export type Gamerule = 'keepInventory' | 'doDaylightCycle' | 'doWeatherCycle' | 'doMobSpawning';

export interface WorldSettings {
  levelName: string;
  difficulty: Difficulty;
  gamemode: Gamemode;
  hardcore: boolean;
  whitelist: boolean;
  running: boolean;
  /** Null per-rule when the server's offline (can't query RCON) or that query failed. */
  gamerules: Record<Gamerule, boolean | null> | null;
}

export const worldApi = {
  get: (serverId: string) => apiFetch<WorldSettings>(`/api/servers/${serverId}/world`),
  update: (
    serverId: string,
    input: { difficulty?: Difficulty; gamemode?: Gamemode; whitelist?: boolean },
  ) =>
    apiFetch<WorldSettings>(`/api/servers/${serverId}/world`, {
      method: 'PATCH',
      body: json(input),
    }),
  setGamerule: (serverId: string, rule: Gamerule, value: boolean) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/world/gamerules/${rule}`, {
      method: 'PATCH',
      body: json({ value }),
    }),
  deleteWorld: (serverId: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/world`, { method: 'DELETE' }),
};

// ---- files ----

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: string | null;
}

export interface FileSearchResult {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
}

export const filesApi = {
  list: (serverId: string, dirPath: string) =>
    apiFetch<{ path: string; items: FileEntry[] }>(
      `/api/servers/${serverId}/files?path=${encodeURIComponent(dirPath)}`,
    ),
  search: (serverId: string, query: string, scopePath: string) =>
    apiFetch<{ items: FileSearchResult[]; truncated: boolean }>(
      `/api/servers/${serverId}/files/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(scopePath)}`,
    ),
  readContent: (serverId: string, filePath: string) =>
    apiFetch<{ path: string; content: string }>(
      `/api/servers/${serverId}/files/content?path=${encodeURIComponent(filePath)}`,
    ),
  writeContent: (serverId: string, filePath: string, content: string) =>
    apiFetch<{ ok: true }>(
      `/api/servers/${serverId}/files/content?path=${encodeURIComponent(filePath)}`,
      {
        method: 'PUT',
        body: json({ content }),
      },
    ),
  remove: (serverId: string, filePath: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/files?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE',
    }),
  downloadUrl: (serverId: string, filePath: string) =>
    `/api/servers/${serverId}/files/download?path=${encodeURIComponent(filePath)}`,
  uploadUrl: (serverId: string, dirPath: string) =>
    `/api/servers/${serverId}/files/upload?path=${encodeURIComponent(dirPath)}`,
};

// ---- backups ----

export interface Backup {
  id: string;
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export const backupsApi = {
  list: (serverId: string) => apiFetch<Backup[]>(`/api/servers/${serverId}/backups`),
  create: (serverId: string) =>
    apiFetch<Backup>(`/api/servers/${serverId}/backups`, { method: 'POST' }),
  restore: (serverId: string, backupId: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/backups/${backupId}/restore`, {
      method: 'POST',
    }),
  remove: (serverId: string, backupId: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/backups/${backupId}`, { method: 'DELETE' }),
  downloadUrl: (serverId: string, backupId: string) =>
    `/api/servers/${serverId}/backups/${backupId}/download`,
};

// ---- modrinth / packs ----

/** Optional narrowing for a mod search. */
export interface PalworldModType {
  value: string;
  label: string;
  /**
   * False for the UE4SS-backed types, which have no working loader on the Linux dedicated server.
   */
  installable: boolean;
  note: string;
}

// ---- steam workshop packs ----

export interface WorkshopItemHit {
  workshopItemId: string;
  title: string;
  description: string;
  previewUrl: string | null;
  subscriptions: number | null;
}

export interface WorkshopPackItem {
  id: string;
  workshopItemId: string;
  title: string;
  /**
   * Only Project Zomboid needs this; null elsewhere, and null on a Zomboid item whose author didn't
   * publish one in the usual format.
   */
  modId: string | null;
  previewUrl: string | null;
}

export interface WorkshopPack {
  id: string;
  name: string;
  game: string;
  createdAt: string;
  items: WorkshopPackItem[];
  _count?: { items: number };
}

export const workshopPacksApi = {
  games: () =>
    apiFetch<{ games: { id: string; displayName: string; requiresModIds: boolean }[] }>(
      '/api/workshop-games',
    ),
  list: () => apiFetch<WorkshopPack[]>('/api/workshop-packs'),
  create: (name: string, game: string) =>
    apiFetch<WorkshopPack>('/api/workshop-packs', { method: 'POST', body: json({ name, game }) }),
  get: (id: string) => apiFetch<WorkshopPack>(`/api/workshop-packs/${id}`),
  remove: (id: string) => apiFetch<void>(`/api/workshop-packs/${id}`, { method: 'DELETE' }),
  search: (id: string, q: string, page = 1) =>
    apiFetch<{ hits: WorkshopItemHit[] }>(
      `/api/workshop-packs/${id}/search?${new URLSearchParams({ q, page: String(page) }).toString()}`,
    ),
  addItem: (id: string, workshopItemId: string) =>
    apiFetch<WorkshopPack>(`/api/workshop-packs/${id}/items`, {
      method: 'POST',
      body: json({ workshopItemId }),
    }),
  setModId: (id: string, itemId: string, modId: string) =>
    apiFetch<WorkshopPack>(`/api/workshop-packs/${id}/items/${itemId}`, {
      method: 'PATCH',
      body: json({ modId }),
    }),
  removeItem: (id: string, itemId: string) =>
    apiFetch<WorkshopPack>(`/api/workshop-packs/${id}/items/${itemId}`, { method: 'DELETE' }),
  importCollection: (id: string, collectionId: string) =>
    apiFetch<{
      pack: WorkshopPack;
      imported: number;
      unresolved: { workshopItemId: string; title: string }[];
    }>(`/api/workshop-packs/${id}/import-collection`, {
      method: 'POST',
      body: json({ collectionId }),
    }),
};

export interface FactorioModSummary {
  name: string;
  title: string;
  owner: string;
  summary: string;
  downloadsCount: number;
  category: string;
  latestVersion: string | null;
  factorioVersion: string | null;
  downloadPageUrl: string;
  pageUrl: string;
}

export const factorioModsApi = {
  categories: () =>
    apiFetch<{ categories: { value: string; label: string }[] }>('/api/factorio/categories'),
  search: (q: string, category?: string, offset = 0) => {
    const qs = new URLSearchParams({ q, offset: String(offset) });
    if (category) qs.set('category', category);
    return apiFetch<{ hits: FactorioModSummary[]; total: number }>(
      `/api/factorio/mods?${qs.toString()}`,
    );
  },
  dependencies: (name: string) =>
    apiFetch<{ dependencies: string[] }>(
      `/api/factorio/mods/${encodeURIComponent(name)}/dependencies`,
    ),
};

export const palworldModsApi = {
  filters: () =>
    apiFetch<{ types: PalworldModType[]; tags: { value: string; label: string }[] }>(
      '/api/curseforge/palworld/categories',
    ),
  search: (q: string, type: string, category?: string, offset = 0) => {
    const qs = new URLSearchParams({ q, type, offset: String(offset) });
    if (category) qs.set('category', category);
    return apiFetch<{ hits: CurseForgeModSummary[] }>(
      `/api/curseforge/palworld/mods?${qs.toString()}`,
    );
  },
  install: (serverId: string, slug: string, fileId: number, category: string) =>
    apiFetch<{ ok: boolean; files: string[]; installDir: string }>(
      `/api/servers/${serverId}/palworld-mods`,
      {
        method: 'POST',
        body: json({ slug, fileId, category }),
      },
    ),
};

export interface UpnpStatus {
  /** False when the router never answered. */
  supported: boolean;
  /** Whether this server's port is forwarded right now, read back from the router itself. */
  mapped: boolean;
  externalIp: string | null;
  gamePort: number;
  protocol: 'tcp' | 'udp';
  /** Raw upnpc output, shown when something failed so the actual reason is visible. */
  output: string;
}

export const upnpApi = {
  get: (serverId: string) => apiFetch<UpnpStatus>(`/api/servers/${serverId}/upnp`),
  open: (serverId: string) =>
    apiFetch<{ ok: boolean; externalIp: string | null; gamePort: number; protocol: string }>(
      `/api/servers/${serverId}/upnp`,
      { method: 'POST' },
    ),
  close: (serverId: string) =>
    apiFetch<{ ok: boolean }>(`/api/servers/${serverId}/upnp`, { method: 'DELETE' }),
};

export interface ModSearchOptions {
  category?: string;
  sort?: string;
  /** Hides mods that can't run on a dedicated server at all. */
  serverOnly?: boolean;
}

export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  /** Modrinth's own curated side support. 'unsupported' means the mod can't run headless at all. */
  server_side?: 'required' | 'optional' | 'unsupported';
  /** Supported Minecraft versions, oldest first. */
  versions?: string[];
  /** Includes loader tags (fabric/forge/neoforge/quilt) alongside topic tags. */
  categories?: string[];
}

export interface PackItem {
  id: string;
  source: 'modrinth' | 'local';
  projectId: string | null;
  projectSlug: string | null;
  projectName: string;
  /** Null for jars imported from a zip that matched no project. */
  iconUrl: string | null;
  versionId: string | null;
  versionNumber: string | null;
  filename: string;
  isDependency: boolean;
}

/** Result of asking Modrinth whether this pack's project has published something newer. */
export type PackUpdateStatus =
  | { trackable: false }
  | {
      trackable: true;
      available: boolean;
      current: string | null;
      latest?: string;
      latestVersionId?: string;
    };

export interface Pack {
  id: string;
  name: string;
  mcVersion: string;
  loader: string;
  modrinthProjectId?: string | null;
  modrinthVersionNumber?: string | null;
  createdAt: string;
  items: PackItem[];
  _count?: { items: number };
  servers?: { id: string; name: string }[];
}

export const modrinthApi = {
  search: (
    q: string,
    mcVersion: string,
    loader: string,
    opts: ModSearchOptions = {},
    offset = 0,
  ) => {
    const qs = new URLSearchParams({ q, mcVersion, loader, offset: String(offset) });
    if (opts.category) qs.set('category', opts.category);
    if (opts.sort) qs.set('sort', opts.sort);
    if (opts.serverOnly) qs.set('serverOnly', 'true');
    return apiFetch<{ hits: ModrinthSearchHit[]; total_hits: number }>(
      `/api/modrinth/search?${qs.toString()}`,
    );
  },
  filters: () =>
    apiFetch<{
      categories: { value: string; label: string }[];
      sorts: { value: string; label: string }[];
    }>('/api/modrinth/filters'),
  /** mcVersion/loader are optional filters. */
  searchModpacks: (q: string, mcVersion?: string, loader?: string, offset = 0) => {
    const qs = new URLSearchParams({ q, offset: String(offset) });
    if (mcVersion) qs.set('mcVersion', mcVersion);
    if (loader) qs.set('loader', loader);
    return apiFetch<{ hits: ModrinthSearchHit[]; total_hits: number }>(
      `/api/modrinth/modpacks?${qs.toString()}`,
    );
  },
  gameVersions: () => apiFetch<string[]>('/api/modrinth/game-versions'),
  searchPlugins: (q: string, mcVersion: string, offset = 0) =>
    apiFetch<{ hits: ModrinthSearchHit[]; total_hits: number }>(
      `/api/modrinth/plugins?q=${encodeURIComponent(q)}&mcVersion=${encodeURIComponent(mcVersion)}&offset=${offset}`,
    ),
};

export interface CurseForgeModSummary {
  slug: string;
  fileId: number;
  name: string;
  summary: string;
  logoUrl: string | null;
  gameVersion: string | null;
  /** Borrowed from Modrinth by slug. */
  clientSide?: 'required' | 'optional' | 'unsupported';
  serverSide?: 'required' | 'optional' | 'unsupported';
}

export type ImportJobStatus =
  | { phase: 'resolving' }
  | { phase: 'downloading'; current: number; total: number }
  | { phase: 'matching'; current: number; total: number }
  | {
      phase: 'done';
      pack: Pack;
      format: string;
      unresolved: UnresolvedEntry[];
      clientOnly: UnresolvedEntry[];
    }
  | { phase: 'error'; error: string };

export const curseforgeApi = {
  searchModpacks: (q: string, mcVersion?: string, offset = 0) => {
    const qs = new URLSearchParams({ q, offset: String(offset) });
    if (mcVersion) qs.set('mcVersion', mcVersion);
    return apiFetch<{ hits: CurseForgeModSummary[] }>(`/api/curseforge/modpacks?${qs.toString()}`);
  },
  startImport: (slug: string, fileId: number, mcVersion: string, loader: string, name?: string) =>
    apiFetch<{ jobId: string }>('/api/curseforge/modpacks/import', {
      method: 'POST',
      body: json({ slug, fileId, mcVersion, loader, name }),
    }),
  getImportJob: (jobId: string) =>
    apiFetch<ImportJobStatus>(`/api/curseforge/import-jobs/${jobId}`),
  searchMods: (q: string, mcVersion: string, loader: string, category?: string, offset = 0) => {
    const qs = new URLSearchParams({ q, mcVersion, loader, offset: String(offset) });
    if (category) qs.set('category', category);
    return apiFetch<{ hits: CurseForgeModSummary[] }>(`/api/curseforge/mods?${qs.toString()}`);
  },
  categories: () =>
    apiFetch<{ categories: { value: string; label: string }[] }>('/api/curseforge/categories'),
  // logoUrl comes from the clicked search result: CurseForge-only mods have no Modrinth project to
  // backfill artwork from later.
  addMod: (packId: string, slug: string, fileId: number, logoUrl?: string | null) =>
    apiFetch<{ pack: Pack }>('/api/curseforge/mods/add', {
      method: 'POST',
      body: json({ packId, slug, fileId, logoUrl }),
    }),
};

export interface ServerPlugin {
  id: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  versionId: string;
  versionNumber: string;
  filename: string;
}

export const pluginsApi = {
  list: (serverId: string) =>
    apiFetch<{ plugins: ServerPlugin[]; mcVersion: string }>(`/api/servers/${serverId}/plugins`),
  add: (serverId: string, projectId: string, versionId?: string) =>
    apiFetch<ServerPlugin>(`/api/servers/${serverId}/plugins`, {
      method: 'POST',
      body: json({ projectId, versionId }),
    }),
  remove: (serverId: string, itemId: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/plugins/${itemId}`, { method: 'DELETE' }),
};

// ---- storage / orphaned server data ----

export interface OrphanDir {
  id: string;
  sizeBytes: number;
  modifiedAt: string;
  guessedGame: string | null;
  guessedGameName: string | null;
  sample: string[];
  empty: boolean;
}

export const storageApi = {
  orphans: () => apiFetch<{ orphans: OrphanDir[]; totalBytes: number }>('/api/storage/orphans'),
  restore: (
    id: string,
    input: { game: string; name: string; variant?: string; version?: string; memoryMb: number },
  ) =>
    apiFetch<GameServer>(`/api/storage/orphans/${id}/restore`, {
      method: 'POST',
      body: json(input),
    }),
  remove: (id: string) =>
    apiFetch<{ ok: true }>(`/api/storage/orphans/${id}`, { method: 'DELETE' }),
};

export const packsApi = {
  list: () => apiFetch<Pack[]>('/api/packs'),
  get: (id: string) => apiFetch<Pack>(`/api/packs/${id}`),
  create: (input: { name: string; mcVersion: string; loader: string }) =>
    apiFetch<Pack>('/api/packs', { method: 'POST', body: json(input) }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/api/packs/${id}`, { method: 'DELETE' }),
  addItem: (packId: string, projectId: string, versionId?: string) =>
    apiFetch<Pack>(`/api/packs/${packId}/items`, {
      method: 'POST',
      body: json({ projectId, versionId }),
    }),
  removeItem: (packId: string, itemId: string) =>
    apiFetch<{ ok: true }>(`/api/packs/${packId}/items/${itemId}`, { method: 'DELETE' }),
  deploy: (packId: string, name: string, memoryMb: number, motd?: string) =>
    apiFetch<GameServer>(`/api/packs/${packId}/deploy`, {
      method: 'POST',
      body: json({ name, memoryMb, motd }),
    }),
  exportUrl: (packId: string) => `/api/packs/${packId}/export`,
  checkUpdate: (packId: string) => apiFetch<PackUpdateStatus>(`/api/packs/${packId}/update`),
  applyUpdate: (packId: string) =>
    apiFetch<{
      pack: Pack;
      version: string;
      unresolved: UnresolvedEntry[];
      clientOnly: UnresolvedEntry[];
    }>(`/api/packs/${packId}/update`, { method: 'POST' }),
  import: (file: File, overrides: { name?: string; mcVersion?: string; loader?: string }) => {
    const form = new FormData();
    form.append('file', file);
    if (overrides.name) form.append('name', overrides.name);
    if (overrides.mcVersion) form.append('mcVersion', overrides.mcVersion);
    if (overrides.loader) form.append('loader', overrides.loader);
    return apiFetch<ImportResponse>('/api/packs/import', { method: 'POST', body: form });
  },
  importFromModrinth: (projectId: string, mcVersion?: string, loader?: string) =>
    apiFetch<ImportResponse>(`/api/modrinth/modpacks/${projectId}/import`, {
      method: 'POST',
      body: json({ mcVersion, loader }),
    }),
  /** Imports an uploaded pack INTO an already-existing one, instead of creating a new one. */
  importInto: (packId: string, file: File, replace: boolean) => {
    const form = new FormData();
    form.append('file', file);
    form.append('replace', String(replace));
    return apiFetch<ImportResponse>(`/api/packs/${packId}/import`, { method: 'POST', body: form });
  },
};

export interface UnresolvedEntry {
  label: string;
  reason: string;
}

export interface ImportResponse {
  pack: Pack;
  format: 'mrpack' | 'curseforge' | 'jars';
  unresolved: UnresolvedEntry[];
  clientOnly: UnresolvedEntry[];
}

export interface ResolvedCollection {
  workshopItemIds: string[];
  modIds: string[];
  unresolved: { workshopId: string; title: string }[];
  total: number;
}

export const steamWorkshopApi = {
  resolveCollection: (collectionId: string) =>
    apiFetch<ResolvedCollection>('/api/steam-workshop/resolve-collection', {
      method: 'POST',
      body: json({ collectionId }),
    }),
};
