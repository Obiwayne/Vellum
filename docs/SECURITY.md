# Security review

## App, bridge and content

Scope: the Electron main process and window (`src/main/index.ts`), the WebSocket bridge (`src/main/bridge.ts`,
`mcp/src/bridge.ts`), the offscreen renderer (`src/main/offscreen.ts`), the preload, the renderer CSP, and how
design content (MCP `write_html`, pasted HTML, imported SVG, files on disk) is imported and rendered.

Tests: `mcp/test/security.mjs` (79 checks), run against a test instance:

```
set VELLUM_USER_DATA=%TEMP%\vellum-sec && set VELLUM_PORT=29190 && npx electron .
cd mcp && npm run build && set VELLUM_USER_DATA=%TEMP%\vellum-sec && set VELLUM_PORT=29190 && node test/security.mjs
```

### 1. Unauthenticated WebSocket bridge — High (fixed)

**Issue.** `ws://127.0.0.1:29170` accepted every client. Any local process, and any web page open in the
user's browser, could connect and read, change or export every design in the open profile. Browsers don't apply
CORS or the same-origin policy to WebSockets (cross-site WebSocket hijacking), and a DNS-rebinding page gets the
same access.

**Fix.**
- The handshake is rejected when the request has an `Origin` header (403). Browsers always send one; the MCP
  server (Node `ws`) never does.
- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (403 otherwise). This blocks DNS rebinding.
- A per-install secret is required. On first start the app writes 32 random bytes (hex) to
  `<userData>\bridge-token` (`%APPDATA%\Vellum\bridge-token`, file mode 0600; `%APPDATA%` is only readable by
  the current Windows user and administrators). The MCP server reads the same file on every connect
  (`VELLUM_USER_DATA` if set, else `%APPDATA%\Vellum`) and sends it in the `x-vellum-token` header. The app
  compares it in constant time (`timingSafeEqual`) and rejects anything else with 401. The MCP server turns a
  401/403 into a readable "bridge authentication failed" error.
- The server still binds to 127.0.0.1 only. `maxPayload` is 100 MB, per-message deflate is off, there are at
  most 8 connections and 64 in-flight requests per connection. Tool names are validated.
- Malformed input can't crash the main process. Before, a message of `null` threw a TypeError in the `message`
  handler. Binary frames, JSON that isn't an object, and missing or invalid `tool` names now get an error reply.
- `bridge:respond` IPC is only accepted from the main window's webContents.
- The user's registered MCP command doesn't change: the server finds the token file on its own. An MCP server
  process that was started before this change has to be restarted once (restart Claude Code), because old
  builds don't send the token.

**Verified.** `security.mjs` checks that a missing, wrong or truncated token gets 401; that a browser `Origin`
(also `null`) gets 403 even with the right token; that a foreign `Host` gets 403; that malformed JSON, `null`,
arrays and invalid tool names get error replies while the socket stays usable; that the MCP client works through
the token file; and that `regress.mjs`, `e2e.mjs` and `call.mjs list_files` pass.

### 2. Stored/injected script in design content (XSS in the privileged renderer) — High (fixed; mitigated before by CSP)

**Issue.** SVG inner markup was stored verbatim and inserted with `dangerouslySetInnerHTML` (canvas, dashboard
thumbnails) and `innerHTML` (offscreen measuring). SVG attributes were copied wholesale, including `on*`
handlers, which `NodeView` applied with `setAttribute`. Imported `href`/`src` kept `javascript:` URLs. `attrs.tag`
was emitted unchecked into exports, and attribute names were concatenated unescaped, so a crafted file could
inject markup (for example `x" onmouseover="…`). HTML break-out elements inside an `<svg>` (`</svg><img onerror>`,
`<meta http-equiv=refresh>`, `<base>`) reached the live document. The renderer CSP (`script-src 'self'`)
already blocked inline script and handlers, but not `<meta>` refresh navigation, `<base>`, or unsafe markup in
exported HTML/SVG/JSX files.

