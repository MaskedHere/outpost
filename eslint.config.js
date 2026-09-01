// @ts-check
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      // TypeScript's own compiler already catches genuinely undefined identifiers; no-undef
      // produces false positives on ambient type-only globals like `NodeJS.*` and `React.*`.
      'no-undef': 'off',
    },
  },
  {
    files: ['apps/backend/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['apps/frontend/**/*.ts', 'apps/frontend/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    // Several components deliberately narrow a polling effect's dependency array (re-running on
    // every render would restart the interval constantly) and silence this rule inline. Without the
    // plugin actually registered, those eslint-disable comments referenced a rule that didn't
    // exist, which is itself an error — so `npm run lint` failed on 12 of them in CI.
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettier,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/build/**',
      '**/.vite/**',
      'apps/backend/generated/**',
      '.data/**',
    ],
  },
];
