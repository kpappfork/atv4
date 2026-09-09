# atv4

TVML/TVJS client for Apple TV.

## Layout

| Path | What it is |
|---|---|
| `application.js` | Entry point. Declares the module load order and the boot sequence. |
| `js/*.js` | The modules. Plain scripts sharing one global scope — no imports. |
| `bundle.js`, `bundle.min.js` | **Generated.** Do not edit by hand — run `npm run build`. |
| `img/`, `CHANGELOG`, `VERSION` | Assets and metadata served alongside the app. |
| `build/` | The build suite (see below). |

There are two ways the app boots, and both come from the same sources:

- **Un-bundled** — the host loads `application.js`, which `evaluateScripts()`s each
  `js/*.js` at runtime. Used during development: edit a module, relaunch, done.
- **Bundled** — the host loads `bundle.js`, which has every module inlined. This is
  what `AppSettings.setDefaultUrl()` registers as the playlist boot URL, so it is
  what most installs actually run.

`application.js` picks the path via `__BUNDLED__`, which the bundler replaces with
`true`. Anything you change in `js/` only reaches bundled installs after a rebuild.

## Build

```bash
npm install
npm run build
```

That runs the checks, writes `bundle.js` and `bundle.min.js`, and smoke-tests the
result. Other scripts:

| Command | What it does |
|---|---|
| `npm run build` | Full pipeline: check → bundle → smoke test. |
| `npm run build:dev` | Unminified bundle, for reading the output or debugging. |
| `npm run check` | Parse, handler, and lint checks — no output written. |
| `npm run lint` | ESLint only. |
| `npm run check:handlers` | Verifies every TVML `onselect`/`onplay` handler resolves. |
| `npm run smoke` | Loads the built bundle against TVJS stubs. |

### Build-time configuration

The API endpoints are injected from the environment and are optional — with none
set, the defaults in `js/consts.js` apply.

```bash
API_ENCODED=... API_LEGACY_ENCODED=... API_EXT2_LEGACY=... npm run build
```

These are substituted into `js/settings.js` as literals, so the branches that do
not apply are dropped from the output.

### What the bundler does

1. Reads the module order from the `javascriptFiles` array in `application.js` —
   one source of truth, so adding a module means editing one list.
2. Concatenates the modules and `application.js`, wraps them in an IIFE, and
   re-publishes every top-level declaration on `globalThis`. TVML markup calls
   handlers by name (`onselect="KP.moviesPage()"`), so those names must stay
   global and unminified.
3. Inlines `${baseURL}img/*.png` references as data URIs. The per-item rating
   icons use string concatenation instead and stay as URLs on purpose — they
   repeat once per list item.
4. Minifies with esbuild (`safari11`, ASCII output).

## Checks

Three checks run before every build, each aimed at a failure mode this codebase
has actually shipped:

- **`build.mjs --check`** — every source parses as one concatenated scope.
- **`check-handlers.mjs`** — handler attributes in markup are invisible to a
  linter, so a name that is not global only fails when a user presses the button.
  This scans every `onselect`/`onplay`/`onholdselect` attribute and resolves the
  root identifier of each call.
- **`eslint`** — `no-undef` above all. Cross-file globals are legal here, so the
  project's own top-level declarations are fed in as globals from
  `build/globals.mjs`; anything left undefined is a genuine typo.

`smoke-test.mjs` then runs the built bundle against minimal TVJS stubs and asserts
the globals markup depends on are actually published — a bundle can parse fine and
still fail to publish (`md5` reaches the global scope through a UMD wrapper).
