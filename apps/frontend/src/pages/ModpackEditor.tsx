import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { modrinthApi, packsApi, type ModrinthSearchHit, type Pack } from '../lib/api';

export default function ModpackEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [pack, setPack] = useState<Pack | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModrinthSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeploy, setShowDeploy] = useState(false);
  const [deployName, setDeployName] = useState('');
  const [deploying, setDeploying] = useState(false);

  const load = () => {
    if (!id) return;
    packsApi.get(id).then(setPack);
  };

  useEffect(load, [id]);

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
    if (!id) return;
    setError(null);
    try {
      const updated = await packsApi.addItem(id, projectId);
      setPack(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add mod');
    }
  };

  const removeItem = async (itemId: string) => {
    if (!id) return;
    await packsApi.removeItem(id, itemId);
    load();
  };

  const deploy = async () => {
    if (!id) return;
    setDeploying(true);
    try {
      const server = await packsApi.deploy(id, deployName, 4096);
      navigate(`/servers/${server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  };

  if (!pack) return <div className="px-8 py-10 text-base-500">Loading…</div>;

  const addedProjectIds = new Set(pack.items.map((i) => i.projectId));

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <Link to="/modpacks" className="mb-4 inline-block text-sm text-base-500 hover:text-accent-400">
        ← Back to modpacks
      </Link>

      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-base-50">{pack.name}</h1>
          <p className="mt-1 text-sm text-base-500">
            {pack.mcVersion} · {pack.loader} · {pack.items.length} mods
          </p>
        </div>
        <div className="flex gap-2">
          <a className="btn-secondary" href={packsApi.exportUrl(pack.id)}>
            Share (.mrpack)
          </a>
          <button className="btn-primary" onClick={() => setShowDeploy((s) => !s)}>
            Deploy server
          </button>
        </div>
      </div>

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

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-base-500">Search Modrinth</h2>
          <form onSubmit={runSearch} className="mb-3 flex gap-2">
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
          <div className="card divide-y divide-base-800">
            {results.map((hit) => (
              <div key={hit.project_id} className="flex items-center gap-3 p-3">
                {hit.icon_url && <img src={hit.icon_url} alt="" className="h-8 w-8 rounded" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-base-100">{hit.title}</p>
                  <p className="truncate text-xs text-base-500">{hit.description}</p>
                </div>
                <button
                  className="btn-secondary shrink-0 !py-1 !text-xs"
                  disabled={addedProjectIds.has(hit.project_id)}
                  onClick={() => addMod(hit.project_id)}
                >
                  {addedProjectIds.has(hit.project_id) ? 'Added' : 'Add'}
                </button>
              </div>
            ))}
            {results.length === 0 && (
              <p className="p-6 text-center text-sm text-base-500">Search for mods to add to this pack.</p>
            )}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-base-500">In this pack</h2>
          <div className="card divide-y divide-base-800">
            {pack.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-3">
                <div>
                  <p className="text-sm text-base-100">{item.projectName}</p>
                  <p className="text-xs text-base-500">
                    v{item.versionNumber} {item.isDependency && '· dependency'}
                  </p>
                </div>
                <button className="text-xs text-red-400/80 hover:text-red-400" onClick={() => removeItem(item.id)}>
                  Remove
                </button>
              </div>
            ))}
            {pack.items.length === 0 && <p className="p-6 text-center text-sm text-base-500">No mods added yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
