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
// Drives the XHR stub so Network.loadItemsFrom's branches can be exercised.
const net = { response: { status: 200, responseText: '{}' }, modals: 0, aborts: 0, queue: false, pending: [] };
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
  XMLHttpRequest: class {
    constructor() { this.status = 0; this.responseText = ''; this.aborted = false; }
    open() {} setRequestHeader() {}
    abort() { net.aborts++; this.aborted = true; if (this.onabort) this.onabort(); }
    send() {
      if (net.queue) { net.pending.push(this); return; }
      this.status = net.response.status;
      this.responseText = net.response.responseText;
      if (this.onload) this.onload();
    }
    settle(status, body) {
      if (this.aborted) return;   // an aborted xhr fires neither load nor error
      this.status = status;
      this.responseText = body;
      if (status === 0) { if (this.onerror) this.onerror(); }
      else if (this.onload) this.onload();
    }
  },
  DOMParser: class { parseFromString() { return {}; } },
  navigationDocument: {
    documents: [],
    pushDocument() { net.modals++; },
    replaceDocument() { net.modals++; },
    presentModal() { net.modals++; },
  },
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
  // Regression: the CHANGELOG is plain text fed to an XML parser. Raw < or >
  // reaching parseWithContext threw, which broke the settings page and wedged
  // every page opened afterwards.
  ['escapeText escapes angle brackets',
    Utils.escapeText('a & b < c > d') === 'a &amp; b &lt; c &gt; d'],
  ['escapeText keeps existing entities',
    Utils.escapeText('&amp; &#171; x') === '&amp; &#171; x'],
  ['escapeForParser still passes markup through untouched',
    Utils.escapeForParser('<title>x</title>') === '<title>x</title>'],
  ['the real CHANGELOG survives escaping',
    !/[<>]/.test(Utils.escapeText(readFileSync(join(ROOT, 'CHANGELOG'), 'utf8')).replace(/&lt;|&gt;/g, ''))],
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
// Closing the player fires watching/marktime with no callback. A 200 whose body
// is not JSON must stay silent there — it used to raise "Некорректный ответ
// сервера" and abort every in-flight request.
sandbox.API.setToken('smoke-test');
function drive(responseText, status = 200) {
  net.response = { status, responseText };
  net.modals = 0;
  net.aborts = 0;
  sandbox.Cache.remove('watchingmarktimemarktimeundefinedpage0');
  sandbox.Network.loadItemsFrom(
    { items: 'watching', from: 'marktime', id: 'marktime', filters: { id: 1 } },
    () => {}, true);
  return { modals: net.modals, aborts: net.aborts };
}
const quiet = (r) => r.modals === 0 && r.aborts === 0;
// An error must still surface, but it must NOT abort unrelated in-flight
// requests: doing so stranded the page the user had just opened, leaving it
// blank until the tab was reselected.
const alerts = (r) => r.modals === 1 && r.aborts === 0;

checks.push(
  ['unparseable 200 stays silent', quiet(drive('OK\n'))],
  ['whitespace-only 200 stays silent', quiet(drive('\n  '))],
  ['empty 200 stays silent', quiet(drive(''))],
  ['valid JSON 200 stays silent', quiet(drive('{"items":[]}'))],
  ['200 carrying {"error"} still alerts', alerts(drive('{"error":"boom"}'))],
  ['HTTP 502 still alerts', alerts(drive('', 502))],
  ['an error does not abort other in-flight requests', drive('', 502).aborts === 0],
);

// saveTopShelf runs before the page renders. A throw there blanked the page and
// left the TopShelf permanently stuck, because every later write failed the same
// way on the same stored value.
function topShelfSurvives(stored) {
  const key = sandbox.KEYS.topshelf;
  store.delete(key);
  if (stored !== null) store.set(key, stored);
  try {
    sandbox.KP.saveTopShelf(
      [{ id: 1, type: 'movie', title: 'A / B', kinopoisk_rating: 7, posters: { big: 'https://m.pushbr.com/a.jpg' } },
       { id: 2, type: 'movie', title: 'C' }],
      sandbox.topShelfOptions.unwatched, 'Недосмотренные фильмы');
    return !!store.get(key);
  } catch { return false; }
}

