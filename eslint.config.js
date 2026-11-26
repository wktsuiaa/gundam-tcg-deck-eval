// Flat config. Formatting is intentionally left to the editor; these rules cover correctness and readability only.
const { defineConfig, globalIgnores } = require('eslint/config');
const nextVitals = require('eslint-config-next/core-web-vitals');
const nextTs = require('eslint-config-next/typescript');

module.exports = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts', '.agents/**', '.claude/**']),
  {
    rules: {
      // Correctness
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Readability
      'prefer-const': 'error',
      'no-else-return': 'warn',
      'object-shorthand': 'warn',
      // Files stay short enough to read in one sitting. Split along domain seams instead of raising the cap.
      'max-lines': ['error', { max: 500 }],
    },
  },
  {
    // Test files are exempt; they are split only when the module they cover is split.
    files: ['__tests__/**'],
    rules: { 'max-lines': 'off' },
  },
  {
    // shortcut: files not yet split below 500 lines are exempt, remove each entry when its split lands.
    files: [
      'components/CatalogFilterPanel.tsx',
      'components/DeckWorkspace.tsx',
      'components/MatchSandbox.tsx',
      'components/StrategyGeneratorPanel.tsx',
      'lib/cfg-parser.ts',
      'lib/chain-verifier.ts',
      'lib/deck-engine.ts',
      'lib/effect-parser.ts',
      'lib/gundam-db.ts',
    ],
    rules: { 'max-lines': 'off' },
  },
  {
    files: ['eslint.config.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // CLI scripts print their results.
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
]);
