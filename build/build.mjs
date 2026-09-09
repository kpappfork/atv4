#!/usr/bin/env node
/**
 * Builds bundle.js / bundle.min.js from application.js + js/*.js.
 *
 * The sources are plain TVJS scripts that share one global scope (no imports).
 * The bundle reproduces that by concatenating them in the order application.js
 * declares, wrapping the result in an IIFE, and re-publishing every top-level
 * declaration on globalThis — TVML markup calls handlers like
 * onselect="KP.moviesPage()" by name, so those names must stay global and
 * unminified.
 *
 * Usage:
 *   node build/build.mjs [--dev] [--no-minify] [--check]
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, topLevelNames } from './globals.mjs';
const ENTRY = 'application.js';
const OUT = ['bundle.js', 'bundle.min.js'];

const args = process.argv.slice(2);
const DEV = args.includes('--dev');
const CHECK_ONLY = args.includes('--check');
const MINIFY = !args.includes('--no-minify') && !DEV;

/** Build-time constants. Values come from the environment; absent = `undefined`,
 *  which lets the minifier drop the corresponding branch in settings.js. */
const DEFINES = {
  __BUNDLED__: 'true',
  'process.env.API_ENCODED': jsonOrUndefined(process.env.API_ENCODED),
  'process.env.API_LEGACY_ENCODED': jsonOrUndefined(process.env.API_LEGACY_ENCODED),
  'process.env.API_EXT2_LEGACY': jsonOrUndefined(process.env.API_EXT2_LEGACY),
};

function jsonOrUndefined(value) {
  return value === undefined || value === '' ? 'undefined' : JSON.stringify(value);
}

/** The module load order lives in application.js so there is one source of truth. */
function readModuleOrder(entrySource) {
  const match = entrySource.match(/const javascriptFiles = \[([\s\S]*?)\]\s*\.map/);
  if (!match) {
    throw new Error('Could not find the javascriptFiles array in ' + ENTRY);
  }
  const names = [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error('javascriptFiles array is empty');
  return names;
}

/**
 * Inlines `${baseURL}img/foo.png` references as data URIs.
 *
 * The bundle is loaded from a single URL and the images live next to it, so the
 * chrome images (menu logo, Trakt/KP Speed logos, flags) are embedded to avoid
 * extra round trips. Only the template-literal form is inlined — the per-item
 * rating icons are built with string concatenation (`baseURL + 'img/imdb.png'`)
 * and are deliberately left as URLs, because they repeat once per list item and
 * embedding them would balloon the generated markup.
 */
function inlineImages(source) {
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif' };
  const inlined = [];
  const out = source.replace(/\$\{baseURL\}img\/([\w.-]+)/g, (match, file) => {
    const path = join(ROOT, 'img', file);
    if (!existsSync(path)) {
      console.warn(`  ! img/${file} referenced but not found — left as a URL`);
      return match;
    }
    const ext = file.split('.').pop().toLowerCase();
    const mime = MIME[ext];
    if (!mime) {
      console.warn(`  ! img/${file} has an unsupported type — left as a URL`);
      return match;
    }
    const data = readFileSync(path);
    inlined.push({ file, bytes: data.length });
    return `data:${mime};base64,${data.toString('base64')}`;
  });
  return { source: out, inlined };
}

function applyDefines(source) {
  let out = source;
  for (const [key, value] of Object.entries(DEFINES)) {
    out = out.split(key).join(value);
  }
  return out;
}

function randomHeader() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const length = 2700 + Math.floor(Math.random() * 60);
  let s = '';
  for (let i = 0; i < length; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `/* OK - ${s} */`;
}

function loadEsbuild() {
  try {
    return createRequire(import.meta.url)('esbuild');
  } catch {
    return null;
  }
}

async function main() {
  const entrySource = readFileSync(join(ROOT, ENTRY), 'utf8');
  const modules = readModuleOrder(entrySource);

  const parts = [];
  const exported = new Set();
  const missing = [];

  for (const name of modules) {
    const path = join(ROOT, 'js', `${name}.js`);
    if (!existsSync(path)) {
      missing.push(`js/${name}.js`);
      continue;
    }
    const source = readFileSync(path, 'utf8');
    parts.push(`// ==== js/${name}.js ====\n${source}`);
    for (const n of topLevelNames(source)) exported.add(n);
  }

  if (missing.length) {
    throw new Error(`Modules listed in ${ENTRY} are missing: ${missing.join(', ')}`);
  }

  parts.push(`// ==== ${ENTRY} ====\n${entrySource}`);
  for (const n of topLevelNames(entrySource)) exported.add(n);

  // App/Device/navigationDocument etc. are host-provided; never shadow them.
  const HOST_GLOBALS = new Set(['App', 'Device', 'Player', 'Playlist', 'MediaItem']);
  const exports = [...exported]
    .filter((n) => !HOST_GLOBALS.has(n))
    .sort()
    .map((n) => `globalThis.${n} = ${n};`)
    .join('\n');

  const body = `${parts.join('\n\n')}\n\n// ==== globals for TVML markup handlers ====\n${exports}\n`;
  const { source: withImages, inlined } = inlineImages(applyDefines(body));
  let code = `(function(){\n${withImages}\n}).call(globalThis);`;

  if (CHECK_ONLY) {
    new Function(code); // throws on a syntax error
    console.log(`✔ ${modules.length + 1} files parse, ${exported.size} globals exported`);
    return;
  }

  if (inlined.length) {
    const total = inlined.reduce((sum, i) => sum + i.bytes, 0);
    console.log(
      `  inlined ${inlined.length} image(s), ${(total / 1024).toFixed(0)} KB: ` +
        inlined.map((i) => i.file).join(', ')
    );
  }

  if (MINIFY) {
    const esbuild = loadEsbuild();
    if (!esbuild) {
      throw new Error(
        'esbuild is not installed — run `npm install`, or build unminified with `npm run build:dev`.'
      );
    }
    const result = await esbuild.transform(code, {
      minify: true,
      target: 'safari11', // tvOS 11+ JavaScriptCore
      charset: 'ascii',   // the shipped bundle escapes Cyrillic as \uXXXX
      legalComments: 'none',
    });
    code = result.code;
    if (result.warnings.length) {
      for (const w of result.warnings) console.warn(`esbuild: ${w.text}`);
    }
  } else {
    new Function(code);
  }

  const output = `${randomHeader()}\n${code}`;
  for (const file of OUT) {
    writeFileSync(join(ROOT, file), output);
  }

  const kb = (Buffer.byteLength(output) / 1024).toFixed(1);
  console.log(
    `✔ built ${OUT.join(', ')} — ${kb} KB, ${modules.length + 1} files, ` +
      `${exported.size} globals${MINIFY ? '' : ' (unminified)'}`
  );
}

main().catch((err) => {
  console.error(`✖ build failed: ${err.message}`);
  process.exit(1);
});
