/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Modrinth's actual dark-mode surface/text scale (pulled from modrinth.com).
        base: {
          50: '#ecf9fb',
          100: '#dbe4ec',
          200: '#c4cfdd',
          300: '#b0bac5',
          500: '#7b8494',
          600: '#5c6472',
          700: '#42444a',
          800: '#34363c',
          900: '#27292e',
          925: '#1d1f23',
          950: '#16181c',
        },
        accent: {
          300: '#76ffbc',
          400: '#33f598',
          500: '#09de78',
          600: '#00af5c',
          700: '#04914f',
        },
        ember: {
          400: '#fb923c',
          500: '#f97316',
        },
        // Muted, desaturated warn/crit tones for usage meters (CPU/RAM)
        warn: {
          400: '#c99361',
          500: '#b8763f',
        },
        crit: {
          400: '#c17b74',
          500: '#a85a52',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'select-in': {
          from: { opacity: '0', transform: 'translateY(-4px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'tree-sway': {
          '0%, 100%': { transform: 'rotate(calc(var(--sway-amp, 1deg) * -1))' },
          '50%': { transform: 'rotate(var(--sway-amp, 1deg))' },
        },
        // A lit segment travelling along a track, for work with no measurable progress.
        'log-in': {
          from: { opacity: '0', transform: 'translateY(-4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        sweep: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(500%)' },
        },
      },
      animation: {
        'tree-sway': 'tree-sway 5s ease-in-out infinite',
        sweep: 'sweep 1.6s ease-in-out infinite',
        'log-in': 'log-in 180ms ease-out both',
      },
    },
  },
  plugins: [],
};