checks.push(
  ['topshelf: no stored value', topShelfSurvives(null)],
  ['topshelf: valid stored value', topShelfSurvives(JSON.stringify({ sections: [{ title: 'Недосмотренные фильмы', items: [] }] }))],
  ['topshelf: stored "null"', topShelfSurvives('null')],
  ['topshelf: object without sections', topShelfSurvives('{}')],
  ['topshelf: empty sections array', topShelfSurvives('{"sections":[]}')],
  ['topshelf: corrupt JSON', topShelfSurvives('not json at all')],
  ['topshelf: item with no posters is skipped', topShelfSurvives(null)],
);

// An empty or unparseable body falls back to the xhr. Caching that object meant
// every revisit within 60s replayed it to callers expecting result.items, which
// threw and left the page blank — reachable by simply revisiting a tab.
function cachesFallback() {
  const o = { items: 'items', type: 'movie', from: 'hot', id: 'cachetest', title: 'x' };
  net.response = { status: 200, responseText: '' };
  sandbox.Network.loadItemsFrom(o, () => {});
  net.response = { status: 200, responseText: '{"items":[{"id":1}]}' };
  let second;
  sandbox.Network.loadItemsFrom(o, (r) => { second = r; });
  return !(second && Array.isArray(second.items));
}
function cachesValidData() {
  const o = { items: 'items', type: 'serial', from: 'hot', id: 'cachetest2', title: 'x' };
  net.response = { status: 200, responseText: '{"items":[{"id":9}]}' };
  sandbox.Network.loadItemsFrom(o, () => {});
  net.response = { status: 500, responseText: '' };
  let second;
  sandbox.Network.loadItemsFrom(o, (r) => { second = r; });
  return !!(second && Array.isArray(second.items));
}

checks.push(
  ['cache: a fallback response is never cached', !cachesFallback()],
  ['cache: valid data is still cached', cachesValidData()],
);

// The reported failure: leaving a tab whose request then fails must not strand
// the request belonging to the tab just opened. It used to abort it, and an
// aborted xhr never calls back, so that page stayed blank until reselected.
function otherTabSurvivesAFailure() {
  net.queue = true;
  net.pending = [];
  let rendered = false;
  sandbox.Network.loadItemsFrom({ items: 'items', type: 'serial', from: 'hot', id: 'tabA' }, () => {}, true);
  sandbox.Network.loadItemsFrom({ items: 'watching', type: 'serial', from: 'serials', id: 'tabB' },
    (r) => { if (r && Array.isArray(r.items)) rendered = true; }, true);
  const [a, b] = net.pending;
  net.queue = false;
  if (!a || !b) { return false; }
  a.settle(502, '');
  b.settle(200, '{"items":[{"id":1}]}');
  return rendered;
}

checks.push(['a failing request does not strand another tab', otherTabSurvivesAFailure()]);

// AppSettings parses stored settings while the module loads. A throw there
// happened before the app existed, so corrupt storage meant it could not start
// and nothing inside the app could clear it.
function bootsWith(storedSettings) {
  const s = new Map();
  if (storedSettings !== null) s.set('localStorage_kpSettings', storedSettings);
  const sb = { console: { log() {}, error() {}, warn() {} },
    setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {},
    App: {}, Device: sandbox.Device,
    userDefaults: { getData: (k) => s.get(k), setData: (k, v) => s.set(k, v), removeData: (k) => s.delete(k) },
    localStorage: { getItem: (k) => s.get(k) ?? null, setItem: (k, v) => s.set(k, v), removeItem: (k) => s.delete(k) },
    XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} abort() {} },
    DOMParser: class { parseFromString() { return {}; } },
    navigationDocument: { documents: [], pushDocument() {}, replaceDocument() {} },
    getActiveDocument: () => ({}), evaluateScripts: () => {} };
  sb.globalThis = sb;
  try {
    vm.runInNewContext(readFileSync(join(ROOT, 'bundle.js'), 'utf8'), sb);
    const q = sb.AppSettings && sb.AppSettings.get('userQuality');
    return !!(q && q.id);
  } catch { return false; }
}

