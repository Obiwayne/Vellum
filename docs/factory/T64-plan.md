# T64 plan: Handoff H4, the assets pipeline (images, SVG icons, fonts, PNG references)

Slice H4 of [T58-plan.md](T58-plan.md) (sections 3, 8, 10, 11 and task 4 of its breakdown). H1 (`devSpec`), H2 (`CNode.dev`) and H3 (`src/renderer/src/handoff/`, `buildHandoff`) are merged or flagged ready. This plan splits H4 so each piece is one branch and one review. It changes neither Design mode nor the file format.

## 1. Approach

H3 already **lists** assets: `HandoffOptions.assets?: AssetRecord[]` is printed into `spec.json` and the markdown and its paths are checked by `assertSafePaths`; H3 also reserves `screens/<slug>.<bp>.png`. H4 is the code that **decides** those records and **produces** the bytes behind them. Per the service-layer split in this codebase, the work is two layers:

- **Pure mechanics** (no DOM, no Electron, runs in vitest `node`): read an image's type and size from its bytes, decide which densities exist, decide names and de-dup, optimise an SVG and detect single-colour icons, plan the jobs. Deterministic.
- **Edge** (renderer, needs a canvas and the main-process renderer): resample an image down, rasterise a screen to PNG. Thin, and tested with an injected fake so the pure layers carry the logic.

```
Doc + frames ──► planAssets(doc, frames, measure)        pure   → AssetPlan { records, jobs, warnings }
                       │ records ─► buildHandoff({ assets })   (H3: lists them, no bytes)
                       ▼ jobs
              runAssetJobs(jobs, engine)                 edge   → files: Record<path, Uint8Array | string>
                       │ engine = { resize, renderPng } (canvas + window.canvasApi.renderHtml; fake in tests)
                       ▼
        H5 writer merges buildHandoff().files (text) with these (bytes) and writes the folder
```

### 1.1 Where it lives

