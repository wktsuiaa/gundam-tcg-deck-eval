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
    },
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
