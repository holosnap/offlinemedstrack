const expoConfig = require('eslint-config-expo/flat');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier/flat');

module.exports = tseslint.config(
  { ignores: ['node_modules/', '.expo/', 'dist/', 'ios/', 'android/', 'coverage/'] },
  ...expoConfig,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  prettier,
);