**Fix.** New `src/renderer/src/model/sanitize.ts`, applied on import and again at every render or export sink,
so old or hand-edited files are covered too.
- `sanitizeSvgMarkup`: parses the markup the same way the sinks do (HTML parser inside `<svg>`, in an inert
  DOMParser document) and re-serializes it by hand with everything escaped. Only SVG-namespace elements are kept,
  so HTML break-outs, `<script>`, `<foreignObject>`, `<iframe>`, comments and processing instructions are
  dropped. `on*` attributes are removed. `href`/`xlink:href` must be `#fragment` (`<use>`, gradients,
  `<feImage>`), a safe image URL (`<image>`: relative, http(s), blob, `data:image/…`), or a safe link (`<a>`).
  Script URLs are removed from every attribute. SMIL `set`/`animate*` elements that target `href`, `on*` or
  `style` are removed. `<style>` and `style=""` are kept unless they contain `@import`, `javascript:`,
  `expression(` or `-moz-binding`. The result is cached.
- `sanitizeAttrs` / `cleanAttrs`: valid attribute names only; no `on*`, `style`, `srcdoc`, `formaction`, `action`
  or `http-equiv`; safe `src`/`srcset`/`href`; no script URLs; `tag` must be a plain tag name and not a
  script, style, frame, object, meta, base, svg or math tag.
- `html.ts` import now skips `iframe`, `frame(set)`, `object`, `embed`, `applet`, `base`, `portal`, `math` and
  similar elements together with their content. `tagOf` falls back to `div`.
- Sinks: `NodeView` (SVG markup, SVG attributes, image `src`), `Thumbnail`, `nodeToRenderHtml` (canvas-equivalent
  markup for measuring and screenshots), `nodeToHtml`/`nodeToJsx`, and `get_jsx` (Tailwind).
- `_render_node`: `tokensCss` and `inheritedCss` end up inside `<style>` in rendered and exported documents,
  so `<` is CSS-escaped (`\3c `) and only valid custom-property token names are emitted. Before, a token value
  of `</style><script>…` injected script into exported HTML.
- The bridge handler lookup only uses own properties, so `__proto__`, `constructor` and similar names are not tools.

Legitimate content is unchanged: inline styles, CSS gradients, `data:image` and https images, http(s) links,
SVG shapes, gradients, filters, `<use href="#id">`, SVG `<style>` classes and SMIL opacity animations.

**Verified.** `security.mjs` writes a payload with about 25 vectors and checks the canvas render markup, the
export HTML and both JSX formats for script, handlers, `javascript:`, iframe/object/embed/base/meta,
`foreignObject`, external `<use>`, href animation and `@import`, and also that the legitimate features above
survive. It also checks token and font-family `</style>` injection. Manually: a stored file was edited on disk to
contain `<script>`, `onerror`, a `</svg><img onerror>` break-out, an `onload` attribute, an attribute name with
a quote, `attrs.tag = "script"` and `src="javascript:…"`. It opened in the app without incident, and
`_render_node` returned only `<image href="x"></image><circle r="2"></circle>` and `<img />`.

### 3. Offscreen render window could run design script — Medium (fixed)

**Issue.** The hidden window that rasterizes screenshots and exports (`main:render_png`, and the `renderHtml`
IPC) loaded agent-supplied HTML with JavaScript enabled and no CSP, so `<script>` and handlers in a design ran
there. The window is sandboxed, without node or preload, on an in-memory partition, but its script could still
make network requests and navigate. Arguments weren't validated.

**Fix.** Documents on the `vellum-render:` scheme are served with a strict CSP: `script-src 'none'`,
`default-src 'none'`, and styles, fonts and images only (https/data/blob), with no connect, frame, object or
form targets and `base-uri 'none'`. The measuring code is injected with `executeJavaScript`, which CSP doesn't
restrict. The render partition denies all permission requests and checks, and cancels downloads. Navigation,
redirects away from `vellum-render:`, frame navigation, webviews and new windows are all blocked. Render arguments
are validated and clamped (html type and 100 MB cap, scale 0.01–16, format enum, quality, maxDimension,
background length).

