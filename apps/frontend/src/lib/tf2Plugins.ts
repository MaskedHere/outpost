export interface CuratedPlugin {
  name: string;
  description: string;
  url: string;
}

// SourceMod plugins have no reliable public API, so this is a curated reference list of popular TF2
// plugins rather than an auto-installer.
export const TF2_CURATED_PLUGINS: CuratedPlugin[] = [
  {
    name: 'SourceMod',
    description:
      'The scripting/admin framework almost every other plugin on this list depends on — install this first.',
    url: 'https://www.sourcemod.net/downloads.php',
  },
  {
    name: 'MetaMod:Source',
    description:
      'Required alongside SourceMod — the plugin loader that lets SourceMod (and other engine mods) hook into the game.',
    url: 'https://www.metamodsource.net/downloads.php',
  },
  {
    name: 'SourceBans++',
    description:
      'Web-based ban/admin management shared across servers, with a public ban list players can check.',
    url: 'https://github.com/sbpp/sourcebans-pp',
  },
  {
    name: 'Freak Fortress 2',
    description:
      'The plugin behind "Versus Saxton Hale" (VSH) servers — one player becomes a boss, everyone else fights them.',
    url: 'https://github.com/FlaminSarge/freak_fortress_2',
  },
];

export const TF2_PLUGINS_BROWSE_URL = 'https://forums.alliedmods.net/forumdisplay.php?f=97';
