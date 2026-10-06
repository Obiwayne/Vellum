# T39 — Windows installer, packaged MCP server and auto-update: plan

Status: plan only, no code. Written against `package.json`, `electron.vite.config.ts`, `src/main/index.ts` (userData, single-instance lock, `IPC.mcpEntry`), `src/main/updater.ts` (git-based updater), `src/shared/api.ts` (`UpdatesApi`), `src/renderer/src/dashboard/ConnectAgentModal.tsx`, `mcp/` (`tsc` build, `dist/index.js`), `Vellum.cmd`, `scripts/make-shortcuts.ps1`, `.github/workflows/ci.yml`, `docs/MCP.md`, `docs/SECURITY.md`.

Input note: `docs/factory/T39-concept.md` and a discovery document do not exist in the repo. Scope is my reading of the title and of how Vellum is installed today. Assumptions are listed under "Decisions to approve".

## Where we are
- **Install today = `git clone` + `Vellum.cmd`.** The script runs `npm install`, builds `mcp/` and the app when sources are newer, then starts `node_modules\electron\dist\electron.exe` on the folder. `scripts/make-shortcuts.ps1` adds shortcuts to that launcher. The user needs Node, npm and git.
- **Updates today = git.** `src/main/updater.ts` runs `git fetch`/`git pull --ff-only`, `npm install`, a rebuild and a restart, only for clones (`UpdateStatus`, a card in the dashboard).
- **The MCP server is a separate Node program** (`mcp/`, its own `package.json`, `tsc` to `mcp/dist/index.js`, deps `@modelcontextprotocol/sdk`, `zod`, `ws`). Agents start it with `node <repo>/mcp/dist/index.js`; the "Connect your agent" dialogs print that command from `IPC.mcpEntry` (a path inside the repo). It finds the app through the bridge port (`VELLUM_PORT`, default 29170) and the secret in `<userData>\bridge-token`.
- **Data is already outside the app folder:** `%APPDATA%\Vellum` (profiles, files, bridge token). An installed copy and a clone share it, and share the single-instance lock and the bridge port.

## Approach

### 1. Package with electron-builder (NSIS), per-user
- `electron-builder.yml`: `appId: com.vellum.app`, `productName: Vellum`, NSIS one-click-off installer that installs **per user** to `%LOCALAPPDATA%\Programs\Vellum` (no admin prompt), Start Menu and Desktop shortcuts, the existing `resources/icon.ico`, `Vellum-Setup-<version>.exe`. The AppUserModelID equals the `appId` so taskbar pinning survives updates.
- Input is the existing `electron-vite build` output (`out/`). Production deps stay in `dependencies` (`ws`, …); the renderer is already bundled by Vite.
- `asar: true` for the app; anything an external process must read or run stays **unpacked** (see 2).
- One version source: `package.json` `version`. `WhatsNew.tsx` `APP_VERSION` is generated from it (it is a separate constant today).
- `npm run pack` (`electron-builder --dir`, unpacked app for tests and CI smoke) and `npm run dist` (installer).
- **Uninstall keeps `%APPDATA%\Vellum`** by default (designs are never deleted by an uninstall or an update); an opt-in checkbox "Delete my files too" is a custom NSIS page in a later task.

### 2. Package the MCP server inside the app
- **Bundle `mcp/` into one file** with esbuild (`resources/mcp/index.mjs`, SDK + zod + ws inlined, target node22), so the install does not need `npm install` or a second `node_modules`. `extraResources` copies it next to the app (outside the asar), so any process can read it.
- **Run it with Electron's own Node:** `Vellum.exe` with `ELECTRON_RUN_AS_NODE=1` and the bundle as argument. The user needs no Node install. The command agents run becomes
  `claude mcp add vellum -e ELECTRON_RUN_AS_NODE=1 -- "C:\Users\<you>\AppData\Local\Programs\Vellum\Vellum.exe" "C:\Users\<you>\AppData\Local\Programs\Vellum\resources\mcp\index.mjs"`
  (Codex/JSON configs get the same command, args and env). Dev clones keep `node mcp/dist/index.js`.
