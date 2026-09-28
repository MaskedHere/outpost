import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  serversApi,
  tunnelApi,
  boreApi,
  mapApi,
  settingsApi,
  upnpApi,
  worldApi,
  type BoreStatus,
  type Difficulty,
  type Gamemode,
  type Gamerule,
  type GameDef,
  type GameSettingField,
  type GameServer,
  type MapControlStatus,
  type TunnelStatus,
  type UpnpStatus,
  type WorldSettings as WorldSettingsData,
} from '../../lib/api';
import { motion } from 'framer-motion';
import { FaCheck } from 'react-icons/fa';
import { groupOptions } from '../../lib/groupedOptions';
import MemorySlider, { maxMemoryMb } from '../MemorySlider';
import Select from '../Select';
import InfoTip from '../InfoTip';
import Skeleton from '../Skeleton';

export default function SettingsTab({
  server,
  gameDef,
}: {
  server: GameServer;
  gameDef: GameDef | undefined;
}) {
  const navigate = useNavigate();
  const [deleteData, setDeleteData] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [memoryMb, setMemoryMb] = useState(server.memoryMb);
  const [confirmingMemory, setConfirmingMemory] = useState(false);
  const [savingMemory, setSavingMemory] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [hostMemoryMb, setHostMemoryMb] = useState<number | undefined>(undefined);

  // Only for the memory slider's upper bound.
  useEffect(() => {
    settingsApi
      .get()
      .then((s) => setHostMemoryMb(s.hostMemoryMb))
      .catch(() => undefined);
  }, []);

  useEffect(() => setMemoryMb(server.memoryMb), [server.memoryMb]);
  // Changing the slider after arming the confirm step should require a fresh confirm, not silently
  // apply whatever value it's since been dragged to.
  useEffect(() => setConfirmingMemory(false), [memoryMb]);

  const handleDelete = async () => {
    setRemoving(true);
    try {
      await serversApi.remove(server.id, deleteData);
      navigate('/');
    } finally {
      setRemoving(false);
    }
  };

  const handleSaveMemory = async () => {
    setConfirmingMemory(false);
    setSavingMemory(true);
    setMemoryError(null);
    setMemorySaved(false);
    try {
      await serversApi.updateMemory(server.id, memoryMb);
      setMemorySaved(true);
      setTimeout(() => setMemorySaved(false), 3000);
    } catch (e) {
      setMemoryError(e instanceof Error ? e.message : 'Failed to change memory limit');
    } finally {
      setSavingMemory(false);
    }
  };

  return (
    // Explicit rows of paired columns, rather than CSS multi-column masonry.
    <div className="space-y-6">
      {/* Server info, World and Settings all describe the same thing. */}
      {/* divide-y draws the section rules; the padding gives each section room either side of one. */}
      <div className="card divide-y divide-base-800 p-5 [&>*:not(:first-child)]:pt-6 [&>*:not(:last-child)]:pb-6">
        <div>
          <h3 className="mb-3 font-medium text-base-50">Server info</h3>
          <dl className="grid grid-cols-2 items-center gap-y-3 text-sm">
            <dt className="text-base-500">Game</dt>
            <dd className="text-base-100">
              {server.game}
              {server.variant !== 'default' ? ` (${server.variant})` : ''}
            </dd>
            {server.version && (
              <>
                <dt className="text-base-500">Version</dt>
                <dd className="text-base-100">{server.version}</dd>
              </>
            )}
            <dt className="text-base-500">Port</dt>
            <dd className="text-base-100">{server.gamePort}</dd>
            <dt className="text-base-500">Data path</dt>
            <dd className="break-all font-mono text-xs text-base-100">{server.dataPath}</dd>
          </dl>

          <div className="mt-4 border-t border-base-800 pt-4">
            <MemorySlider
              value={memoryMb}
              onChange={setMemoryMb}
              min={512}
              max={maxMemoryMb(hostMemoryMb)}
              step={512}
              disabled={savingMemory}
            />

            {!confirmingMemory ? (
              <div className="mt-3 flex items-center gap-2">
                <button
                  className="btn-secondary !px-2.5 !py-1 !text-xs"
                  disabled={savingMemory || memoryMb === server.memoryMb}
                  onClick={() => setConfirmingMemory(true)}
                >
                  {savingMemory ? 'Applying…' : memorySaved ? 'Saved ✓' : 'Save memory change'}
                </button>
                {memoryError && <p className="text-xs text-red-400">{memoryError}</p>}
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-base-800/70 px-3 py-2">
                <span className="text-xs text-base-200">
                  Apply {memoryMb >= 1024 ? `${memoryMb / 1024} GB` : `${memoryMb} MB`}? Briefly
                  restarts the container.
                </span>
                <button className="btn-primary !px-2.5 !py-1 !text-xs" onClick={handleSaveMemory}>
                  Confirm
                </button>
                <button
                  className="btn-secondary !px-2.5 !py-1 !text-xs"
                  onClick={() => setConfirmingMemory(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>

        <WorldSettings server={server} gameDef={gameDef} />

        <BehaviorSettings server={server} gameDef={gameDef} />
      </div>

      {/* Map control only exists for TF2, and is a live action rather than configuration, so it
          keeps its own card. */}
      <MapControl server={server} gameDef={gameDef} />

      <div className="flex flex-col items-start gap-6 lg:flex-row [&>*]:min-w-0 [&>*]:flex-1">
        <PublicAccess server={server} gameDef={gameDef} />

        {server.rconPassword && (
          <div className="card w-full p-5">
            <h3 className="mb-1 font-medium text-base-50">Connection secret</h3>
            <p className="mb-3 text-sm text-base-500">
              {server.rconPort
                ? 'Used by the console tab to run commands on this server.'
                : "This game has no admin console — some (like Valheim) reuse this as the server's join password instead."}
            </p>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {server.rconPort && (
                <>
                  <dt className="text-base-500">RCON port</dt>
                  <dd className="text-base-100">{server.rconPort}</dd>
                </>
              )}
              <dt className="text-base-500">Password</dt>
              <dd className="break-all font-mono text-xs text-base-100">{server.rconPassword}</dd>
            </dl>
          </div>
        )}
      </div>

      <div className="card border-red-500/20 p-5">
        <h3 className="mb-1 font-medium text-red-400">Danger zone</h3>
        <p className="mb-4 text-sm text-base-500">
          Removes the Docker container. Optionally deletes world/config data too.
        </p>
        <label className="mb-4 flex items-center gap-2 text-sm text-base-200">
          <input
            type="checkbox"
            className="checkbox"
            checked={deleteData}
            onChange={(e) => setDeleteData(e.target.checked)}
          />
          Also delete server data from disk
        </label>

        {!confirmingDelete ? (
          <button
            className="btn-danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={removing}
          >
            Delete server
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-base-200">
              Delete "{server.name}"{deleteData ? ' and all its data' : ''}? This can't be undone.
            </span>
            <button className="btn-danger" onClick={handleDelete} disabled={removing}>
              {removing ? 'Deleting…' : 'Confirm delete'}
            </button>
            <button
              className="btn-secondary !px-2.5 !py-1 !text-xs"
              onClick={() => setConfirmingDelete(false)}
              disabled={removing}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MapControl({ server, gameDef }: { server: GameServer; gameDef: GameDef | undefined }) {
  const [status, setStatus] = useState<MapControlStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const userPickedCategory = useRef(false);

  const load = () =>
    mapApi
      .get(server.id)
      .then(setStatus)
      .catch(() => undefined);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  // Poll faster while a map switch is in progress so the notice clears as soon as the new map
  // loads.
  useEffect(() => {
    if (!switchingTo) return;
    const interval = setInterval(load, 1500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchingTo]);

  useEffect(() => {
    if (switchingTo && status?.current === switchingTo) setSwitchingTo(null);
  }, [status?.current, switchingTo]);

  const groups = useMemo(
    () => (status?.options ? groupOptions(status.options) : []),
    [status?.options],
  );

  // Follow the currently loaded map's gamemode, unless the user has picked a different one to
  // browse.
  useEffect(() => {
    if (userPickedCategory.current || !status?.current || groups.length === 0) return;
    const match = groups.find((g) => g.options.some((o) => o.value === status.current));
    setCategory(match?.category ?? groups[0]!.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.current, groups]);

  if (!status?.supported || !status.options) return null;

  const mapLabel = (map: string) => {
    const raw = status.options![map] ?? map;
    const sep = raw.indexOf(' — ');
    return sep === -1 ? raw : raw.slice(sep + 3);
  };

  const apply = async (map: string) => {
    setBusy(map);
    setError(null);
    try {
      await mapApi.set(server.id, map);
      setSwitchingTo(map);
      // The server takes a moment to finish loading the new map before status reports it.
      setTimeout(load, 1000);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message}${gameDef?.id === 'tf2' ? ' — try "Install extra maps" below if this one was never downloaded.' : ''}`
          : 'Failed to change map',
      );
    } finally {
      setBusy(null);
    }
  };

  const installExtraMaps = async () => {
    setInstalling(true);
    setError(null);
    try {
      await mapApi.installExtra(server.id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start the map install');
    } finally {
      setInstalling(false);
    }
  };

  const activeGroup = groups.find((g) => g.category === category) ?? groups[0];

  return (
    <div className="card p-5">
      <h3 className="mb-1 font-medium text-base-50">Map</h3>
      <p className="mb-4 text-sm text-base-500">
        Switches live, no restart needed — takes effect as soon as the map loads.
      </p>

      {gameDef?.id === 'tf2' && (
        <div className="mb-4 rounded-lg bg-base-800/70 px-3 py-2.5">
          {status.installingExtraMaps ? (
            <p className="text-xs text-ember-400">
              Installing the rest of the stock maps — this downloads several GB and can take a few
              minutes. Maps not yet on disk will fail to load until it finishes.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-base-500">
                This server image only ships with Badlands by default. One-time download restores
                every map below (~10 GB, runs in the background).
              </p>
              <button
                className="btn-secondary shrink-0 !px-2.5 !py-1 !text-xs"
                onClick={installExtraMaps}
                disabled={installing}
              >
                {installing ? 'Starting…' : 'Install extra maps'}
              </button>
            </div>
          )}
        </div>
      )}

      {switchingTo && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-accent-500/10 px-3 py-2.5 text-xs text-accent-400">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
          </span>
          Switching to {mapLabel(switchingTo)}… this can take a few seconds while the map loads.
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {groups.length > 1 && (
        <div className="mb-3">
          <label className="label" htmlFor="map-gamemode">
            Gamemode
          </label>
          <Select
            id="map-gamemode"
            value={activeGroup?.category ?? ''}
            onChange={(c) => {
              userPickedCategory.current = true;
              setCategory(c);
            }}
            options={groups.map((g) => ({
              value: g.category,
              label: `${g.category || 'Other'} (${g.options.length})`,
            }))}
          />
        </div>
      )}

      <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
        {activeGroup?.options.map(({ value, label }) => {
          const isCurrent = value === status.current;
          return (
            <button
              key={value}
              className={`rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors ${
                isCurrent
                  ? 'border-accent-500/50 bg-accent-500/10 text-accent-400'
                  : 'border-base-700 bg-base-800 text-base-200 hover:border-accent-500/40'
              } disabled:cursor-not-allowed disabled:opacity-60`}
              disabled={busy !== null || isCurrent}
              onClick={() => apply(value)}
            >
              {label}
              {isCurrent && ' ✓'}
              {busy === value && ' …'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const GAMERULE_LABELS: Record<Gamerule, string> = {
  keepInventory: 'Keep inventory on death',
  doDaylightCycle: 'Day/night cycle',
  doWeatherCycle: 'Weather changes',
  doMobSpawning: 'Mobs spawn',
};

const GAMERULE_INFO: Record<Gamerule, string> = {
  keepInventory:
    "On: dying doesn't drop your items — they stay in your inventory. Off (vanilla default): everything drops where you died and despawns after 5 minutes if not recovered.",
  doDaylightCycle:
    'Off freezes the time of day wherever it currently is — the sun/moon stop moving. Useful to lock in permanent day and skip nighttime mob spawns.',
  doWeatherCycle:
    "Off stops rain/thunderstorms from starting on their own (an operator can still force weather with /weather). Doesn't affect the day/night cycle.",
  doMobSpawning:
    'Off stops all mobs — hostile and passive — from spawning naturally anywhere in the world. Mobs already alive, spawners, and mobs spawned by commands are unaffected.',
};

/**
 * Minecraft-only: delete-world plus common settings. Difficulty/gamemode/whitelist are read from
 * server.properties so they work while stopped; gamerules need RCON, so they require a running
 * server.
 */
function WorldSettings({ server, gameDef }: { server: GameServer; gameDef: GameDef | undefined }) {
  const [world, setWorld] = useState<WorldSettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Deleting a world is destructive and instantaneous, and the confirm box collapsing on its own
  // looks identical to it having done nothing.
  const [deletedAt, setDeletedAt] = useState<number | null>(null);

  const load = () =>
    worldApi
      .get(server.id)
      .then(setWorld)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load world settings'));

  useEffect(() => {
    if (gameDef?.id === 'minecraft') load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.status?.running, gameDef?.id]);

  if (gameDef?.id !== 'minecraft') return null;

  const updateSetting = async (
    patch: { difficulty?: Difficulty } | { gamemode?: Gamemode } | { whitelist?: boolean },
    key: string,
  ) => {
    setSavingKey(key);
    setError(null);
    try {
      const updated = await worldApi.update(server.id, patch);
      setWorld(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSavingKey(null);
    }
  };

  const toggleGamerule = async (rule: Gamerule, value: boolean) => {
    setSavingKey(rule);
    setError(null);
    setWorld((w) => (w?.gamerules ? { ...w, gamerules: { ...w.gamerules, [rule]: value } } : w));
    try {
      await worldApi.setGamerule(server.id, rule, value);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update gamerule');
      load();
    } finally {
      setSavingKey(null);
    }
  };

  const handleDeleteWorld = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await worldApi.deleteWorld(server.id);
      setConfirmingDelete(false);
      setDeletedAt(Date.now());
      // The panel shows the world's size and seed; both are stale the moment it's gone.
      await load();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to delete world');
    } finally {
      setDeleting(false);
    }
  };

  if (!world) {
    if (error) {
      return (
        <div>
          <h3 className="mb-1 font-medium text-base-50">World</h3>
          <p className="text-sm text-base-500">{error}</p>
        </div>
      );
    }
    return (
      <div>
        <Skeleton className="mb-4 h-5 w-16" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
        <Skeleton className="mt-4 h-4 w-24" />
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <h3 className="font-medium text-base-50">World</h3>
        {/* Minecraft's own default save name is "world". */}
        {world.levelName.toLowerCase() !== 'world' && (
          <span className="pill !px-1.5 !py-0.5 !text-[10px] text-base-300">{world.levelName}</span>
        )}
        {world.hardcore && (
          <span className="pill !px-1.5 !py-0.5 !text-[10px] text-red-400">Hardcore</span>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label flex items-center gap-1.5" htmlFor="world-difficulty">
            Difficulty
            <InfoTip text="Peaceful: no hostile mobs, hunger doesn't deplete. Easy/Normal/Hard scale up hostile mob damage and hunger's effects — on Hard, starving can kill you; on Easy, it can't drop you below 5 hearts." />
          </label>
          <Select
            id="world-difficulty"
            value={world.difficulty}
            onChange={(v) => updateSetting({ difficulty: v as Difficulty }, 'difficulty')}
            options={[
              { value: 'peaceful', label: 'Peaceful' },
              { value: 'easy', label: 'Easy' },
              { value: 'normal', label: 'Normal' },
              { value: 'hard', label: 'Hard' },
            ]}
          />
        </div>
        <div>
          <label className="label flex items-center gap-1.5" htmlFor="world-gamemode">
            Default gamemode
            <InfoTip text="What a brand-new player starts as the first time they join — doesn't change anyone already playing. Change an individual player's gamemode anytime with /gamemode from the console." />
          </label>
          <Select
            id="world-gamemode"
            value={world.gamemode}
            onChange={(v) => updateSetting({ gamemode: v as Gamemode }, 'gamemode')}
            options={[
              { value: 'survival', label: 'Survival' },
              { value: 'creative', label: 'Creative' },
              { value: 'adventure', label: 'Adventure' },
              { value: 'spectator', label: 'Spectator' },
            ]}
          />
        </div>
      </div>

      <label className="mt-4 flex items-center gap-2 text-sm text-base-200">
        <input
          type="checkbox"
          className="checkbox"
          checked={world.whitelist}
          disabled={savingKey === 'whitelist'}
          onChange={(e) => updateSetting({ whitelist: e.target.checked }, 'whitelist')}
        />
        Whitelist only
      </label>

      <div className="mt-5 border-t border-base-800 pt-4">
        <p className="label !mb-2">Gamerules</p>
        {!world.running ? (
          <p className="text-xs text-base-500">Start the server to view/change gamerules.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(GAMERULE_LABELS) as Gamerule[]).map((rule) => {
              const value = world.gamerules?.[rule] ?? null;
              return (
                <label
                  key={rule}
                  className="flex items-center justify-between gap-2 rounded-lg bg-base-800/60 px-3 py-2 text-sm text-base-200"
                >
                  <span className="flex items-center gap-1.5">
                    {GAMERULE_LABELS[rule]}
                    <InfoTip text={GAMERULE_INFO[rule]} />
                  </span>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={value ?? false}
                    disabled={value === null || savingKey === rule}
                    onChange={(e) => toggleGamerule(rule, e.target.checked)}
                  />
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-red-500/20 pt-4">
        {!confirmingDelete ? (
          <>
            <button
              className="btn-danger !text-xs"
              onClick={() => setConfirmingDelete(true)}
              disabled={world.running}
            >
              Delete world
            </button>
            {world.running && (
              <p className="mt-2 text-xs text-base-500">
                Stop the server first to delete its world.
              </p>
            )}
            {deletedAt !== null && (
              <motion.p
                key={deletedAt}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2 flex items-center gap-1.5 text-xs text-accent-400"
              >
                <FaCheck className="h-3 w-3" />
                World deleted. A brand new one generates the next time this server starts.
              </motion.p>
            )}
          </>
        ) : (
          <div className="rounded-lg bg-red-500/5 p-3">
            <p className="mb-2 text-xs text-red-300">
              This permanently deletes "{world.levelName}" (overworld, nether, and end) — everything
              else (config, mods, backups) stays. The server generates a brand new world next time
              it starts. This can't be undone.
            </p>
            <div className="flex gap-2">
              <button
                className="btn-danger !px-2.5 !py-1 !text-xs"
                onClick={handleDeleteWorld}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Yes, delete it'}
              </button>
              <button
                className="btn-secondary !px-2.5 !py-1 !text-xs"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {deleteError && <p className="mt-2 text-xs text-red-400">{deleteError}</p>}
      </div>
    </div>
  );
}

/** Renders whatever settings the server's game declares (GameDefinition.settings). */
function BehaviorSettings({
  server,
  gameDef,
}: {
  server: GameServer;
  gameDef: GameDef | undefined;
}) {
  const stored = useMemo<Record<string, string>>(
    () => (server.extraSettings ? JSON.parse(server.extraSettings) : {}),
    [server.extraSettings],
  );
  const [values, setValues] = useState<Record<string, string>>(stored);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setValues(stored), [stored]);
  useEffect(() => setConfirming(false), [values]);

  const fields = gameDef?.settings ?? [];
  if (fields.length === 0) return null;

  const valueOf = (f: GameSettingField) => values[f.key] ?? f.default;
  const dirty = fields.some((f) => valueOf(f) !== (stored[f.key] ?? f.default));
  const setValue = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  // Preserve declaration order while collecting fields under their group heading.
  const groups: { name: string; fields: GameSettingField[] }[] = [];
  for (const field of fields) {
    const name = field.group ?? 'General';
    const existing = groups.find((g) => g.name === name);
    if (existing) existing.fields.push(field);
    else groups.push({ name, fields: [field] });
  }

  const save = async () => {
    setConfirming(false);
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await serversApi.updateSettings(server.id, values);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h3 className="mb-4 font-medium text-base-50">Settings</h3>

      {/* One field per row. */}
      {/* Newspaper-style columns that balance by height. */}
      {/* Grid rather than CSS columns so groups re-balance when one appears, disappears, or changes
         height. `items-start` keeps short groups from stretching. */}
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-4 lg:grid-cols-2">
        {groups.map((group) => (
          <div key={group.name}>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-base-500">
              {group.name}
            </p>
            <div className="space-y-1.5">
              {group.fields.map((f) => (
                <div
                  key={f.key}
                  className="flex items-center justify-between gap-3 rounded-lg bg-base-800/60 px-3 py-2 text-sm text-base-200"
                >
                  <span className="flex items-center gap-1.5">
                    <span>{f.label}</span>
                    <InfoTip
                      text={
                        f.newWorldOnly
                          ? `${f.info} Only applies to a world that hasn't been generated yet.`
                          : f.info
                      }
                    />
                  </span>

                  {f.type === 'toggle' && (
                    <input
                      type="checkbox"
                      className="checkbox shrink-0"
                      checked={valueOf(f) === f.onValue}
                      disabled={saving}
                      onChange={(e) => setValue(f.key, e.target.checked ? f.onValue! : f.offValue!)}
                    />
                  )}
                  {f.type === 'number' && (
                    <input
                      type="number"
                      className="input !w-20 shrink-0 !py-1 !text-xs"
                      value={valueOf(f)}
                      min={f.min}
                      max={f.max}
                      disabled={saving}
                      onChange={(e) => setValue(f.key, e.target.value)}
                    />
                  )}
                  {f.type === 'select' && (
                    // The app's own Select, matching World settings' dropdowns.
                    <div className="w-48 shrink-0">
                      <Select
                        value={valueOf(f)}
                        onChange={(value) => setValue(f.key, value)}
                        options={f.options ?? []}
                      />
                    </div>
                  )}
                  {f.type === 'text' && (
                    <input
                      type="text"
                      className="input !w-36 shrink-0 !py-1 !text-xs"
                      value={valueOf(f)}
                      placeholder="none"
                      disabled={saving}
                      onChange={(e) => setValue(f.key, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!confirming ? (
        <div className="mt-4 flex items-center gap-2">
          <button
            className="btn-secondary !px-2.5 !py-1 !text-xs"
            disabled={saving || !dirty}
            onClick={() => setConfirming(true)}
          >
            {saving ? 'Applying…' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-base-800/70 px-3 py-2">
          <span className="text-xs text-base-200">
            Apply these changes? Briefly restarts the container.
          </span>
          <button className="btn-primary !px-2.5 !py-1 !text-xs" onClick={save}>
            Confirm
          </button>
          <button
            className="btn-secondary !px-2.5 !py-1 !text-xs"
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

type Method = 'upnp' | 'bore' | 'playit';

/** Asks the router to forward this server's port straight to the machine, over UPnP. */
function UpnpSection({ server }: { server: GameServer }) {
  const [status, setStatus] = useState<UpnpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // Not polled: each check runs a short-lived container to talk to the router, which is far too
  // heavy to repeat on a timer for a panel that's merely open.
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await upnpApi.get(server.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the router');
    } finally {
      setBusy(false);
      setChecked(true);
    }
  };

  const open = async () => {
    setBusy(true);
    setError(null);
    try {
      await upnpApi.open(server.id);
      setStatus(await upnpApi.get(server.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The router refused the port forward');
    } finally {
      setBusy(false);
      setChecked(true);
    }
  };

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      await upnpApi.close(server.id);
      setStatus(await upnpApi.get(server.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the port forward');
    } finally {
      setBusy(false);
    }
  };

  const address = status?.externalIp ? `${status.externalIp}:${status.gamePort}` : null;

  return (
    <div className="space-y-3">
      <p className="text-xs text-base-500">
        Asks your router to forward port {server.gamePort} to this machine. No account and nothing
        in the middle, so this is the fastest option — friends connect directly at your own upload
        speed. Needs UPnP enabled on the router, which most have by default.
      </p>

      {status?.mapped && address && (
        <div className="rounded-lg bg-base-800/70 px-3 py-2">
          <p className="text-xs text-base-500">Share this address:</p>
          <p className="select-all font-mono text-sm text-accent-400">{address}</p>
        </div>
      )}

      {status?.mapped === false && checked && !error && (
        <p className="text-xs text-base-500">Port {server.gamePort} isn't forwarded right now.</p>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <p className="text-xs text-red-400">{error}</p>
          {status?.output && (
            <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-base-500">
              {status.output.trim()}
            </pre>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!status?.mapped ? (
          <button className="btn-primary !py-1.5 !text-xs" onClick={open} disabled={busy}>
            {busy ? 'Asking the router…' : 'Open my port'}
          </button>
        ) : (
          <button className="btn-danger !py-1.5 !text-xs" onClick={close} disabled={busy}>
            {busy ? 'Working…' : 'Close my port'}
          </button>
        )}
        <button className="btn-secondary !py-1.5 !text-xs" onClick={check} disabled={busy}>
          Check router
        </button>
      </div>

      <p className="text-xs text-base-500">
        A forwarded port is reachable by anyone who knows your address, so set a server password if
        you'd rather keep it to friends. Routers also drop these when they reboot — use "Check
        router" if people suddenly can't connect.
      </p>
    </div>
  );
}

function PublicAccess({ server, gameDef }: { server: GameServer; gameDef: GameDef | undefined }) {
  const boreSupported = gameDef?.gamePortProtocol === 'tcp';
  const [playitStatus, setPlayitStatus] = useState<TunnelStatus | null>(null);
  const [boreStatus, setBoreStatus] = useState<BoreStatus | null>(null);
  const [method, setMethod] = useState<Method>(boreSupported ? 'bore' : 'playit');

  const loadPlayit = () =>
    tunnelApi
      .get(server.id)
      .then(setPlayitStatus)
      .catch(() => undefined);
  const loadBore = () =>
    boreApi
      .get(server.id)
      .then(setBoreStatus)
      .catch(() => undefined);

  useEffect(() => {
    loadPlayit();
    loadBore();
    const interval = setInterval(() => {
      loadPlayit();
      loadBore();
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  // Once either method is turned on, show that one instead of whatever was last picked.
  useEffect(() => {
    if (playitStatus?.enabled) setMethod('playit');
    else if (boreStatus?.enabled) setMethod('bore');
  }, [playitStatus?.enabled, boreStatus?.enabled]);

  if (!playitStatus || !boreStatus) return null;

  const anyEnabled = playitStatus.enabled || boreStatus.enabled;

  return (
    <div className="card p-5">
      <h3 className="mb-1 font-medium text-base-50">Public access</h3>
      <p className="mb-4 text-sm text-base-500">
        Let friends outside your network join — no router port-forwarding, no static IP required.
      </p>

      {!anyEnabled && (
        <div className="mb-4 flex gap-1 rounded-xl bg-base-800 p-1 text-sm">
          {/* UPnP first: it's the fastest path when the router allows it, and unlike the other two
              it works for both TCP and UDP games. */}
          <button
            className={`flex-1 rounded-lg px-3 py-1.5 font-medium transition-colors ${
              method === 'upnp' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
            }`}
            onClick={() => setMethod('upnp')}
          >
            My router
          </button>
          {boreSupported && (
            <button
              className={`flex-1 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                method === 'bore' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
              }`}
              onClick={() => setMethod('bore')}
            >
              Bore
            </button>
          )}
          <button
            className={`flex-1 rounded-lg px-3 py-1.5 font-medium transition-colors ${
              method === 'playit' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
            }`}
            onClick={() => setMethod('playit')}
          >
            playit.gg
          </button>
        </div>
      )}

      {!anyEnabled && !boreSupported && method === 'bore' && (
        <p className="mb-4 text-xs text-base-500">
          This game uses a UDP game port, which the no-account bore.pub option can't tunnel.
        </p>
      )}

      {method === 'upnp' ? (
        <UpnpSection server={server} />
      ) : method === 'bore' ? (
        <BoreSection server={server} status={boreStatus} reload={loadBore} />
      ) : (
        <PlayitSection server={server} status={playitStatus} reload={loadPlayit} />
      )}
    </div>
  );
}

function DisableButton({ onDisable, busy }: { onDisable: () => Promise<void>; busy: boolean }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        className="btn-danger !py-1.5 !text-xs"
        onClick={() => setConfirming(true)}
        disabled={busy}
      >
        Disable public access
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-base-800/70 px-3 py-2">
      <span className="text-xs text-base-200">
        Friends will only be able to join from your local network. Turn off?
      </span>
      <button
        className="btn-danger !px-2.5 !py-1 !text-xs"
        onClick={() => {
          setConfirming(false);
          void onDisable();
        }}
        disabled={busy}
      >
        {busy ? 'Turning off…' : 'Confirm'}
      </button>
      <button
        className="btn-secondary !px-2.5 !py-1 !text-xs"
        onClick={() => setConfirming(false)}
        disabled={busy}
      >
        Cancel
      </button>
    </div>
  );
}

function BoreSection({
  server,
  status,
  reload,
}: {
  server: GameServer;
  status: BoreStatus;
  reload: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    setError(null);
    setBusy(true);
    try {
      await boreApi.enable(server.id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable public access');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await boreApi.disable(server.id);
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (!status.enabled) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-base-500">
          Powered by{' '}
          <a
            href="https://github.com/ekzhang/bore"
            target="_blank"
            rel="noreferrer"
            className="text-accent-400 hover:underline"
          >
            bore
          </a>{' '}
          and its free public bore.pub relay — genuinely nothing to sign up for. Trade-off: it's a
          small community-run service (no uptime guarantee like a company-backed product), and the
          address it gives you can change if the tunnel restarts.
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary" onClick={enable} disabled={busy}>
          {busy ? 'Starting…' : 'Enable public access'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            status.failed ? 'bg-red-500' : status.connected ? 'bg-accent-500' : 'bg-ember-500'
          }`}
        />
        <span className="text-base-100">
          {status.failed
            ? 'Failed to connect — try again'
            : status.connected
              ? 'Connected via bore.pub'
              : 'Starting up…'}
        </span>
      </div>

      {status.connected && status.borePort && (
        <div className="rounded-xl border border-base-700 bg-base-800/50 p-4 text-sm">
          <p className="mb-1 text-base-500">Share this address with your friends:</p>
          <code className="text-base font-semibold text-accent-400">
            bore.pub:{status.borePort}
          </code>
        </div>
      )}

      <DisableButton onDisable={disable} busy={busy} />
    </div>
  );
}

function PlayitSection({
  server,
  status,
  reload,
}: {
  server: GameServer;
  status: TunnelStatus;
  reload: () => void;
}) {
  const [secretKey, setSecretKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill from the panel-wide default (Settings → Public access defaults) so this is a paste
  // once instead of per-server.
  useEffect(() => {
    settingsApi.get().then((s) => {
      if (s.defaultPlayitKey) setSecretKey((current) => current || s.defaultPlayitKey!);
    });
  }, []);

  const enable = async () => {
    if (!secretKey.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await tunnelApi.enable(server.id, secretKey.trim());
      setSecretKey('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable public access');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await tunnelApi.disable(server.id);
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (!status.enabled) {
    return (
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="playit-key">
            playit.gg secret key
          </label>
          <input
            id="playit-key"
            className="input"
            type="password"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            placeholder="Paste your secret key"
          />
          <p className="mt-1.5 text-xs text-base-500">
            Free, no credit card —{' '}
            <a
              href={status.keyUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent-400 hover:underline"
            >
              get a key from your playit.gg account
            </a>
            , then paste it here. This is the one step Outpost can't do for you — the key belongs to
            your personal account.
          </p>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn-primary" onClick={enable} disabled={busy || !secretKey.trim()}>
          {busy ? 'Starting…' : 'Enable public access'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block h-2 w-2 rounded-full ${status.connected ? 'bg-accent-500' : 'bg-ember-500'}`}
        />
        <span className="text-base-100">
          {status.connected ? 'Connected to playit.gg' : 'Starting up…'}
        </span>
      </div>

      <div className="rounded-xl border border-base-700 bg-base-800/50 p-4 text-sm">
        <p className="mb-2 font-medium text-base-100">
          One-time step: point a tunnel at this server
        </p>
        <ol className="ml-4 list-decimal space-y-1 text-base-500">
          <li>
            Open{' '}
            <a
              href={status.tunnelsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent-400 hover:underline"
            >
              your playit.gg tunnels page
            </a>{' '}
            and click "Add Tunnel"
          </li>
          <li>
            Set the local address to{' '}
            <code className="text-base-200">localhost:{status.gamePort}</code>
          </li>
          <li>
            Share the address playit.gg gives you with your friends — that's what they connect to
          </li>
        </ol>
      </div>

      <DisableButton onDisable={disable} busy={busy} />
    </div>
  );
}
