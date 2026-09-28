import { useEffect, useState } from 'react';
import {
  playersApi,
  type GameDef,
  type PlayerAction,
  type PlayerRef,
  type SeenPlayer,
} from '../../lib/api';
import Skeleton from '../Skeleton';

type ActionDef = { action: PlayerAction; label: string; className: string };

export default function PlayersPanel({
  serverId,
  gameDef,
  running,
}: {
  serverId: string;
  gameDef: GameDef | undefined;
  running: boolean;
}) {
  const [players, setPlayers] = useState<PlayerRef[] | null>(null);
  const [banned, setBanned] = useState<PlayerRef[] | null>(null);
  const [offline, setOffline] = useState<SeenPlayer[] | null>(null);
  const [view, setView] = useState<'online' | 'offline' | 'banned'>('online');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: PlayerAction } | null>(null);

  const support = gameDef?.playerManagement;
  const showHeads = gameDef?.id === 'minecraft';

  const loadPlayers = () => {
    playersApi
      .list(serverId)
      .then((r) => {
        setPlayers(r.players);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load players'));
  };

  const loadBanned = () => {
    playersApi
      .banned(serverId)
      .then((r) => {
        setBanned(r.players);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load ban list'));
  };

  const loadOffline = () => {
    playersApi
      .offline(serverId)
      .then((r) => {
        setOffline(r.players);
        setError(null);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'Failed to load the offline player log'),
      );
  };

  useEffect(() => {
    if (!support || !running) return;
    loadPlayers();
    const interval = setInterval(loadPlayers, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, support, running]);

  useEffect(() => {
    if (!running) return;
    if (view === 'banned') loadBanned();
    if (view === 'offline') loadOffline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, running]);

  // Clear the previous session's players and errors so a fresh start doesn't briefly show stale
  // data.
  useEffect(() => {
    if (!running) {
      setPlayers(null);
      setBanned(null);
      setOffline(null);
      setError(null);
    }
  }, [running]);

  if (!support) {
    return (
      <div className="card p-5">
        <h3 className="mb-1 font-medium text-base-50">Players</h3>
        <p className="text-sm text-base-500">
          This game has no RCON console for Outpost to manage players through, so there's no
          kick/ban here.
        </p>
      </div>
    );
  }

  if (!running) {
    return (
      <div className="card p-5">
        <h3 className="mb-1 font-medium text-base-50">Players</h3>
        <p className="text-sm text-base-500">
          The server needs to finish booting before players can be managed here.
        </p>
      </div>
    );
  }

  const act = async (action: PlayerAction, player: PlayerRef) => {
    setConfirming(null);
    setError(null);
    setBusyId(player.id);
    try {
      await playersApi.action(serverId, action, player);
      loadPlayers();
      if (view === 'banned') loadBanned();
      if (view === 'offline') loadOffline();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusyId(null);
    }
  };

  // Unban is non-destructive and reversible (just ban again), so it skips the confirm step.
  const requestAction = (action: PlayerAction, player: PlayerRef) => {
    if (action === 'unban') {
      act(action, player);
    } else {
      setConfirming({ id: player.id, action });
    }
  };

  const onlineActions = (player: PlayerRef): ActionDef[] => [
    ...(support.op
      ? [
          player.isOp
            ? { action: 'deop' as const, label: 'De-op', className: 'btn-secondary' }
            : { action: 'op' as const, label: 'Op', className: 'btn-secondary' },
        ]
      : []),
    { action: 'kick', label: 'Kick', className: 'btn-secondary' },
    ...(support.kill
      ? [{ action: 'kill' as const, label: 'Kill', className: 'btn-secondary' }]
      : []),
    { action: 'ban', label: 'Ban', className: 'btn-danger' },
  ];

  const bannedActions = (): ActionDef[] => [
    { action: 'unban', label: 'Unban', className: 'btn-secondary' },
  ];

  // Kick/kill/op don't mean anything for someone who's not connected.
  const offlineActions = (): ActionDef[] => [
    { action: 'ban', label: 'Ban', className: 'btn-danger' },
  ];

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-base-50">Players</h3>
        <div className="flex gap-1 rounded-lg bg-base-800 p-1 text-xs">
          <button
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
              view === 'online' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
            }`}
            onClick={() => setView('online')}
          >
            Online
          </button>
          <button
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
              view === 'offline' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
            }`}
            onClick={() => setView('offline')}
          >
            Offline
          </button>
          {support.banList && (
            <button
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                view === 'banned' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
              }`}
              onClick={() => setView('banned')}
            >
              Ban list
            </button>
          )}
        </div>
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {view === 'online' && (
        <PlayerList
          players={players}
          loading={players === null && !error}
          emptyLabel="Nobody's connected right now."
          busyId={busyId}
          showHeads={showHeads}
          confirming={confirming}
          getActions={onlineActions}
          onRequestAction={requestAction}
          onConfirm={act}
          onCancelConfirm={() => setConfirming(null)}
        />
      )}
      {view === 'offline' && (
        <>
          <p className="mb-3 text-xs text-base-500">
            Everyone RCON has seen connect who isn't online (or banned) right now — so someone who
            caused trouble and left before you could act is still findable here.
          </p>
          <PlayerList
            players={offline}
            loading={offline === null && !error}
            emptyLabel="No one's shown up in the log yet."
            busyId={busyId}
            showHeads={showHeads}
            confirming={confirming}
            getActions={offlineActions}
            onRequestAction={requestAction}
            onConfirm={act}
            onCancelConfirm={() => setConfirming(null)}
          />
        </>
      )}
      {view === 'banned' && (
        <PlayerList
          players={banned}
          loading={banned === null && !error}
          emptyLabel="No one's banned."
          busyId={busyId}
          showHeads={showHeads}
          confirming={confirming}
          getActions={bannedActions}
          onRequestAction={requestAction}
          onConfirm={act}
          onCancelConfirm={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

function pingColor(ping: number): string {
  if (ping < 100) return 'text-accent-400';
  if (ping < 200) return 'text-ember-400';
  return 'text-red-400';
}

function formatLastSeen(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function PlayerList({
  players,
  loading,
  emptyLabel,
  busyId,
  showHeads,
  confirming,
  getActions,
  onRequestAction,
  onConfirm,
  onCancelConfirm,
}: {
  players: (PlayerRef & { lastSeenAt?: string })[] | null;
  loading: boolean;
  emptyLabel: string;
  busyId: string | null;
  showHeads: boolean;
  confirming: { id: string; action: PlayerAction } | null;
  getActions: (player: PlayerRef) => ActionDef[];
  onRequestAction: (action: PlayerAction, player: PlayerRef) => void;
  onConfirm: (action: PlayerAction, player: PlayerRef) => void;
  onCancelConfirm: () => void;
}) {
  if (loading) {
    return (
      // Same well as the loaded list, so the panel doesn't visibly change shape once players arrive.
      <ul className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-2.5 py-2.5">
            <Skeleton className="h-7 w-7 shrink-0 rounded-md" />
            <Skeleton className="h-4 w-32" />
          </li>
        ))}
      </ul>
    );
  }
  if (players === null) return null;
  if (players.length === 0) {
    return (
      <div className="rounded-xl border border-base-800 bg-base-950/60 py-6">
        <p className="text-center text-sm text-base-500">{emptyLabel}</p>
      </div>
    );
  }

  return (
    // Recessed well around the roster only.
    <ul className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3">
      {players.map((p) => {
        const isConfirming = confirming?.id === p.id;
        const actions = getActions(p);
        // No first/last padding reset inside the bordered well.
        return (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              {showHeads && (
                <img
                  src={`https://mc-heads.net/avatar/${encodeURIComponent(p.name)}/32`}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-md"
                  loading="lazy"
                />
              )}
              <span className="truncate text-sm text-base-100">{p.name}</span>
              {p.isOp && (
                <span className="pill shrink-0 !px-1.5 !py-0.5 !text-[10px] text-accent-400">
                  OP
                </span>
              )}
              {p.ping !== undefined && (
                <span className={`shrink-0 text-xs ${pingColor(p.ping)}`}>{p.ping}ms</span>
              )}
              {p.lastSeenAt && (
                <span className="shrink-0 text-xs text-base-500">
                  last seen {formatLastSeen(p.lastSeenAt)}
                </span>
              )}
            </div>

            {isConfirming ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-base-500">
                  {actions.find((a) => a.action === confirming.action)?.label ?? confirming.action}?
                </span>
                <button
                  className="btn-danger !px-2.5 !py-1 !text-xs"
                  disabled={busyId === p.id}
                  onClick={() => onConfirm(confirming.action, p)}
                >
                  Confirm
                </button>
                <button className="btn-secondary !px-2.5 !py-1 !text-xs" onClick={onCancelConfirm}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex shrink-0 gap-1.5">
                {actions.map(({ action, label, className }) => (
                  <button
                    key={action}
                    className={`${className} !px-2.5 !py-1 !text-xs`}
                    disabled={busyId === p.id}
                    onClick={() => onRequestAction(action, p)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
