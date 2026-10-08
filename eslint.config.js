// @ts-check
// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

const CORE_IMPORT_BANS = ['node:*', 'fs', 'path', 'http', 'https', 'net', 'child_process'];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'release/**',
      'test-results/**',
      'playwright-report/**',
      'test/scripts/fixtures/**',
      'packages/core/src/*-mutant-*/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
    },
  },
  {
    // The core must stay pure: no I/O, no clock, no ambient randomness, no network.
    files: ['packages/core/src/**/*.ts'],
    languageOptions: { globals: {} },
    rules: {
      'no-restricted-imports': ['error', { patterns: CORE_IMPORT_BANS }],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded PRNG in shuffle/.' },
        { object: 'Date', property: 'now', message: 'Core must not read the clock.' },
      ],
      'no-restricted-globals': [
        'error',
        'fetch',
        'XMLHttpRequest',
        'WebSocket',
        'EventSource',
        'localStorage',
        'window',
        'navigator',
      ],
    },
  },
  {
    // The independent diff checker must never depend on the diff engine (or on anything
    // that re-exports it), so a bug in compare/ cannot hide itself from check/.
    files: ['packages/core/src/check/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['..', '../', '../index', '../index.ts'],
          patterns: [...CORE_IMPORT_BANS, '**/compare', '**/compare/**'],
        },
      ],
    },
  },
  {
    // Privacy: the browser UI never talks to the network. (The generated service worker
    // only answers same-origin requests from its cache; it is emitted by vite.config.ts.)
    files: ['packages/web/src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: 'No network calls.' },
      ],
    },
  },
  prettier,
);
