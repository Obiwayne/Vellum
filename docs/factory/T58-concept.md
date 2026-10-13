# T58 — Dev Mode: concept

Discovery: there is no separate `T58-discovery.md`. The discover findings (what a developer gets today, the gaps, prior art) are section 1 of `docs/factory/T58-plan.md`, written first. This document replaces the plan's concept and design sections as the decision record.

## Goal
Let a developer (a person, or an agent over MCP) build a screen from a Vellum design to the pixel: read exact resolved numbers, tokens, typography, assets and code for any layer, without risk of editing the design and without leaving Vellum.

Success test: for a given artboard, a dev can reproduce every layer's box, spacing, colour and type from the panel alone, and a build screenshot matches the design export.

## Options

### A. Read-only Inspect toggle (smallest)
Add an "Inspect" switch to the existing right panel that swaps the editing sections for a read-only value list for the selection. No canvas changes.
- **Changes:** one new inspector view, `model/devSpec.ts` (or inline reads), top-bar toggle.
- **Cost:** about 2 slices (spec model, panel). Low risk; no gating of canvas edits.
- **Trade-offs:** canvas stays editable, so a dev can still nudge or delete layers; no redlines, so spacing between layers still has to be computed by hand; no code tab beyond today's right-click copy.

### B. Dev Mode: read-only editor mode with Spec panel, redlines, code and assets (recommended)
A mode of the editor (`D`, top-bar `Design | Dev`). Canvas navigable but never edits; inspector becomes the Spec panel (box, layout, type, paints, tokens, assets, code); hover shows pixel distances; MCP `get_dev_spec` returns the same data.
- **Changes:** `EditorState.devMode` (not in the file, no migration), `canEdit` guards in canvas, shortcuts, layers tree and context menu, new `model/devSpec.ts`, Spec panel, redline overlay, `copyAs` routed through `jsx-components`, one MCP tool and docs.
- **Cost:** about 7 slices (A–G in the plan): spec model, mode and gating, panel, code and assets, redlines, MCP, end-to-end and docs. Moderate: the risk is a missed edit entry point, handled by a guard test.
- **Trade-offs:** audience must open Vellum. Reuses the existing measure and code generators, so panel, clipboard and agent output agree.

### C. Handoff export: static viewer bundle
"Export for developers" writes a folder or single HTML: artboard images, `spec.json`, `tokens.css`, assets, and a small viewer that offers the Spec panel and redlines in a browser.
- **Changes:** a serialiser for the whole file's specs, a standalone viewer (separate bundle, own build), packaging and docs.
- **Cost:** large (about 8–10 slices): measuring every node of every page at export, a second UI codebase, versioning the spec format, keeping the viewer in sync with the app.
- **Trade-offs:** the only option that serves a developer without Vellum. A snapshot goes stale, and image-based viewing loses the live DOM.

## Recommendation
**Option B**, with C as a later follow-on built on the same `NodeSpec` data.

Reason: B delivers the whole inspect → measure → copy loop for the people who use Vellum today (Obi and agents) at moderate cost, and it is where `NodeSpec` is defined; C then becomes "serialise `NodeSpec[]` plus a viewer" rather than a new design. A alone leaves the two things a handoff needs most, safety (no accidental edits) and redlines, unaddressed.

Decision for Obi that could change this: if the developer only ever receives a file or link, C moves ahead of the Spec panel polish and B's slices A, C and D still come first because C needs them.

## Out of scope
- Ready-for-dev status, approvals, seats, permissions.
- Cloud links, accounts, Jira/Slack/VS Code integrations, plugin API.
- Editing from Dev Mode (including "fix this value" suggestions).
- The static viewer (option C) and the build-vs-design compare overlay: both are follow-ons, not first release.
- Generating a whole app or framework scaffolding; code output stays per-layer snippets from the existing generators.
- Changes to the file format.

## Name candidates
Checked 2026-10-13: GitHub with `gh repo view Obiwayne/<name>` (owner Obiwayne, where the Vellum repo lives; failing = free); npm with `npm view <name>` (404 = free). These are names for the feature/export, shown as the unscoped npm name and as the `vellum-` prefixed one.

| Name | Rationale | GitHub (Obiwayne/…) | npm |
|---|---|---|---|
| Dev Mode | What designers already call it; zero learning cost. UI label, not a package. | n/a | n/a |
| vellum-spec | Says what it produces: a spec for a layer. Fits `get_dev_spec` / `NodeSpec`. | free | free |
| vellum-handoff | Names the job; fits a future static export (option C). | free | free |
| vellum-redline | The signature feature (distances). Narrow: undersells code and tokens. | free | free |
| vellum-caliper | A measuring tool; memorable. Less obvious than "spec". | free | free |
| redline / caliper / plumb (bare) | Short names without the prefix. | free (under this owner) | taken |

Pick: **Dev Mode** as the UI name, **vellum-spec** if a package or export format needs a name. Bare npm names are taken, so use the `vellum-` prefix.
