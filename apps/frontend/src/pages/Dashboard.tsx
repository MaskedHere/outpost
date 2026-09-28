import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCpu, FiGrid, FiHardDrive, FiList, FiSquare, FiUsers } from 'react-icons/fi';
import { gamesApi, serversApi, type GameDef, type GameServer } from '../lib/api';
import { currentMapLabel } from '../lib/currentMapLabel';
import StatusBadge from '../components/StatusBadge';
import PlayerCount from '../components/PlayerCount';
import InstallProgressBar from '../components/InstallProgressBar';
import BootProgress from '../components/BootProgress';
import Skeleton from '../components/Skeleton';
import { pageVariants, staggerContainer, staggerItem } from '../lib/motion';

// Muted usage-severity coloring for CPU/RAM readouts.
function usageColorClass(percent: number): string {
  if (percent >= 90) return 'text-crit-400';
  if (percent >= 70) return 'text-warn-400';
  return '';
}

// Traces the real server-card's own layout (banner area, title+badge row, stats row) with pulsing
// placeholders instead of a bare "Loading…".
function SkeletonServerCard({ square }: { square: boolean }) {
  return (
    <div className={`server-card flex flex-col overflow-hidden ${square ? 'aspect-square' : ''}`}>
      <div className={`relative bg-base-800/40 ${square ? 'min-h-0 flex-1' : 'h-20 shrink-0'}`}>
        <div className="flex h-full items-start justify-between p-4">
          <div className="min-w-0 flex-1 pl-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-2 h-3 w-16" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
        </div>
      </div>
      <div className="flex items-center gap-4 px-5 py-3">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-3 w-10" />
      </div>
    </div>
  );
}

const shakeAnimation = { x: [0, -3, 3, -3, 3, -2, 2, 0] };

type LayoutMode = 'default' | 'list' | 'square';
const LAYOUT_STORAGE_KEY = 'outpost:server-layout';

const GRID_CLASS: Record<LayoutMode, string> = {
  default: 'grid grid-cols-1 gap-3 sm:grid-cols-2',
  list: 'grid grid-cols-1 gap-3',
  square: 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4',
};

