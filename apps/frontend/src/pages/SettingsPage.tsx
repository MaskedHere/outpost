import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FaArrowLeft } from 'react-icons/fa';
import {
  authApi,
  settingsApi,
  gameCacheApi,
  gamesApi,
  storageApi,
  type PanelSettings,
  type CachedGame,
  type GameDef,
  type OrphanDir,
} from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import MemorySlider, { maxMemoryMb } from '../components/MemorySlider';
import Select from '../components/Select';
import Skeleton from '../components/Skeleton';
import { pageVariants } from '../lib/motion';
import { readPreference, writePreference, type EffectsPreference } from '../lib/visualEffects';

export default function SettingsPage() {
  return (
    <motion.div
      variants={pageVariants}
      initial="initial"
      animate="animate"
      className="mx-auto max-w-2xl px-8 py-10"
    >
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-base-500 hover:text-accent-400"
      >
        <FaArrowLeft className="h-3.5 w-3.5" />
        Back to servers
      </Link>
      <h1 className="mb-1 text-2xl font-semibold text-base-50">Settings</h1>
      <p className="mb-6 text-sm text-base-500">
        Panel-wide preferences — not tied to any one server.
      </p>

      <div className="space-y-6">
        <AccountSection />
        <AppearanceSection />
        <PublicAccessDefaults />
        <ServerDefaults />
        <GameFileCache />
        <OrphanedData />
      </div>
    </motion.div>
  );
}

