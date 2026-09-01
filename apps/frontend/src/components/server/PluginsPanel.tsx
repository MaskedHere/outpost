import { FormEvent, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { modrinthApi, pluginsApi, type ModrinthSearchHit, type ServerPlugin } from '../../lib/api';
import { staggerContainer, staggerItem } from '../../lib/motion';

/** Plugins only exist for Paper Minecraft servers — vanilla has no plugin loader, and the other
 *  variants (Fabric/Forge/NeoForge/Quilt) are mod loaders, a different ecosystem. Mirrors
 *  ModpackPanel's shape (search Modrinth, add/remove a list) but simpler: no dependency
 *  resolution, no deploy/export — plugins are managed directly on one already-existing server. */
export default function PluginsPanel({ serverId }: { serverId: string }) {
  const [plugins, setPlugins] = useState<ServerPlugin[] | null>(null);
  const [mcVersion, setMcVersion] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModrinthSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const load = () => {
    pluginsApi
      .list(serverId)
      .then((r) => {
        setPlugins(r.plugins);
        setMcVersion(r.mcVersion);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load plugins'));
  };

  useEffect(load, [serverId]);

  const runSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!mcVersion) return;
    setSearching(true);
    setError(null);
    try {
      const res = await modrinthApi.searchPlugins(query, mcVersion);
      setResults(res.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  // Popular plugins are worth showing before the user even searches — same idea as the modpack
  // wizard's browse view.
  useEffect(() => {
    if (mcVersion) runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcVersion]);

  const addPlugin = async (projectId: string) => {
    setAddingId(projectId);
    setError(null);
    try {
      await pluginsApi.add(serverId, projectId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add plugin');
    } finally {
      setAddingId(null);
    }
  };

  const removePlugin = async (itemId: string) => {
    await pluginsApi.remove(serverId, itemId);
    load();
  };

  if (!plugins) return <p className="text-base-500">Loading…</p>;

  const addedProjectIds = new Set(plugins.map((p) => p.projectId));

  return (
    <div>
      <div className="mb-4 rounded-lg bg-base-800/70 px-3 py-2.5 text-xs text-base-500">
        Changes here apply the next time this server restarts from scratch (e.g. after a memory change) — not
        instantly on a plain restart, since the plugin list is baked in at container creation.
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-base-500">Browse plugins</h3>
          <form onSubmit={runSearch} className="mb-3 flex gap-2">
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search plugins…"
            />
            <button type="submit" className="btn-secondary shrink-0" disabled={searching}>
              {searching ? '…' : 'Search'}
            </button>
          </form>
          <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card divide-y divide-base-800">
            {results.map((hit) => (
              <motion.div variants={staggerItem} key={hit.project_id} className="flex items-center gap-3 p-3">
                {hit.icon_url && <img src={hit.icon_url} alt="" className="h-8 w-8 rounded" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-base-100">{hit.title}</p>
                  <p className="truncate text-xs text-base-500">{hit.description}</p>
                </div>
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  className="btn-secondary shrink-0 !py-1 !text-xs"
                  disabled={addedProjectIds.has(hit.project_id) || addingId === hit.project_id}
                  onClick={() => addPlugin(hit.project_id)}
                >
                  {addedProjectIds.has(hit.project_id) ? 'Added' : addingId === hit.project_id ? '…' : 'Add'}
                </motion.button>
              </motion.div>
            ))}
            {results.length === 0 && !searching && <p className="p-6 text-center text-sm text-base-500">No plugins found.</p>}
          </motion.div>
        </div>

        <div>
          <h3 className="mb-3 text-sm font-medium uppercase tracking-wide text-base-500">Installed</h3>
          <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card divide-y divide-base-800">
            {plugins.map((item) => (
              <motion.div variants={staggerItem} key={item.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm text-base-100">{item.projectName}</p>
                  <p className="text-xs text-base-500">v{item.versionNumber}</p>
                </div>
                <button className="text-xs text-red-400/80 hover:text-red-400" onClick={() => removePlugin(item.id)}>
                  Remove
                </button>
              </motion.div>
            ))}
            {plugins.length === 0 && <p className="p-6 text-center text-sm text-base-500">No plugins installed yet.</p>}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
