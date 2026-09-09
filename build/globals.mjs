/**
 * Shared source of truth for the project's global surface.
 *
 * The TVJS sources share one global scope: every file can see every other file's
 * top-level declarations. The bundler needs that list to re-publish them on
 * globalThis, ESLint needs it so cross-file references are not reported as
 * undefined, and the handler checker needs it to tell a real typo from a normal
 * cross-file call.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Provided by the TVJS runtime or injected by the native host. */
export const HOST_GLOBALS = {
  App: 'readonly',
  Device: 'readonly',
  Player: 'writable',
  Playlist: 'readonly',
  MediaItem: 'readonly',
  navigationDocument: 'readonly',
  getActiveDocument: 'readonly',
  evaluateScripts: 'readonly',
  DOMParser: 'readonly',
  XMLHttpRequest: 'readonly',
  localStorage: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  userDefaults: 'readonly',
  microPlay: 'readonly',
  tinyPlay: 'readonly',
  setTraktIDs: 'readonly',
  swiftInterfaceLog: 'readonly',
  formatDuration: 'writable',
  __BUNDLED__: 'readonly',
  process: 'readonly',
  // md5.js publishes itself through a UMD wrapper rather than a top-level `var`.
  md5: 'readonly',
  module: 'readonly',
};

/** Source files, in no particular order. Build order comes from application.js. */
export function sourceFiles() {
  const modules = readdirSync(join(ROOT, 'js'))
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => join('js', f));
  return ['application.js', ...modules];
}

/**
 * Top-level declarations in a file. The sources keep every top-level
 * declaration at column 0, so a line-anchored scan is reliable here and keeps
 * the build free of a parser dependency.
 */
export function topLevelNames(source) {
  const names = new Set();
  for (const m of source.matchAll(/^(?:var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(m[1]);
  }
  return names;
}

/** Every name the sources declare at top level, across all files. */
export function projectGlobals() {
  const names = new Set();
  for (const file of sourceFiles()) {
    for (const n of topLevelNames(readFileSync(join(ROOT, file), 'utf8'))) names.add(n);
  }
  return names;
}
