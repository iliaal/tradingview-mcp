import eslint from '@eslint/js';
import globals from 'globals';

export default [
  eslint.configs.recommended,
  {
    files: ['src/**/*.js', 'tmp/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.electron,
        TV_CONFIG: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-eval': 'error',
      // The codebase uses } catch {} idiomatically for "best-effort" CDP calls
      // that should never break the caller. Allowed; warns if anyone writes
      // an empty function body or empty for-loop.
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
];