`src/renderer/src/handoff/assets/` (inside H3's module, so one boundary to police; `iris` owns `handoff/` today, so tasks touching it say so):

| File | Layer | Does | Depends on |
|---|---|---|---|
| `bytes.ts` | pure | `dataUrlToBytes`, `sniff(bytes)` → `{ mime, ext, width, height }` for PNG, JPEG, GIF, WebP, SVG (header parsing only, no decode); `sha256Hex` (WebCrypto, async) | none |
| `density.ts` | pure | `densities(layoutW, layoutH, naturalW, naturalH)` → `{ list: [1,2,3], maxDensity }`; never upscales | none |
| `svgIcon.ts` | pure | `optimiseSvg(markup)` via `svgo`; `monochrome(markup)` → the single colour or null; `toCurrentColor` | `svgo` |
| `plan.ts` | pure | walks the exported nodes (same visibility and whitelist rules as H3's `collect`), returns `AssetPlan` | `bytes`, `density`, `svgIcon`, `handoff/paths.ts`, `devSpec` |
| `fonts.ts` | pure | `fontSourceOf(family, { google, local })` for `HandoffOptions.fontSource`, plus the licence line text used by `fonts.md` | `editor/inspector/fonts` list (data only) |
| `run.ts` | edge | `runAssetJobs(plan.jobs, engine)`; `canvasEngine()` and the PNG job runner | `window.canvasApi.renderHtml`, `OffscreenCanvas` |
| `index.ts` | | `prepareAssets(doc, options)` = `planAssets` + `runAssetJobs`, progress callback, cancel signal | all |

`svgo` is the one new dependency (devDependency-style bundle, MIT, approved in T58 section 16). It runs in the renderer (its `svgo/browser` build); the main process is not involved. No zip library is added here (H5's problem).

## 2. Decisions (so build tasks do not re-open them)

**Which assets exist.** Walked over the exported frames only, using the same hidden-layer and chosen-frame rules as H3 (`collect.ts`): an `image` node (`attrs.src`), an `svg` node, a shape with a `background-image: url(...)` fill, and an instance's twins like any node. Nothing from other pages, hidden layers, or unchosen frames, so nothing new can leak. External `http(s)` image URLs are **not fetched**: they are listed with `source: 'external'` and a warning ("image is a link, not bundled"). No network, ever.

**Images** (`kind: 'image'`):
- Bytes are the **original bytes** of the data URL, never re-encoded for the `@1x` file. Extension from the sniffed type (`png`, `jpg`, `gif`, `webp`, `svg`); a data URL whose declared type disagrees with its bytes uses the bytes and warns.
- Layout size is the measured box (`node.box.width/height`); natural size is the sniffed size. `maxDensity = min(natW / layoutW, natH / layoutH)`.
  - `@1x` is always the original file at its natural size when `maxDensity >= 1`; when the image is **smaller** than its box (`maxDensity < 1`) the original is exported once and the record says `maxDensity: 0.6` (no `@2x`, no `@3x`).
  - `@2x` and `@3x` exist only when `maxDensity >= 2` / `>= 3`; they are **down-sampled from the original** to `layout * d`, same format, JPEG quality 90, PNG/WebP lossless-as-supported. When the natural size is **exactly** `layout * d` the original is that file (no resample). Never upscaled.
  - When the original is larger than `3x` the `@1x` is still the original (not downsized): the dev gets the best pixels and `spec.json` carries `maxDensity` so they can choose. A decision to flag (section 7, Q2).
- Names: `assets/images/<screen-slug>-<layer-slug>.<ext>`, `@2x` / `@3x` suffix before the extension; collisions `-2`, `-3` via H3's `PathRegistry` (one registry per bundle, shared with H3 so paths cannot collide across files). The layer name is stored in `layerName` for humans.
- **De-dup** by SHA-256 of the original bytes: several nodes with identical bytes are written once; each record lists all `nodeIds`. The name comes from the first use in document order. Same bytes at different layout sizes: one file, `maxDensity` computed from the **largest** use.
- Animated GIF / APNG: exported as-is at `@1x` only, with a warning ("animated, not resampled").

**Image fills** (`background-image: url(data:...)`) follow the same rules and are referenced from the node by asset id in `spec.json` (the data URL is already stripped from `style.*` by H3).

**SVG icons** (`kind: 'icon'`; `svg` nodes, including picker icons which carry `data-name`):
- Run `svgo` with a fixed config (remove metadata, comments, empty groups, `title` is **kept**, `viewBox` kept, `width`/`height` removed when `viewBox` exists, ids prefixed per file to stay unique), plus `sanitizeSvgMarkup` from `model/html` first so no `<script>`, `on*` or external `href` survives. A fixed config means golden tests are stable.
- **`currentColor`**: if every painted `fill`/`stroke` resolves to one colour (and `none`), that colour is replaced by `currentColor` and the record notes `recoloured: true, was: '#111111'`. Multi-colour SVGs are untouched and flagged `multiColour: true`. Gradients, `<use>` and inline `style` with colours count as "not single-colour" (kept as is).
- Names: `assets/icons/icon-<picker-name>.svg` when `data-name` exists, else `icon-<layer-slug>.svg`. De-dup on the **optimised** text hash.
- Size: the node's box is the intended size; the file keeps `viewBox`, so it scales.

**Fonts.** `fonts.md` and `spec.json.fonts[]` are already written by H3. H4 supplies `fontSource`: `google` when the family is in the app's Google list or has a loaded `fetchCss` entry, `local` when it is in the locally installed list, `system` for generic and OS stacks, else `unknown`. The licence line is H3's text. **No font files are bundled and nothing is downloaded** (decision, section 7 Q1).

**PNG references** (`kind: 'png'`): for every exported breakpoint frame, one PNG at `1x` and, when the option asks, `2x`, named by H3 (`screens/<slug>.<bp>.png`, `@2x` suffix). Rendered by the same offscreen path as Export PNG (`window.canvasApi.renderHtml` with the document HTML from `renderDocument`, tokens CSS and fonts), at the frame's measured size, background from `exportBackground`. The PNG must show the frame in the **mode in effect** (default) or the mode the caller names. Hidden layers are not rendered (the render path already drops them; a test asserts it with a canary).

**Progress and limits.** `prepareAssets` takes `onProgress({ done, total, label })` and an `AbortSignal`. Defaults: stop and warn above 200 MB total or 500 files (`options.limits` overrides); a failed single asset becomes a warning and a record with `missing: true`, never a thrown error that loses the rest.

## 3. What H3 needs from this (the seam)

H3 is already shaped for it, so H4 adds no H3 behaviour change except two small things, done in H4's first task and reviewed with iris:
1. `AssetRecord` gains optional fields (`mime`, `bytes`, `width`, `height`, `density`, `maxDensity`, `source`, `recoloured`, `multiColour`, `missing`, `sha256`). `spec.schema.json` lists them (additive, schema stays `vellum.handoff/1`).
2. `HandoffResult.files` stays text. H4 returns bytes separately; a shared type `BundleFiles = Record<string, string | Uint8Array>` lives in `handoff/types.ts` for H5 to merge. `assertSafePaths` is run on the union before writing.

## 4. Order of work

1. **Task 1** `bytes.ts` + `density.ts` + record fields (pure, no new dependency).
2. **Task 2** `svgIcon.ts` with `svgo` (needs the dependency approved; independent of task 1).
3. **Task 3** `plan.ts` + `fonts.ts`: the plan over a doc (needs 1 and 2).
4. **Task 4** `run.ts`: resample engine and PNG renders, `prepareAssets` (needs 3).
5. **Task 5** integration test through `buildHandoff` with a real fixture and a byte-level assets golden (needs 4). Docs line for `docs/HANDOFF.md` is H12's.

Tasks 1 and 2 run in parallel. H5 (dialog) can start once task 3 lands because it needs only `plan.records` for counts and the tree preview.

## 5. Risks

- **Canvas resampling differs by platform.** Down-sampling goes through `OffscreenCanvas` (Chromium in Electron on all platforms, so same engine), but pixel-exact goldens are brittle. Mitigation: assert **dimensions, type and de-dup**, not pixels; pixel check only for a flat-colour fixture where any resampler agrees.
- **`svgo` output drifts between versions.** Pin the exact version, golden-test a small corpus (picker icons, an exported Figma-style SVG, a multi-colour logo, a malicious SVG), and treat a golden change as a reviewed diff.
- **Large files.** A 20-screen file with 4K photos can be hundreds of MB. Mitigation: limits above, de-dup first, stream jobs one at a time (peak memory = one image), progress and cancel.
- **Malicious SVG / data URL** reaches the bundle. Mitigation: sanitise before optimise, then a final allow-list check on the output (no `script`, `foreignObject`, `on*`, `javascript:`, external `href`/`url()`); canary test.
- **Wrong type claims.** A `.png` data URL that is really HTML. `sniff` returns `unknown`; the asset is skipped with a warning, not written.
- **PNG renders differ from the canvas** (fonts not loaded, images late). Mitigation: reuse `renderDocument` (it already awaits font CSS), add an explicit "images decoded" wait inside the render document, and fail the single PNG to a warning when it times out.
- **Name collisions across H3 and H4.** One shared `PathRegistry`; a test builds a doc whose image layer is called like a screen.

## 6. How it is tested

- **Unit (vitest `node`)**: `sniff` on tiny real PNG/JPEG/GIF/WebP/SVG fixtures (a few hundred bytes each, checked in as base64) and on truncated, zero-length and lying inputs; `densities` table (smaller than box, exactly 2x, 2.5x, 3x, huge, zero size, NaN); `monochrome` and `optimiseSvg` goldens; naming and de-dup (same bytes twice, same bytes at two sizes, case-insensitive collisions on Windows); `plan` on the H3 `checkoutFixture` extended with an image, an icon, a multi-colour logo, a background image, a hidden image (canary) and an image on another page (canary).
- **Edge with a fake engine**: `runAssetJobs` with `{ resize, renderPng }` fakes records the calls: resample only when needed, never for the original, one job at a time, abort stops, a throwing job yields a warning and `missing: true`.
- **Integration**: `buildHandoff({ assets: plan.records })` still validates against `spec.schema.json`; every path safe; the canary suite from H3 re-run with the new fixture (no hidden or other-page asset name or byte appears anywhere).
- **Real render (manual evidence, then e2e in H12)**: export a screen from the running app, open the PNG, compare with the on-screen frame within 1 px, and look at an `@2x`.
- `npm test` green and `tsc` clean at every task.

## 7. Questions for approval

1. **Google font files (T58 §8 "an option adds Google font files").** Downloading them is network access, which T58 §11 forbids ("Local only: no network"). Recommendation: **drop the option from 1.0 of the handoff**; `fonts.md` links the family page and the dev installs it. Say if you want an explicit, opt-in "Download Google fonts" step with its own warning instead.
2. **Original larger than `3x`.** Recommendation: export the original as `@1x` (best pixels, `maxDensity` in the spec). Alternative: also write a downsized true-`1x`, which costs a resample and a second file per image. The plan assumes the first.
3. **External image links.** Recommendation: list and warn, never fetch. Confirm.
4. **`svgo` as a runtime dependency** of the renderer bundle (about 400 kB). Recommendation: yes; the alternative is a hand-written optimiser, which T58 §8 already rejected.

Left out on purpose: bundling font files, fetching anything over the network, vectorising bitmaps, video/Lottie assets, image format conversion (WebP/AVIF re-encode), per-breakpoint different crops, and any change to how images are stored in the document.

## 8. Task breakdown (for the Captain to post)

Lines: `feature` (logic), `bugfix`. All tasks are inside `src/renderer/src/handoff/` (iris's area today: say so on the branch) plus `package.json` for task 2.

| # | Title | Acceptance criteria | Line | Needs |
|---|---|---|---|---|
| 1 | Asset bytes and density rules (H4a) | `bytes.ts` `dataUrlToBytes`, `sniff` returning `{ mime, ext, width, height }` for PNG, JPEG, GIF, WebP and SVG without decoding, and `unknown` for anything else or truncated input; `sha256Hex`; `density.ts` returns `list` and `maxDensity` and never lists a density above what the pixels allow; `AssetRecord` gains the optional fields and `spec.schema.json` accepts them (still `vellum.handoff/1`); table-driven tests incl. lying data URLs, zero and NaN sizes | feature | T62 |
| 2 | SVG optimise and currentColor (H4b) | `svgo` added at an exact version; `optimiseSvg(markup)` runs `sanitizeSvgMarkup` then a fixed svgo config and ends with an allow-list check (no `script`, `foreignObject`, `on*`, `javascript:`, external `href` or `url()`); `monochrome` finds the single paint colour or null; recolours to `currentColor` only when single-colour, flags multi-colour; golden tests for picker icons, a stroke icon, a fill icon, a multi-colour logo, a gradient icon and a malicious SVG; `viewBox` kept, ids unique | feature | none |
| 3 | Asset plan and font sources (H4c) | `planAssets(doc, frames, measure)` returns `AssetRecord[]` and jobs for images, image fills and icons of the exported frames only; names `<screen>-<layer>` with `-2` suffix via the shared `PathRegistry`; identical bytes written once with all `nodeIds`; `@2x`/`@3x` only when the pixels exist, original kept as `@1x`; external URLs listed not fetched; hidden-layer and other-page canaries never appear; `fontSourceOf` returns google/local/system/unknown and feeds `fontSource`; `buildHandoff` output validates | feature | 1, 2 |
| 4 | Asset runner: resampling and PNG references (H4d) | `runAssetJobs(jobs, engine)` runs one job at a time with progress and abort, resamples only down and only when needed, JPEG quality 90, and turns a failing job into a warning plus `missing: true`; `canvasEngine()` uses `OffscreenCanvas` and `renderHtml`; PNG per breakpoint at 1x (2x on request) in the mode in effect, hidden layers absent; size limits warn; tests with a fake engine for calls, order, abort and failure, plus one flat-colour real resample | feature | 3 |
| 5 | Assets end to end through the bundle (H4e) | `prepareAssets(doc, options)` plus `buildHandoff` on an extended fixture gives a file map whose assets, `spec.json.assets`, markdown references and `.handoff.json` hashes agree; every path safe and unique across text and byte files; bundle total under the limits; canary suite re-run with image, SVG and background-image canaries; sample output attached as evidence | feature | 4 |
