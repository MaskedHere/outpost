import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { serversApi, type GameServer } from '../lib/api';
import StatusBadge from '../components/StatusBadge';
import ConsoleTab from '../components/server/ConsoleTab';
import FilesTab from '../components/server/FilesTab';
import BackupsTab from '../components/server/BackupsTab';
import SettingsTab from '../components/server/SettingsTab';

const TABS = ['console', 'files', 'backups', 'settings'] as const;
type Tab = (typeof TABS)[number];

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const [server, setServer] = useState<GameServer | null>(null);
  const [tab, setTab] = useState<Tab>('console');
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!id) return;
    serversApi.get(id).then(setServer);
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [id]);

  if (!id || !server) {
    return <div className="px-8 py-10 text-base-500">Loading…</div>;
  }

  const runAction = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    try {
      await serversApi[action](id);
      load();
    } finally {
      setBusy(false);
    }
  };

  const running = server.status?.state === 'running';

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <Link to="/" className="mb-4 inline-block text-sm text-base-500 hover:text-accent-400">
        ← Back to servers
      </Link>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-base-50">{server.name}</h1>
            <StatusBadge status={server.status} />
          </div>
          <p className="mt-1 text-sm text-base-500">
            Minecraft {server.mcVersion} · {server.loader} · port {server.gamePort}
          </p>
        </div>
        <div className="flex gap-2">
          {running ? (
            <>
              <button className="btn-secondary" onClick={() => runAction('restart')} disabled={busy}>
                Restart
              </button>
              <button className="btn-danger" onClick={() => runAction('stop')} disabled={busy}>
                Stop
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => runAction('start')} disabled={busy}>
              Start
            </button>
          )}
        </div>
      </div>

      <div className="mb-6 flex gap-1 border-b border-base-800">
        {TABS.map((t) => (
          <button
            key={t}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
              tab === t ? 'border-accent-500 text-base-50' : 'border-transparent text-base-500 hover:text-base-200'
            }`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'console' && <ConsoleTab serverId={id} />}
      {tab === 'files' && <FilesTab serverId={id} />}
      {tab === 'backups' && <BackupsTab serverId={id} />}
      {tab === 'settings' && <SettingsTab server={server} />}
    </div>
  );
}
