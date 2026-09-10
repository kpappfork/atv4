#!/usr/bin/env node
/**
 * Refuses to build if a tracked file looks like a captured log or carries a
 * credential.
 *
 * This exists because `git add -A` has twice swept something into a commit that
 * did not belong there: a 16MB .ipa, and a shell artifact named "$1" containing
 * a console capture with a live access token. Both were mistakes a person makes
 * once and a check catches every time.
 */

import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './globals.mjs';

// These must match a literal VALUE, not source code that merely names the field.
// `'refresh_token': refreshToken` is ordinary code; a quoted 16-char literal is not.
const SECRET_PATTERNS = [
  [/access_token=[A-Za-z0-9._-]{12,}/, 'an access token in a URL'],
  [/refresh_token['"]?\s*[:=]\s*['"][A-Za-z0-9._-]{16,}['"]/, 'a refresh token literal'],
  [/Authorization:\s*Bearer\s+[A-Za-z0-9._-]{16,}/i, 'a bearer token'],
  [/X-API-KEY['"]?\s*[:=]\s*['"][A-Za-z0-9-]{16,}['"]/i, 'an API key literal'],
];

// Names that are never legitimate here.
const FORBIDDEN_NAMES = [
  [/^\$/, 'a shell artifact (an unexpanded "$1"-style filename)'],
  [/\.log$/i, 'a log file'],
  [/\.ipa$/i, 'an app binary'],
  [/^__cmd\.js$/, 'a scratch command file'],
];

const MAX_BYTES = 2 * 1024 * 1024;   // do not scan the bundle and images byte by byte

const tracked = execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 })
  .toString('utf8').split('\0').filter(Boolean);

const problems = [];

for (const file of tracked) {
  const base = file.split('/').pop();
  for (const [pattern, why] of FORBIDDEN_NAMES) {
    if (pattern.test(base)) { problems.push(`${file}: ${why}`); }
  }
}

for (const file of tracked) {
  // bundle.js legitimately contains the client id/secret that ship with the app.
  if (file === 'bundle.js' || file === 'bundle.min.js') { continue; }
  let size;
  try { size = statSync(join(ROOT, file)).size; } catch { continue; }
  if (size > MAX_BYTES) { continue; }
  let text;
  try { text = readFileSync(join(ROOT, file), 'utf8'); } catch { continue; }
  if (text.includes('\0')) { continue; }
  for (const [pattern, why] of SECRET_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      problems.push(`${file}: ${why} (matched "${match[0].slice(0, 24)}…")`);
      break;
    }
  }
}

if (problems.length) {
  console.error('✖ tracked files that must not be committed:\n');
  for (const p of problems) { console.error('  ' + p); }
  console.error('\n  Remove them from the index, and rotate anything that leaked.');
  process.exit(1);
}

console.log(`✔ no logs, binaries or credentials among ${tracked.length} tracked files`);
