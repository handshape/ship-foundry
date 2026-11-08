# Ship Foundry — Meta-Plan

A purely client-side **procedural starship generator**. This document is the
top-level plan. It defines the invariants, architecture, and the set of
**sub-plans** (workstreams). Each sub-plan is a self-contained unit of work that
a sub-agent can own end-to-end. Sub-plan detail lives in [`./plans/`](./plans/).

---

## 1. Product goals

- Generate starships procedurally, entirely in the browser (no backend, no network).
- Ships are **frigates and larger** in scale.
- **Forward axis is +Z**, ship origin at its center. This convention is global.
- Ships support a **variety of design aesthetics**, including ones inspired by
  popular science-fiction universes (design *languages*, not trademarked assets).
- Every ship has **procedurally generated textures** (canvas-based, so they bake
  into GLTF exports with no external image files).
- Every tunable aspect of the generator has a **dedicated "harness" page** for
  iterative tuning during development.
- **All persistence is in browser storage** (IndexedDB).
- Ships can be **exported as GLTF/GLB** using three.js `GLTFExporter`.
- **MIT** licensed.

## 2. Stack (locked — do not change without a plan amendment)

| Concern      | Choice                                             |
| ------------ | -------------------------------------------------- |
| Language     | JavaScript (ESM)                                   |
| Build        | Vite (SPA, `base: './'` for host-agnostic output)  |
| Styling      | Tailwind CSS v4 + DaisyUI v5                       |
| Icons        | Lucide (swaps in after each render via `createIcons`) |
| 3D rendering | three.js (+ `GLTFExporter` from `examples/jsm`)    |
| Persistence  | IndexedDB (thin custom wrapper in `src/persistence/`) |
| Routing      | Single-page app + hash routing (no router library) |

## 3. Invariants (every sub-plan must preserve these)

1. **+Z is forward**; the ship's origin is its center. Camera default sits on −Z.
2. There is **one canonical `ShipConfig`** object (see §5). It is plain JSON so
   it round-trips through IndexedDB and the harnesses with no serialization code.
3. **All randomness is seeded.** A saved ship's `config` + `seed` must
   deterministically reproduce the ship.
4. **No network / backend / build-time asset generation.**
5. **Textures are `THREE.CanvasTexture`**, so GLTF export is self-contained.
6. **Every view disposes its WebGL context on unmount** (via `app/cleanup.js`)
   so navigating between the main app and harnesses never leaks contexts.
7. **`npm run build` and `npm run lint` must stay green.**

## 4. Module map

```
src/
  main.js                 entry: mounts shell + starts router
  styles/main.css         Tailwind v4 + DaisyUI v5 entry
  app/
    shell.js              persistent chrome (navbar, theme toggle) + #outlet
    router.js             hash router; mounts a view into #outlet
    state.js              shared working ShipConfig store (appState)
    cleanup.js            onCleanup/flushCleanups (WebGL teardown per route)
  ui/
    icons.js              refreshIcons() -> lucide createIcons()
  views/
    main.js               main application view (SP-08)
  core/
    three/
      scene.js            createViewport/frameToObject; +Z convention (SP-01)
      exporter.js         exportGLTF/exportAndDownload (GLTFExporter wrapper)
    generator/
      index.js            generateShip/randomConfig/disposeGroup  (SP-02 spine)
      config.js           ShipConfig schema + normalize/validate/random/clone (SP-02)
      rng.js              createRng seeded PRNG                    (SP-02)
      hull.js             generateHull                             (SP-04)
      modules.js          generateModules + InstancedMesh budget   (SP-05, SP-11)
      placeholder.js      scaffold stand-in ship (harness compare mode)
    aesthetics/
      index.js            AESTHETICS registry + applyAesthetic     (SP-07)
    textures/
      index.js            generateTextures/createShipMaterial      (SP-06)
  persistence/
    db.js                 IndexedDB wrapper (ships + presets) + migrations
    record.js             ShipRecord shape + shipStats + captureThumbnail (SP-03)
    storage.js            saveShip/loadShip/listShips/deleteShip + presets (SP-03)
  harness/
    framework.js          registerHarness/getHarness/runHarness/harnessIndexView (SP-09)
    controls.js           schema-driven DaisyUI controls (paramControls, ...)
    index.js              imports each harness (side-effect registration)
    hull.js               hull harness        (SP-10)
    modules.js            modules harness     (SP-10)
    textures.js           texture harness     (SP-10)
    aesthetics.js         aesthetic harness   (SP-10)
    export.js             export harness      (SP-10)
```

## 5. The canonical ShipConfig

A single plain-JSON object. Each aspect owns exactly one sub-object and is
responsible for its fields, defaults, and ranges. The generator spine (SP-02)
defines how these compose; the aspects (SP-04…07) fill them in.

```js
{
  seed: number,              // drives all randomness            (SP-02)
  hull: {                    // geometry                        (SP-04)
    archetype, length, beam, height, crossSection, taper, deck, keel, ...
  },
  modules: {                 // superstructure                  (SP-05)
    density, bridge, nacelles, engineBlocks, weapons, sensors, ...
  },
  texture: {                 // procedural surface              (SP-06)
    palette, panelLines, greebles, wear, stripes, emblem, size, ...
  },
  aesthetic: string,         // id into AESTHETICS              (SP-07)
}
```

