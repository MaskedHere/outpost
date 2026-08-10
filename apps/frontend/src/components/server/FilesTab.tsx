import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { filesApi, type FileEntry } from '../../lib/api';

function joinPath(base: string, name: string) {
  return base ? `${base}/${name}` : name;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function FilesTab({ serverId }: { serverId: string }) {
  const [currentPath, setCurrentPath] = useState('');
  const [items, setItems] = useState<FileEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = (dirPath: string) => {
    filesApi
      .list(serverId, dirPath)
      .then((res) => {
        setItems(res.items.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name)));
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => load(currentPath), [serverId, currentPath]);

  const openFile = async (name: string) => {
    const path = joinPath(currentPath, name);
    try {
      const res = await filesApi.readContent(serverId, path);
      setEditing({ path, content: res.content });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open file');
    }
  };

  const saveFile = async () => {
    if (!editing) return;
    await filesApi.writeContent(serverId, editing.path, editing.content);
    setEditing(null);
  };

  const deleteEntry = async (name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await filesApi.remove(serverId, joinPath(currentPath, name));
    load(currentPath);
  };

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    await fetch(filesApi.uploadUrl(serverId, currentPath), { method: 'POST', body: formData, credentials: 'include' });
    if (fileInputRef.current) fileInputRef.current.value = '';
    load(currentPath);
  };

  const crumbs = currentPath ? currentPath.split('/') : [];

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1 text-sm text-base-200">
          <button className="hover:text-accent-400" onClick={() => setCurrentPath('')}>
            /data
          </button>
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-base-600">/</span>
              <button className="hover:text-accent-400" onClick={() => setCurrentPath(crumbs.slice(0, i + 1).join('/'))}>
                {crumb}
              </button>
            </span>
          ))}
        </div>
        <div>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}>
            Upload
          </button>
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="divide-y divide-base-800">
        {items.map((item) => (
          <div key={item.name} className="flex items-center justify-between py-2 text-sm">
            <button
              className="flex-1 text-left text-base-100 hover:text-accent-400"
              onClick={() => (item.isDir ? setCurrentPath(joinPath(currentPath, item.name)) : openFile(item.name))}
            >
              {item.isDir ? '📁' : '📄'} {item.name}
            </button>
            <span className="w-20 text-right text-xs text-base-500">{item.isDir ? '' : formatSize(item.size)}</span>
            <div className="ml-4 flex gap-2">
              {!item.isDir && (
                <a
                  className="text-xs text-base-500 hover:text-accent-400"
                  href={filesApi.downloadUrl(serverId, joinPath(currentPath, item.name))}
                >
                  Download
                </a>
              )}
              <button className="text-xs text-red-400/80 hover:text-red-400" onClick={() => deleteEntry(item.name)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="py-6 text-center text-sm text-base-500">This folder is empty.</p>}
      </div>

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
    </div>
  );
}