PDF export (`main:render_pdf`, the `renderPdf` IPC with the same `trustedSender` check) loads its document in the
same window, scheme and CSP, with the same HTML type and size checks; WebP encoding runs our own injected code in
that page on a `data:` PNG, which the CSP allows. Neither adds a way to write files: the app still saves through
the renderer's download (a save dialog), and MCP exports go through the export-folder policy (#6).

**Verified.** `security.mjs` checks that a `<script>` and an `onerror` handler that would resize the measured box
don't run (the box stays 10px), that normal 2x renders still work, and that a non-string `html` is rejected.
e2e screenshots and exports and the regress large-screenshot tiling pass.

### 4. Electron window hardening — Medium (fixed)

**Issue.** `contextIsolation`, `sandbox` and `nodeIntegration: false` were already set. But the main window had
no navigation guard (a design's `<meta http-equiv=refresh>`, a link or a dropped file could navigate the
privileged window away), no permission handler (every permission was granted by default), and a loose
`/^https?:/` check on `openExternal`. Privileged IPC didn't check the sender.

**Fix.**
- `webSecurity: true`, `allowRunningInsecureContent: false`, `webviewTag: false`, `navigateOnDragDrop: false`.
- `will-navigate` and `will-redirect` only allow the app's own URL (the dev-server origin, or the built
  `index.html`). Subframe navigations are blocked, and `will-attach-webview` is always prevented.
- `setWindowOpenHandler` always denies. `openExternal` (IPC and window-open) parses the URL and only opens
  absolute http(s) URLs without credentials, up to 2 KB.
- The default-session permission handlers only grant `clipboard-read`, `clipboard-sanitized-write`,
  `local-fonts` and `fullscreen`, and only to the main window at the app URL. Everything else is denied.
- The IPC handlers in `index.ts` (`renderHtml`, `capturePage`, `readClipboardMedia`, `openExternal`, reload,
  devtools, quit) check `trustedSender`: the main window's main frame at the app URL. `capturePage` clamps its
  rect to finite numbers. `trustedSender` is exported for the other IPC modules to use. The only `sendSync`
  handler (`mcpEntry`) just joins a path.
- DevTools can still be toggled from the menu. It only affects the local user's own window.

**Verified.** `npm run typecheck` and `npm run build` pass. The test instance and the user's instance start and
show the app, e2e and regress pass through the full app, and the only CSP report was the blocked `<base>` inside
the inert import document.

### 5. Renderer CSP — Low (tightened)

**Before:** `connect-src 'self' ws: http: https:` (any host) and no `object-src`, `base-uri`, `form-action` or
`frame-src`. **Now:** `script-src 'self'` (no `unsafe-inline`, no `unsafe-eval`), `connect-src 'self'
https://fonts.googleapis.com https://fonts.gstatic.com` (the only fetches are Google Fonts), `object-src 'none'`,
`frame-src 'none'`, `child-src 'none'`, `base-uri 'none'`, `form-action 'none'`, and `media-src`/`worker-src`
limited to self, data and blob. `img-src` still allows https/http/data/blob (designs use remote images), and
`style-src` still needs `'unsafe-inline'` because React inline styles and design styles are inline.
**Verified:** loading a Google font (Lobster) on the canvas logs no CSP violation. The app, thumbnails and
exports work.

### Notes and accepted risks

- An SVG `<style>` element is global CSS in the document, so an SVG can restyle parts of the app UI while it's on
  screen. It can't run script or load remote CSS (`@import` is removed). We keep `<style>` because SVG exports
  from design tools depend on it.
- Designs can reference remote http(s) images and Google Fonts, which reveals the user's IP address to those
  hosts when the design is shown. This is expected for a design tool.
- The bridge token protects against other users, web pages and sandboxed apps. Any program running as the same
  Windows user can read `%APPDATA%` and so can still reach the bridge. That is outside what a local app can
  prevent.
- If the app is started with `--user-data-dir`, set `VELLUM_USER_DATA` for the MCP server to the same folder so
  it finds the token.

## Profiles, storage and dependencies

