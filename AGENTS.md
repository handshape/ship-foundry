# AGENTS.md

Guidance for an AI agent working in this repository. Read this before making
changes.

## The project

Ship Foundry is a **purely client-side procedural starship generator**. Ships
are generated entirely in the browser (no backend, no network) and can be tuned
per-aspect on dedicated harness pages, saved to IndexedDB, and exported as
GLTF/GLB.

- Stack: Vite 8 (SPA, `base: './'`), Tailwind v4 + DaisyUI v5, Lucide, three.js
  ^0.187.0, IndexedDB, ESLint 10 (flat config).
- Language: JavaScript (ESM). No TypeScript.
- **`npm run build` and `npm run lint` must stay green** after every change.

## Non-negotiable invariants

1. **+Z is forward**; the ship's origin is its center. The hull spans
   `z ∈ [−L/2, +L/2]`. The hull anchor frame is right-handed: starboard = +X,
   top = +Y, fore = +Z. The default camera sits on the −Z side.
2. **Single JSON `ShipConfig`** drives the whole generator. It is plain JSON so
   it persists to IndexedDB and round-trips through the harnesses with no
   serialization code. The schema (`SHIP_CONFIG_SCHEMA` in
   `src/core/generator/config.js`) is the single source of truth:
   `normalizeConfig`, `validateConfig`, and `randomFromSchema` are all driven by
   it. Adding a field there is all an aspect needs to make it defaultable,
   clamped, validatable, and randomizable.
3. **Deterministic**: the same `config` + `seed` always reproduces the same ship
   (identical node names, positions, instance matrices, material colors). All
   randomness flows from `createRng(seed)` (xorshift32). **There is NO
   `Math.random()` anywhere in `src/core/generator/**`,
   `src/core/textures/**`, or `src/core/aesthetics/**`.** The only `Math.random`
   in the codebase is in the UI layer (seed picker in `src/views/main.js` and a
   fallback ID in `src/persistence/record.js`).
4. **Single emissive `glowColor` per ship**, derived from the palette's glow
   channel (`palette[3]`).
5. **No WebGL leaks**: every view disposes its WebGL context on unmount via
   `app/cleanup.js` (`onCleanup` / `flushCleanups`).

## Module map

```
src/
  main.js                 entry: mounts the shell, starts the router
  app/
    shell.js              persistent chrome (navbar, theme toggle) + #outlet
    router.js             hash router; mounts a view into #outlet
    state.js              shared working ShipConfig store (appState)
    cleanup.js            onCleanup/flushCleanups (per-route WebGL teardown)
  ui/
    icons.js              refreshIcons() -> lucide createIcons()
  views/
    main.js               main application view (viewport, controls, save, export)
  core/
    three/
      scene.js            createViewport / frameToObject; +Z convention
      exporter.js         exportGLTF / exportAndDownload (GLTFExporter)
    generator/
      index.js            generateShip / randomConfig / disposeGroup (the spine)
      config.js           ShipConfig schema + normalize/validate/random/clone
      rng.js              createRng seeded PRNG (xorshift32)
      hull.js             generateHull (9 archetypes)
      modules.js          generateModules (superstructure)
      placeholder.js      static scaffold ship (compare mode)
    aesthetics/
      index.js            AESTHETICS registry + applyAesthetic (8 languages)
    textures/
      index.js            generateTextures / createShipMaterial
  persistence/
    db.js                 IndexedDB wrapper (ships + presets stores) + migrations
    record.js             ShipRecord shape, shipStats, captureThumbnail
    storage.js            saveShip/loadShip/listShips/deleteShip + presets
  harness/
    framework.js          registerHarness / runHarness / harnessIndexView
    controls.js           schema-driven DaisyUI controls (paramControls, ...)
    index.js              imports each harness (side-effect registration)
    hull.js / modules.js / textures.js / aesthetics.js / export.js
```

## Key contracts

- `generateShip(config, seed?) -> { group: THREE.Group, config }` — the
  deterministic spine in `src/core/generator/index.js`. Composition order:
  `normalizeConfig` → `generateHull` → `generateTextures` → shared
  `MeshStandardMaterial` → `generateModules` (hull-local, shared material) →
  assemble +Z-forward Group. It is PURE: it renders the config it is given and
  never re-resolves the aesthetic.
- `generateHull(hullParams) -> { group: THREE.Group, info: HullInfo }` —
  `HullInfo = { length, beam, height, noseZ, sternZ, anchors, archetype, body }`;
  `anchors = { top, bottom, port, starboard, fore, aft }` (hull-local vectors).
  The group is one or more hull-body meshes; the spine assigns the shared
  texture material to every mesh in it.
- `generateModules(cfg.modules, hullInfo, { material, hullGroup, color,
  glowColor })` — places superstructure in hull-local space, seating each module
  base on the hull's real surface (queried from `hullGroup`, not the envelope).
- `applyAesthetic(id, config, rng) -> config` — resolves the aesthetic's
  parameter **ranges** to concrete values via the seeded rng and merges them over
  `hull` / `modules` / `texture`.

## How to extend

### Add a new *aspect* (a new sub-object of `ShipConfig`)

1. **Schema** — add the sub-object to `SHIP_CONFIG_SCHEMA` in
   `src/core/generator/config.js`. Each leaf uses one of the spec types
   (`number`, `boolean`, `choice`, `string`, `palette`, `object`).
2. **Builder** — add `generate<Aspect>(params, ...)` under `src/core/<aspect>/`
   (or a new directory) that consumes `params` and returns `THREE.Object3D` (or
   `material`/`texture`/`hullInfo`). Use only the seeded `rng` — never
   `Math.random`.
3. **Spine** — call the builder from `generateShip` in
   `src/core/generator/index.js`, in the right order, and compose the result.