checks.push(
  ['boots with corrupt stored settings', bootsWith('not json at all')],
  ['boots with stored settings of the wrong type', bootsWith('[1,2,3]')],
  ['boots with valid stored settings', bootsWith(JSON.stringify({ userQuality: { id: '720p', name: '720' } }))],
);

// A refresh that never reached the server said nothing about the credentials,
// but every caller treated it as "make the user activate again". One blip while
// refreshing — waking from sleep before the network is up, say — signed the user
// out with a perfectly good refresh token.
function sessionKeptWhen(status, body) {
  const expired = String(Math.floor(Date.now() / 1000) - 3600);
  const s = new Map([
    ['localStorage_accessToken', 'old'],
    ['localStorage_refreshToken', 'good-refresh'],
    ['localStorage_tokenExpires', expired],
  ]);
  const sb = { console: { log() {}, error() {}, warn() {} },
    setTimeout() {}, setInterval() {}, clearTimeout() {}, clearInterval() {},
    App: {}, Device: sandbox.Device,
    userDefaults: { getData: (k) => s.get(k), setData: (k, v) => s.set(k, v), removeData: (k) => s.delete(k) },
    localStorage: { getItem: (k) => s.get(k) ?? null, setItem: (k, v) => s.set(k, v), removeItem: (k) => s.delete(k) },
    DOMParser: class { parseFromString() { return {}; } },
    navigationDocument: { documents: [], pushDocument() {}, replaceDocument() {} },
    getActiveDocument: () => ({}), evaluateScripts: () => {} };
  sb.XMLHttpRequest = class {
    constructor() { this.status = 0; this.responseText = ''; }
    open() {} setRequestHeader() {} abort() {}
    send() { this.status = status; this.responseText = body; if (this.onload) this.onload(); }
  };
  sb.globalThis = sb;
  vm.runInNewContext(readFileSync(join(ROOT, 'bundle.js'), 'utf8'), sb);
  sb.showActivationPage = () => {};
  return sb.Auth.check();
}

checks.push(
  ['auth: a successful refresh keeps the session', sessionKeptWhen(200, '{"access_token":"a","refresh_token":"b","expires_in":86400}')],
  ['auth: network failure keeps the session', sessionKeptWhen(0, '')],
  ['auth: 502 keeps the session', sessionKeptWhen(502, '')],
  ['auth: an unreadable 200 keeps the session', sessionKeptWhen(200, '<html>')],
  ['auth: 400 invalid_grant signs out', !sessionKeptWhen(400, '{"error":"invalid_grant"}')],
  ['auth: 401 signs out', !sessionKeptWhen(401, '{"error":"unauthorized"}')],
);

// The connection pool is 6 per host and a page issues about that many, so a page
// left mid-load kept the next page's first request queued behind it. Cancelling
// must be scoped to the page being left: aborting everything is what used to
// strand the page the user had just opened.
function groupCancellationIsScoped() {
  net.queue = true;
  net.pending = [];
  let oldPageCalledBack = false, newPageCalledBack = false;
  const groupA = sandbox.Ajax.newGroup();
  sandbox.Network.loadItemsFrom({ items: 'items', type: 'movie', from: 'hot', id: 'oldpage' },
    () => { oldPageCalledBack = true; }, true);
  sandbox.Ajax.newGroup();
  sandbox.Network.loadItemsFrom({ items: 'items', type: 'serial', from: 'hot', id: 'newpage' },
    () => { newPageCalledBack = true; }, true);
  const aborted = sandbox.Ajax.abortGroup(groupA);
  const pending = net.pending.slice();
  net.queue = false;
  pending.forEach((x) => x.settle(200, '{"items":[]}'));
  // The page being left is cancelled; the page just opened still renders.
  return aborted === 1 && !oldPageCalledBack && newPageCalledBack;
}

checks.push(['request cancellation is scoped to the page being left', groupCancellationIsScoped()]);

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`✖ behaviour check failed: ${failed.join('; ')}`);
  process.exit(1);
}

console.log(`✔ bundle loads and publishes all ${REQUIRED.length} required globals`);