/** Ambient background effects. */
function AppearanceSection() {
  const [preference, setPreference] = useState<EffectsPreference>(readPreference);

  function choose(value: EffectsPreference) {
    setPreference(value);
    writePreference(value);
  }

  const OPTIONS: { value: EffectsPreference; label: string; hint: string }[] = [
    {
      value: 'auto',
      label: 'Auto',
      hint: 'Measures your frame rate and disables them if the page struggles.',
    },
    { value: 'on', label: 'Always on', hint: 'Keep the swaying trees regardless.' },
    {
      value: 'off',
      label: 'Off',
      hint: 'Plain background. Fastest, especially without hardware acceleration.',
    },
  ];

  return (
    <section className="card p-6">
      <h2 className="mb-1 text-lg font-medium text-base-50">Appearance</h2>
      <p className="mb-4 text-sm text-base-500">
        Background effects are decorative. Turning them off costs nothing but the scenery and makes
        the panel noticeably lighter on machines without GPU acceleration.
      </p>
      <div className="space-y-2">
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              preference === option.value
                ? 'border-accent-500 bg-accent-500/5'
                : 'border-base-700 hover:border-base-600'
            }`}
          >
            <input
              type="radio"
              name="visual-effects"
              className="mt-0.5"
              checked={preference === option.value}
              onChange={() => choose(option.value)}
            />
            <span>
              <span className="block text-sm text-base-100">{option.label}</span>
              <span className="block text-xs text-base-500">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function AccountSection() {
  const { status, refresh } = useAuth();
  const [username, setUsername] = useState(status?.username ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setUsername(status?.username ?? ''), [status?.username]);

  const usernameChanged = username.trim() !== '' && username.trim() !== status?.username;
  const passwordChanged = newPassword.trim() !== '';
  const dirty = usernameChanged || passwordChanged;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || !currentPassword) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await authApi.updateAccount({
        username: usernameChanged ? username.trim() : undefined,
        newPassword: passwordChanged ? newPassword : undefined,
        currentPassword,
      });
      await refresh();
      setNewPassword('');
      setCurrentPassword('');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card p-5" onSubmit={handleSubmit}>
      <h3 className="mb-1 font-medium text-base-50">Account</h3>
      <p className="mb-4 text-sm text-base-500">Your login for this panel.</p>

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="account-username">
            Username
          </label>
          <input
            id="account-username"
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="account-new-password">
            New password
          </label>
          <input
            id="account-new-password"
            type="password"
            className="input"
            placeholder="Leave blank to keep your current password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        {dirty && (
          <div>
            <label className="label" htmlFor="account-current-password">
              Current password
            </label>
            <input
              id="account-current-password"
              type="password"
              className="input"
              placeholder="Confirm it's you"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button className="btn-primary" disabled={!dirty || !currentPassword || busy}>
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save account changes'}
        </button>
      </div>
    </form>
  );
}

function PublicAccessDefaults() {
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsApi.get().then((s) => {
      setSettings(s);
      setKey(s.defaultPlayitKey ?? '');
    });
  }, []);

  const dirty = settings !== null && key !== (settings.defaultPlayitKey ?? '');

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await settingsApi.update({ defaultPlayitKey: key || null });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <h3 className="mb-1 font-medium text-base-50">Public access defaults</h3>
      <p className="mb-4 text-sm text-base-500">
        Pre-fills the playit.gg secret key when enabling public access on a server, so it's a paste
        once instead of per-server.
      </p>

      <label className="label" htmlFor="default-playit-key">
        playit.gg secret key
      </label>
      <input
        id="default-playit-key"
        type="password"
        className="input"
        placeholder="Paste your secret key"
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4">
        <button className="btn-primary" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** Server data directories with no server pointing at them. */
function OrphanedData() {
  const [orphans, setOrphans] = useState<OrphanDir[] | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [games, setGames] = useState<GameDef[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreGame, setRestoreGame] = useState('');
  const [restoreName, setRestoreName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () =>
    storageApi
      .orphans()
      .then((r) => {
        setOrphans(r.orphans);
        setTotalBytes(r.totalBytes);
      })
      .catch(() => setOrphans([]));

  useEffect(() => {
    load();
    gamesApi
      .list()
      .then(setGames)
      .catch(() => undefined);
  }, []);

  const beginRestore = (o: OrphanDir) => {
    setRestoring(o.id);
    setConfirmingDelete(null);
    setError(null);
    setRestoreGame(o.guessedGame ?? '');
    setRestoreName(o.guessedGameName ? `Restored ${o.guessedGameName}` : 'Restored server');
  };

  const doRestore = async (o: OrphanDir) => {
    if (!restoreGame) return;
    setBusy(o.id);
    setError(null);
    try {
      await storageApi.restore(o.id, {
        game: restoreGame,
        name: restoreName.trim() || 'Restored server',
        memoryMb: 2048,
      });
      setRestoring(null);
      setNote(
        `Restored "${restoreName}". It appears on your servers list, stopped — check its settings before starting it.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to restore');
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (o: OrphanDir) => {
    setBusy(o.id);
    setError(null);
    try {
      await storageApi.remove(o.id);
      setConfirmingDelete(null);
      setNote(`Deleted ${formatBytes(o.sizeBytes)} of leftover data.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setBusy(null);
    }
  };

  if (orphans !== null && orphans.length === 0) return null;

  return (
    <div className="card p-5">
      <h3 className="mb-1 font-medium text-base-50">Leftover server data</h3>
      <p className="mb-4 text-sm text-base-500">
        {orphans === null
          ? 'Checking…'
          : `${orphans.length} folder${orphans.length === 1 ? '' : 's'} on disk that no server is using — ${formatBytes(totalBytes)} in total. Deleting a server keeps its files unless you ask otherwise, and reinstalling Outpost leaves them all behind. Restore one to get the server back, or delete it to reclaim the space.`}
      </p>

      {note && <p className="mb-3 text-xs text-accent-400">{note}</p>}
      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

      <div className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3">
        {(orphans ?? []).map((o) => (
          <div key={o.id} className="py-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-base-100">
                  {o.guessedGameName ?? 'Unrecognised'}
                  <span className="ml-2 text-xs text-base-500">{formatBytes(o.sizeBytes)}</span>
                  {o.empty && (
                    <span className="ml-2 text-xs text-base-600">empty — safe to delete</span>
                  )}
                </p>
                <p className="truncate font-mono text-[11px] text-base-600">{o.id}</p>
              </div>
              {!o.empty && (
                <button
                  className="btn-secondary shrink-0 !py-1 !text-xs"
                  disabled={busy === o.id}
                  onClick={() => beginRestore(o)}
                >
                  Restore
                </button>
              )}
              <button
                className="shrink-0 text-xs text-red-400/80 hover:text-red-400"
                disabled={busy === o.id}
                onClick={() => {
                  setRestoring(null);
                  setConfirmingDelete(confirmingDelete === o.id ? null : o.id);
                }}
              >
                Delete
              </button>
            </div>

            {restoring === o.id && (
              <div className="mt-2 space-y-2 rounded-lg bg-base-800/50 p-3">
                <p className="text-xs text-base-400">
                  Outpost can tell what game this was from its files, but not which loader or
                  version it ran — pick the game, then adjust the rest in the server's settings
                  afterwards. The files stay exactly where they are.
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="input !py-1 !text-xs"
                    style={{ flex: '1 1 12rem' }}
                    value={restoreName}
                    onChange={(e) => setRestoreName(e.target.value)}
                    placeholder="Server name"
                  />
                  <div className="w-40">
                    <Select
                      value={restoreGame}
                      onChange={setRestoreGame}
                      options={games.map((g) => ({ value: g.id, label: g.displayName }))}
                    />
                  </div>
                  <button
                    className="btn-primary !py-1 !text-xs"
                    disabled={!restoreGame || busy === o.id}
                    onClick={() => doRestore(o)}
                  >
                    {busy === o.id ? 'Restoring…' : 'Restore'}
                  </button>
                  <button
                    className="btn-secondary !py-1 !text-xs"
                    onClick={() => setRestoring(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {confirmingDelete === o.id && (
              <div className="mt-2 rounded-lg bg-red-500/5 p-3">
                <p className="mb-2 text-xs text-red-300">
                  Permanently delete {formatBytes(o.sizeBytes)}, including any worlds and saves
                  inside. This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    className="btn-danger !px-2.5 !py-1 !text-xs"
                    disabled={busy === o.id}
                    onClick={() => doDelete(o)}
                  >
                    {busy === o.id ? 'Deleting…' : 'Yes, delete it'}
                  </button>
                  <button
                    className="btn-secondary !px-2.5 !py-1 !text-xs"
                    onClick={() => setConfirmingDelete(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GameFileCache() {
  const [games, setGames] = useState<CachedGame[] | null>(null);
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const load = () =>
    gameCacheApi
      .list()
      .then((r) => setGames(r.games))
      .catch(() => undefined);

  useEffect(() => {
    load();
    settingsApi
      .get()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  // Downloads run detached on the server and take tens of minutes, so poll while any is in flight.
  const anyBusy = games?.some((g) => g.busy) ?? false;
  useEffect(() => {
    if (!anyBusy) return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [anyBusy]);

  const toggleUseCache = async (value: boolean) => {
    setError(null);
    try {
      setSettings(await settingsApi.update({ useGameCache: value }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };

  return (
    <div className="card p-5">
      <h3 className="mb-1 font-medium text-base-50">Game file cache</h3>
      <p className="mb-4 text-sm text-base-500">
        Some games download their whole install from Steam every time you make a server — 7 Days to
        Die alone is about 14 GB of it. Keeping one shared copy here means every server after the
        first starts almost immediately.
      </p>

      <label className="mb-4 flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 accent-accent-500"
          checked={settings?.useGameCache ?? true}
          onChange={(e) => toggleUseCache(e.target.checked)}
        />
        <span className="text-sm text-base-200">
          Use cached game files for new servers
          <span className="mt-0.5 block text-xs text-base-500">
            Turn this off to keep nothing pre-staged on disk — every server then downloads its own
            copy.
          </span>
        </span>
      </label>

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      {games === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-base-800">
          {games.map((game) => (
            <li
              key={game.gameId}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="text-sm text-base-100">{game.displayName}</p>
                <p className="text-xs text-base-500">
                  {game.busy
                    ? 'Downloading… this takes a while, you can leave this page'
                    : game.cached
                      ? `Ready · ${game.sizeBytes !== null ? formatBytes(game.sizeBytes) : game.approxSizeLabel} on disk`
                      : `Not downloaded yet · ${game.approxSizeLabel}`}
                </p>
              </div>
              {game.busy ? (
                <span className="pill shrink-0 !text-xs text-ember-400">Working…</span>
              ) : confirmingDelete === game.gameId ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    className="btn-danger !px-2.5 !py-1 !text-xs"
                    onClick={() => {
                      setConfirmingDelete(null);
                      act(() => gameCacheApi.remove(game.gameId));
                    }}
                  >
                    Delete
                  </button>
                  <button
                    className="btn-secondary !px-2.5 !py-1 !text-xs"
                    onClick={() => setConfirmingDelete(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : game.cached ? (
                <button
                  className="btn-secondary shrink-0 !px-2.5 !py-1 !text-xs"
                  onClick={() => setConfirmingDelete(game.gameId)}
                >
                  Remove
                </button>
              ) : (
                <button
                  className="btn-secondary shrink-0 !px-2.5 !py-1 !text-xs"
                  onClick={() => act(() => gameCacheApi.prewarm(game.gameId))}
                >
                  Download now
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ServerDefaults() {
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [memoryMb, setMemoryMb] = useState(2048);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    settingsApi.get().then((s) => {
      setSettings(s);
      setMemoryMb(s.defaultMemoryMb);
    });
  }, []);

  const dirty = settings !== null && memoryMb !== settings.defaultMemoryMb;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await settingsApi.update({ defaultMemoryMb: memoryMb });
      setSettings(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <h3 className="mb-1 font-medium text-base-50">New server defaults</h3>
      <p className="mb-4 text-sm text-base-500">
        Starting memory allocation shown in the "New server" wizard.
      </p>

      <MemorySlider
        value={memoryMb}
        onChange={setMemoryMb}
        min={512}
        max={maxMemoryMb(settings?.hostMemoryMb)}
        step={512}
        disabled={busy}
      />

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-4">
        <button className="btn-primary" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>
    </div>
  );
}