4. **Aesthetic (optional)** — add the aspect's parameter **ranges** to each
   aesthetic's `params` in `src/core/aesthetics/index.js` (descriptors:
   `N/C/B/P/M`).
5. **Controls (optional)** — add a schema + `paramControls` wiring in the main
   view and/or a new harness.
6. **Verify** — `npm run build` + `npm run lint` green; re-run the determinism
   check (generate twice, diff node names / world positions / instance matrices /
   material colors).

### Add a new *harness*

1. Create `src/harness/<id>.js` with `registerHarness({ id, title,
   description, build(controlsEl, api) { ... } })`.
2. Add `import './<id>.js'` to `src/harness/index.js`.
3. The route `#/harness/<id>`, the index card, the live preview, and the
   save-to-config path all come from the framework automatically.

### Add a new hull archetype

1. Add the id to `HULL_ARCHETYPES` in `src/core/generator/hull.js`.
2. Implement `build<Archetype>(params)` returning a `THREE.Group` of hull-body
   meshes that fit the length/beam/height envelope and share the common
   `info` + `anchors` (so superstructure placement works uniformly).
3. Add a `case '<id>':` to the switch in `generateHull`.
4. If it has new params, add them to the `hull` children in
   `SHIP_CONFIG_SCHEMA` and to the harness schema in `src/harness/hull.js`.
5. **Verify** — `npm run build` + `npm run lint` green.

## Verification

- **Lint**: `npm run lint` (ESLint 10 flat config).
- **Build**: `npm run build` (Vite production build to `dist/`).
- **Determinism spot-check**: import `generateShip` headlessly (stub
  `document.createElement('canvas')` with a Proxy 2D context), generate the same
  config+seed twice, and diff node names / world positions / material colors.

## Shared constants

Cross-file tuning values live in named constants so they stay in sync:

| Constant | Defined in | Used in |
|---|---|---|
| `DEFAULT_LENGTH` / `DEFAULT_BEAM` / `DEFAULT_HEIGHT` | `hull.js` | `config.js` schema, `hull.js` fallbacks, `modules.js` fallbacks |
| `DEFAULT_PALETTE` | `config.js` | `config.js` schema, `textures/index.js`, `modules.js` (glow + weapon fallback) |
| `NACELLE_COUNT_WEIGHTS` | `config.js` | `config.js` schema (aesthetics use the literal to avoid the circular import) |
| `DEFAULT_TEXTURE_SIZE` | `config.js` | `config.js` schema, `textures/index.js` normalizer |
| `TWIN_TUBE_OFFSET` / `TWIN_TUBE_BEAM` / `TWIN_TUBE_HEIGHT` / `TWIN_CROSSBEAM_W` / `TWIN_CROSSBEAM_H` / `TWIN_CROSSBEAM_L` | `hull.js` | `hull.js` (anchor + geometry), `modules.js` (weapon/nacelle placement) |

Texture tuning constants (`ORGANIC_SEED_SALT`, `PANEL_SEED_SALT`,
`GREEBLE_SEED_SALT`, `PANEL_BASE_CELLS`, `PANEL_CELL_SPAN`, `PANEL_JITTER`,
`RIVET_PROB`, `GREEBLE_BASE`, `GREEBLE_SPAN`, `EMBLEM_RADIUS_FRAC`,
`LUCIDE_VIEWBOX`, `RUST_THRESHOLD`, `RUST_BASE`, `RUST_SPAN`) are local to
`textures/index.js`.

Module tuning constants (`POD_TAPER`, `WEAPON_EMBED`, `EMBED_FLOOR`,
`EMBED_FRAC`, `AFT_POD_RADIUS_FRAC`, `INSECT_SURFACE_BOOST`, `PAIR_SEED_MULT`)
are local to `modules.js`.

Nose-taper constants (`NOSE_TIP_RADIUS`, `NOSE_TIP_MIN`, `NOSE_TAPER_RINGS`,
`STERN_TAPER_FACTOR`) are local to `hull.js`.

When adding a new tuning value that is used in 2+ places, extract it to a named
constant. When a constant is shared across files, prefer defining it in the
module that owns the geometry (e.g. `hull.js`) to avoid circular-import TDZ.

## Notes for the agent

- **Circular imports** (pre-existing): `config.js` ↔ `modules.js` and
  `config.js` ↔ `aesthetics/index.js`. They work in the browser; in headless Node
  they can hit TDZ if imported in the wrong order — import `index.js` first.
  Do NOT add new imports from `config.js` into `aesthetics/index.js` or
  `modules.js` that are used at module top-level (e.g. in a const initializer),
  as this will trigger TDZ. The `DEFAULT_PALETTE` import in `textures/index.js`
  and `modules.js` is safe because those files are leaf modules (no cycle back
  to `config.js` through top-level evaluation).
- The `numW` helper in `config.js` is like `num` but with a weighted `rand` array
  for the schema-driven randomizer (e.g. nacelle `count` weights use
  `NACELLE_COUNT_WEIGHTS`).
- `generateHull` archetypes each use genuinely different base geometries — do
  not collapse them into one lofted tube.
- Twin-hull geometry is defined by the `TWIN_*` constants in `hull.js`. The
  surface query in `modules.js` (`surfaceRadiusAt`) uses the same constants so
  the pod placement matches the built hull. The twin top/bottom anchors point
  to the crossbeam (not the tube extrema) via `TWIN_CROSSBEAM_H`.
- Aft nacelle engines are **embedded in the stern** (front face inside the hull,
  back face outside); pylon and waist nacelles are outboard. See
  `buildNacelle` in `src/core/generator/modules.js`.
- Do not commit changes unless the user explicitly asks.
- Keep `npm run build` and `npm run lint` green after every change.
