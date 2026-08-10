import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { serversApi, type GameServer } from '../lib/api';
import StatusBadge from '../components/StatusBadge';

export default function Dashboard() {
  const [servers, setServers] = useState<GameServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => serversApi.list().then(setServers).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-base-50">Servers</h1>
          <p className="mt-1 text-sm text-base-500">Every server here is its own Docker container.</p>
        </div>
        <Link to="/servers/new" className="btn-primary">
          + New server
        </Link>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {servers === null && <p className="text-base-500">Loading…</p>}

      {servers?.length === 0 && (
        <div className="card flex flex-col items-center gap-3 px-8 py-16 text-center">
          <p className="text-base-200">No servers yet.</p>
          <p className="max-w-sm text-sm text-base-500">
            Spin up a vanilla/Paper/Fabric server in a couple clicks, or build a modpack in the Modpack Studio
            first and deploy it here.
          </p>
          <Link to="/servers/new" className="btn-primary mt-2">
            Create your first server
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {servers?.map((server) => (
          <Link
            key={server.id}
            to={`/servers/${server.id}`}
            className="card flex flex-col gap-3 p-5 transition-colors hover:border-accent-500/50"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-medium text-base-50">{server.name}</h2>
                <p className="text-xs text-base-500">
                  Minecraft {server.mcVersion} · {server.loader}
                </p>
              </div>
              <StatusBadge status={server.status} />
            </div>
            <div className="flex items-center gap-4 text-xs text-base-500">
              <span>Port {server.gamePort}</span>
              {server.status?.state === 'running' && (
                <>
                  <span>CPU {server.status.cpuPercent}%</span>
                  <span>
                    RAM {server.status.memoryUsedMb}MB / {server.memoryMb}MB
                  </span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
