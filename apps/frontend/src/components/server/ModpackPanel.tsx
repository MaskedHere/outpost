import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { modrinthApi, packsApi, type ModrinthSearchHit, type Pack, type UnresolvedEntry } from '../../lib/api';
import { staggerContainer, staggerItem } from '../../lib/motion';
import DropZone from '../DropZone';

const FORMAT_LABEL: Record<string, string> = {
  mrpack: 'Modrinth .mrpack',
  curseforge: 'CurseForge pack',
  jars: 'zip of jars',
};

/** The actual mod-search/add/remove/deploy editor — shared by the standalone /modpacks/:id page
 *  (for packs not yet attached to a server, e.g. right after import) and ServerDetail's Modpack
 *  tab (for a server that already has one). Takes packId as a prop rather than reading it from the
 *  route so it works in both places. */
export default function ModpackPanel({ packId, showDeployAction = true }: { packId: string; showDeployAction?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const importState = location.state as { unresolved?: UnresolvedEntry[]; clientOnly?: UnresolvedEntry[]; format?: string } | null;
  const [pack, setPack] = useState<Pack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModrinthSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeploy, setShowDeploy] = useState(false);
  const [deployName, setDeployName] = useState('');
  const [deploying, setDeploying] = useState(false);
  const [unresolved, setUnresolved] = useState<UnresolvedEntry[]>(importState?.unresolved ?? []);
  const [clientOnly, setClientOnly] = useState<UnresolvedEntry[]>(importState?.clientOnly ?? []);
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

  const runSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!pack) return;
    setSearching(true);
    setError(null);
    try {
      const res = await modrinthApi.search(query, pack.mcVersion, pack.loader);
      setResults(res.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
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
          <button className="mt-2 text-xs font-medium text-red-300 underline underline-offset-2" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!pack) return <p className="text-base-500">Loading…</p>;

  const addedProjectIds = new Set(pack.items.map((i) => i.projectId));

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
        <DropZone onDrop={(files) => setImportFile(files[0] ?? null)} hint="A .mrpack, CurseForge .zip, or a zip of .jar mods" className="card mb-6 space-y-3 p-5">
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
            <input type="checkbox" className="checkbox" checked={importReplace} onChange={(e) => setImportReplace(e.target.checked)} />
            Replace the pack's current mods instead of adding to them
          </label>
          <p className="text-xs text-base-500">
            {importReplace
              ? "Everything currently in this pack will be removed first, then replaced with what's in the file."
              : "Mods already in this pack are left alone — only new ones from the file get added."}
          </p>
          <div className="flex items-center gap-2">
            <button className="btn-primary" onClick={runImport} disabled={!importFile || importing}>
              {importing ? 'Importing…' : 'Import'}
            </button>
            <button className="btn-secondary" onClick={() => setShowImport(false)} disabled={importing}>
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
              {importState?.format ? `Imported from ${FORMAT_LABEL[importState.format] ?? importState.format}: ` : ''}
              {unresolved.length} mod{unresolved.length === 1 ? '' : 's'} couldn't be matched automatically
            </p>
            <button className="text-xs text-base-500 hover:text-base-200" onClick={() => setUnresolved([])}>
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
          <p className="mt-2 text-xs text-base-500">Search and add these manually below if you still want them.</p>
        </div>
      )}

      {clientOnly.length > 0 && (
        <div className="card mb-6 border-base-600/50 bg-base-800/40 p-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-base-300">
              {clientOnly.length} client-only mod{clientOnly.length === 1 ? '' : 's'} left out automatically
            </p>
            <button className="text-xs text-base-500 hover:text-base-200" onClick={() => setClientOnly([])}>
              Dismiss
            </button>
          </div>
          <p className="mb-2 text-xs text-base-500">
            These don't run on a dedicated server (shaders, cosmetics, UI mods, etc.) — players keep them on their own client as normal.
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

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-base-500">Search Modrinth</h3>
          <form onSubmit={runSearch} className="mb-3 flex gap-2">
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search mods…" />
            <button type="submit" className="btn-secondary shrink-0" disabled={searching}>
              {searching ? '…' : 'Search'}
            </button>
          </form>
          <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card divide-y divide-base-800">
            {results.map((hit) => {
              // Marked rather than hidden — see the matching list in CreateServerWizard.
              const clientOnly = hit.server_side === 'unsupported';
              return (
                <motion.div variants={staggerItem} key={hit.project_id} className="flex items-center gap-3 p-3">
                  {hit.icon_url && <img src={hit.icon_url} alt="" className={`h-8 w-8 rounded ${clientOnly ? 'opacity-40' : ''}`} />}
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${clientOnly ? 'text-base-500' : 'text-base-100'}`}>{hit.title}</p>
                    <p className="truncate text-xs text-base-500">
                      {clientOnly ? "Client-only — can't run on a server" : hit.description}
                    </p>
                  </div>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    className="btn-secondary shrink-0 !py-1 !text-xs"
                    disabled={clientOnly || addedProjectIds.has(hit.project_id)}
                    title={clientOnly ? 'This mod only works on the Minecraft client, not a dedicated server.' : undefined}
                    onClick={() => addMod(hit.project_id)}
                  >
                    {clientOnly ? 'Client only' : addedProjectIds.has(hit.project_id) ? 'Added' : 'Add'}
                  </motion.button>
                </motion.div>
              );
            })}
            {results.length === 0 && <p className="p-6 text-center text-sm text-base-500">Search for mods to add to this pack.</p>}
          </motion.div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-base-500">In this pack</h3>
          <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card divide-y divide-base-800">
            {pack.items.map((item) => (
              <motion.div variants={staggerItem} key={item.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm text-base-100">{item.projectName}</p>
                  <p className="text-xs text-base-500">
                    {item.source === 'local' ? 'Local file' : `v${item.versionNumber}`}
                    {item.isDependency && ' · dependency'}
                  </p>
                </div>
                <button className="text-xs text-red-400/80 hover:text-red-400" onClick={() => removeItem(item.id)}>
                  Remove
                </button>
              </motion.div>
            ))}
            {pack.items.length === 0 && <p className="p-6 text-center text-sm text-base-500">No mods added yet.</p>}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