Scope: `src/main/vault.ts` (profiles + encryption), `src/main/storage.ts` (IPC), `src/main/clipboard.ts`, the
renderer profile and persist code, the MCP server's `export`, `render.ts` and `fonts.ts`, and dependencies.
Tests: `cd mcp && npm run test:profiles` (105 checks, no app needed) and `node test/regress.mjs` /
`node test/e2e.mjs` against a test instance (`VELLUM_USER_DATA=<temp>`, `VELLUM_PORT=29191`).

### 6. MCP `export` could write anywhere — High (fixed)
**Issue.** `outputDir` was used as given, so an agent (or a prompt injection in design content it read) could
write files into any folder, e.g. the Startup folder. Existing files were checked with `access()` and then
written, which left a race in which a file could be overwritten.
**Fix.** (`mcp/src/index.ts`) Exports only go into the export folder (`VELLUM_EXPORT_DIR`, default
`Downloads\Vellum`) or a folder the user lists in the new `VELLUM_EXPORT_ROOTS`. A relative `outputDir` is resolved
inside the export folder. `..`, other drives, UNC paths and anything outside the roots are refused. The real
path is checked before and after `mkdir`, so a symlink or junction can't lead outside. Files are created with
`O_EXCL` (`flag: 'wx'`), which never overwrites a file or follows a planted link, and a ` (n)` suffix is added
on a name clash. File names made from layer names have separators and control characters removed, leading and
trailing dots and spaces trimmed, and device names such as `CON` prefixed.
**Verified.** `regress.mjs` section 3 covers relative subfolders, allowed absolute paths, a
`..\..\evil/../CON` layer name, no overwrite on a second export, and 8 refused outputDirs (`..`, `../escape`,
`..\..\escape`, `%TEMP%`, `C:\Windows\Temp`, `\\127.0.0.1\c$`, `//127.0.0.1/c$`, `sub/../../escape`). The
e2e export also passes.

