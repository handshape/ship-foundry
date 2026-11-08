# SP-10: Per-aspect harness pages

**Phase 4** · **Depends on:** SP-09, SP-04, SP-05, SP-06, SP-07 · **Primary
files:** `src/harness/{hull,modules,textures,aesthetics,export}.js` + `index.js`

## Goal
Provide one dedicated tuning page per tunable aspect, each a thin config over the
SP-09 framework, so any aspect can be tuned iteratively in isolation.

## Context
`hull.js` and `textures.js` exist as examples. `index.js` imports harnesses for
side-effect registration. The framework (SP-09) gives `paramControls` + a full
`api`.

## Scope
- **In:** one harness per aspect, registered and linked from
  `#/harness`:
    - **hull** — archetype, length, beam, height, cross-section, tapers, deck/keel,
      stations (SP-04 schema).
    - **modules** — density + per-module toggles/counts (SP-05 schema).
    - **textures** — palette, panel lines, greebles, wear, stripes, emblem, size
      (SP-06 schema).
    - **aesthetics** — pick an aesthetic, preview the re-roll, tweak its ranges,
      and save as a custom preset (SP-07).
    - **export** — choose GLB/GLTF, filename, texture resolution; preview the
      export; trigger download; (optional) re-import check.
  Each harness declares its param **schema** and a `build` that wires
  `paramControls` → `api.patchConfig`/`api.saveConfig`.
- **Out:** the frameworks themselves (SP-09) and the aspects' internals.

## Rules
- A harness edits only its own aspect's sub-object of the config (plus, for
  aesthetics, the aesthetic id). It never touches other aspects directly.
- Every harness has a live preview and a **Save to config** path (SP-09).

## Acceptance criteria
- [ ] `#/harness` lists all five harnesses; each is reachable and renders a
      live preview.
- [ ] Adjusting a harness's controls changes only that aspect in the preview.
- [ ] **Save to config** in a harness is reflected in the main app after reload.
- [ ] The export harness produces a valid downloadable file.
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Create the per-aspect harnesses in `src/harness/`: hull, modules, textures,
> aesthetics, and export. Each declares a param schema and a `build` that wires
> `paramControls` to `api.patchConfig` and `api.saveConfig`, with a live preview.
> The aesthetics harness picks/preview-rolls an aesthetic and can save a custom
> preset; the export harness chooses GLB/GLTF + filename + texture resolution and
> downloads. Register them all in `index.js`. Keep build and lint green.
