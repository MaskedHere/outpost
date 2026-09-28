import { useEffect, useState } from 'react';
import { backupsApi, type Backup } from '../../lib/api';

function formatSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function BackupsTab({ serverId }: { serverId: string }) {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: 'restore' | 'delete' } | null>(
    null,
  );

  const load = () =>
    backupsApi
      .list(serverId)
      .then(setBackups)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, [serverId]);

  const createBackup = async () => {
    setCreating(true);
    setError(null);
    try {
      await backupsApi.create(serverId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backup failed');
    } finally {
      setCreating(false);
    }
  };

  const restoreBackup = async (id: string) => {
    setConfirming(null);
    await backupsApi.restore(serverId, id);
    setNotice('Restore complete.');
    setTimeout(() => setNotice(null), 4000);
  };

  const deleteBackup = async (id: string) => {
    setConfirming(null);
    await backupsApi.remove(serverId, id);
    load();
  };

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-base-50">Backups</h3>
          <p className="text-xs text-base-500">
            Snapshots the server's data folder. Briefly stops the server if it's running.
          </p>
        </div>
        <button className="btn-primary" onClick={createBackup} disabled={creating}>
          {creating ? 'Backing up…' : 'Create backup'}
        </button>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-3 text-sm text-accent-400">{notice}</p>}

      <div className="divide-y divide-base-800">
        {backups.map((b) => {
          const isConfirming = confirming?.id === b.id;
          return (
            <div key={b.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <p className="text-base-100">{b.filename}</p>
                <p className="text-xs text-base-500">
                  {formatSize(b.sizeBytes)} · {new Date(b.createdAt).toLocaleString()}
                </p>
              </div>
              {isConfirming ? (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-base-500">
                    {confirming.action === 'restore'
                      ? 'Replace current server files?'
                      : 'Delete this backup?'}
                  </span>
                  <button
                    className="text-xs font-medium text-red-400 hover:text-red-300"
                    onClick={() =>
                      confirming.action === 'restore' ? restoreBackup(b.id) : deleteBackup(b.id)
                    }
                  >
                    Confirm
                  </button>
                  <button
                    className="text-xs text-base-500 hover:text-base-200"
                    onClick={() => setConfirming(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <a
                    className="text-xs text-base-500 hover:text-accent-400"
                    href={backupsApi.downloadUrl(serverId, b.id)}
                  >
                    Download
                  </a>
                  <button
                    className="text-xs text-base-500 hover:text-accent-400"
                    onClick={() => setConfirming({ id: b.id, action: 'restore' })}
                  >
                    Restore
                  </button>
                  <button
                    className="text-xs text-red-400/80 hover:text-red-400"
                    onClick={() => setConfirming({ id: b.id, action: 'delete' })}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {backups.length === 0 && (
          <p className="py-6 text-center text-sm text-base-500">No backups yet.</p>
        )}
      </div>
    </div>
  );
}
