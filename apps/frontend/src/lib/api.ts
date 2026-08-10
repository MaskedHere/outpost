async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

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
    apiFetch<{ username: string }>('/api/auth/setup', { method: 'POST', body: json({ username, password }) }),
  login: (username: string, password: string) =>
    apiFetch<{ username: string }>('/api/auth/login', { method: 'POST', body: json({ username, password }) }),
  logout: () => apiFetch<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
};

// ---- games / servers ----

export interface GameDef {
  id: string;
  displayName: string;
  loaders: string[];
  defaultGamePort: number;
}

export interface ServerStatus {
  state: 'running' | 'exited' | 'created' | 'restarting' | 'paused' | 'dead' | 'unknown';
  cpuPercent: number;
  memoryUsedMb: number;
  memoryLimitMb: number;
}

export interface GameServer {
  id: string;
  name: string;
  game: string;
  loader: string;
  mcVersion: string;
  containerId: string | null;
  gamePort: number;
  memoryMb: number;
  dataPath: string;
  packId: string | null;
  createdAt: string;
  status: ServerStatus | null;
}

export const gamesApi = {
  list: () => apiFetch<GameDef[]>('/api/games'),
};

export const serversApi = {
  list: () => apiFetch<GameServer[]>('/api/servers'),
  get: (id: string) => apiFetch<GameServer>(`/api/servers/${id}`),
  create: (input: { name: string; loader: string; mcVersion: string; memoryMb: number; packId?: string }) =>
    apiFetch<GameServer>('/api/servers', { method: 'POST', body: json(input) }),
  start: (id: string) => apiFetch<{ ok: true }>(`/api/servers/${id}/start`, { method: 'POST' }),
  stop: (id: string) => apiFetch<{ ok: true }>(`/api/servers/${id}/stop`, { method: 'POST' }),
  restart: (id: string) => apiFetch<{ ok: true }>(`/api/servers/${id}/restart`, { method: 'POST' }),
  remove: (id: string, deleteData: boolean) =>
    apiFetch<{ ok: true }>(`/api/servers/${id}?deleteData=${deleteData}`, { method: 'DELETE' }),
};

// ---- files ----

export interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtime: string | null;
}

export const filesApi = {
  list: (serverId: string, dirPath: string) =>
    apiFetch<{ path: string; items: FileEntry[] }>(
      `/api/servers/${serverId}/files?path=${encodeURIComponent(dirPath)}`,
    ),
  readContent: (serverId: string, filePath: string) =>
    apiFetch<{ path: string; content: string }>(
      `/api/servers/${serverId}/files/content?path=${encodeURIComponent(filePath)}`,
    ),
  writeContent: (serverId: string, filePath: string, content: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/files/content?path=${encodeURIComponent(filePath)}`, {
      method: 'PUT',
      body: json({ content }),
    }),
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
  create: (serverId: string) => apiFetch<Backup>(`/api/servers/${serverId}/backups`, { method: 'POST' }),
  restore: (serverId: string, backupId: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/backups/${backupId}/restore`, { method: 'POST' }),
  remove: (serverId: string, backupId: string) =>
    apiFetch<{ ok: true }>(`/api/servers/${serverId}/backups/${backupId}`, { method: 'DELETE' }),
  downloadUrl: (serverId: string, backupId: string) =>
    `/api/servers/${serverId}/backups/${backupId}/download`,
};

// ---- modrinth / packs ----

export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
}

export interface PackItem {
  id: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  versionId: string;
  versionNumber: string;
  filename: string;
  isDependency: boolean;
}

export interface Pack {
  id: string;
  name: string;
  mcVersion: string;
  loader: string;
  createdAt: string;
  items: PackItem[];
  _count?: { items: number };
}

export const modrinthApi = {
  search: (q: string, mcVersion: string, loader: string, offset = 0) =>
    apiFetch<{ hits: ModrinthSearchHit[]; total_hits: number }>(
      `/api/modrinth/search?q=${encodeURIComponent(q)}&mcVersion=${encodeURIComponent(mcVersion)}&loader=${encodeURIComponent(loader)}&offset=${offset}`,
    ),
};

export const packsApi = {
  list: () => apiFetch<Pack[]>('/api/packs'),
  get: (id: string) => apiFetch<Pack>(`/api/packs/${id}`),
  create: (input: { name: string; mcVersion: string; loader: string }) =>
    apiFetch<Pack>('/api/packs', { method: 'POST', body: json(input) }),
  remove: (id: string) => apiFetch<{ ok: true }>(`/api/packs/${id}`, { method: 'DELETE' }),
  addItem: (packId: string, projectId: string, versionId?: string) =>
    apiFetch<Pack>(`/api/packs/${packId}/items`, { method: 'POST', body: json({ projectId, versionId }) }),
  removeItem: (packId: string, itemId: string) =>
    apiFetch<{ ok: true }>(`/api/packs/${packId}/items/${itemId}`, { method: 'DELETE' }),
  deploy: (packId: string, name: string, memoryMb: number) =>
    apiFetch<GameServer>(`/api/packs/${packId}/deploy`, { method: 'POST', body: json({ name, memoryMb }) }),
  exportUrl: (packId: string) => `/api/packs/${packId}/export`,
};
