#!/usr/bin/env node
/**
 * TVML markup calls JS by name from onselect / onplay / onholdselect attributes.
 * Those names are invisible to a normal linter, so a typo or a helper that is not
 * on globalThis only fails at runtime, when the user presses the button.
 *
 * This scans every attribute handler in the sources, extracts the root
 * identifier of each call, and verifies it is declared at top level somewhere.
 * (`globalClearStorage` and `Trakt.makeDisabled` were both found this way.)
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, sourceFiles, topLevelNames, HOST_GLOBALS } from './globals.mjs';

const declared = new Set([...Object.keys(HOST_GLOBALS), 'JSON', 'Math', 'Date', 'encodeURIComponent', 'decodeURIComponent']);
const sources = new Map();
for (const file of sourceFiles()) {
  const source = readFileSync(join(ROOT, file), 'utf8');
  sources.set(file, source);
  for (const n of topLevelNames(source)) declared.add(n);
}

// Handler attributes, single- or double-quoted.
const HANDLER = /\bon(?:select|play|holdselect|change|highlight)\s*=\s*(["'])((?:(?!\1)[\s\S])*?)\1/g;
// Root identifier of a call: `KP.foo(` -> KP, `showText(` -> showText
const CALL = /([A-Za-z_$][\w$]*)\s*(?:\.\s*[A-Za-z_$][\w$]*\s*)*\(/g;

/**
 * A handler body in source is part literal markup, part build-time JS that is
 * concatenated or interpolated into it. Only the literal part runs when the
 * button is pressed, so strip the rest before looking for call targets —
 * otherwise every `encodeURIComponent(...)` used to build the string is a false
 * positive.
 */
function literalPartsOnly(body) {
  return body
    .replace(/\$\{[\s\S]*?\}/g, '')          // `${...}` template interpolation
    .replace(/\\?['"]\s*\+[\s\S]*?\+\s*\\?['"]/g, '') // '... ' + expr + ' ...'
    .replace(/\\?['"]\s*\+[\s\S]*$/, '');   // trailing ' + expr
}

const problems = [];
for (const [file, source] of sources) {
  for (const handler of source.matchAll(HANDLER)) {
    const body = handler[2];
    const line = source.slice(0, handler.index).split('\n').length;
    for (const call of literalPartsOnly(body).matchAll(CALL)) {
      const name = call[1];
      if (declared.has(name)) continue;
      if (/^(if|for|while|switch|catch|return|typeof|new|function)$/.test(name)) continue;
      problems.push({ file, line, name, body: body.trim().slice(0, 90) });
    }
  }
}

if (problems.length) {
  console.error(`✖ ${problems.length} handler(s) reference an undeclared name:\n`);
  for (const p of problems) {
    console.error(`  ${p.file}:${p.line}  ${p.name}  —  ${p.body}`);
  }
  process.exit(1);
}

console.log(`✔ all markup handlers resolve (${sources.size} files, ${declared.size} known names)`);