- `IPC.mcpEntry` grows into a small descriptor `{ command, args, env }` computed in main from `app.isPackaged`, `process.execPath` and `process.resourcesPath`; the renderer builds every agent snippet from it (one function, no copies of the command string in three dialogs).
- The updater replaces the install folder, so the printed path stays valid across updates (same folder, new files). A moved or reinstalled app shows a changed path; the dialog always prints the current one.
- Env vars stay as documented (`VELLUM_PORT`, `VELLUM_USER_DATA`, export roots).

### 3. Auto-update with electron-updater (packaged builds only)
- `electron-updater` with the **GitHub Releases** provider (`latest.yml` + installer + blockmap, differential download). Check 15 s after start and every 4 h (the git updater's timings); download in the background; never install silently mid-session.
- Map its events onto the existing `UpdateStatus` / `UpdatesApi` (`idle | checking | available | downloading | ready | error`, plus progress) so the dashboard card and the IPC surface are reused. Packaged builds use electron-updater, clones keep the git updater; `app.isPackaged` selects, nothing else changes for clones.
- UI: the card shows "Version 1.2.0 is available" → download progress → "Restart to update". Installing calls `quitAndInstall` only after the renderer confirms; files autosave, an update never touches `%APPDATA%\Vellum`. A Settings toggle "Check for updates automatically" (default on) and release notes from the GitHub release body.
- Failure is quiet and retryable (offline, rate limit, bad signature): status `error` with the message, retry at the next interval, the app keeps working.
- **Trust:** updates are fetched over HTTPS from the release feed; when the installer is code-signed, electron-updater verifies the publisher name before running it. Unsigned builds cannot be verified that way (see risks).

### 4. Releases and CI
- Release workflow on a `v*` tag: Windows runner, `npm ci`, typecheck, tests, `electron-builder --publish always` with `GH_TOKEN`; creates a draft release with installer, blockmap and `latest.yml`. A human publishes the draft.
- A CI job on every PR builds `electron-builder --dir` and runs a **packaged-app smoke test**: start the unpacked `Vellum.exe` with a temp `VELLUM_USER_DATA`, then run the MCP suites against it using the packaged bundle (`ELECTRON_RUN_AS_NODE`). That is the check that the installer's contents work, not only the dev tree.

## Order of work
1. Packaging config + `pack`/`dist` scripts + single version source.
2. MCP bundle + the packaged-MCP handshake smoke test.
3. Connect-agent dialogs use the descriptor.
4. NSIS options (shortcuts, per-user, uninstall keeps data) + silent install/uninstall script test.
5. Update engine (electron-updater wrapper, state mapping) with unit tests on a mocked updater.
6. Update UI (card states, restart, settings toggle).
7. Release workflow + PR packaged smoke job.
8. Run the existing MCP suites against the packaged exe; update test against a local feed.
9. Code signing (needs a certificate decision).
10. Docs: README install section, `docs/RELEASING.md`, `docs/MCP.md` setup, `docs/SECURITY.md`.

## Risks
- **SmartScreen / signing.** An unsigned installer shows "Windows protected your PC" and electron-updater cannot verify the publisher. Mitigation: ship unsigned for the first internal releases, call it out in the README, and plan signing (OV/EV certificate or Azure Trusted Signing) as its own task that needs Obi's decision and secrets.
- **`ELECTRON_RUN_AS_NODE`** must work for everything the MCP server uses (fs, net, ws, fetch, child processes). It runs without Chromium; the plan's smoke test (handshake + `tools/list` + a real tool call against the packaged app) is the proof. Fallback if an agent cannot pass env vars: a `vellum-mcp.cmd` shim in the install folder that sets the variable.
- **Two copies on one PC** (clone and installed) share `%APPDATA%\Vellum`, the single-instance lock and port 29170. The second one to start hands over to the first (existing lock). Documented; a clone can use `VELLUM_USER_DATA`/`VELLUM_PORT` to stay apart.
- **Antivirus and updates replacing a running exe.** The updater installs on quit, never while the app runs; the NSIS installer closes a running Vellum first.
- **Size and cold start.** The app is ~100 MB installed (Electron); the MCP bundle adds ~1 MB. Measure install size, first start and update download size in the tasks and record them.
- **Rate limits / private repo.** A private repository needs a token in the app to read releases, which must not ship. The plan assumes a public release feed (or a separate public releases repo) — a decision for Obi.
- **Windows only.** `ELECTRON_RUN_AS_NODE`, NSIS and paths are Windows-first like the rest of the app today.
- **Existing git updater** must not run in packaged builds (no `.git`); `app.isPackaged` guard plus a test.

## How it is tested
- **Unit (vitest):** descriptor builder (`isPackaged` true/false, paths with spaces), update-state mapping and retry on a mocked `autoUpdater`, version generation, settings toggle.
- **Packaged smoke (CI, Windows):** `electron-builder --dir`; launch the unpacked app with a temp data dir; the MCP client suites (`profiles`, `e2e`, `regress`, `security`) run through the packaged bundle; assert tool count and a screenshot export.
- **Installer test (CI):** silent install (`/S`), assert files, shortcuts and the uninstall entry, launch, uninstall silently, assert `%APPDATA%\Vellum` survives.
- **Update test:** a local HTTP server serves `latest.yml` + a newer installer built from the same commit with a bumped version; the app (with `VELLUM_UPDATE_URL` override, packaged builds only, test hook off by default) sees it, downloads, shows "Restart to update"; installing restarts into the new version and the data folder is intact. This runs locally and in CI.
- Manual before the first public release: install on a clean Windows user, connect Claude Code with the printed command, create a design, update to a newer build.
- Existing checks stay green: `npm test`, typecheck, `npm run test:mcp`, `npm run e2e` (dev tree).

## Decisions to approve
- electron-builder with an **NSIS per-user installer**; no admin rights, no MSI, no Store package.
- **MCP bundled** as one esbuild file and run through the app's own Electron-as-Node (`ELECTRON_RUN_AS_NODE`); users need no Node.
- **electron-updater + GitHub Releases** as the update feed (public), packaged builds only; the git updater stays for clones.
- Updates download in the background and install on an explicit "Restart to update" (or on next quit), never silently mid-session.
- First releases **unsigned**; signing is a separate, later task needing a certificate decision.
- Uninstall **keeps** the user's data folder.

## Left out
macOS and Linux builds; a beta/stable channel split; MSI/enterprise deployment; Microsoft Store; file associations or protocol handlers; telemetry or crash reporting; in-app release-notes history beyond the release body; moving the data folder; delta updates beyond electron-updater's blockmap; auto-update of the MCP server separately from the app (it ships with the app).

## Task breakdown

**T-A. Package the app with electron-builder (unpacked + installer)** — line: feature
- `electron-builder.yml` (appId `com.vellum.app`, per-user NSIS, icons, asar with the MCP bundle outside it) and scripts `npm run pack` and `npm run dist` exist; `npm run pack` produces `release/win-unpacked/Vellum.exe` that starts, opens the dashboard and uses a temp `VELLUM_USER_DATA` when given.
- `package.json` `version` is the single source: `APP_VERSION` and the installer name derive from it; a test fails if they differ.
- `npm run dist` writes `Vellum-Setup-<version>.exe`; its size and the unpacked size are noted in the task output; `npm test` and typecheck pass.

**T-B. Bundle the MCP server and run it from the packaged app** — line: feature
- A build step bundles `mcp/src/index.ts` with esbuild into `resources/mcp/index.mjs` (SDK, zod, ws inlined); `npm run pack` includes it as an extra resource outside the asar.
- A smoke test starts `Vellum.exe` from `release/win-unpacked` with `ELECTRON_RUN_AS_NODE=1` and the bundle, connects an MCP client over stdio, lists the tools (count equals the dev server's) and calls `get_basic_info` against a running packaged app.
- `mcp/` still builds with `tsc` and `npm run test:mcp` passes unchanged.

**T-C. Connect-agent dialogs use the packaged command** — line: ui
- `IPC.mcpEntry` returns `{ command, args, env }` (packaged: `process.execPath`, the bundle path, `ELECTRON_RUN_AS_NODE=1`; dev clone: `node mcp/dist/index.js`); one function builds the Claude, Codex and JSON snippets from it, used by both Connect-agent dialogs.
- Unit tests cover packaged and dev descriptors, paths with spaces (quoting) and the three agents' output; a screenshot of the dialog in a packaged build shows the real install path.
- `docs/MCP.md` setup section shows both forms.

**T-D. Installer behaviour: shortcuts, data, uninstall** — line: feature
- The installer is per-user (no UAC prompt), creates Start Menu and Desktop shortcuts, offers "Run Vellum", closes a running Vellum before installing, and registers an uninstall entry.
- Uninstall removes the app but leaves `%APPDATA%\Vellum` untouched.
- A script `scripts/test-installer.ps1` runs a silent install into a temp folder, checks files, shortcuts and registry entry, starts the app, uninstalls silently and checks the data folder survived; it passes locally and is wired for CI.

**T-E. Auto-update engine (packaged builds)** — line: feature (needs T-A)
- A wrapper around electron-updater (GitHub provider) in `src/main/` checks 15 s after start and every 4 h, downloads in the background and emits `UpdateStatus` states (`checking`, `available`, `downloading` with progress, `ready`, `error`) over the existing IPC; `app.isPackaged` selects it, clones keep the git updater and the git updater never runs in a packaged build.
- Install happens only on an explicit renderer request (`quitAndInstall`) or on the next quit; a failed check or download leaves the app usable and retries at the next interval.
- Unit tests on a mocked `autoUpdater` cover the state transitions, retry after error, no check when `isPackaged` is false, and a `VELLUM_UPDATE_URL` override that only works in packaged test runs.

**T-F. Update UI: card, progress, restart, setting** — line: ui (needs T-E)
- The dashboard card shows "Version X is available", the download progress and "Restart to update"; errors show a short message with Retry; the git-update wording stays for clones.
- Settings has "Check for updates automatically" (default on, honoured by T-E); release notes from the release body open from the card.
- UI wiring tests for each state plus screenshots of available, downloading, ready and error.

**T-G. Release workflow and PR packaging job** — line: feature (needs T-A, T-B)
- `.github/workflows/release.yml` builds on `windows-latest` for a `v*` tag, runs typecheck and tests, and publishes a **draft** release with the installer, blockmap and `latest.yml` using `GH_TOKEN`.
- `ci.yml` gets a `package` job: `npm run pack` plus the packaged-MCP smoke test from T-B; it must pass on a PR.
- `docs/RELEASING.md` describes tagging, publishing the draft and rolling back a release.

**T-H. Packaged-app regression and update test** — line: bugfix (needs T-B, T-E, T-G)
- `npm run test:mcp` accepts an `APP_EXE` (unpacked app) and passes all four suites against the packaged app and bundle.
- An update test serves `latest.yml` and a newer installer from a local server; the packaged app downloads it, shows "Restart to update", installs, restarts on the new version, and the data folder and a created file are intact; it passes locally and in CI.
- Measured install size, first-start time and update download size are recorded in the task evidence.

**T-I. Code signing (decision needed)** — line: feature
- Once Obi chooses a certificate or signing service and provides the secrets, the release workflow signs the installer and the app exe; the updater verifies the publisher name.
- A signed installer passes `Get-AuthenticodeSignature` in CI and SmartScreen shows the publisher; unsigned local builds still work. If no certificate is chosen, this task stays closed and the README states the SmartScreen warning.

**T-J. Docs: install, update, security** — line: feature (docs; after T-A..T-H)
- README: a download-and-install section for the installer (with the SmartScreen note while unsigned), the clone route kept for developers, how updates work, where data lives and how to uninstall without losing it.
- `docs/SECURITY.md`: update feed trust, what signing does and does not cover, the `VELLUM_UPDATE_URL` test hook; `docs/MCP.md`: packaged setup and the `ELECTRON_RUN_AS_NODE` explanation; Learn page entry for updates.
- Every command and label in the docs is checked against a packaged build and its screenshot.