### 7. Clipboard paste read UNC / device paths — Medium (fixed)
**Issue.** `readClipboardMedia` read every `file:` URL in `text/uri-list`. Any app, or a web page's copy
handler, can put such a list on the clipboard. On paste, `file://attacker/share/x.png` made Windows open an SMB
connection, which can leak the user's NTLM hash. Symlinks, devices and non-regular files were also read. The
size was checked before the read (a race), and a malformed URL threw and broke the whole paste.
**Fix.** Only `file:` URLs with an empty or `localhost` host that map to a drive-letter path are accepted.
`\\server`, `\\?\` and `\\.\` paths and NUL bytes are refused. `lstat` must report a regular file (symlinks
aren't followed). The size is checked again on the open handle, and the read stops at that size. There are
caps of 50 MB per file, 200 MB per paste and 50 files. The clipboard bitmap's MIME type is validated. Every item
is wrapped in try/catch, and logs show only the error code, never the path.
**Verified.** The URL filter was run against local, `localhost`, `file://server/share`, `file:////server`,
percent-encoded UNC, `\\?\`, `\\.\PhysicalDrive0`, NUL and relative cases. Only the two local paths pass.

### 8. Ids and paths at the main-process boundary — Medium (fixed)
**Issue.** The doc id check allowed any length and Windows device names (`CON`, `NUL`, `COM1`…). The vault's
own `safeId` accepted non-strings. `readJson` and `remove` accepted any path, and only `writeJson` checked its
path, with a case-sensitive string prefix. IPC arguments were passed on without type checks.
**Fix.** `isSafeId` / `safeId` in `vault.ts` (`[A-Za-z0-9_-]{1,128}`, strings only, no device names) is used
for every profile id (`open`, `recover`, `deleteProfile`, `profileDir`, entries of `profiles.json`) and every
doc id (`storage.ts` `docPath`). `readJson`, `writeJson`, `remove` and `path` all resolve the path and require
it to lie strictly inside the open profile's folder (`isInside`, via `path.relative`). With a profile open,
nothing can read or write another profile's folder or `profiles.json`. Every IPC argument is coerced to its
expected type. MCP file ids resolve only against the renderer store's own keys (`hasDoc`), so `__proto__` and
`constructor` are not files.
**Verified.** `profiles.mjs` "ids and paths" covers 18 bad ids (`..`, `a/b`, `C:`, UNC, `CON`, `nul`, 129
characters, NUL…), `open`, `delete` and `recover` with traversal ids, and read, write, remove and `path` outside
the open profile (all refused, and `profiles.json` stays intact).

### 9. No brute-force throttle on passwords — Medium (fixed)
**Issue.** Only the scrypt cost (about 0.3 s) slowed down guessing through IPC, and parallel calls ran in
parallel.
**Fix.** Every password or recovery-key check (`open`, `recover`, change, remove, new recovery key,
`deleteProfile`) runs through `Vault.guarded`. Checks are serialised per profile. After 3 wrong answers the next
attempt is refused until 1 s has passed, then 2, 4… up to 60 s ("Too many wrong attempts. Try again in N s.").
A correct answer resets the count. The count is kept in memory, so restarting the app resets it, but a restart
takes seconds and every guess still costs a full scrypt. Offline attacks on a copied `profiles.json` depend only
on scrypt.
**Verified.** `profiles.mjs` "brute-force throttle": after 3 wrong passwords even the correct one, delete and
recovery are refused. The delay doubles, and a correct answer after the wait opens the profile and resets the
count.

### 10. Crash safety of writes and conversions — Medium (fixed)
**Issue.** `writeAtomic` renamed without `fsync`. After a power loss NTFS could leave a zero-length
`profiles.json`, which would make every protected profile unrecoverable because the wrapped keys live there.
A crash during "remove password" could leave plaintext `*.tmp` files that nothing cleaned up, even after a
password was added again. A failed rename (antivirus holding the file) left the `.tmp` behind.
**Fix.** `writeAtomic` now writes to `.tmp`, calls `fsync`, closes, then renames. The rename is retried on
EPERM, EBUSY or EACCES, and the `.tmp` is removed if it finally fails. Each session start deletes stale `*.tmp`
files of the profile before anything is queued, then re-encrypts any plaintext file in a protected profile (as
before). Adding a password records the keys first and converts after, so a crash in between is healed at the
next unlock. If the conversion fails, the error says so. Removing a password decrypts first and drops the keys
last, and a crash in between is healed the same way.
**Verified.** `profiles.mjs` plants `one.json.tmp` and `index.json.tmp` plaintext leftovers and a plaintext doc
in a protected profile. After unlock the leftovers are gone and the doc is ciphertext.

### 11. Crypto review — Low (hardened)
**Found sound.** AES-256-GCM with a 32-byte key, a fresh random 96-bit IV per encryption and a 16-byte tag
checked on decrypt. The format has a version byte. scrypt uses N=2^17, r=8, p=1 (128 MiB) with a 16-byte salt.
The DEK is 256-bit random, wrapped under the password key and under an HKDF-derived key from a 128-bit random
recovery key, with the profile id as AAD. `profiles.json` holds no secret in clear. The renderer only receives
the recovery key once, to show it. No comparisons of secrets outside GCM, so no timing leaks. Nothing secret is
logged. `index.json` (prefs) and all docs of a protected profile are encrypted. Only name, avatar, colour and
auto-lock minutes are in clear, by design.
**Hardened.**
- **Format v2**: the AAD now includes the version byte and the file's name inside the profile
  (`files/<id>.json`), so ciphertexts can't be swapped between docs or passed off as `index.json`. v1 files
  still read and are rewritten as v2 on the next save.
- KDF parameters read from `profiles.json` are bounds-checked (N between 2^14 and 2^20 and a power of two,
  r 8–16, p 1–4, salt at least 16 bytes), so a tampered file can't weaken the KDF or cause a memory DoS.
- Wrapped keys are length-checked.
- The unwrapped DEK is copied into a non-pooled buffer and the intermediate buffers are zeroed.
- Passwords are limited to 1024 characters, and the recovery key input to 200.
- Auto-lock minutes are clamped to 0–1440.
- On quit (`will-quit` in `storage.ts`) the open profile is closed: pending writes finish and the DEK is zeroed.
- A profile's key is only zeroed after its queued writes have finished. Writes encode with the key current when
  they run.
**Verified.** `profiles.mjs` checks that new files are v2, that swapped ciphertext is rejected, that v1 still
reads and is rewritten as v2, and that an unknown version is rejected. It checks that `close()` zeroes the key
buffer, and that tampered KDF params (N=2), a malformed wrapped key and bad profile ids in `profiles.json` are
refused.

### 12. Fonts / network — Low (fixed)
**Issue.** `fonts.ts` stopped its 10 s timeout once the headers arrived, so a slow body could hang and had no
size cap. The cache was written in place, so two MCP processes or a crash could corrupt it. Family names from
the metadata went into a Google Fonts URL with `'` unescaped, and that URL is later placed in an SVG
`@import url('…')`.
**Fix.** One 20 s timeout now covers headers and body. The fixed URL must be https on `fonts.google.com`
(checked again after redirects). The body is streamed with a 32 MB cap. Only data that parses as metadata is
cached, and the cache (`%LOCALAPPDATA%\Vellum`) is written to a temp file and then renamed. Entries with
control characters, `<`, `>`, quotes, backticks or backslashes in the family name are skipped, and
`' ( ) ! *` are percent-encoded in the css2 URL. In `render.ts`, design CSS inside HTML `<style>` has `<`
escaped as `\3c `. The SVG export's `<style>` content is XML-escaped: before, the `&` of the Google Fonts URL
made the SVG malformed XML.
**Verified.** `regress.mjs` checks that an SVG export has no raw `&` in `<style>`. The e2e font and export checks
pass.

