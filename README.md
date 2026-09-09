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

## Deploy

The app is served from GitHub Pages, published by the `deploy` job in
`.github/workflows/build.yml`. It is **manual** — run it from the Actions tab.
The Apple TV client re-fetches its bundle from the published URL on every
launch, so whatever is live is what every user runs immediately; there is no
staged rollout to hide a bad build behind.

The published tree is only what the app fetches at runtime:

| File | Read by |
|---|---|
| `bundle.js`, `bundle.min.js`, `application.js` | The boot URL. All three are the same build — the host may use any of these names, and the published tree has no `js/` directory. |
| `img/imdb.png`, `img/kinopoisk.png`, `img/kinopub.png` | Per-item rating rows. The other images are inlined into the bundle. |
| `CHANGELOG` | `KP.showHistory()` |
| `VERSION` | `KP.checkNewVersion()`, compared against the baked-in `APP_VERSION` |

Because `VERSION` is compared against `APP_VERSION`, the two must be bumped
together or every client will show the "new version, restart" prompt forever.

Set `API_ENCODED`, `API_LEGACY_ENCODED` and `API_EXT2_LEGACY` as repository
secrets if the deployed build needs endpoints other than the defaults in
`js/consts.js`. For a custom domain, prefer Settings → Pages; the optional
`PAGES_CNAME` repository variable writes a `CNAME` into the artifact instead.
A domain can only be claimed by one repository, so a fork must not reuse the
upstream's.

### Keeping personal accounts off workflow runs

Every workflow run records an actor, and the actor is always the account behind
the credential that triggered it:

| Trigger | Actor |
|---|---|
| `push` | the account whose credentials pushed |
| `workflow_dispatch` | the account that clicked "Run workflow" |
| `repository_dispatch` | the account owning the token that sent the dispatch |
| `schedule` | the account that last modified the workflow file |

`kpappfork` is an organisation, and organisations cannot push or author commits —
only user accounts can. So keeping a personal account out of the run history means
routing pushes and deploys through a **machine account** that belongs to the org:

1. Create a separate GitHub user for the org (e.g. `kpappfork-ci`) and invite it
   with write access to this repository.
2. Give it a fine-grained personal access token scoped to this repository, with
   `Contents: read and write` and `Metadata: read`.
3. Push with that account's credentials rather than your own, so `push`-triggered
   runs are attributed to it.
4. Deploy headlessly instead of clicking "Run workflow", so the deploy is
   attributed to the token's owner:

   ```bash
   GH_TOKEN=<machine-account-token> \
     gh api repos/kpappfork/atv4/dispatches -f event_type=deploy
   ```

The workflow itself never reads `github.actor`, never prints the environment, and
touches secrets only through the `secrets` context — the actor in the run list is
GitHub's own metadata, not something the job discloses.

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
