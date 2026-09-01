import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  curseforgeApi,
  gamesApi,
  modrinthApi,
  packsApi,
  serversApi,
  settingsApi,
  steamWorkshopApi,
  type CurseForgeModSummary,
  type ModSearchOptions,
  type GameDef,
  type ImportJobStatus,
  type ModrinthSearchHit,
  type Pack,
  type UnresolvedEntry,
} from '../lib/api';
import { FaArrowLeft } from 'react-icons/fa';
import Select from '../components/Select';
import SearchableSelect from '../components/SearchableSelect';
import MemorySlider, { maxMemoryMb } from '../components/MemorySlider';
import DropZone from '../components/DropZone';
import InfoTip from '../components/InfoTip';
import { easeOut, pageVariants, staggerContainer, staggerItem } from '../lib/motion';

const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'];

/** Stands in for "no category filter". Radix's Select treats an empty-string item value as "no
 *  selection" and refuses to render it, so the unfiltered option needs a real value of its own. */
const ANY_CATEGORY = '__any__';

const GAME_STYLE: Record<string, string> = {
  minecraft: 'from-emerald-600/50 to-emerald-950/70',
  terraria: 'from-sky-600/50 to-lime-950/70',
  factorio: 'from-amber-600/50 to-amber-950/70',
  valheim: 'from-yellow-600/50 to-yellow-950/70',
  gmod: 'from-fuchsia-600/50 to-fuchsia-950/70',
  tf2: 'from-red-600/50 to-red-950/70',
  '7dtd': 'from-orange-800/50 to-stone-950/70',
  zomboid: 'from-red-900/60 to-stone-950/80',
};

type Step =
  | 'games'
  | 'vanilla'
  | 'workshop'
  | 'modded-choice'
  | 'modded-import'
  | 'modded-build'
  | 'modded-browse'
  | 'deploy';

