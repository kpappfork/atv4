#!/usr/bin/env node
/**
 * Executes the built bundle against minimal TVJS stubs and asserts that the
 * globals TVML markup depends on are actually published. A bundle that parses
 * but does not publish (e.g. md5, which uses a UMD wrapper) still fails at
 * runtime on a real device, so this runs the code rather than just parsing it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT } from './globals.mjs';

const REQUIRED = [
  'API', 'AppSettings', 'AppStorage', 'Auth', 'Cache', 'KP', 'KPlayer', 'Network',
  'Presenter', 'Templates', 'MovieTemplates', 'TVTemplates', 'TV', 'Trakt', 'TMDB',
  'FanArt', 'Utils', 'Log', 'KEYS', 'KINOPUB', 'md5',
  // Called by name from markup:
  'play', 'playTV', 'playTrailer', 'playFewEp', 'playShuffle', 'showText',
  'showRating', 'globalClearStorage', 'showActivationPage', 'setDefaultUrl',
  'noDefaultUrl', 'formatDuration', 'backgroundFetch',
];

const store = new Map();
const sandbox = {
  console: { log() {}, error() {}, warn() {} },
  setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
  App: {},
  Device: {
    appIdentifier: 'com.octavian.microiptv', appVersion: 6, systemVersion: '17.0',
    productType: 'AppleTV', vendorIdentifier: 'test', model: 'AppleTV',
  },
  userDefaults: {
    getData: (k) => store.get(k), setData: (k, v) => store.set(k, v),
    removeData: (k) => store.delete(k),
  },
  localStorage: {
    getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
  XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} abort() {} },
  DOMParser: class { parseFromString() { return {}; } },
  navigationDocument: { documents: [], pushDocument() {}, replaceDocument() {} },
  getActiveDocument: () => ({}),
  evaluateScripts: () => {},
};
sandbox.globalThis = sandbox;

const code = readFileSync(join(ROOT, 'bundle.js'), 'utf8');
try {
  vm.runInNewContext(code, sandbox, { filename: 'bundle.js', timeout: 10000 });
} catch (err) {
  console.error(`✖ bundle threw while loading: ${err.message}`);
  process.exit(1);
}

const missing = REQUIRED.filter((name) => sandbox[name] === undefined);
if (missing.length) {
  console.error(`✖ bundle did not publish: ${missing.join(', ')}`);
  process.exit(1);
}

// Spot-checks so a regression in a previously-fixed bug fails the build.
const { Utils, TV } = sandbox;

const playlist = [
  '#EXTM3U url-tvg="http://example.com/epg.xml"',
  '#EXTINF:-1 tvg-id="ch1" tvg-logo="http://example.com/1.png" group-title="Кино",Первый, HD',
  'http://example.com/1/index.m3u8?token=abc',
  '#EXTINF:-1 tvg-logo="http://example.com/2.png",Второй',
  '#EXTGRP:Спорт',
  'http://example.com/2.m3u8',
  '#EXTINF:-1,Третий',
  '#EXTVLCOPT:network-caching=1000',
  'rtmp://example.com/live/3',
].join('\n');
const parsed = TV.parsePlaylist(playlist, false, false);

const checks = [
  ['escapeForParser keeps existing entities',
    Utils.escapeForParser('Tom & Jerry &amp; Co &lt;x&gt;') === 'Tom &amp; Jerry &amp; Co &lt;x&gt;'],
  ['replaceText does not invert angle brackets',
    Utils.replaceText('5 < 10 > 2') === '5 &lt; 10 &gt; 2'],
  ['spoiler replaces every occurrence',
    Utils.spoiler('a <spoiler>x</spoiler> b <spoiler>y</spoiler>') === 'a [SPOILER] b [SPOILER]'],
  ['parseJSON survives an empty body', Utils.parseJSON({ responseText: '' }, 'fb') === 'fb'],
  ['md5 is functional', sandbox.md5('abc') === '900150983cd24fb0d6963f7d28e17f72'],
  // M3U parsing
  ['playlist yields every channel', parsed.length === 3],
  ['channel name keeps its comma', parsed[0] && parsed[0].title === 'Первый, HD'],
  ['group comes from group-title', parsed[0] && parsed[0].group === 'Кино'],
  ['tvg-logo is picked up', parsed[0] && parsed[0].logo === 'http://example.com/1.png'],
  ['#EXTGRP still works', parsed[1] && parsed[1].group === 'Спорт'],
  ['non-http schemes are kept', parsed[2] && parsed[2].url === 'rtmp://example.com/live/3'],
  ['#EXTVLCOPT is not treated as a URL', parsed[2] && parsed[2].title === 'Третий'],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`✖ behaviour check failed: ${failed.join('; ')}`);
  process.exit(1);
}

console.log(`✔ bundle loads and publishes all ${REQUIRED.length} required globals`);
