import { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
  FiFolder,
  FiFile,
  FiFileText,
  FiArchive,
  FiImage,
  FiSettings,
  FiTerminal,
  FiDownload,
  FiTrash2,
  FiUploadCloud,
  FiChevronRight,
  FiSearch,
  FiX,
  FiEdit2,
  FiCornerLeftUp,
  FiRefreshCw,
} from 'react-icons/fi';
import { filesApi, type FileEntry, type FileSearchResult } from '../../lib/api';
import DropZone from '../DropZone';

function joinPath(base: string, name: string) {
  return base ? `${base}/${name}` : name;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** One directory up from a relative path. */
function parentPath(current: string): string {
  const cut = current.lastIndexOf('/');
  return cut === -1 ? '' : current.slice(0, cut);
}

/**
 * Compact "modified" column, in the spirit of a file manager's: a time for today, a date for
 * anything older.
 */
function formatMtime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

const EXT_ICONS: Record<string, { icon: typeof FiFile; className: string }> = {
  jar: { icon: FiArchive, className: 'text-amber-400' },
  zip: { icon: FiArchive, className: 'text-amber-400' },
  json: { icon: FiSettings, className: 'text-accent-400' },
  toml: { icon: FiSettings, className: 'text-accent-400' },
  properties: { icon: FiSettings, className: 'text-accent-400' },
  yml: { icon: FiSettings, className: 'text-accent-400' },
  yaml: { icon: FiSettings, className: 'text-accent-400' },
  cfg: { icon: FiSettings, className: 'text-accent-400' },
  conf: { icon: FiSettings, className: 'text-accent-400' },
  txt: { icon: FiFileText, className: 'text-base-400' },
  log: { icon: FiTerminal, className: 'text-base-400' },
  png: { icon: FiImage, className: 'text-pink-400' },
  jpg: { icon: FiImage, className: 'text-pink-400' },
  jpeg: { icon: FiImage, className: 'text-pink-400' },
  webp: { icon: FiImage, className: 'text-pink-400' },
};

function iconFor(name: string, isDir: boolean) {
  if (isDir) return { icon: FiFolder, className: 'text-accent-400' };
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_ICONS[ext] ?? { icon: FiFile, className: 'text-base-500' };
}

export default function FilesTab({ serverId }: { serverId: string }) {
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingPath, setEditingPath] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FileSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);

  const load = (dirPath: string) => {
    filesApi
      .list(serverId, dirPath)
      .then((res) => {
        setItems(
          res.items.sort(
            (a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name),
          ),
        );
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => load(currentPath), [serverId, currentPath]);

  // A running server rewrites this directory constantly.
  useEffect(() => {
    // Search runs on its own debounce against a different endpoint, and re-listing underneath it
    // would fight the results the user is looking at.
    if (query.trim()) return;
    const id = setInterval(() => {
      // A background tab has nobody watching it; skip the work until it's visible again.
      if (!document.hidden) load(currentPath);
    }, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, currentPath, query]);

  /** Explicit refresh, so there's a way to force one without waiting out the interval. */
  const refreshNow = () => {
    setRefreshing(true);
    load(currentPath);
    if (query.trim()) runSearch(query.trim());
    // Purely a visual acknowledgement.
    setTimeout(() => setRefreshing(false), 400);
  };

  // Debounced live search, scoped to the current folder and everything under it.
  const runSearch = (q: string) => {
    setSearching(true);
    filesApi
      .search(serverId, q, currentPath)
      .then((res) => {
        setSearchResults(res.items);
        setSearchTruncated(res.truncated);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Search failed'))
      .finally(() => setSearching(false));
  };

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const handle = setTimeout(() => runSearch(q), 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, query, currentPath]);

  const openFileAtPath = async (fullPath: string) => {
    try {
      const res = await filesApi.readContent(serverId, fullPath);
      setEditing({ path: fullPath, content: res.content });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open file');
    }
  };

  const saveFile = async () => {
    if (!editing) return;
    await filesApi.writeContent(serverId, editing.path, editing.content);
    setEditing(null);
  };

  const deleteEntry = async (fullPath: string) => {
    setConfirmingDelete(null);
    await filesApi.remove(serverId, fullPath);
    load(currentPath);
    if (query.trim()) runSearch(query.trim());
  };

  const uploadFiles = async (files: File[]) => {
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(filesApi.uploadUrl(serverId, currentPath), {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`Failed to upload ${file.name}`);
      }
      load(currentPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) uploadFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const goTo = (p: string) => {
    setCurrentPath(p);
    setQuery('');
  };

  const startEditingPath = () => {
    setPathDraft(currentPath);
    setEditingPath(true);
    setTimeout(() => pathInputRef.current?.select(), 0);
  };

  const submitPathDraft = () => {
    goTo(pathDraft.trim().replace(/^\/+/, '').replace(/\/+$/, ''));
    setEditingPath(false);
  };

  const crumbs = currentPath ? currentPath.split('/') : [];
  const showingSearch = query.trim().length > 0;

  return (
    <DropZone
      onDrop={uploadFiles}
      className="card overflow-hidden p-5"
      hint={`They'll be uploaded into /data${currentPath ? `/${currentPath}` : ''}`}
    >
      {/* Inset toolbar holding the address bar, search and upload. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-base-800 bg-base-950/60 px-2.5 py-2">
        {editingPath ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              submitPathDraft();
            }}
          >
            <span className="shrink-0 text-sm text-base-500">/data/</span>
            <input
              ref={pathInputRef}
              className="input !py-1 flex-1 !text-sm"
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditingPath(false);
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitPathDraft();
                }
              }}
              onBlur={() => setEditingPath(false)}
              placeholder="config/some-folder"
            />
          </form>
        ) : (
          <button
            // Styled as a permanent address-bar field rather than bare text that only reveals its
            // affordance on hover.
            className="group/path flex min-w-0 flex-1 items-center gap-1 rounded-lg border border-base-800 bg-base-900 px-2 py-1 text-left text-sm text-base-200 transition-colors hover:border-base-700 hover:bg-base-800"
            onClick={startEditingPath}
            title="Click to type a path"
          >
            <span className="shrink-0 rounded px-1 font-medium text-base-100">/data</span>
            {crumbs.map((crumb, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1">
                <FiChevronRight className="h-3.5 w-3.5 shrink-0 text-base-600" />
                <span
                  role="link"
                  className="truncate rounded px-1 hover:bg-base-700 hover:text-accent-400"
                  onClick={(e) => {
                    e.stopPropagation();
                    goTo(crumbs.slice(0, i + 1).join('/'));
                  }}
                >
                  {crumb}
                </span>
              </span>
            ))}
            {/* Always shown (just dimmed until hover) */}
            <FiEdit2 className="ml-auto h-3 w-3 shrink-0 text-base-600 transition-colors group-hover/path:text-base-300" />
          </button>
        )}

        <div className="relative w-48 shrink-0">
          <FiSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-base-500" />
          <input
            className="input !py-1.5 w-full !pl-8 !pr-7 !text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search files…"
          />
          {query && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2 text-base-500 hover:text-base-200"
              onClick={() => setQuery('')}
            >
              <FiX className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          className="btn-secondary inline-flex shrink-0 items-center gap-1.5"
          onClick={refreshNow}
          disabled={refreshing}
          title="Re-read this folder now"
        >
          <FiRefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
        <button
          className="btn-secondary inline-flex shrink-0 items-center gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <FiUploadCloud className="h-4 w-4" />
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {showingSearch ? (
        <div className="overflow-hidden rounded-xl border border-base-800">
          <div className="border-b border-base-800 bg-base-800/40 px-3 py-1.5 text-xs text-base-500">
            {searching
              ? 'Searching…'
              : `${searchResults?.length ?? 0} result${searchResults?.length === 1 ? '' : 's'} in /data${currentPath ? `/${currentPath}` : ''} and below${
                  searchTruncated ? ' (more than shown — narrow your search)' : ''
                }`}
          </div>
          {searchResults?.map((item, i) => {
            const { icon: Icon, className: iconClassName } = iconFor(item.name, item.isDir);
            const fullPath = joinPath(currentPath, item.path);
            return (
              <div
                key={item.path}
                className={`group flex items-center justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-base-800/60 ${
                  i !== searchResults.length - 1 ? 'border-b border-base-800' : ''
                }`}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-base-100"
                  onClick={() => (item.isDir ? goTo(fullPath) : openFileAtPath(fullPath))}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} />
                  <span className="min-w-0">
                    <span className="block truncate">{item.name}</span>
                    <span className="block truncate font-mono text-[11px] text-base-500">
                      /data/{fullPath}
                    </span>
                  </span>
                </button>
                <span className="w-16 shrink-0 text-right text-xs text-base-500">
                  {item.isDir ? '' : formatSize(item.size)}
                </span>
                <button
                  className="ml-2 shrink-0 rounded-md p-1.5 text-base-500 opacity-0 transition-opacity hover:bg-base-700 hover:text-red-400 group-hover:opacity-100"
                  onClick={() => deleteEntry(fullPath)}
                  title="Delete"
                >
                  <FiTrash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {!searching && searchResults?.length === 0 && (
            <p className="py-6 text-center text-sm text-base-500">
              No files match "{query.trim()}" here.
            </p>
          )}
        </div>
      ) : (
        // Inset well + a real header row: this is what makes the listing read as a file manager
        // rather than a bare list of links sitting on the panel.
        <div className="overflow-hidden rounded-xl border border-base-800 bg-base-950/60">
          <div className="flex items-center gap-3 border-b border-base-800 bg-base-800/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-base-500">
            <span className="min-w-0 flex-1">Name</span>
            <span className="w-20 shrink-0 text-right">Size</span>
            <span className="w-28 shrink-0 text-right">Modified</span>
            <span className="w-14 shrink-0" />
          </div>

          {/* The ".." row every file manager has. */}
          {currentPath && (
            <button
              className="flex w-full items-center gap-2.5 border-b border-base-800 px-3 py-2 text-left text-sm text-base-300 transition-colors hover:bg-base-800/60"
              onClick={() => goTo(parentPath(currentPath))}
            >
              <FiCornerLeftUp className="h-4 w-4 shrink-0 text-base-500" />
              <span className="font-mono">..</span>
            </button>
          )}

          {items.map((item, i) => {
            const { icon: Icon, className: iconClassName } = iconFor(item.name, item.isDir);
            const fullPath = joinPath(currentPath, item.name);
            return (
              <div
                key={item.name}
                className={`group flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-base-800/60 ${
                  i !== items.length - 1 ? 'border-b border-base-800' : ''
                }`}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-base-100"
                  onDoubleClick={() => (item.isDir ? goTo(fullPath) : openFileAtPath(fullPath))}
                  onClick={() => (item.isDir ? goTo(fullPath) : openFileAtPath(fullPath))}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${iconClassName}`} />
                  <span className="truncate">{item.name}</span>
                </button>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-base-500">
                  {item.isDir ? '—' : formatSize(item.size)}
                </span>
                <span className="w-28 shrink-0 text-right text-xs tabular-nums text-base-500">
                  {formatMtime(item.mtime)}
                </span>
                <div className="flex w-14 shrink-0 items-center justify-end gap-1">
                  {confirmingDelete === item.name ? (
                    <>
                      <span className="text-xs text-base-500">Delete?</span>
                      <button
                        className="text-xs font-medium text-red-400 hover:text-red-300"
                        onClick={() => deleteEntry(fullPath)}
                      >
                        Confirm
                      </button>
                      <button
                        className="text-xs text-base-500 hover:text-base-200"
                        onClick={() => setConfirmingDelete(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {!item.isDir && (
                        <a
                          className="rounded-md p-1.5 text-base-500 opacity-0 transition-opacity hover:bg-base-700 hover:text-accent-400 group-hover:opacity-100"
                          href={filesApi.downloadUrl(serverId, fullPath)}
                          title="Download"
                        >
                          <FiDownload className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        className="rounded-md p-1.5 text-base-500 opacity-0 transition-opacity hover:bg-base-700 hover:text-red-400 group-hover:opacity-100"
                        onClick={() => setConfirmingDelete(item.name)}
                        title="Delete"
                      >
                        <FiTrash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="py-6 text-center text-sm text-base-500">This folder is empty.</p>
          )}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8">
          <div className="card flex h-full w-full max-w-3xl flex-col p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-sm text-base-200">{editing.path}</span>
              <div className="flex gap-2">
                <button className="btn-secondary" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={saveFile}>
                  Save
                </button>
              </div>
            </div>
            <textarea
              className="input flex-1 resize-none font-mono text-xs"
              value={editing.content}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </DropZone>
  );
}
