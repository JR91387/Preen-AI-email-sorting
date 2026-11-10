// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Development only (not part of the add-on). ESLint is installed globally on
// the developer's machine, so this config uses no plugins or shared configs.

const browserGlobals = Object.fromEntries([
  'window', 'document', 'navigator', 'location', 'URLSearchParams', 'console', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'fetch', 'URL', 'Blob', 'Option', 'CSS', 'confirm', 'alert', 'structuredClone',
  'indexedDB', 'IDBKeyRange', 'AbortController', 'AbortSignal', 'TextEncoder', 'TextDecoder',
  'IntersectionObserver', 'ResizeObserver', 'HTMLElement', 'Response', 'Event', 'DOMException', 'Intl', 'globalThis',
].map((name) => [name, 'readonly']));

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'after-used', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-cond-assign': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'eqeqeq': ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': 'error',
};

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['apps/**/*.js', 'packages/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...browserGlobals, messenger: 'readonly', browser: 'readonly' },
    },
    rules,
  },
  {
    // page-guard.js is a classic script, loaded before the page's modules.
    files: ['apps/thunderbird/ui/shared/page-guard.js'],
    languageOptions: { sourceType: 'script' },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...browserGlobals, process: 'readonly', messenger: 'writable', Buffer: 'readonly' },
    },
    rules,
  },
];
