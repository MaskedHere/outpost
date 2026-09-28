import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FaArrowLeft } from 'react-icons/fa';
import { gamesApi, serversApi, type GameDef, type GameServer } from '../lib/api';
import { currentMapLabel } from '../lib/currentMapLabel';
import StatusBadge from '../components/StatusBadge';
import PlayerCount from '../components/PlayerCount';
import ConsoleTab from '../components/server/ConsoleTab';
import FilesTab from '../components/server/FilesTab';
import BackupsTab from '../components/server/BackupsTab';
import PlayersPanel from '../components/server/PlayersPanel';
import ModpackPanel from '../components/server/ModpackPanel';
import PalworldModsPanel from '../components/server/PalworldModsPanel';
import FactorioModsPanel from '../components/server/FactorioModsPanel';
import PluginsPanel from '../components/server/PluginsPanel';
import Tf2PluginsPanel from '../components/server/Tf2PluginsPanel';
import SettingsTab from '../components/server/SettingsTab';
import StatusPanel from '../components/server/StatusPanel';
import InstallProgressBar from '../components/InstallProgressBar';
import BootProgress from '../components/BootProgress';
import Skeleton from '../components/Skeleton';
import { pageVariants } from '../lib/motion';

const TABS = [
  'status',
  'console',
  'files',
  'backups',
  'players',
  'modpack',
  'mods',
  'plugins',
  'settings',
] as const;
type Tab = (typeof TABS)[number];

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const [server, setServer] = useState<GameServer | null>(null);
  const [games, setGames] = useState<GameDef[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('console');
  const [busy, setBusy] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [bannerFailed, setBannerFailed] = useState(false);
  const [recoveredMods, setRecoveredMods] = useState<string[]>([]);

  // Returns its promise so callers can wait for the refreshed state before clearing a pending
  // action.
  const load = () => {
    if (!id) return Promise.resolve();
    return serversApi
      .get(id)
      .then((s) => {
        setServer(s);
        setLoadError(null);
        // autoRecoveredMods is only ever set on the one poll where recovery just happened.
        if (s.autoRecoveredMods && s.autoRecoveredMods.length > 0) {
          setRecoveredMods((prev) => [...new Set([...prev, ...s.autoRecoveredMods!])]);
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load server'));
  };

  useEffect(() => {
    load();
    gamesApi.list().then(setGames);
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    setBannerFailed(false);
  }, [server?.mapBannerUrl]);

  if (!id || (!server && loadError)) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <div className="card flex items-start gap-3 border-red-500/30 bg-red-500/5 px-5 py-4">
          <span className="text-red-400">⚠</span>
          <div>
            <p className="text-sm text-red-300">{loadError ?? 'Server not found'}</p>
            <button
              className="mt-2 text-xs font-medium text-red-300 underline underline-offset-2"
              onClick={load}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <Skeleton className="mb-4 h-4 w-32" />
        <div className="relative mb-6 overflow-hidden rounded-t-2xl border border-base-800 bg-base-900 p-6 pt-20">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <div className="mb-6 flex gap-4 border-b border-base-800 pb-3">
          {TABS.map((t) => (
            <Skeleton key={t} className="h-4 w-14" />
          ))}
        </div>
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  const runAction = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(action);
    try {
      await serversApi[action](id);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const running = server.status?.state === 'running';
  // Distinct from `running`: the container can be up (Docker's view) well before the game itself
  // has finished loading and RCON is answerable.
  const gameReady = server.readiness === 'running';
  const gameDef = games.find((g) => g.id === server.game);
  const bannerUrl = (!bannerFailed && server.mapBannerUrl) || gameDef?.bannerUrl || null;
  const visibleTabs = TABS.filter((t) => {
    if (t === 'modpack') return Boolean(server.packId);
    if (t === 'plugins')
      return (server.game === 'minecraft' && server.variant === 'paper') || server.game === 'tf2';
    if (t === 'players') return Boolean(gameDef?.playerManagement);
    // Palworld and Factorio install mods directly into server files rather than through a pack, so
    // they share this tab with game-specific panels.
    if (t === 'mods') return server.game === 'palworld' || server.game === 'factorio';
    return true;
  });

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      className="mx-auto max-w-5xl px-8 py-10"
    >
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-base-500 hover:text-accent-400"
      >
        <FaArrowLeft className="h-3.5 w-3.5" />
        Back to servers
      </Link>

      <div className="relative mb-6 overflow-hidden rounded-t-2xl border border-base-800 bg-gradient-to-br from-base-800 to-base-900">
        <AnimatePresence>
          {bannerUrl && (
            <motion.img
              key={bannerUrl}
              src={bannerUrl}
              alt=""
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
              className="absolute inset-0 h-full w-full object-cover"
              onError={() => setBannerFailed(true)}
            />
          )}
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-t from-base-950 via-base-950/85 to-base-950/30" />

        <div className="relative flex flex-wrap items-end justify-between gap-4 p-6 pt-20">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-base-50">{server.name}</h1>
              {/* `busy` is set on click, so the badge switches to "Stopping…" immediately instead
                 of waiting for the next poll. */}
              <StatusBadge readiness={server.readiness} pending={busy} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-base-300">
              <span>
                {[
                  gameDef?.displayName ?? server.game,
                  server.version || null,
                  currentMapLabel(server, gameDef) ??
                    (server.variant !== 'default' ? server.variant : null),
                  `port ${server.gamePort}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {server.players && (
                <>
                  <span>·</span>
                  <PlayerCount players={server.players} />
                </>
              )}
            </p>
            {server.readiness === 'installing' && (
              <div className="mt-2 max-w-sm">
                <InstallProgressBar
                  installPhase={server.installPhase}
                  bytes={server.installBytes}
                  totalBytes={server.installTotalBytes}
                />
              </div>
            )}
            {server.readiness === 'booting' && (
              <div className="mt-2 max-w-sm">
                <BootProgress startedAt={server.status?.startedAt ?? null} />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            {running ? (
              <>
                <button
                  className="btn-secondary transition-transform active:scale-95"
                  onClick={() => runAction('restart')}
                  disabled={busy !== null}
                >
                  {busy === 'restart' ? (
                    <span className="animate-pulse">Restarting…</span>
                  ) : (
                    'Restart'
                  )}
                </button>
                <button
                  className="btn-danger transition-transform active:scale-95"
                  onClick={() => runAction('stop')}
                  disabled={busy !== null}
                >
                  {busy === 'stop' ? <span className="animate-pulse">Stopping…</span> : 'Stop'}
                </button>
              </>
            ) : (
              <button
                className="btn-primary transition-transform active:scale-95"
                onClick={() => runAction('start')}
                disabled={busy !== null}
              >
                {busy === 'start' ? <span className="animate-pulse">Starting…</span> : 'Start'}
              </button>
            )}
          </div>
        </div>
      </div>

      {recoveredMods.length > 0 && (
        <div className="card mb-6 border-ember-500/30 bg-ember-500/5 p-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ember-400">
              Auto-removed {recoveredMods.length} mod{recoveredMods.length === 1 ? '' : 's'} that
              crashed the server on boot
            </p>
            <button
              className="text-xs text-base-500 hover:text-base-200"
              onClick={() => setRecoveredMods([])}
            >
              Dismiss
            </button>
          </div>
          <p className="mb-2 text-xs text-base-500">
            Forge's own crash report named these as the cause — most likely client-only mods that
            don't run on a dedicated server. Outpost moved them aside and restarted automatically.
            Check the Modpack tab if you want to review or re-add them.
          </p>
          <ul className="space-y-1 text-xs text-base-500">
            {recoveredMods.map((f) => (
              <li key={f} className="text-base-200">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-6 flex gap-1 border-b border-base-800">
        {visibleTabs.map((t) => (
          <button
            key={t}
            className={`relative px-4 py-2.5 text-sm font-medium capitalize transition-colors ${
              tab === t ? 'text-base-50' : 'text-base-500 hover:text-base-200'
            }`}
            onClick={() => setTab(t)}
          >
            {t}
            {tab === t && (
              <motion.div
                layoutId="server-tab-underline"
                className="absolute inset-x-0 -bottom-px h-0.5 bg-accent-500"
              />
            )}
          </button>
        ))}
      </div>

      {/* Each tab gets its own keyed motion.div, each conditionally rendered by itself. */}
      <AnimatePresence>
        {tab === 'status' && (
          <motion.div
            key="status"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <StatusPanel server={server} />
          </motion.div>
        )}
        {tab === 'console' && (
          <motion.div
            key="console"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <ConsoleTab serverId={id} />
          </motion.div>
        )}
        {tab === 'files' && (
          <motion.div
            key="files"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <FilesTab serverId={id} />
          </motion.div>
        )}
        {tab === 'backups' && (
          <motion.div
            key="backups"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <BackupsTab serverId={id} />
          </motion.div>
        )}
        {tab === 'players' && (
          <motion.div
            key="players"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <PlayersPanel serverId={id} gameDef={gameDef} running={gameReady} />
          </motion.div>
        )}
        {tab === 'modpack' && server.packId && (
          <motion.div
            key="modpack"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <ModpackPanel packId={server.packId} />
          </motion.div>
        )}
        {tab === 'mods' && (
          <motion.div
            key="mods"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {server.game === 'factorio' ? (
              <FactorioModsPanel serverId={server.id} />
            ) : (
              <PalworldModsPanel serverId={server.id} />
            )}
          </motion.div>
        )}
        {tab === 'plugins' && (
          <motion.div
            key="plugins"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {server.game === 'minecraft' && <PluginsPanel serverId={id} />}
            {server.game === 'tf2' && <Tf2PluginsPanel />}
          </motion.div>
        )}
        {tab === 'settings' && (
          <motion.div
            key="settings"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <SettingsTab server={server} gameDef={gameDef} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
