import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  curseforgeApi,
  modrinthApi,
  packsApi,
  type CurseForgeModSummary,
  type ModSearchOptions,
  type ModrinthSearchHit,
  type Pack,
  type PackUpdateStatus,
  type UnresolvedEntry,
} from '../../lib/api';
import { staggerContainer, staggerItem } from '../../lib/motion';
import DropZone from '../DropZone';
import Select from '../Select';
import InfoTip from '../InfoTip';
import Skeleton from '../Skeleton';

/** Stands in for "no category filter". */
const ANY_CATEGORY = '__any__';

/** One placeholder row, shaped like a real mod row: icon, two lines of text, an action on the end. */
function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Skeleton className="h-8 w-8 shrink-0 rounded" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <Skeleton className="h-6 w-12 shrink-0 rounded-lg" />
    </div>
  );
}

/** Stands in for the whole editor while the pack loads. */
function ModpackPanelSkeleton({ showDeployAction }: { showDeployAction: boolean }) {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        {showDeployAction && (
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 rounded-xl" />
            <Skeleton className="h-9 w-32 rounded-xl" />
            <Skeleton className="h-9 w-28 rounded-xl" />
          </div>
        )}
      </div>

      <div className="card p-5">
        <Skeleton className="mb-2 h-5 w-16" />
        <Skeleton className="mb-4 h-4 w-72" />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[0, 1].map((column) => (
            <div key={column}>
              <Skeleton className="mb-3 h-3.5 w-28" />
              <div className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3">
                {[0, 1, 2, 3, 4].map((row) => (
                  <SkeletonRow key={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A mod's artwork in the pack listing, with a monogram standing in when there is none. */
function ModIcon({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    // Lazy-loaded so large packs don't fire hundreds of icon requests for rows that are off-screen.
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-8 w-8 shrink-0 rounded"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-base-800 text-xs font-medium text-base-500">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}

const FORMAT_LABEL: Record<string, string> = {
  mrpack: 'Modrinth .mrpack',
  curseforge: 'CurseForge pack',
  jars: 'zip of jars',
};

/** The actual mod-search/add/remove/deploy editor. */
export default function ModpackPanel({
  packId,
  showDeployAction = true,
}: {
  packId: string;
  showDeployAction?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const importState = location.state as {
    unresolved?: UnresolvedEntry[];
    clientOnly?: UnresolvedEntry[];
    format?: string;
  } | null;
  const [pack, setPack] = useState<Pack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModrinthSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  // Same two-source search as the "Build modpack" wizard step, since many mods are CurseForge-only.
  const [source, setSource] = useState<'modrinth' | 'curseforge'>('modrinth');
  const [cfResults, setCfResults] = useState<CurseForgeModSummary[]>([]);
  const [cfCategory, setCfCategory] = useState('');
  const [cfCategories, setCfCategories] = useState<{ value: string; label: string }[]>([]);
  const [cfAddingSlug, setCfAddingSlug] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('relevance');
  const [serverOnly, setServerOnly] = useState(false);
  const [filterOptions, setFilterOptions] = useState<{
    categories: { value: string; label: string }[];
    sorts: { value: string; label: string }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDeploy, setShowDeploy] = useState(false);
  const [deployName, setDeployName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [unresolved, setUnresolved] = useState<UnresolvedEntry[]>(importState?.unresolved ?? []);
  const [clientOnly, setClientOnly] = useState<UnresolvedEntry[]>(importState?.clientOnly ?? []);
  // Modrinth publishes new versions of a pack over time; this is how the panel offers to move onto
  // one.
  const [updateStatus, setUpdateStatus] = useState<PackUpdateStatus | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  // Search is hidden behind this toggle so the panel stays focused on managing installed mods.
  const [adding, setAdding] = useState(false);
  const [installedFilter, setInstalledFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importReplace, setImportReplace] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = () => {
    packsApi
      .get(packId)
      .then((p) => {
        setPack(p);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load pack'));
  };

  useEffect(load, [packId]);

  useEffect(() => {
    // Best-effort: a Modrinth outage shouldn't stop the editor rendering, it just means no banner.
    packsApi
      .checkUpdate(packId)
      .then(setUpdateStatus)
      .catch(() => undefined);
  }, [packId]);

  const applyUpdate = async () => {
    setUpdating(true);
    setError(null);
    try {
      const res = await packsApi.applyUpdate(packId);
      setPack(res.pack);
      setUpdateStatus({ trackable: true, available: false, current: res.version });
      setUnresolved(res.unresolved);
      setClientOnly(res.clientOnly);
      setUpdateNote(`Updated to ${res.version}. Restart any server using this pack to apply it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update this pack');
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    // Filters are an enhancement.
    modrinthApi
      .filters()
      .then(setFilterOptions)
      .catch(() => undefined);
    curseforgeApi
      .categories()
      .then((r) => setCfCategories(r.categories))
      .catch(() => undefined);
  }, []);

  // Filter values are passed explicitly so a control can re-run the search with its new value
  // immediately.
  const runSearch = async (e?: FormEvent, overrides: ModSearchOptions = {}) => {
    e?.preventDefault();
    if (!pack) return;
    setSearching(true);
    setError(null);
    try {
      const res = await modrinthApi.search(query, pack.mcVersion, pack.loader, {
        category,
        sort,
        serverOnly,
        ...overrides,
      });
      setResults(res.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const runCfSearch = async (e?: FormEvent, categoryOverride?: string) => {
    e?.preventDefault();
    if (!pack) return;
    setSearching(true);
    setError(null);
    try {
      const res = await curseforgeApi.searchMods(
        query,
        pack.mcVersion,
        pack.loader,
        categoryOverride ?? cfCategory,
      );
      setCfResults(res.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  /**
   * Downloads the file, hashes it, and pulls in the mod's CurseForge-declared required
   * dependencies.
   */
  const addCfMod = async (hit: CurseForgeModSummary) => {
    setError(null);
    setCfAddingSlug(hit.slug);
    try {
      const result = await curseforgeApi.addMod(packId, hit.slug, hit.fileId, hit.logoUrl);
      setPack(result.pack);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add this mod');
    } finally {
      setCfAddingSlug(null);
    }
  };

  const addMod = async (projectId: string) => {
    setError(null);
    try {
      const updated = await packsApi.addItem(packId, projectId);
      setPack(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add mod');
    }
  };

  const removeItem = async (itemId: string) => {
    await packsApi.removeItem(packId, itemId);
    load();
  };

  const deploy = async () => {
    setDeploying(true);
    try {
      const server = await packsApi.deploy(packId, deployName, 4096);
      navigate(`/servers/${server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  };

  const runImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setError(null);
    try {
      const result = await packsApi.importInto(packId, importFile, importReplace);
      setPack(result.pack);
      setUnresolved(result.unresolved);
      setClientOnly(result.clientOnly);
      setShowImport(false);
      setImportFile(null);
      setImportReplace(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  if (!pack && loadError) {
    return (
      <div className="card flex items-start gap-3 border-red-500/30 bg-red-500/5 px-5 py-4">
        <span className="text-red-400">⚠</span>
        <div>
          <p className="text-sm text-red-300">{loadError}</p>
          <button
            className="mt-2 text-xs font-medium text-red-300 underline underline-offset-2"
            onClick={load}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!pack) return <ModpackPanelSkeleton showDeployAction={showDeployAction} />;

  const addedProjectIds = new Set(pack.items.map((i) => i.projectId));
  // Also matches the filename, since imported items are often named after their jar.
  const needle = installedFilter.trim().toLowerCase();
  const installedItems = needle
    ? pack.items.filter(
        (i) =>
          i.projectName.toLowerCase().includes(needle) || i.filename.toLowerCase().includes(needle),
      )
    : pack.items;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-base-50">{pack.name}</h2>
          <p className="mt-1 text-sm text-base-500">
            {pack.mcVersion} · {pack.loader} · {pack.items.length} mods
          </p>
        </div>
        {showDeployAction && (
          <div className="flex gap-2">
            <a className="btn-secondary" href={packsApi.exportUrl(pack.id)}>
              Share (.mrpack)
            </a>
            <button className="btn-secondary" onClick={() => setShowImport((s) => !s)}>
              Import modpack
            </button>
            <button className="btn-primary" onClick={() => setShowDeploy((s) => !s)}>
              Deploy server
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <DropZone
          onDrop={(files) => setImportFile(files[0] ?? null)}
          hint="A .mrpack, CurseForge .zip, or a zip of .jar mods"
          className="card mb-6 space-y-3 p-5"
        >
          <div>
            <label className="label" htmlFor="import-file">
              Modpack file (.mrpack, CurseForge .zip, or a zip of .jar mods)
            </label>
            <input
              id="import-file"
              type="file"
              accept=".mrpack,.zip"
              className="input file:mr-3 file:rounded-lg file:border-0 file:bg-base-700 file:px-3 file:py-1.5 file:text-base-50"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-base-200">
            <input
              type="checkbox"
              className="checkbox"
              checked={importReplace}
              onChange={(e) => setImportReplace(e.target.checked)}
            />
            Replace the pack's current mods instead of adding to them
          </label>
          <p className="text-xs text-base-500">
            {importReplace
              ? "Everything currently in this pack will be removed first, then replaced with what's in the file."
              : 'Mods already in this pack are left alone — only new ones from the file get added.'}
          </p>
          <div className="flex items-center gap-2">
            <button className="btn-primary" onClick={runImport} disabled={!importFile || importing}>
              {importing ? 'Importing…' : 'Import'}
            </button>
            <button
              className="btn-secondary"
              onClick={() => setShowImport(false)}
              disabled={importing}
            >
              Cancel
            </button>
          </div>
        </DropZone>
      )}

      {showDeploy && (
        <div className="card mb-6 flex items-end gap-3 p-5">
          <div className="flex-1">
            <label className="label" htmlFor="deploy-name">
              New server name
            </label>
            <input
              id="deploy-name"
              className="input"
              value={deployName}
              onChange={(e) => setDeployName(e.target.value)}
              placeholder={pack.name}
            />
          </div>
          <button className="btn-primary" onClick={deploy} disabled={deploying || !deployName}>
            {deploying ? 'Deploying…' : 'Deploy'}
          </button>
        </div>
      )}

      {unresolved.length > 0 && (
        <div className="card mb-6 border-ember-500/30 bg-ember-500/5 p-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-ember-400">
              {importState?.format
                ? `Imported from ${FORMAT_LABEL[importState.format] ?? importState.format}: `
                : ''}
              {unresolved.length} mod{unresolved.length === 1 ? '' : 's'} couldn't be matched
              automatically
            </p>
            <button
              className="text-xs text-base-500 hover:text-base-200"
              onClick={() => setUnresolved([])}
            >
              Dismiss
            </button>
          </div>
          <ul className="space-y-1 text-xs text-base-500">
            {unresolved.map((u, i) => (
              <li key={i}>
                <span className="text-base-200">{u.label}</span> — {u.reason}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-base-500">
            Search and add these manually below if you still want them.
          </p>
        </div>
      )}

      {clientOnly.length > 0 && (
        <div className="card mb-6 border-base-600/50 bg-base-800/40 p-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-base-300">
              {clientOnly.length} client-only mod{clientOnly.length === 1 ? '' : 's'} left out
              automatically
            </p>
            <button
              className="text-xs text-base-500 hover:text-base-200"
              onClick={() => setClientOnly([])}
            >
              Dismiss
            </button>
          </div>
          <p className="mb-2 text-xs text-base-500">
            These don't run on a dedicated server (shaders, cosmetics, UI mods, etc.) — players keep
            them on their own client as normal.
          </p>
          <ul className="space-y-1 text-xs text-base-500">
            {clientOnly.map((u, i) => (
              <li key={i}>
                <span className="text-base-200">{u.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Only for packs imported from Modrinth. */}
      {updateStatus?.trackable && updateStatus.available && (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-3 border-accent-500/30 bg-accent-500/5 p-5">
          <div>
            <p className="text-sm font-medium text-accent-300">
              Update available — {updateStatus.latest}
            </p>
            <p className="mt-1 text-xs text-base-400">
              {updateStatus.current ? `This pack is on ${updateStatus.current}. ` : ''}
              Updating replaces its mods and config with the new version, keeping the same pack, so
              servers using it follow along on their next restart.
            </p>
          </div>
          <button
            className="btn-primary shrink-0 !py-1.5 !text-xs"
            onClick={applyUpdate}
            disabled={updating}
          >
            {updating ? 'Updating…' : `Update to ${updateStatus.latest}`}
          </button>
        </div>
      )}

      {updateNote && (
        <div className="card mb-6 border-accent-500/30 bg-accent-500/5 p-4">
          <p className="text-sm text-accent-300">{updateNote}</p>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="relative card p-5">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="font-medium text-base-50">Mods</h3>
          <span className="text-sm text-base-500">{pack.items.length}</span>
          <InfoTip text="What's installed on this pack. Removing something here takes effect on the server's next restart. Mods that only work on a Minecraft client — shaders, cosmetics, UI tweaks — can't be added, because a dedicated server either ignores them or refuses to start." />
          <button
            className="btn-primary ml-auto shrink-0 !py-1.5 !text-xs"
            onClick={() => setAdding(true)}
          >
            Add content
          </button>
        </div>
        <p className="mb-3 text-sm text-base-500">Restart the server after changing this list.</p>

        {/* Filters what's already installed. */}
        <input
          className="input mb-3"
          value={installedFilter}
          onChange={(e) => setInstalledFilter(e.target.value)}
          placeholder={`Search ${pack.items.length} installed mod${pack.items.length === 1 ? '' : 's'}…`}
        />

        {/* The add flow covers the panel rather than sitting beside it permanently. */}
        {adding && (
          <div className="absolute inset-0 z-10 overflow-y-auto rounded-2xl border border-base-700 bg-base-900 p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium uppercase tracking-wide text-base-500">
                Add from {source === 'curseforge' ? 'CurseForge' : 'Modrinth'}
              </h4>
              <div className="flex items-center gap-1 rounded-lg bg-base-800 p-1 text-xs">
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    source === 'modrinth'
                      ? 'bg-base-700 text-base-50'
                      : 'text-base-500 hover:text-base-200'
                  }`}
                  onClick={() => setSource('modrinth')}
                >
                  Modrinth
                </button>
                <button
                  type="button"
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                    source === 'curseforge'
                      ? 'bg-base-700 text-base-50'
                      : 'text-base-500 hover:text-base-200'
                  }`}
                  onClick={() => setSource('curseforge')}
                >
                  CurseForge
                </button>
              </div>
              <button
                className="btn-secondary shrink-0 !py-1 !text-xs"
                onClick={() => setAdding(false)}
              >
                Done
              </button>
            </div>

            <form
              onSubmit={source === 'curseforge' ? runCfSearch : runSearch}
              className="mb-3 flex gap-2"
            >
              <input
                className="input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search mods…"
              />
              <button type="submit" className="btn-secondary shrink-0" disabled={searching}>
                {searching ? '…' : 'Search'}
              </button>
            </form>

            {/* Modrinth-only: these map to real Modrinth search parameters that the CurseForge
              scraper has no equivalent for. */}
            {source === 'curseforge' && cfCategories.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="w-44">
                  <Select
                    value={cfCategory || ANY_CATEGORY}
                    onChange={(value) => {
                      const next = value === ANY_CATEGORY ? '' : value;
                      setCfCategory(next);
                      runCfSearch(undefined, next);
                    }}
                    options={[{ value: ANY_CATEGORY, label: 'All categories' }, ...cfCategories]}
                  />
                </div>
              </div>
            )}

            {source === 'modrinth' && filterOptions && (
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="w-40">
                  <Select
                    value={category || ANY_CATEGORY}
                    onChange={(value) => {
                      const next = value === ANY_CATEGORY ? '' : value;
                      setCategory(next);
                      runSearch(undefined, { category: next });
                    }}
                    options={[
                      { value: ANY_CATEGORY, label: 'All categories' },
                      ...filterOptions.categories,
                    ]}
                  />
                </div>
                <div className="w-40">
                  <Select
                    value={sort}
                    onChange={(value) => {
                      setSort(value);
                      runSearch(undefined, { sort: value });
                    }}
                    options={filterOptions.sorts}
                  />
                </div>
                <label className="flex items-center gap-1.5 rounded-lg bg-base-800/60 px-2.5 py-1 text-xs text-base-200">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={serverOnly}
                    disabled={searching}
                    onChange={(e) => {
                      setServerOnly(e.target.checked);
                      runSearch(undefined, { serverOnly: e.target.checked });
                    }}
                  />
                  Server-compatible only
                </label>
              </div>
            )}
            {source === 'curseforge' ? (
              <motion.div
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3"
              >
                {cfResults.map((hit) => {
                  // CurseForge publishes no side data of its own, so these tags are borrowed from
                  // Modrinth where the same slug exists (see withSideTags)
                  const clientOnly = hit.serverSide === 'unsupported';
                  const added = pack.items.some((item) => item.projectSlug === hit.slug);
                  return (
                    <motion.div
                      variants={staggerItem}
                      key={hit.slug}
                      className="flex items-center gap-3 py-2.5"
                    >
                      {hit.logoUrl && (
                        <img
                          src={hit.logoUrl}
                          alt=""
                          className={`h-8 w-8 rounded ${clientOnly ? 'opacity-40' : ''}`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-sm ${clientOnly ? 'text-base-500' : 'text-base-100'}`}
                        >
                          {hit.name}
                        </p>
                        <p className="truncate text-xs text-base-500">
                          {clientOnly ? "Client-only — can't run on a server" : hit.summary}
                        </p>
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        className="btn-secondary shrink-0 !py-1 !text-xs"
                        disabled={clientOnly || added || cfAddingSlug === hit.slug}
                        title={
                          clientOnly
                            ? 'This mod only works on the Minecraft client, not a dedicated server.'
                            : undefined
                        }
                        onClick={() => addCfMod(hit)}
                      >
                        {clientOnly
                          ? 'Client only'
                          : added
                            ? 'Added'
                            : cfAddingSlug === hit.slug
                              ? '…'
                              : 'Add'}
                      </motion.button>
                    </motion.div>
                  );
                })}
                {cfResults.length === 0 && (
                  <p className="py-6 text-center text-sm text-base-500">
                    Search for mods to add to this pack.
                  </p>
                )}
              </motion.div>
            ) : (
              <motion.div
                variants={staggerContainer}
                initial="initial"
                animate="animate"
                className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3"
              >
                {results.map((hit) => {
                  // Marked rather than hidden.
                  const clientOnly = hit.server_side === 'unsupported';
                  return (
                    <motion.div
                      variants={staggerItem}
                      key={hit.project_id}
                      className="flex items-center gap-3 py-2.5"
                    >
                      {hit.icon_url && (
                        <img
                          src={hit.icon_url}
                          alt=""
                          className={`h-8 w-8 rounded ${clientOnly ? 'opacity-40' : ''}`}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-sm ${clientOnly ? 'text-base-500' : 'text-base-100'}`}
                        >
                          {hit.title}
                        </p>
                        <p className="truncate text-xs text-base-500">
                          {clientOnly ? "Client-only — can't run on a server" : hit.description}
                        </p>
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        className="btn-secondary shrink-0 !py-1 !text-xs"
                        disabled={clientOnly || addedProjectIds.has(hit.project_id)}
                        title={
                          clientOnly
                            ? 'This mod only works on the Minecraft client, not a dedicated server.'
                            : undefined
                        }
                        onClick={() => addMod(hit.project_id)}
                      >
                        {clientOnly
                          ? 'Client only'
                          : addedProjectIds.has(hit.project_id)
                            ? 'Added'
                            : 'Add'}
                      </motion.button>
                    </motion.div>
                  );
                })}
                {results.length === 0 && (
                  <p className="py-6 text-center text-sm text-base-500">
                    Search for mods to add to this pack.
                  </p>
                )}
              </motion.div>
            )}
          </div>
        )}

        <motion.div
          variants={staggerContainer}
          initial="initial"
          animate="animate"
          className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3"
        >
          {installedItems.map((item) => (
            <motion.div
              variants={staggerItem}
              key={item.id}
              className="flex items-center gap-3 py-2.5"
            >
              <ModIcon url={item.iconUrl} name={item.projectName} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-base-100">{item.projectName}</p>
                <p className="text-xs text-base-500">
                  {item.source === 'local' ? 'Local file' : `v${item.versionNumber}`}
                  {item.isDependency && ' · dependency'}
                </p>
              </div>
              <button
                className="shrink-0 text-xs text-red-400/80 hover:text-red-400"
                onClick={() => removeItem(item.id)}
              >
                Remove
              </button>
            </motion.div>
          ))}
          {installedItems.length === 0 && (
            <p className="py-6 text-center text-sm text-base-500">
              {pack.items.length === 0
                ? 'Nothing installed yet — use Add content to search for mods.'
                : `No installed mod matches "${installedFilter}".`}
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