export default function CreateServerWizard() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameDef[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gameVersions, setGameVersions] = useState<string[]>([]);
  const [step, setStep] = useState<Step>('games');
  const [game, setGame] = useState<GameDef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [variant, setVariant] = useState('');
  const [version, setVersion] = useState('');
  const [memoryMb, setMemoryMb] = useState(2048);
  const [hostMemoryMb, setHostMemoryMb] = useState<number | undefined>(undefined);
  const [motd, setMotd] = useState('');

  // Workshop-based modding (Garry's Mod / Project Zomboid)
  const [workshopCollectionId, setWorkshopCollectionId] = useState('');
  const [workshopItemIds, setWorkshopItemIds] = useState('');
  const [modIds, setModIds] = useState('');
  // Zomboid has no native "give me everything in this collection" flag the way GMod's server does
  // (see steamWorkshop.ts) — this resolves one client-side, then fills the two fields above exactly
  // as if they'd been typed by hand.
  const [zomboidCollectionId, setZomboidCollectionId] = useState('');
  const [resolvingCollection, setResolvingCollection] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [collectionUnresolved, setCollectionUnresolved] = useState<{ workshopId: string; title: string }[]>([]);

  // Minecraft modpack flow
  const [pack, setPack] = useState<Pack | null>(null);
  const [unresolved, setUnresolved] = useState<UnresolvedEntry[]>([]);
  const [clientOnly, setClientOnly] = useState<UnresolvedEntry[]>([]);
  const [packMcVersion, setPackMcVersion] = useState('1.21.1');
  const [packLoader, setPackLoader] = useState('fabric');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ModrinthSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [buildSource, setBuildSource] = useState<'modrinth' | 'curseforge'>('modrinth');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('relevance');
  const [serverOnly, setServerOnly] = useState(false);
  const [filterOptions, setFilterOptions] = useState<{
    categories: { value: string; label: string }[];
    sorts: { value: string; label: string }[];
  } | null>(null);
  const [cfResults, setCfResults] = useState<CurseForgeModSummary[]>([]);
  const [cfAddingSlug, setCfAddingSlug] = useState<string | null>(null);
  const [addedCfSlugs, setAddedCfSlugs] = useState<Set<string>>(new Set());

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMcVersion, setImportMcVersion] = useState('');
  const [importLoader, setImportLoader] = useState('');

  const [browseQuery, setBrowseQuery] = useState('');
  const [browseResults, setBrowseResults] = useState<ModrinthSearchHit[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [importingPackId, setImportingPackId] = useState<string | null>(null);

  const [browseSource, setBrowseSource] = useState<'modrinth' | 'curseforge'>('modrinth');
  const [cfBrowseResults, setCfBrowseResults] = useState<CurseForgeModSummary[]>([]);
  const [cfImportingSlug, setCfImportingSlug] = useState<string | null>(null);
  const [cfImportProgress, setCfImportProgress] = useState<ImportJobStatus | null>(null);

  useEffect(() => {
    gamesApi
      .list()
      .then(setGames)
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load games'));
    modrinthApi
      .gameVersions()
      .then(setGameVersions)
      .catch(() => undefined);
    settingsApi
      .get()
      .then((s) => {
        setMemoryMb(s.defaultMemoryMb);
        setHostMemoryMb(s.hostMemoryMb);
      })
      .catch(() => undefined);
    modrinthApi
      .filters()
      .then(setFilterOptions)
      // Filters are an enhancement, not a requirement — search still works without them.
      .catch(() => undefined);
  }, []);

  const backToGames = () => {
    setStep('games');
    setGame(null);
    setError(null);
  };

  const resetCommonFields = (g: GameDef) => {
    setName('');
    setMemoryMb(2048);
    setMotd('');
    setVersion(g.id === 'minecraft' ? (gameVersions[0] ?? '1.21.1') : (g.versionPlaceholder?.split(' ')[0] ?? ''));
  };

  const pickVanilla = (g: GameDef) => {
    setGame(g);
    setError(null);
    const plainVariants = g.moddable ? g.variants.filter((v) => !g.moddedVariants.includes(v)) : g.variants;
    setVariant(plainVariants[0] ?? g.variants[0] ?? '');
    resetCommonFields(g);
    setStep('vanilla');
  };

  const pickModded = (g: GameDef) => {
    setGame(g);
    setError(null);
    resetCommonFields(g);
    setWorkshopCollectionId('');
    setWorkshopItemIds('');
    setModIds('');
    if (g.moddingKind === 'minecraft') {
      setPack(null);
      setUnresolved([]);
      setPackMcVersion(gameVersions[0] ?? '1.21.1');
      setPackLoader('fabric');
      setStep('modded-choice');
    } else {
      setVariant(g.variants[0] ?? '');
      setStep('workshop');
    }
  };

  const handleVanillaSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!game) return;
    setError(null);
    setSubmitting(true);
    try {
      const server = await serversApi.create({
        name,
        game: game.id,
        variant,
        version,
        memoryMb,
        motd: motd || undefined,
      });
      navigate(`/servers/${server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create server');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWorkshopSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!game) return;
    setError(null);
    setSubmitting(true);
    try {
      const server = await serversApi.create({
        name,
        game: game.id,
        variant,
        version,
        memoryMb,
        workshopCollectionId: game.moddingKind === 'workshop-collection' ? workshopCollectionId || undefined : undefined,
        workshopItemIds:
          game.moddingKind === 'workshop-items'
            ? splitList(workshopItemIds)
            : undefined,
        modIds: game.moddingKind === 'workshop-items' ? splitList(modIds) : undefined,
      });
      navigate(`/servers/${server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create server');
    } finally {
      setSubmitting(false);
    }
  };

  const startBuild = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const p = await packsApi.create({ name: name || 'New pack', mcVersion: packMcVersion, loader: packLoader });
      setPack(p);
      setStep('modded-build');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start pack');
    } finally {
      setSubmitting(false);
    }
  };

  // Filters are passed explicitly rather than read from state inside the request, so a change can
  // re-run the search immediately with its new value instead of waiting a render for state to land.
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

  const addMod = async (projectId: string) => {
    if (!pack) return;
    setError(null);
    try {
      const updated = await packsApi.addItem(pack.id, projectId);
      setPack(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add mod');
    }
  };

  const runCfSearch = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!pack) return;
    setSearching(true);
    setError(null);
    try {
      const res = await curseforgeApi.searchMods(query, pack.mcVersion, pack.loader);
      setCfResults(res.hits);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const addCfMod = async (hit: CurseForgeModSummary) => {
    if (!pack) return;
    setError(null);
    setCfAddingSlug(hit.slug);
    try {
      const result = await curseforgeApi.addMod(pack.id, hit.slug, hit.fileId);
      setPack(result.pack);
      setAddedCfSlugs((prev) => new Set(prev).add(hit.slug));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add this mod');
    } finally {
      setCfAddingSlug(null);
    }
  };

  const handleImportSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!importFile) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await packsApi.import(importFile, {
        mcVersion: importMcVersion || undefined,
        loader: importLoader || undefined,
      });
      setPack(result.pack);
      setUnresolved(result.unresolved);
      setClientOnly(result.clientOnly);
      setStep('deploy');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import pack');
    } finally {
      setSubmitting(false);
    }
  };

  const resolveZomboidCollection = async () => {
    if (!zomboidCollectionId.trim()) return;
    setResolvingCollection(true);
    setCollectionError(null);
    setCollectionUnresolved([]);
    try {
      const result = await steamWorkshopApi.resolveCollection(zomboidCollectionId.trim());
      setWorkshopItemIds(result.workshopItemIds.join(', '));
      setModIds(result.modIds.join(', '));
      setCollectionUnresolved(result.unresolved);
    } catch (err) {
      setCollectionError(err instanceof Error ? err.message : 'Failed to resolve collection');
    } finally {
      setResolvingCollection(false);
    }
  };

  const runBrowseSearch = async (e?: FormEvent, queryOverride?: string, sourceOverride?: 'modrinth' | 'curseforge') => {
    e?.preventDefault();
    const source = sourceOverride ?? browseSource;
    setBrowsing(true);
    setError(null);
    try {
      // Deliberately unfiltered by version/loader: the wizard defaults to the newest Minecraft
      // release, and the packs people actually look for (All the Mods 10 and friends) track an older
      // one, so filtering by the preset hid essentially the whole catalogue. Importing a pack adopts
      // that pack's own version and loader, so there's nothing to reconcile.
      if (source === 'curseforge') {
        const res = await curseforgeApi.searchModpacks(queryOverride ?? browseQuery);
        setCfBrowseResults(res.hits);
      } else {
        const res = await modrinthApi.searchModpacks(queryOverride ?? browseQuery);
        setBrowseResults(res.hits);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBrowsing(false);
    }
  };

  const importBrowsedPack = async (hit: ModrinthSearchHit) => {
    setError(null);
    setImportingPackId(hit.project_id);
    try {
      const result = await packsApi.importFromModrinth(hit.project_id, packMcVersion, packLoader);
      setPack(result.pack);
      setUnresolved(result.unresolved);
      setClientOnly(result.clientOnly);
      setStep('deploy');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import this modpack');
    } finally {
      setImportingPackId(null);
    }
  };

  const importCurseForgePack = async (hit: CurseForgeModSummary) => {
    setError(null);
    setCfImportingSlug(hit.slug);
    setCfImportProgress({ phase: 'resolving' });
    try {
      // These are only fallbacks — the pack's own manifest (or, for a server pack, its loader
      // artifacts) decides the real version and loader. Sending the version CurseForge listed for
      // this pack rather than whatever the wizard is preset to means the fallback is at least
      // right about the game version if detection ever comes up empty.
      const { jobId } = await curseforgeApi.startImport(
        hit.slug,
        hit.fileId,
        hit.gameVersion || packMcVersion,
        packLoader,
        hit.name,
      );
      // Resolving a download link, pulling down a (sometimes 100-200MB+) file, and matching
      // hundreds of mods against Modrinth can take minutes — the backend runs it as a background
      // job and reports live phase/progress here instead of one opaque blocking request.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((res) => setTimeout(res, 700));
        const status = await curseforgeApi.getImportJob(jobId);
        setCfImportProgress(status);
        if (status.phase === 'done') {
          setPack(status.pack);
          setUnresolved(status.unresolved);
          setClientOnly(status.clientOnly);
          setStep('deploy');
          break;
        }
        if (status.phase === 'error') {
          setError(status.error);
          break;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import this modpack');
    } finally {
      setCfImportingSlug(null);
      setCfImportProgress(null);
    }
  };

  const handleDeploy = async () => {
    if (!pack) return;
    setError(null);
    setSubmitting(true);
    try {
      const server = await packsApi.deploy(pack.id, name || pack.name, memoryMb, motd || undefined);
      navigate(`/servers/${server.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setSubmitting(false);
    }
  };

  const addedProjectIds = new Set(pack?.items.map((i) => i.projectId) ?? []);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <AnimatePresence mode="wait">
        {step === 'games' && (
          <motion.div key="games" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <h1 className="mb-1 text-2xl font-semibold text-base-50">New server</h1>
            <p className="mb-8 text-sm text-base-500">
              Pick a game. It creates a real Docker container on your NAS, ready to join within a minute or two.
            </p>

            {loadError && (
              <div className="card mb-4 flex items-start gap-3 border-red-500/30 bg-red-500/5 px-5 py-4">
                <span className="text-red-400">⚠</span>
                <p className="text-sm text-red-300">{loadError}</p>
              </div>
            )}

            {games === null && !loadError && <p className="text-base-500">Loading…</p>}

            <motion.div
              variants={staggerContainer}
              initial="initial"
              animate="animate"
              className="grid grid-cols-2 gap-4 sm:grid-cols-3"
            >
              {games?.map((g) => (
                <motion.div
                  key={g.id}
                  variants={staggerItem}
                  onMouseEnter={() => setHovered(g.id)}
                  onMouseLeave={() => setHovered((h) => (h === g.id ? null : h))}
                  whileHover={{ y: -4, transition: easeOut }}
                  className="group relative h-32 overflow-hidden rounded-2xl border border-base-800 shadow-lg"
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${GAME_STYLE[g.id] ?? 'from-base-700/50 to-base-950/70'}`} />
                  {g.bannerUrl && (
                    <img
                      src={g.bannerUrl}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />

                  <button
                    type="button"
                    className="absolute inset-0 flex flex-col items-start justify-end p-4 text-left"
                    onClick={() => (g.moddable ? undefined : pickVanilla(g))}
                  >
                    <span className="text-lg font-semibold text-white drop-shadow">{g.displayName}</span>
                    {g.moddable && <span className="text-xs text-white/70">Vanilla or modded</span>}
                  </button>

                  <AnimatePresence>
                    {g.moddable && hovered === g.id && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={easeOut}
                        className="absolute inset-0 flex items-center justify-center gap-2 bg-base-950/80 backdrop-blur-sm"
                      >
                        <motion.button
                          type="button"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.96 }}
                          className="btn-secondary !py-1.5 !text-xs"
                          onClick={() => pickVanilla(g)}
                        >
                          Vanilla
                        </motion.button>
                        <motion.button
                          type="button"
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.96 }}
                          className="btn-primary !py-1.5 !text-xs"
                          onClick={() => pickModded(g)}
                        >
                          Modded
                        </motion.button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        )}

        {step === 'vanilla' && game && (
          <motion.div key="vanilla" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <BackLink onClick={backToGames} />
            <h1 className="mb-1 text-2xl font-semibold text-base-50">{game.displayName}</h1>
            <p className="mb-8 text-sm text-base-500">Set it up and it'll be live in a minute or two.</p>

            <form onSubmit={handleVanillaSubmit} className="card space-y-5 p-6">
              <div>
                <label className="label" htmlFor="name">
                  Server name
                </label>
                <input
                  id="name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Friday Night Crew"
                  required
                />
              </div>

              {game.variants.length > 1 && (
                <div>
                  <label className="label flex items-center gap-1.5" htmlFor="variant">
                    {game.variantFieldLabel ?? (game.id === 'minecraft' ? 'Server type' : 'Variant')}
                    {game.id === 'minecraft' && (
                      <InfoTip text="Vanilla: unmodified official server, exactly what a normal Minecraft client connects to. Paper: a drop-in replacement that's much more performant and adds a plugin system (Bukkit/Spigot plugins) — same vanilla gameplay unless you install plugins." />
                    )}
                  </label>
                  <Select
                    id="variant"
                    value={variant}
                    onChange={setVariant}
                    options={variantOptions(game, game.moddable ? game.variants.filter((v) => !game.moddedVariants.includes(v)) : game.variants)}
                  />
                </div>
              )}

              {game.versionLabel && (
                <div>
                  <label className="label" htmlFor="version">
                    {game.versionLabel}
                  </label>
                  {game.id === 'minecraft' && gameVersions.length > 0 ? (
                    <SearchableSelect id="version" value={version} onChange={setVersion} options={gameVersions} />
                  ) : (
                    <input
                      id="version"
                      className="input"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                      placeholder={game.versionPlaceholder ?? ''}
                      required
                    />
                  )}
                </div>
              )}

              {game.id === 'minecraft' && (
                <div>
                  <label className="label" htmlFor="motd">
                    MOTD <span className="normal-case text-base-500">(optional)</span>
                    <InfoTip text="Message of the Day — the line of text shown in the multiplayer server list under your server's name, before anyone joins. Supports Minecraft color codes (&a, &l, etc.)." />
                  </label>
                  <input
                    id="motd"
                    className="input"
                    value={motd}
                    onChange={(e) => setMotd(e.target.value)}
                    placeholder="Welcome! Don't break anything."
                    maxLength={200}
                  />
                </div>
              )}

              <MemoryPicker value={memoryMb} onChange={setMemoryMb} hostMemoryMb={hostMemoryMb} />

              {error && <p className="text-sm text-red-400">{error}</p>}

              <motion.button
                type="submit"
                whileTap={{ scale: 0.98 }}
                className="btn-primary w-full"
                disabled={submitting}
              >
                {submitting ? 'Creating…' : 'Create server'}
              </motion.button>
            </form>
          </motion.div>
        )}

        {step === 'workshop' && game && (
          <motion.div key="workshop" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <BackLink onClick={backToGames} />
            <h1 className="mb-1 text-2xl font-semibold text-base-50">{game.displayName} · Modded</h1>
            <p className="mb-8 text-sm text-base-500">
              Steam Workshop content downloads automatically at first boot — no Steam account needed.
            </p>

            <form onSubmit={handleWorkshopSubmit} className="card space-y-5 p-6">
              <div>
                <label className="label" htmlFor="ws-name">
                  Server name
                </label>
                <input
                  id="ws-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Friday Night Crew"
                  required
                />
              </div>

              {game.variants.length > 1 && (
                <div>
                  <label className="label" htmlFor="ws-variant">
                    Variant
                  </label>
                  <Select id="ws-variant" value={variant} onChange={setVariant} options={game.variants} />
                </div>
              )}

              {game.moddingKind === 'workshop-collection' && (
                <div>
                  <label className="label" htmlFor="ws-collection">
                    Steam Workshop collection ID
                  </label>
                  <input
                    id="ws-collection"
                    className="input"
                    value={workshopCollectionId}
                    onChange={(e) => setWorkshopCollectionId(e.target.value)}
                    placeholder="e.g. 123456789"
                  />
                  <p className="mt-1.5 text-xs text-base-500">
                    The numeric ID from a Workshop collection's URL. Leave blank to start with no addons and add a
                    collection later from Settings.
                  </p>
                </div>
              )}

              {game.moddingKind === 'workshop-items' && (
                <>
                  <div className="rounded-xl border border-base-700 bg-base-800/40 p-4">
                    <label className="label flex items-center gap-1.5" htmlFor="ws-collection">
                      Steam Workshop collection ID
                      <InfoTip text="Paste a collection's numeric ID (from its Workshop page URL) instead of hunting up every mod's item ID and mod ID by hand — this fetches the whole collection and fills in both fields below automatically. Mods whose page doesn't list a Mod ID in the expected format are called out separately so you can add them yourself." />
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="ws-collection"
                        className="input"
                        value={zomboidCollectionId}
                        onChange={(e) => setZomboidCollectionId(e.target.value)}
                        placeholder="e.g. 3610184378"
                      />
                      <button
                        type="button"
                        className="btn-secondary shrink-0"
                        onClick={resolveZomboidCollection}
                        disabled={resolvingCollection || !zomboidCollectionId.trim()}
                      >
                        {resolvingCollection ? 'Resolving…' : 'Resolve'}
                      </button>
                    </div>
                    {collectionError && <p className="mt-1.5 text-xs text-red-400">{collectionError}</p>}
                    {collectionUnresolved.length > 0 && (
                      <div className="mt-2 rounded-lg bg-ember-500/5 p-2.5">
                        <p className="text-xs text-ember-400">
                          {collectionUnresolved.length} mod{collectionUnresolved.length === 1 ? '' : 's'} couldn't be
                          auto-matched — add its Mod ID manually if you want it included:
                        </p>
                        <ul className="mt-1 space-y-0.5 text-xs text-base-500">
                          {collectionUnresolved.map((u) => (
                            <li key={u.workshopId}>{u.title}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="mt-1.5 text-xs text-base-500">Fills in the two fields below — review before creating the server.</p>
                  </div>
                  <div>
                    <label className="label flex items-center gap-1.5" htmlFor="ws-items">
                      Steam Workshop item IDs
                      <InfoTip text="Comma-separated numeric IDs, one per mod, from each mod's Workshop page URL (the number after ?id=). These just get the files downloaded — Project Zomboid still needs the separate 'Matching mod IDs' field to actually enable them." />
                    </label>
                    <input
                      id="ws-items"
                      className="input"
                      value={workshopItemIds}
                      onChange={(e) => setWorkshopItemIds(e.target.value)}
                      placeholder="2160432461, 2685168362"
                    />
                  </div>
                  <div>
                    <label className="label flex items-center gap-1.5" htmlFor="ws-modids">
                      Matching mod IDs
                      <InfoTip text="Each mod's own internal Mod ID (not the Workshop item ID) — find it on the mod's Workshop page, usually in the description, in the same order as the item IDs above. Zomboid needs both: the item ID to download it, the mod ID to actually turn it on." />
                    </label>
                    <input
                      id="ws-modids"
                      className="input"
                      value={modIds}
                      onChange={(e) => setModIds(e.target.value)}
                      placeholder="ClaimNonResidential, MoreDescriptionForTraits"
                    />
                    <p className="mt-1.5 text-xs text-base-500">
                      Each mod's own internal ID (shown on its Workshop page, not the numeric item ID) — same order
                      as the Workshop IDs above. Leave both blank to start unmodded and add mods later.
                    </p>
                  </div>
                </>
              )}

              <MemoryPicker value={memoryMb} onChange={setMemoryMb} hostMemoryMb={hostMemoryMb} />

              {error && <p className="text-sm text-red-400">{error}</p>}

              <motion.button type="submit" whileTap={{ scale: 0.98 }} className="btn-primary w-full" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create server'}
              </motion.button>
            </form>
          </motion.div>
        )}

        {step === 'modded-choice' && game && (
          <motion.div key="modded-choice" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <BackLink onClick={backToGames} />
            <h1 className="mb-1 text-2xl font-semibold text-base-50">{game.displayName} · Modded</h1>
            <p className="mb-8 text-sm text-base-500">Browse an existing pack, import one, or build one now.</p>

            <div className="card mb-6 space-y-4 p-6">
              <div>
                <label className="label" htmlFor="modded-name">
                  Server name
                </label>
                <input
                  id="modded-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Friday Night Crew"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="modded-version">
                    Minecraft version
                  </label>
                  {gameVersions.length > 0 ? (
                    <SearchableSelect id="modded-version" value={packMcVersion} onChange={setPackMcVersion} options={gameVersions} />
                  ) : (
                    <input
                      id="modded-version"
                      className="input"
                      value={packMcVersion}
                      onChange={(e) => setPackMcVersion(e.target.value)}
                      placeholder="1.21.1"
                    />
                  )}
                </div>
                <div>
                  <label className="label flex items-center gap-1.5" htmlFor="modded-loader">
                    Loader
                    <InfoTip text="The mod-loading framework mods are built for — a mod only works with the loader it was made for. Forge and NeoForge (NeoForge is Forge's actively-developed successor for 1.20.6+) have the biggest mod libraries; Fabric is lighter-weight and updates to new Minecraft versions faster; Quilt is a Fabric-compatible fork with some extra features. Check what your intended modpack needs before picking." />
                  </label>
                  <Select id="modded-loader" value={packLoader} onChange={setPackLoader} options={LOADERS} />
                </div>
              </div>
              <MemoryPicker value={memoryMb} onChange={setMemoryMb} hostMemoryMb={hostMemoryMb} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <motion.button
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="card p-6 text-left transition-colors hover:border-accent-500/50"
                onClick={() => {
                  setBrowseResults([]);
                  setCfBrowseResults([]);
                  setBrowseQuery('');
                  setError(null);
                  setStep('modded-browse');
                  runBrowseSearch(undefined, '', browseSource);
                }}
              >
                <h2 className="mb-1 font-medium text-base-50">Browse packs</h2>
                <p className="text-sm text-base-500">Search existing modpacks on Modrinth or CurseForge.</p>
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="card p-6 text-left transition-colors hover:border-accent-500/50"
                onClick={() => {
                  setImportMcVersion(packMcVersion);
                  setImportLoader(packLoader);
                  setError(null);
                  setStep('modded-import');
                }}
              >
                <h2 className="mb-1 font-medium text-base-50">Import a modpack</h2>
                <p className="text-sm text-base-500">A .mrpack, a CurseForge zip, or a plain zip of .jar mods.</p>
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                className="card p-6 text-left transition-colors hover:border-accent-500/50"
                onClick={startBuild}
                disabled={submitting}
              >
                <h2 className="mb-1 font-medium text-base-50">Build one now</h2>
                <p className="text-sm text-base-500">Search Modrinth and add mods, right here.</p>
              </motion.button>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </motion.div>
        )}

        {step === 'modded-browse' && game && (
          <motion.div key="modded-browse" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <BackLink onClick={() => setStep('modded-choice')} label="Back" />
            <h1 className="mb-1 text-2xl font-semibold text-base-50">Browse modpacks</h1>
            <p className="mb-4 text-sm text-base-500">
              {browseSource === 'curseforge' ? 'CurseForge' : 'Modrinth'} packs for {packMcVersion} · {packLoader}.
            </p>

            <div className="mb-4 flex items-center gap-1 rounded-lg bg-base-800 p-1 text-sm">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  browseSource === 'modrinth' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
                }`}
                onClick={() => {
                  setBrowseSource('modrinth');
                  runBrowseSearch(undefined, browseQuery, 'modrinth');
                }}
              >
                Modrinth
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                  browseSource === 'curseforge' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
                }`}
                onClick={() => {
                  setBrowseSource('curseforge');
                  runBrowseSearch(undefined, browseQuery, 'curseforge');
                }}
              >
                CurseForge
              </button>
            </div>

            <form onSubmit={runBrowseSearch} className="mb-4 flex gap-2">
              <input
                className="input"
                value={browseQuery}
                onChange={(e) => setBrowseQuery(e.target.value)}
                placeholder="Search modpacks…"
                autoFocus
              />
              <button type="submit" className="btn-secondary shrink-0" disabled={browsing}>
                {browsing ? '…' : 'Search'}
              </button>
            </form>

            {cfImportProgress && (
              <div className="card mb-4 p-4">
                <p className="mb-2 text-sm text-base-200">{describeImportProgress(cfImportProgress).label}</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-800">
                  <motion.div
                    className="h-full rounded-full bg-accent-500"
                    animate={{ width: `${describeImportProgress(cfImportProgress).percent ?? 100}%` }}
                    transition={{ duration: 0.3 }}
                    style={!describeImportProgress(cfImportProgress).determinate ? { opacity: 0.5 } : undefined}
                  />
                </div>
              </div>
            )}

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            {browseSource === 'curseforge' ? (
              <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card divide-y divide-base-800">
                {cfBrowseResults.map((hit) => (
                  <motion.div variants={staggerItem} key={hit.slug} className="flex items-center gap-3 p-3">
                    {hit.logoUrl && <img src={hit.logoUrl} alt="" className="h-10 w-10 rounded-lg" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-base-100">
                        {hit.name}
                        {/* Results aren't version-filtered any more, so each one states its own. */}
                        {hit.gameVersion && <span className="ml-2 text-xs font-normal text-base-500">{hit.gameVersion}</span>}
                      </p>
                      <p className="truncate text-xs text-base-500">{hit.summary}</p>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      className="btn-secondary shrink-0 !py-1 !text-xs"
                      disabled={cfImportingSlug !== null}
                      onClick={() => importCurseForgePack(hit)}
                    >
                      {cfImportingSlug === hit.slug ? 'Importing…' : 'Use this pack'}
                    </motion.button>
                  </motion.div>
                ))}
                {cfBrowseResults.length === 0 && (
                  <p className="p-6 text-center text-sm text-base-500">
                    {browsing ? 'Loading…' : 'No modpacks found — try a different search.'}
                  </p>
                )}
              </motion.div>
            ) : (
              <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card divide-y divide-base-800">
                {browseResults.map((hit) => (
                  <motion.div variants={staggerItem} key={hit.project_id} className="flex items-center gap-3 p-3">
                    {hit.icon_url && <img src={hit.icon_url} alt="" className="h-10 w-10 rounded-lg" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-base-100">
                        {hit.title}
                        {/* Newest supported version plus the loader tag Modrinth files under
                            categories — results aren't version-filtered, so each says what it targets. */}
                        <span className="ml-2 text-xs font-normal text-base-500">
                          {[hit.versions?.[hit.versions.length - 1], hit.categories?.find((c) => LOADERS.includes(c))]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </p>
                      <p className="truncate text-xs text-base-500">{hit.description}</p>
                    </div>
                    <motion.button
                      whileTap={{ scale: 0.95 }}
                      className="btn-secondary shrink-0 !py-1 !text-xs"
                      disabled={importingPackId === hit.project_id}
                      onClick={() => importBrowsedPack(hit)}
                    >
                      {importingPackId === hit.project_id ? 'Importing…' : 'Use this pack'}
                    </motion.button>
                  </motion.div>
                ))}
                {browseResults.length === 0 && (
                  <p className="p-6 text-center text-sm text-base-500">
                    {browsing ? 'Loading…' : 'No modpacks found — try a different search.'}
                  </p>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

        {step === 'modded-import' && game && (
          <motion.div key="modded-import" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <BackLink onClick={() => setStep('modded-choice')} label="Back" />
            <h1 className="mb-1 text-2xl font-semibold text-base-50">Import modpack</h1>
            <p className="mb-8 text-sm text-base-500">We'll match it against Modrinth, then you can deploy it.</p>

            <DropZone onDrop={(files) => setImportFile(files[0] ?? null)} hint="A .mrpack, CurseForge .zip, or a zip of .jar mods">
              <form onSubmit={handleImportSubmit} className="card space-y-5 p-6">
                <div>
                <label className="label" htmlFor="pack-file">
                  Modpack file
                </label>
                <input
                  id="pack-file"
                  type="file"
                  accept=".zip,.mrpack"
                  className="input file:mr-3 file:rounded-lg file:border-0 file:bg-base-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-base-50"
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  required
                />
                <p className="mt-1.5 text-xs text-base-500">
                  Accepts a Modrinth <code>.mrpack</code>, a CurseForge modpack zip, or a plain zip of{' '}
                  <code>.jar</code> mods.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="import-version">
                    Minecraft version (if not detected)
                  </label>
                  <input
                    id="import-version"
                    className="input"
                    value={importMcVersion}
                    onChange={(e) => setImportMcVersion(e.target.value)}
                    placeholder="1.21.1"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="import-loader">
                    Loader (if not detected)
                  </label>
                  <Select
                    id="import-loader"
                    value={importLoader}
                    onChange={setImportLoader}
                    placeholder="Auto-detect"
                    options={LOADERS}
                  />
                </div>
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <motion.button
                type="submit"
                whileTap={{ scale: 0.98 }}
                className="btn-primary w-full"
                disabled={!importFile || submitting}
              >
                {submitting ? 'Importing…' : 'Import pack'}
              </motion.button>
              </form>
            </DropZone>
          </motion.div>
        )}

        {step === 'modded-build' && pack && (
          <motion.div key="modded-build" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <BackLink onClick={() => setStep('modded-choice')} label="Back" />
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-base-50">Build modpack</h1>
                <p className="mt-1 text-sm text-base-500">
                  {pack.mcVersion} · {pack.loader} · {pack.items.length} mods
                </p>
              </div>
              <motion.button whileTap={{ scale: 0.98 }} className="btn-primary" onClick={() => setStep('deploy')}>
                Continue to deploy →
              </motion.button>
            </div>

            {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-medium uppercase tracking-wide text-base-500">
                    Search {buildSource === 'curseforge' ? 'CurseForge' : 'Modrinth'}
                  </h2>
                  <div className="flex items-center gap-1 rounded-lg bg-base-800 p-1 text-xs">
                    <button
                      type="button"
                      className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                        buildSource === 'modrinth' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
                      }`}
                      onClick={() => setBuildSource('modrinth')}
                    >
                      Modrinth
                    </button>
                    <button
                      type="button"
                      className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                        buildSource === 'curseforge' ? 'bg-base-700 text-base-50' : 'text-base-500 hover:text-base-200'
                      }`}
                      onClick={() => setBuildSource('curseforge')}
                    >
                      CurseForge
                    </button>
                  </div>
                </div>
                <form
                  onSubmit={buildSource === 'curseforge' ? runCfSearch : runSearch}
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

                {/* Modrinth-only: these map to real Modrinth search parameters, which the CurseForge
                    scraper has no equivalent for. Each control re-runs the search immediately with
                    its own new value, so there's no "apply filters" step to forget. */}
                {buildSource === 'modrinth' && filterOptions && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    {/* The app's own Select (Radix-backed) rather than a bare <select> — a native
                        one renders the OS dropdown, which on Windows is a light-mode list that
                        looks pasted in from another application.
                        ANY_CATEGORY is a sentinel because Radix rejects an empty-string item value
                        (it reserves "" for "nothing selected"), which rendered a blank trigger. */}
                    <div className="w-40">
                      <Select
                        value={category || ANY_CATEGORY}
                        onChange={(value) => {
                          const next = value === ANY_CATEGORY ? '' : value;
                          setCategory(next);
                          runSearch(undefined, { category: next });
                        }}
                        options={[{ value: ANY_CATEGORY, label: 'All categories' }, ...filterOptions.categories]}
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

                {buildSource === 'curseforge' ? (
                  <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card divide-y divide-base-800">
                    {cfResults.map((hit) => {
                      // CurseForge publishes no side info; the tag is borrowed from Modrinth by slug
                      // where that lookup succeeded. Unknown stays unlabelled and stays addable --
                      // blocking on a guess would hide mods that are perfectly fine on a server.
                      const clientOnly = hit.serverSide === 'unsupported';
                      const serverSafe = hit.serverSide === 'required' || hit.serverSide === 'optional';
                      return (
                        <motion.div variants={staggerItem} key={hit.slug} className="flex items-center gap-3 p-3">
                          {hit.logoUrl && (
                            <img src={hit.logoUrl} alt="" className={`h-8 w-8 rounded ${clientOnly ? 'opacity-40' : ''}`} />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className={`truncate text-sm ${clientOnly ? 'text-base-500' : 'text-base-100'}`}>{hit.name}</p>
                              {clientOnly && (
                                <span className="shrink-0 rounded bg-base-700 px-1.5 py-0.5 text-[10px] text-base-400">Client-only</span>
                              )}
                              {serverSafe && (
                                <span className="shrink-0 rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] text-accent-400">Server</span>
                              )}
                            </div>
                            <p className="truncate text-xs text-base-500">
                              {clientOnly ? "Client-only — can't run on a server" : hit.summary}
                            </p>
                          </div>
                          <motion.button
                            whileTap={{ scale: 0.95 }}
                            className="btn-secondary shrink-0 !py-1 !text-xs"
                            disabled={clientOnly || addedCfSlugs.has(hit.slug) || cfAddingSlug === hit.slug}
                            title={clientOnly ? 'This mod only works on the Minecraft client, not a dedicated server.' : undefined}
                            onClick={() => addCfMod(hit)}
                          >
                            {addedCfSlugs.has(hit.slug) ? 'Added' : cfAddingSlug === hit.slug ? '…' : 'Add'}
                          </motion.button>
                        </motion.div>
                      );
                    })}
                    {cfResults.length === 0 && (
                      <p className="p-6 text-center text-sm text-base-500">Search for mods to add to this pack.</p>
                    )}
                  </motion.div>
                ) : (
                  <motion.div variants={staggerContainer} initial="initial" animate="animate" className="card divide-y divide-base-800">
                    {results.map((hit) => {
                      // Marked rather than hidden: seeing "Client only" explains why a mod someone
                      // expected to find isn't addable, which a silently filtered list wouldn't.
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
                    {results.length === 0 && (
                      <p className="p-6 text-center text-sm text-base-500">Search for mods to add to this pack.</p>
                    )}
                  </motion.div>
                )}
              </div>

              <div>
                <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-base-500">In this pack</h2>
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
                    </motion.div>
                  ))}
                  {pack.items.length === 0 && <p className="p-6 text-center text-sm text-base-500">No mods added yet.</p>}
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}

        {step === 'deploy' && pack && (
          <motion.div key="deploy" variants={pageVariants} initial="initial" animate="animate" exit="exit">
            <BackLink onClick={() => setStep(game?.moddable ? 'modded-choice' : 'games')} label="Back" />
            <h1 className="mb-1 text-2xl font-semibold text-base-50">Deploy</h1>
            <p className="mb-8 text-sm text-base-500">
              {pack.name} · {pack.mcVersion} · {pack.loader} · {pack.items.length} mods
            </p>

            {unresolved.length > 0 && (
              <div className="card mb-6 border-ember-500/30 bg-ember-500/5 p-5">
                <p className="mb-2 text-sm font-medium text-ember-400">
                  {unresolved.length} mod{unresolved.length === 1 ? '' : 's'} couldn't be matched automatically
                </p>
                <ul className="space-y-1 text-xs text-base-500">
                  {unresolved.map((u, i) => (
                    <li key={i}>
                      <span className="text-base-200">{u.label}</span> — {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {clientOnly.length > 0 && (
              <div className="card mb-6 border-base-600/50 bg-base-800/40 p-5">
                <p className="mb-2 text-sm font-medium text-base-300">
                  {clientOnly.length} client-only mod{clientOnly.length === 1 ? '' : 's'} left out automatically
                </p>
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

            <div className="card space-y-5 p-6">
              <div>
                <label className="label" htmlFor="deploy-name">
                  Server name
                </label>
                <input
                  id="deploy-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={pack.name}
                />
              </div>

              <div>
                <label className="label" htmlFor="deploy-motd">
                  MOTD <span className="normal-case text-base-500">(optional)</span>
                    <InfoTip text="Message of the Day — the line of text shown in the multiplayer server list under your server's name, before anyone joins. Supports Minecraft color codes (&a, &l, etc.)." />
                </label>
                <input
                  id="deploy-motd"
                  className="input"
                  value={motd}
                  onChange={(e) => setMotd(e.target.value)}
                  placeholder="Welcome! Don't break anything."
                  maxLength={200}
                />
              </div>

              <MemoryPicker value={memoryMb} onChange={setMemoryMb} hostMemoryMb={hostMemoryMb} />

              {error && <p className="text-sm text-red-400">{error}</p>}

              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                className="btn-primary w-full"
                onClick={handleDeploy}
                disabled={submitting}
              >
                {submitting ? 'Deploying…' : 'Create server'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function variantOptions(game: GameDef, variants: string[]): { value: string; label: string }[] {
  return variants.map((v) => ({ value: v, label: game.variantLabels?.[v] ?? v }));
}

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
}

function describeImportProgress(status: ImportJobStatus): { label: string; percent: number | null; determinate: boolean } {
  switch (status.phase) {
    case 'resolving':
      return { label: "Finding this pack's download link on CurseForge…", percent: null, determinate: false };
    case 'downloading': {
      const percent = status.total > 0 ? Math.round((status.current / status.total) * 100) : null;
      const sizes = status.total > 0 ? ` (${formatMb(status.current)} / ${formatMb(status.total)})` : ` (${formatMb(status.current)})`;
      return { label: `Downloading modpack${sizes}…`, percent, determinate: percent !== null };
    }
    case 'matching': {
      const percent = status.total > 0 ? Math.round((status.current / status.total) * 100) : null;
      return {
        label: `Matching mods against Modrinth (${status.current} / ${status.total})…`,
        percent,
        determinate: percent !== null,
      };
    }
    default:
      return { label: 'Working…', percent: null, determinate: false };
  }
}

function splitList(value: string): string[] | undefined {
  const items = value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function BackLink({ onClick, label = 'All games' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-4 inline-flex items-center gap-1 text-sm text-base-500 transition-colors hover:text-accent-400"
    >
      <FaArrowLeft className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function MemoryPicker({ value, onChange, hostMemoryMb }: { value: number; onChange: (v: number) => void; hostMemoryMb?: number }) {
  // Ceiling comes from the host's real RAM rather than a fixed 8GB, which was both arbitrary and
  // inconsistent with the Settings tab's own slider.
  return <MemorySlider value={value} onChange={onChange} min={1024} max={maxMemoryMb(hostMemoryMb)} step={512} />;
}
