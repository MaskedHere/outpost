/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        base: {
          50: '#eef1f6',
          100: '#dbe1ea',
          200: '#b7c1d3',
          950: '#0a0d12',
          900: '#10151d',
          800: '#171d28',
          700: '#212938',
          600: '#2f394d',
          500: '#4a5773',
        },
        accent: {
          400: '#5eead4',
          500: '#2dd4bf',
          600: '#14b8a6',
        },
        ember: {
          400: '#fb923c',
          500: '#f97316',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