### 13. Dependencies — Info
`npm audit` finds 0 vulnerabilities in the root and in `mcp/`. Electron 44.5.0 is the latest 44.x, and
`@modelcontextprotocol/sdk` 1.31.0 is the latest release. Every direct dependency is used. The only newer
versions are major upgrades (React 19, Vite 8, zod 4, TypeScript 7, nanoid 6), which aren't security fixes and
would change behaviour, so they are left out.

### Notes and accepted risks (profiles)
- **Changing the password doesn't rotate the data key.** An old copy of `profiles.json` (a backup or a synced
  folder) still opens with the old password. To really revoke an old password, remove it (files are decrypted)
  and add a new one (new DEK), then create a new recovery key. Full DEK rotation on password change would be a
  possible later improvement.
- **Deleting a file doesn't wipe the disk blocks.** Removing a password, migrating legacy plaintext files or
  deleting a profile unlinks files. The old plaintext or ciphertext blocks can remain until the disk reuses them
  (SSD TRIM usually clears them). Use BitLocker for protection against someone with the disk.
- **Some secrets stay in memory as JS strings.** Passwords and the displayed recovery key are JS strings in the
  renderer and main, and can't be wiped. Decrypted designs live in renderer memory while the profile is open.
  Locking reloads the window.
- **Auto-lock runs in the renderer.** The idle timer is in the renderer, and MCP activity counts as activity,
  so an agent working keeps the profile unlocked. Locking on Windows session lock or sleep (`powerMonitor`)
  would be a small addition in `index.ts`.
- **Tampered files are out of scope.** Someone who can write to `%APPDATA%\Vellum` can plant plaintext files
  that the unlock heal then encrypts, or roll a doc back to an older ciphertext. Such an attacker can also
  change the app itself.
- **The saved recovery key file is plaintext.** "Save recovery key" writes a `.txt` file to a folder the user
  picks. The dialog text says to keep it private.

## Backups and recovery copies
`<file>.bak` (the previous version of a design, `index.json` or `profiles.json`) and `files/<id>.recovery` (unsaved edits) follow the profile: in a password-protected profile they are AES-256-GCM sealed with the data key like the files themselves (a `.bak` with its file's AAD, a `.recovery` with its own), and they are converted when the password is set or removed. Deleting a design deletes both. Stale `*.tmp` files are removed when a profile is opened.
