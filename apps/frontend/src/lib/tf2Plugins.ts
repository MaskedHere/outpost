export interface CuratedPlugin {
  name: string;
  description: string;
  url: string;
}

// Unlike Minecraft's Modrinth, there's no reliable public API for SourceMod plugins (AlliedModders'
// own forum directory has none) to power a live search/install flow — so this is a small,
// hand-picked reference list of genuinely popular, actively-maintained TF2 plugins instead of an
// auto-installer. Installing any of these means SSH/file access to actually drop them in
// tf/addons/sourcemod/plugins yourself; Outpost can point you at them, not do it for you (yet).
export const TF2_CURATED_PLUGINS: CuratedPlugin[] = [
  {
    name: 'SourceMod',
    description: "The scripting/admin framework almost every other plugin on this list depends on — install this first.",
    url: 'https://www.sourcemod.net/downloads.php',
  },
  {
    name: 'MetaMod:Source',
    description: 'Required alongside SourceMod — the plugin loader that lets SourceMod (and other engine mods) hook into the game.',
    url: 'https://www.metamodsource.net/downloads.php',
  },
  {
    name: 'SourceBans++',
    description: 'Web-based ban/admin management shared across servers, with a public ban list players can check.',
    url: 'https://github.com/sbpp/sourcebans-pp',
  },
  {
    name: 'Freak Fortress 2',
    description: 'The plugin behind "Versus Saxton Hale" (VSH) servers — one player becomes a boss, everyone else fights them.',
    url: 'https://github.com/FlaminSarge/freak_fortress_2',
  },
];

export const TF2_PLUGINS_BROWSE_URL = 'https://forums.alliedmods.net/forumdisplay.php?f=97';
