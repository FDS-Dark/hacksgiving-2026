// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // tsc already checks namespace members, and this rule can't follow
      // `export *` chains in .d.ts files (it flags AuthSession.TokenTypeHint,
      // which exists).
      'import/namespace': 'off',
    },
  },
]);
