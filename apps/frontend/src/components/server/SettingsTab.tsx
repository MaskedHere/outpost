import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { serversApi, type GameServer } from '../../lib/api';

export default function SettingsTab({ server }: { server: GameServer }) {
  const navigate = useNavigate();
  const [deleteData, setDeleteData] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${server.name}"? This removes the container${deleteData ? ' and all its data' : ''}.`)) {
      return;
    }
    setRemoving(true);
    try {
      await serversApi.remove(server.id, deleteData);
      navigate('/');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h3 className="mb-3 font-medium text-base-50">Server info</h3>
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-base-500">Game</dt>
          <dd className="text-base-100">Minecraft ({server.loader})</dd>
          <dt className="text-base-500">Version</dt>
          <dd className="text-base-100">{server.mcVersion}</dd>
          <dt className="text-base-500">Port</dt>
          <dd className="text-base-100">{server.gamePort}</dd>
          <dt className="text-base-500">Memory limit</dt>
          <dd className="text-base-100">{server.memoryMb} MB</dd>
          <dt className="text-base-500">Data path</dt>
          <dd className="break-all font-mono text-xs text-base-100">{server.dataPath}</dd>
        </dl>
      </div>

      <div className="card border-red-500/20 p-5">
        <h3 className="mb-1 font-medium text-red-400">Danger zone</h3>
        <p className="mb-4 text-sm text-base-500">Removes the Docker container. Optionally deletes world/config data too.</p>
        <label className="mb-4 flex items-center gap-2 text-sm text-base-200">
          <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
          Also delete server data from disk
        </label>
        <button className="btn-danger" onClick={handleDelete} disabled={removing}>
          {removing ? 'Deleting…' : 'Delete server'}
        </button>
      </div>
    </div>
  );
}