**Data flow:** `config` → `generateShip(config, seed)` → `THREE.Group`
→ viewport render → (a) GLTF export, (b) persist `{ config, metadata }` to
IndexedDB. Loading a saved ship = read record → `generateShip(record.config,
record.config.seed)` → render.

## 6. Sub-plans

All sub-plans are **complete** (Phases 0–5 done; see §9).

| ID    | Title                                                        | Phase | Status |
| ----- | ------------------------------------------------------------ | ----- | ------ |
| SP-01 | Reusable 3D viewport & scene rig                             | 1     | done   |
| SP-02 | Generation spine (RNG + `generateShip` + config schema)      | 1     | done   |
| SP-03 | Persistence records (ship record + thumbnails + versioning)  | 1     | done   |
| SP-04 | Procedural hull geometry                                     | 2     | done   |
| SP-05 | Superstructure & modules                                     | 2     | done   |
| SP-06 | Procedural textures                                          | 2     | done   |
| SP-07 | Aesthetic / design-language system                           | 2     | done   |
| SP-08 | Main application UI                                          | 3     | done   |
| SP-09 | Harness framework completion (save-to-config, shared controls) | 3   | done   |
| SP-10 | Per-aspect harness pages (hull, modules, textures, aesthetic, export) | 4 | done |
| SP-11 | Docs, performance, final integration pass                    | 5     | done   |

## 7. Dependency graph & execution waves

```
Wave 1 (parallel):  SP-01   SP-02   SP-03*
Wave 2 (parallel):  SP-04   SP-06   SP-07        (*SP-03 may trail SP-02)
                    SP-05 (needs SP-04's hullInfo)
Wave 3 (parallel):  SP-08   SP-09
Wave 4 (parallel):  SP-10 (per-aspect harnesses)
Wave 5:             SP-11
```

- **Wave 1** is fully parallel except SP-03, which needs SP-02's config shape
  (but SP-02's *contract* is fixed in §5, so SP-03 can start immediately).
- **Wave 2** aspects all build against SP-02's contracts and the existing stubs.
  SP-04 should land (or at least publish its `hullInfo` shape) before SP-05,
  since modules are placed relative to the hull.
- **Wave 3** integrates. **Wave 4** fans out one harness per aspect. **Wave 5**
  polishes and verifies the whole.

> Because the contracts in §5 and the module stubs already exist, most waves can
> overlap: as soon as SP-02 publishes the config schema, the Wave-2 aspects can
> start without waiting for SP-02 to be fully finished.

## 8. How a sub-agent takes a sub-plan

1. Read this meta-plan (§3 invariants, §5 config, §4 module map).
2. Read its sub-plan file in [`./plans/`](./plans/).
3. Implement **only** within that sub-plan's scope; keep the public contracts.
4. Extend the matching **harness** (or the main app, for SP-08) so the work is
   visually verifiable.
5. Keep `npm run build` and `npm run lint` green before finishing.
6. Do **not** change the locked stack or the invariants in §3.

## 9. Status (Phases 0–5 — complete)

**All sub-plans (SP-01 … SP-11) are done.** The app is functionally complete,
documented, and verified end to end (build + lint green, preview serves, the full
generate → render → export → save → reload flow works, and the §3 invariants hold).

Phase 0 (scaffold) wired the stack: Vite + Tailwind v4 + DaisyUI v5 + Lucide +
three.js + `GLTFExporter`; SPA + hash router with an app shell and theme toggle;
a **+Z-forward** viewport (grid + green +Z axis arrow); `GLTFExporter` wrapping;
the IndexedDB wrapper + `storage` (ships + presets); the harness framework with
example harnesses; a placeholder generator; and the main-app scaffold.

Phase 1 (SP-01, SP-02, SP-03) delivered the reusable viewport (`createViewport`
with idempotent, leak-free `dispose`), the deterministic generation spine
(`createRng` + `generateShip` + the `ShipConfig` schema), and persistence records
(`ShipRecord` shape, thumbnails, two-level versioning).

Phase 2 (SP-04…07) delivered the real generator aspects: procedural hull
geometry (lofted parametric hulls), superstructure & modules, procedural
textures (canvas-based albedo + PBR maps), and the aesthetic / design-language
registry (8 design languages).

Phase 3 (SP-08, SP-09) delivered the main application UI (live viewport,
schema-driven controls, ship card, saved-ship gallery, GLB/GLTF export) and the
completed harness framework (save-to-config, shared controls).

Phase 4 (SP-10) delivered the per-aspect harness pages: hull, modules, textures,
aesthetics, and export — each with a live preview and a save-to-config path.

Phase 5 (SP-11, this wave) is the polish: real docs (`README.md` +
`ARCHITECTURE.md`), the performance budget (`THREE.InstancedMesh` for repeated
greeble-like modules above a small threshold), and the final integration pass
proving the §3 invariants hold (determinism, no `Math.random` in the generator
path, all five harnesses reachable with live preview + save-to-config, and the
full generate → render → export → save → reload flow), plus a headless WebGL
leak stress test.

**See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full data-flow, config-model,
persistence, and extension guide.**
