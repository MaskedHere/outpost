import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FaArrowLeft } from 'react-icons/fa';
import { workshopPacksApi, type WorkshopItemHit, type WorkshopPack } from '../lib/api';
import { pageVariants, staggerContainer, staggerItem } from '../lib/motion';
import InfoTip from '../components/InfoTip';
import Skeleton from '../components/Skeleton';

/** Mirrors ModpackPanel's ModIcon: a lettered tile keeps rows aligned when a preview is missing or
 *  its URL has gone stale, rather than leaving a hole. */
/**
 * Steam serves full-size images (~512px); request 64px using Steam's own resize params so 32px
 * icons stay crisp on high-DPI displays.
 */
function thumb(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}ima=fit&impolicy=Letterbox&imw=64&imh=64`;
}

function ItemIcon({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={thumb(url)}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-8 w-8 shrink-0 rounded object-cover"
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

/** Builds a reusable list of Steam Workshop items for one game. */
export default function WorkshopPackEditor() {
  const { id } = useParams<{ id: string }>();
  const [pack, setPack] = useState<WorkshopPack | null>(null);
  const [requiresModIds, setRequiresModIds] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WorkshopItemHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [collectionId, setCollectionId] = useState('');
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    workshopPacksApi
      .get(id)
      .then((p) => {
        setPack(p);
        setLoadError(null);
        return workshopPacksApi.games().then((r) => {
          setRequiresModIds(r.games.find((g) => g.id === p.game)?.requiresModIds ?? false);
        });
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load pack'));
  }, [id]);

  const runSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!id) return;
    setSearching(true);
    setError(null);
    try {
      const res = await workshopPacksApi.search(id, query);
      setResults(res.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const addItem = async (hit: WorkshopItemHit) => {
    if (!id) return;
    setAdding(hit.workshopItemId);
    setError(null);
    try {
      setPack(await workshopPacksApi.addItem(id, hit.workshopItemId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add this item');
    } finally {
      setAdding(null);
    }
  };

  const removeItem = async (itemId: string) => {
    if (!id) return;
    setPack(await workshopPacksApi.removeItem(id, itemId).catch(() => pack));
  };

  const importCollection = async () => {
    if (!id || !collectionId.trim()) return;
    setImporting(true);
    setError(null);
    setImportNote(null);
    try {
      const res = await workshopPacksApi.importCollection(id, collectionId.trim());
      setPack(res.pack);
      setCollectionId('');
      setImportNote(
        res.unresolved.length > 0
          ? `Added ${res.imported} items. ${res.unresolved.length} had no Mod ID in the usual format — set those below or they won't load.`
          : `Added ${res.imported} items.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import that collection');
    } finally {
      setImporting(false);
    }
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <div className="card border-red-500/30 bg-red-500/5 px-5 py-4">
          <p className="text-sm text-red-300">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!pack) {
    // Mirrors the loaded layout.
    return (
      <div className="mx-auto max-w-5xl px-8 py-10">
        <Skeleton className="mb-4 h-4 w-32" />
        <div className="mb-6 space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="card p-5">
          <Skeleton className="mb-2 h-5 w-36" />
          <Skeleton className="mb-4 h-4 w-80" />
          <Skeleton className="mb-3 h-10 w-full rounded-xl" />
          <Skeleton className="mb-3 h-10 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {[0, 1].map((column) => (
              <div key={column}>
                <Skeleton className="mb-3 h-3.5 w-28" />
                <div className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3">
                  {[0, 1, 2, 3, 4].map((row) => (
                    <div key={row} className="flex items-center gap-3 py-2.5">
                      <Skeleton className="h-8 w-8 shrink-0 rounded" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-1/2" />
                        <Skeleton className="h-3 w-3/4" />
                      </div>
                      <Skeleton className="h-6 w-12 shrink-0 rounded-lg" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const addedIds = new Set(pack.items.map((i) => i.workshopItemId));
  const missingModIds = pack.items.filter((i) => requiresModIds && !i.modId);

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

      <div className="mb-6">
        <h2 className="text-lg font-semibold text-base-50">{pack.name}</h2>
        <p className="mt-1 text-sm text-base-500">
          {pack.game} · {pack.items.length} item{pack.items.length === 1 ? '' : 's'}
        </p>
      </div>

      {missingModIds.length > 0 && (
        <div className="card mb-6 border-ember-500/30 bg-ember-500/5 p-5">
          <p className="mb-2 text-sm font-medium text-ember-400">
            {missingModIds.length} item
            {missingModIds.length === 1 ? ' still needs' : 's still need'} a Mod ID
          </p>
          <p className="text-xs text-base-500">
            Project Zomboid needs each mod's own internal ID as well as its Workshop ID. These
            authors didn't publish one in the usual format — find it on the mod's Workshop page and
            enter it below, or the mod downloads but never turns on.
          </p>
        </div>
      )}

      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="font-medium text-base-50">Workshop items</h3>
          <InfoTip text="This is a list Outpost keeps, not a Steam collection — publishing to Steam needs a Steam account and Valve's own flow. You can seed it from an existing collection, and apply it to any server of this game. The files themselves are downloaded by the server at boot, so the list stays valid when an author updates their mod." />
        </div>
        <p className="mb-4 text-sm text-base-500">
          Search the Steam Workshop, or start from a collection you already have.
        </p>

        <div className="mb-3 flex gap-2">
          <input
            className="input"
            value={collectionId}
            onChange={(e) => setCollectionId(e.target.value)}
            placeholder="Steam collection ID to import (optional)"
          />
          <button
            className="btn-secondary shrink-0"
            onClick={importCollection}
            disabled={importing || !collectionId.trim()}
          >
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
        {importNote && <p className="mb-3 text-xs text-base-400">{importNote}</p>}

        <form onSubmit={runSearch} className="mb-3 flex gap-2">
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the Workshop…"
          />
          <button type="submit" className="btn-secondary shrink-0" disabled={searching}>
            {searching ? '…' : 'Search'}
          </button>
        </form>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h4 className="mb-3 text-sm font-medium uppercase tracking-wide text-base-500">
              Search results
            </h4>
            <motion.div
              variants={staggerContainer}
              initial="initial"
              animate="animate"
              className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3"
            >
              {results.map((hit) => (
                <motion.div
                  variants={staggerItem}
                  key={hit.workshopItemId}
                  className="flex items-center gap-3 py-2.5"
                >
                  <ItemIcon url={hit.previewUrl} name={hit.title} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-base-100">{hit.title}</p>
                    <p className="truncate text-xs text-base-500">
                      {hit.subscriptions !== null
                        ? `${hit.subscriptions.toLocaleString()} subscribers`
                        : hit.workshopItemId}
                    </p>
                  </div>
                  <button
                    className="btn-secondary shrink-0 !py-1 !text-xs"
                    disabled={addedIds.has(hit.workshopItemId) || adding === hit.workshopItemId}
                    onClick={() => addItem(hit)}
                  >
                    {addedIds.has(hit.workshopItemId)
                      ? 'Added'
                      : adding === hit.workshopItemId
                        ? '…'
                        : 'Add'}
                  </button>
                </motion.div>
              ))}
              {results.length === 0 && (
                <p className="py-6 text-center text-sm text-base-500">
                  {searching ? 'Searching…' : 'Search the Workshop to add items.'}
                </p>
              )}
            </motion.div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-medium uppercase tracking-wide text-base-500">
              In this pack
            </h4>
            <motion.div
              variants={staggerContainer}
              initial="initial"
              animate="animate"
              className="divide-y divide-base-800 rounded-xl border border-base-800 bg-base-950/60 px-3"
            >
              {pack.items.map((item) => (
                <motion.div
                  variants={staggerItem}
                  key={item.id}
                  className="flex items-center gap-3 py-2.5"
                >
                  <ItemIcon url={item.previewUrl} name={item.title} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-base-100">{item.title}</p>
                    {requiresModIds ? (
                      <ModIdField packId={pack.id} item={item} onSaved={setPack} />
                    ) : (
                      <p className="truncate text-xs text-base-500">{item.workshopItemId}</p>
                    )}
                  </div>
                  <button
                    className="shrink-0 text-xs text-red-400/80 hover:text-red-400"
                    onClick={() => removeItem(item.id)}
                  >
                    Remove
                  </button>
                </motion.div>
              ))}
              {pack.items.length === 0 && (
                <p className="py-6 text-center text-sm text-base-500">Nothing added yet.</p>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/** Inline editor for the one field Outpost can't always determine on its own. */
function ModIdField({
  packId,
  item,
  onSaved,
}: {
  packId: string;
  item: { id: string; modId: string | null; workshopItemId: string };
  onSaved: (pack: WorkshopPack) => void;
}) {
  const [value, setValue] = useState(item.modId ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (value.trim() === (item.modId ?? '')) return;
    setSaving(true);
    try {
      onSaved(await workshopPacksApi.setModId(packId, item.id, value.trim()));
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      className={`mt-0.5 w-full rounded border-0 bg-transparent px-0 py-0 text-xs outline-none ${
        item.modId ? 'text-base-500' : 'text-ember-400 placeholder:text-ember-400/60'
      }`}
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && save()}
      placeholder="Mod ID needed — enter it here"
    />
  );
}
