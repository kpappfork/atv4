/**
 * The TVJS sources share one global scope and run in sloppy mode, so the rules
 * that matter are the ones the runtime will not catch for you: undeclared
 * identifiers (`Apptorage`, `makeDisabled`) and the precedence/typo class of
 * bug that silently produces a wrong-but-valid expression.
 *
 * Cross-file references are legal here, so the project's own top-level
 * declarations are fed in as globals — see build/globals.mjs.
 */
import { HOST_GLOBALS, projectGlobals } from './build/globals.mjs';

const globals = { ...HOST_GLOBALS };
for (const name of projectGlobals()) {
  if (!(name in globals)) globals[name] = 'writable';
}

export default [
  {
    files: ['application.js', 'js/**/*.js'],
    languageOptions: { ecmaVersion: 2021, sourceType: 'script', globals },
    linterOptions: { reportUnusedDisableDirectives: true },
    rules: {
      // The bugs this suite exists to catch.
      'no-undef': 'error',
      'no-cond-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-duplicate-case': 'error',
      'no-unsafe-negation': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-sparse-arrays': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-self-compare': 'error',
      // Module namespaces (var Utils = ..., var KP = ...) are consumed by other
      // files, and every file legitimately "redeclares" the global it defines.
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^(_|[A-Z])' }],
      'no-redeclare': ['warn', { builtinGlobals: false }],
    },
  },
  {
    files: ['build/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'warn' },
  },
];