export default function Dashboard() {
  const [servers, setServers] = useState<GameServer[] | null>(null);
  const [games, setGames] = useState<GameDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shakingId, setShakingId] = useState<string | null>(null);
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>(() => {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return saved === 'list' || saved === 'square' ? saved : 'default';
  });

  // The periodic poll below and an explicit post-action load() (e.g. right after a delete) can land
  // in flight at the same time and resolve out of order.
  const loadSeq = useRef(0);
  const load = () => {
    const seq = ++loadSeq.current;
    serversApi
      .list()
      .then((s) => {
        if (seq !== loadSeq.current) return;
        setServers(s);
        setError(null);
      })
      .catch((e) => {
        if (seq !== loadSeq.current) return;
        setError(e.message);
      });
  };

  useEffect(() => {
    load();
    gamesApi.list().then(setGames);
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  }, [layout]);

  const running = servers?.filter((s) => s.status?.running) ?? [];
  // Each server reports its share of the whole machine, but samples are taken at slightly different
  // moments, so clamp to avoid values like "100.4%".
  const totalCpu = Math.min(
    100,
    running.reduce((sum, s) => sum + (s.status?.cpuPercent ?? 0), 0),
  );
  const totalRamUsed = running.reduce((sum, s) => sum + (s.status?.memoryUsedMb ?? 0), 0);
  const totalRamAllocated = running.reduce((sum, s) => sum + s.memoryMb, 0);
  const totalRamPercent = totalRamAllocated > 0 ? (totalRamUsed / totalRamAllocated) * 100 : 0;
  const totalPlayers = running.reduce((sum, s) => sum + (s.players?.current ?? 0), 0);

  const toggleSelect = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    if (checked) setShakingId(id);
  };

  const deleteSelected = () => {
    const ids = [...selected];
    // Remove from local state immediately so the exit animation plays the instant "Confirm delete"
    // is pressed, instead of waiting on the network round trip.
    setServers((prev) => prev?.filter((s) => !ids.includes(s.id)) ?? prev);
    setSelected(new Set());
    setConfirmingBulkDelete(false);
    Promise.all(ids.map((id) => serversApi.remove(id, false)))
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Failed to delete one or more servers'),
      )
      .finally(load);
  };

  const gameDef = (server: GameServer) => games.find((g) => g.id === server.game);

  const gameLabel = (server: GameServer) => {
    const displayName = gameDef(server)?.displayName ?? server.game;
    const mapLabel =
      currentMapLabel(server, gameDef(server)) ??
      (server.variant !== 'default' ? server.variant : null);
    const parts = [displayName, server.version, mapLabel].filter(Boolean);
    return parts.join(' · ');
  };

  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      className="mx-auto max-w-5xl px-8 py-10"
    >
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-base-50">Servers</h1>
            <p className="mt-1 text-sm text-base-500">
              Every server here is its own Docker container.
            </p>
          </div>
          {running.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="pill">
                <FiCpu className="h-3.5 w-3.5" />
                CPU {totalCpu.toFixed(1)}%
              </span>
              <span className={`pill ${usageColorClass(totalRamPercent)}`}>
                <FiHardDrive className="h-3.5 w-3.5" />
                RAM {totalRamUsed}MB / {totalRamAllocated}MB
              </span>
              <span className="pill">
                <FiUsers className="h-3.5 w-3.5" />
                {totalPlayers} online
              </span>
            </div>
          )}
          {servers && servers.length > 0 && (
            <div className="flex items-center gap-1 rounded-lg bg-base-800 p-1">
              <button
                title="Default view"
                className={`rounded-md p-1.5 transition-colors ${
                  layout === 'default'
                    ? 'bg-base-700 text-base-50'
                    : 'text-base-500 hover:text-base-200'
                }`}
                onClick={() => setLayout('default')}
              >
                <FiGrid className="h-3.5 w-3.5" />
              </button>
              <button
                title="List view"
                className={`rounded-md p-1.5 transition-colors ${
                  layout === 'list'
                    ? 'bg-base-700 text-base-50'
                    : 'text-base-500 hover:text-base-200'
                }`}
                onClick={() => setLayout('list')}
              >
                <FiList className="h-3.5 w-3.5" />
              </button>
              <button
                title="Square view"
                className={`rounded-md p-1.5 transition-colors ${
                  layout === 'square'
                    ? 'bg-base-700 text-base-50'
                    : 'text-base-500 hover:text-base-200'
                }`}
                onClick={() => setLayout('square')}
              >
                <FiSquare className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        {selected.size === 0 ? (
          <Link
            to="/servers/new"
            className=" shadow-md shadow-green-400/20  btn-primary transition-transform hover:scale-[1.03] active:scale-95"
          >
            + New server
          </Link>
        ) : confirmingBulkDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-sm text-red-300">
              Delete {selected.size} server{selected.size > 1 ? 's' : ''}? This can't be undone.
            </span>
            <button className="btn-secondary" onClick={() => setConfirmingBulkDelete(false)}>
              Cancel
            </button>
            <button className="btn-danger" onClick={deleteSelected}>
              Confirm delete
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button className="btn-secondary" onClick={() => setSelected(new Set())}>
              Cancel
            </button>
            <button className="btn-danger" onClick={() => setConfirmingBulkDelete(true)}>
              Delete {selected.size} selected
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="card mb-4 flex items-start gap-3 border-red-500/30 bg-red-500/5 px-5 py-4">
          <span className="text-red-400">⚠</span>
          <div>
            <p className="text-sm text-red-300">{error}</p>
            <button
              className="mt-2 text-xs font-medium text-red-300 underline underline-offset-2"
              onClick={load}
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {servers === null && !error && (
        <div className={GRID_CLASS[layout]}>
          {[0, 1, 2].map((i) => (
            <SkeletonServerCard key={i} square={layout === 'square'} />
          ))}
        </div>
      )}

      {servers?.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="card flex flex-col items-center gap-3 px-8 py-16 text-center"
        >
          <p className="text-base-200">No servers yet.</p>
          <p className="max-w-sm text-sm text-base-500">
            Spin up a server in a couple clicks, or build a modpack right from the New Server page.
          </p>
          <Link
            to="/servers/new"
            className="btn-primary mt-2 transition-transform hover:scale-[1.03] active:scale-95"
          >
            Create your first server
          </Link>
        </motion.div>
      )}

      <motion.div
        variants={staggerContainer}
        initial="initial"
        animate="animate"
        className={GRID_CLASS[layout]}
      >
        <AnimatePresence mode="popLayout">
          {servers?.map((server, index) => {
            const ramPercent =
              server.memoryMb > 0
                ? ((server.status?.memoryUsedMb ?? 0) / server.memoryMb) * 100
                : 0;
            const isSelecting = selected.size > 0;
            const isSelected = selected.has(server.id);
            return (
              <motion.div
                key={server.id}
                layout
                variants={staggerItem}
                initial="initial"
                animate="animate"
                exit="exit"
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.99 }}
                className="group relative"
              >
                {/* "Jiggle mode": while anything is selected, unselected cards wobble slightly out of
                 phase and selected cards stay still. */}
                <motion.div
                  animate={isSelecting && !isSelected ? { rotate: [-1.4, 1.4] } : { rotate: 0 }}
                  transition={
                    isSelecting && !isSelected
                      ? {
                          repeat: Infinity,
                          repeatType: 'mirror',
                          duration: 0.14,
                          ease: 'easeInOut',
                          delay: (index % 4) * 0.035,
                        }
                      : { duration: 0.15 }
                  }
                >
                  <motion.label
                    className={`absolute left-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-base-950/70 backdrop-blur-sm transition-opacity ${
                      selected.has(server.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    animate={shakingId === server.id ? shakeAnimation : { x: 0 }}
                    transition={{ duration: 0.4 }}
                    onAnimationComplete={() => {
                      if (shakingId === server.id) setShakingId(null);
                    }}
                  >
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={selected.has(server.id)}
                      onChange={(e) => toggleSelect(server.id, e.target.checked)}
                    />
                  </motion.label>
                  <Link
                    to={`/servers/${server.id}`}
                    className={`server-card flex flex-col overflow-hidden ${layout === 'square' ? 'aspect-square' : ''}`}
                  >
                    <div
                      className={
                        layout === 'square' ? 'relative min-h-0 flex-1' : 'relative h-20 shrink-0'
                      }
                    >
                      <AnimatePresence>
                        {(server.mapBannerUrl ?? gameDef(server)?.bannerUrl) && (
                          <motion.img
                            key={server.mapBannerUrl ?? gameDef(server)?.bannerUrl}
                            src={server.mapBannerUrl ?? gameDef(server)!.bannerUrl!}
                            alt=""
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.5 }}
                            className="absolute inset-0 h-full w-full object-cover"
                            onError={(e) => {
                              const fallback = gameDef(server)?.bannerUrl;
                              if (fallback && e.currentTarget.src !== fallback)
                                e.currentTarget.src = fallback;
                            }}
                          />
                        )}
                      </AnimatePresence>
                      <div className="absolute inset-0 bg-gradient-to-b from-base-950/85 via-base-950/45 to-transparent" />
                      <div className="relative flex h-full items-start justify-between p-4">
                        <div className="min-w-0 pl-7">
                          <h2 className="truncate font-medium text-base-50">{server.name}</h2>
                          <p className="truncate text-xs text-base-300">{gameLabel(server)}</p>
                        </div>
                        <StatusBadge readiness={server.readiness} />
                      </div>
                    </div>
                    <div className="flex items-center gap-4 overflow-hidden px-5 py-3 text-xs text-base-500">
                      <span className="shrink-0">Port {server.gamePort}</span>
                      <PlayerCount players={server.players} className="shrink-0" />
                      {server.status?.running && (
                        <>
                          <span className={`shrink-0 ${usageColorClass(server.status.cpuPercent)}`}>
                            CPU {server.status.cpuPercent}%
                          </span>
                          <span className={`shrink-0 ${usageColorClass(ramPercent)}`}>
                            RAM {server.status.memoryUsedMb}MB / {server.memoryMb}MB
                          </span>
                        </>
                      )}
                    </div>
                    {server.readiness === 'installing' && (
                      <div className="px-5 pb-3">
                        <InstallProgressBar
                          installPhase={server.installPhase}
                          bytes={server.installBytes}
                          totalBytes={server.installTotalBytes}
                        />
                      </div>
                    )}
                    {server.readiness === 'booting' && (
                      <div className="px-5 pb-3">
                        {/* Compact: the badge already says "Booting up!", so the bar just shows that
                       work is ongoing. */}
                        <BootProgress startedAt={server.status?.startedAt ?? null} compact />
                      </div>
                    )}
                  </Link>
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
