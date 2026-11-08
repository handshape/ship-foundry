# SP-08: Main application UI

**Phase 3** · **Depends on:** SP-01…SP-07 · **Primary file:** `src/views/main.js`
(new: `src/app/state.js`, `src/views/components/*` as needed)

## Goal
Build the real main app: a live 3D viewport plus a control panel that edits a
`ShipConfig`, a saved-ship gallery, and export — all wired to the spine.

## Context
The scaffold main view already renders a placeholder ship and has Randomize /
Export GLB / Save + a date-only gallery. It must become the full generator UI.

## Scope
- **In:**
  - A **shared app state** module (`src/app/state.js`): holds the current
    `config`, the live `THREE.Group`, and a subscribe/notify mechanism so the
    viewport, control panel, and gallery stay in sync.
  - **Control panel**: aesthetic picker (SP-07 `listAesthetics`); per-aspect
    param groups (hull, modules, texture) rendered from the config schema with
    DaisyUI inputs; **debounced** live regeneration on change; **Randomize**
    (new `seed`, re-roll within the selected aesthetic).
  - **Ship card**: name, derived class (from length), key stats (SP-03).
  - **Saved-ship gallery** (SP-03): thumbnails + name + class; load (regenerate),
    rename, delete.
  - **Export**: GLB and GLTF buttons (via `exporter.js`), editable filename.
- **Out:** the tuning harnesses (SP-09/10) — main app is the "production" UI.

## Rules
- Editing a control updates `state.config`, regenerates (debounced ~150 ms), and
  updates the ship card/stats. Aesthetic change re-rolls params within the
  aesthetic's ranges.
- Everything visible must be reproducible from the saved config+seed.

## Acceptance criteria
- [ ] Pick an aesthetic → ship regenerates in that style; tweak a slider → live
      update; Randomize → new ship in the same aesthetic.
- [ ] Save → appears in gallery with thumbnail; load → same ship reappears.
- [ ] Export GLB and GLTF both download a valid file that opens in a GLTF viewer.
- [ ] No WebGL context leaks across interactions (SP-01 viewport).
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Build the main app in `src/views/main.js` on top of a new `src/app/state.js`
> (current config + live group + subscribe). Add an aesthetic picker and
> per-aspect param controls (hull/modules/texture) with debounced live
> regeneration, a ship card with derived stats, a saved-ship gallery (thumbnails,
> load/rename/delete), and GLB/GLTF export with an editable filename. Keep the
> +Z convention and dispose via the viewport. Keep build and lint green.
