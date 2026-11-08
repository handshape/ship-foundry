# Ship Foundry — Architecture

A guide to how Ship Foundry works end to end: the data flow, the canonical
config model, the module map, the +Z convention, persistence, the harness
pattern, and how to extend the generator (a new aspect) or add a new harness.

Read this after [`PLAN.md`](./PLAN.md) (the meta-plan: invariants, sub-plans,
and the locked stack).

---

## 1. The data flow

Everything is derived from one plain-JSON `ShipConfig` + a seed. The ship is
never stored as geometry — it is always regenerated from config, so a saved ship
round-trips perfectly.

```
                 ┌─────────────────────────────────────────────────────────┐
                 │                       ShipConfig                         │
                 │  { seed, aesthetic, hull{}, modules{}, texture{} }        │
                 │  (plain JSON — the single source of truth)               │
                 └───────────────┬─────────────────────────────────────────┘
                                 │
                                 ▼
              generateShip(config, seed)        src/core/generator/index.js
                                 │
     ┌───────────────┬───────────┼──────────────┬─────────────────┐
     ▼               ▼           ▼              ▼                 ▼
 normalizeConfig  applyAesthetic  generateHull  generateTextures  generateModules
 (clamp+defaults) (aesthetic id   (hull.js:     (textures:        (modules.js:
                    -> params)      lofted        CanvasTexture     superstructure)
                    SP-07           geometry +    albedo + PBR      SP-05)
                    SP-02           anchors)      maps)             SP-05
                                  SP-04         SP-06
     └───────────────┴───────────┬──────────────┴─────────────────┘
                                 ▼
                     THREE.Group  (name = "ship", +Z forward, origin at center)
                     ├─ hull (Mesh, shared PBR material)
                     └─ modules (Group; per-module Mesh or InstancedMesh)
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
        viewport render                     export / persist
        (core/three/scene.js)               (a) exportGLTF -> GLB/GLTF
        setShip() disposes the old group    (b) storage.saveShip(record)
        and reframes the camera              -> IndexedDB (ShipRecord)
                 │
                 ▼
        render loop (requestAnimationFrame)

 Loading a saved ship:
   read ShipRecord -> generateShip(record.config, record.config.seed) -> render
   (thumbnail + stats are caches only; config + seed are the source of truth)
```

The same `generateShip(config, seed)` is the single code path for: the main
app, every harness preview, export, and reload. Determinism is therefore
guaranteed everywhere at once (see §6).

---

## 2. The `ShipConfig` model

`ShipConfig` is one plain-JSON object (`src/core/generator/config.js`). Each
aspect owns exactly **one** sub-object and is responsible for its fields,
defaults, ranges, and the builder that consumes them. The schema
(`SHIP_CONFIG_SCHEMA`) is the single source of truth: `normalizeConfig`,
`validateConfig`, and `randomFromSchema` are all driven by it, so adding a
field is all an aspect needs to make it defaultable, clamped, validatable, and
randomizable.

| Field        | Type    | Owner  | Consumed by                                   |
| ------------ | ------- | ------ | --------------------------------------------- |
| `seed`       | number  | SP-02  | `createRng` (all randomness flows from here)  |
| `aesthetic`  | string  | SP-07  | `applyAesthetic` (id into `AESTHETICS`)       |
| `hull`       | object  | SP-04  | `generateHull` (hull-body system: lofted / disc / wedge / segmented / composite) |
| `modules`    | object  | SP-05  | `generateModules` (superstructure)            |
| `texture`    | object  | SP-06  | `generateTextures` (procedural surface maps)  |

```js
{
  seed: 12345,                 // SP-02
  aesthetic: 'hardpoint',      // SP-07 (id into AESTHETICS)
  hull: {                      // SP-04 — geometry
    archetype, length, beam, height, crossSection,
    noseTaper, sternTaper, deckOffset, keelOffset, chamfer, stations,
  },
  modules: {                   // SP-05 — superstructure
    density,
    bridge:        { enabled, size },
    commandSpike:  { enabled, height },
    nacelles:      { enabled, count, size },
    engineBlocks:  { enabled, count, size },
    weapons:       { enabled, count, size },
    sensorMast:    { enabled, count, height },
    antenna:       { enabled, count },
    hangar:        { enabled, count },
  },
  texture: {                   // SP-06 — procedural surface
    palette: [base, secondary, accent, glow],
    panelLines: { enabled, weight },
    greebles:   { enabled, density },
    wear:       { enabled, amount },
    stripes:    { enabled, count, width },
    emblem:     { enabled, style },
    size,                      // texture resolution (px), 64..2048
  },
}
```

Because the whole config is plain JSON, it persists to IndexedDB and round-trips
through the harnesses with **no serialization code**. `normalizeConfig` fills
missing fields with schema defaults and clamps out-of-range values, so any
partial config (e.g. a harness patch) becomes a complete, in-range config.

The **aesthetic** is a design *language* (SP-07) that *parameterizes* the other
three aspects. `applyAesthetic(id, config, rng)` resolves the aesthetic's
parameter **ranges** to concrete values via the seeded `rng` and merges them over
`hull` / `modules` / `texture`, then the spine re-normalizes. Different seeds give
variety *within* an aesthetic while the resolved config always stays inside the
schema bounds.

---

## 3. Module map

```
src/
  main.js                 entry: mounts the shell, starts the router
  styles/main.css         Tailwind v4 + DaisyUI v5 entry
  app/
    shell.js              persistent chrome (navbar, theme toggle) + #outlet
    router.js             hash router; mounts a view into #outlet
    state.js              shared working ShipConfig store (appState)
    cleanup.js            onCleanup/flushCleanups (per-route WebGL teardown)
  ui/
    icons.js              refreshIcons() -> lucide createIcons()
  views/
    main.js               main application view (SP-08)
  core/
    three/
      scene.js            createViewport / frameToObject; +Z convention (SP-01)
      exporter.js         exportGLTF / exportAndDownload (GLTFExporter)
    generator/
      index.js            generateShip / randomConfig / disposeGroup (SP-02 spine)
      config.js           ShipConfig schema + normalize/validate/random/clone (SP-02)
      rng.js              createRng seeded PRNG (SP-02)
      hull.js             generateHull (SP-04)
      modules.js          generateModules + InstancedMesh budget (SP-05, SP-11)
      placeholder.js      static scaffold ship (compare mode)
    aesthetics/
      index.js            AESTHETICS registry + applyAesthetic (SP-07)
    textures/
      index.js            generateTextures / createShipMaterial (SP-06)
  persistence/
    db.js                 IndexedDB wrapper (ships + presets stores) + migrations
    record.js             ShipRecord shape, shipStats, captureThumbnail (SP-03)
    storage.js            saveShip/loadShip/listShips/deleteShip + presets (SP-03)
  harness/
    framework.js          registerHarness / runHarness / harnessIndexView (SP-09)
    controls.js           schema-driven DaisyUI controls (paramControls, ...)
    index.js              imports each harness (side-effect registration)
    hull.js               hull harness        (SP-10)
    modules.js            modules harness     (SP-10)
    textures.js           texture harness     (SP-10)
    aesthetics.js         aesthetic harness   (SP-10)
    export.js             export harness      (SP-10)
```

---

## 4. The +Z convention

Global and non-negotiable (PLAN §3 invariant 1):

- A ship's **forward axis is +Z**; the nose is at +Z, the stern at −Z.
- A ship's **origin is its center** (the hull spans `z ∈ [−L/2, +L/2]`).
- The default camera sits on the **−Z** side, so the nose points away from the
  camera into the scene (the `three-quarter` preset is the default).
- The hull's anchor frame is right-handed: **starboard = +X, top = +Y, fore = +Z**.
- A green +Z axis arrow is drawn in every viewport so the convention is visible.

`generateHull` returns a `THREE.Group` of one or more hull-body meshes. Each
archetype is built from actually different base geometries — lofted
cross-sections (`blocky`/`sleek`/`lance`/`dreadnought`, each with its own taper
curve), a lenticular **disc** + dome (`saucer`), a pointed-bow **wedge**
(`wedge`), a chain of overlapping ellipsoid **segments** (`insect`), and a
**composite** of two tubes + a crossbeam (`twin`). Lofted/wedge bodies run s=0
at the stern (−Z) to s=1 at the nose (+Z) and cap both ends with outward-wound
fans (so backface culling keeps them visible). All bodies fit the
length/beam/height envelope. Modules are placed relative to `hullInfo` anchors
(`top`, `bottom`, `port`, `starboard`, `fore`, `aft`) in the same hull-local
space, and the spine assigns the shared texture material to every hull mesh.

---

## 5. Persistence model

All persistence is in browser storage (IndexedDB) — no backend, no network.

### Stores (`src/persistence/db.js`)

A thin wrapper around `indexedDB` opens one database (`ship-foundry`) with two
object stores, each keyed by `id`:

| Store     | Contents                       |
| --------- | ------------------------------ |
| `ships`   | saved `ShipRecord`s            |
| `presets` | named config presets (harnesses) |

**Two-level versioning:**

- `DB_VERSION` (in `db.js`) is the IndexedDB *schema* version. `onupgradeneeded`
  runs each `MIGRATIONS` step in `(oldVersion, DB_VERSION]` order, so bumping the
  version migrates existing databases without loss.
- `RECORD_VERSION` (in `record.js`) is the *record* schema version, stored as each
  record's `v` field. Bump it when a record gains a field; add a migration step to
  backfill.

### `ShipRecord` shape (`src/persistence/record.js`)

```js
{
  id,           // uuid (crypto.randomUUID)
  v,            // RECORD_VERSION
  name,         // display name (defaults to "Ship <id[:8]>")
  savedAt,      // Date.now()
  config,       // the canonical ShipConfig (plain JSON) — SOURCE OF TRUTH
  thumbnail,    // small PNG data URL (cache only)
  stats,        // derived values (cache only), see below
}
```

`config` + `config.seed` are the **source of truth**: they fully regenerate the
ship. `thumbnail` and `stats` are caches only — if they're missing or stale the
app regenerates them; they are never required for correctness.

`shipStats(config)` derives `{ className, hullArchetype, moduleCount,
textureSize }`. `moduleCount` sums the `count` of each enabled module block (or 1
for modules without a count, like `bridge`/`commandSpike`), so it stays meaningful
whether or not the modules are drawn as `InstancedMesh` (see §6).

### Capturing a thumbnail

`captureThumbnail(viewport)` renders the live scene to a **temporary** offscreen
`WebGLRenderer`, grabs a PNG data URL, and immediately disposes the renderer and
force-loses its context — so it never leaks a WebGL context.

---

## 6. Determinism, no-`Math.random`, and the performance budget

### Determinism + seeded RNG

Every random value in the generator path flows from a single `createRng(seed)`
instance (xorshift32 over a uint32 state; a zero seed is remapped to a fixed
non-zero constant). **There is no `Math.random()` anywhere in
`src/core/generator/**`, `src/core/textures/**`, or `src/core/aesthetics/**`** —
the only `Math.random` in the whole codebase is in the UI layer:

- `src/views/main.js` — picks a fresh seed for the **Randomize** button (UI-side;
  the seed is then stored on the config, so the ship is reproducible).
- `src/persistence/record.js` — fallback ID generation only when
  `crypto.randomUUID` is unavailable (record metadata, not geometry).

`generateShip(config, seed)` is therefore a pure function of its inputs: the same
`config` + `seed` produces an identical ship (same node names, positions,
instance matrices, and material colors) on every call, in every surface (main app,
harnesses, export, reload). This was verified with a throwaway Node harness
(generate twice and diff names / world positions / instance matrices / material
colors) during SP-11.

### Draw-call / geometry budget (SP-11)

For frigate-and-larger ships the superstructure can contain many repeated
"greeble-like" parts (weapon turrets, antenna whips, engine thruster rings, sensor
masts). To keep the renderer fast, `generateModules`
(`src/core/generator/modules.js`) draws the four repeatable modules —
`engineBlocks`, `weapons`, `sensorMast`, `antenna` — as **one `THREE.InstancedMesh`
per part** when their instance count exceeds `INSTANCING_THRESHOLD` (4); below it
they fall back to individual meshes.

- Each `InstancedMesh` keeps a name of the form `<module>:<part>` (e.g.
  `engineBlocks:body`, `weapons:barrel`), so the module type stays identifiable.
- Per-instance transforms are computed with the **same seeded `rng`, in the same
  order**, as the individual-mesh path (a `transforms` mode in each builder), so
  the instanced ship is byte-identical to the non-instanced one.
- `shipStats.moduleCount` still reads correctly because it counts from the
  config's `count` fields, not from the scene-graph child count.
- `disposeGroup` / the viewport's `dispose` traverse and dispose every
  `geometry` + `material`, which includes instanced meshes' shared geometry, so
  instancing does not change teardown.

The net effect on a dense ship: instead of ~2 draw calls per engine block (body +
thruster) × count, each part is a single instanced draw call regardless of count.

### Texture resolution

`texture.size` (64..2048, default 512) is respected directly by
`generateTextures`: it sizes every `CanvasTexture` (albedo + roughness +
metalness) and the PBR maps modulate the material. Viewport-scaled resolution is
an optional future refinement; the config-driven `size` is the knob users (and
the texture harness) control today, and it bakes cleanly into GLTF exports.

### Dispose correctness / no WebGL leaks (PLAN §3 invariant 6)

Every view disposes its WebGL context on unmount via `app/cleanup.js`:

- The router calls `flushCleanups()` **before** mounting the next view.
- Each viewport (`createViewport`) registers an `onCleanup` that stops the render
  loop, disconnects the `ResizeObserver`, disposes the scene contents, calls
  `renderer.dispose()`, and **force-loses the WebGL context**.

This was verified with a headless Chromium navigation stress test (SP-11):
navigating main ↔ each of the 5 harnesses 20 times (120 navigations) kept the
**live canvas / WebGL context count at exactly 1** at all times, with at most one
context created per navigation — i.e. zero leaks.

---

## 7. The harness pattern

A **harness** isolates one tunable aspect of the generator for iterative
development. The framework (`src/harness/framework.js`) provides a two-pane layout
(controls + live preview) and a shared API.

### Registering a harness

A harness is a plain object registered as a side effect:

```js
import { registerHarness } from './framework.js'

registerHarness({
  id: 'hull',                       // must match the #/harness/:id route
  title: 'Hull',                    // shown in the card + header
  description: 'Tune hull geometry.',
  build(controlsEl, api) {
    // render controls into controlsEl, wire onPatch to api.patchConfig
  },
})
```

Then import the file from `src/harness/index.js` (one line) so it registers.

### The harness API

`runHarness(harness)` wires up the preview and hands `build` an `api`:

| Method / field      | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `scene`             | the live preview `THREE.Scene`                                 |
| `shipRoot`          | the current preview group (generated + placeholder)            |
| `setShip(group)`    | replace the preview group (legacy hook)                        |
| `refresh()`         | re-measure / re-frame the preview                               |
| `getConfig()`       | the current working `ShipConfig` (a clone) from `appState`      |
| `patchConfig(patch)`| deep-merge `patch` into the working config, normalize, regenerate the preview |
| `saveConfig(name)`  | persist the working config as a **preset** + publish to `appState` so a later main-app load applies it |
| `setCompare(on)`    | swap the preview between the generated ship and the placeholder |

The preview regenerates live through the deterministic spine (`generateShip`),
debounced so a slider drag re-frames smoothly. A header **Compare** checkbox swaps
the preview between the generated ship and the static placeholder.

### Save-to-config

The shared working config lives in `appState` (`src/app/state.js`). A harness
`patchConfig`s it as the user tunes; `api.saveConfig(name)` persists a snapshot as
a **preset** (IndexedDB `presets` store) and calls `appState.publish(...)`, which
notifies listeners. The main app subscribes to `appState`, so navigating back to
`#/` after a harness save re-generates the main viewport from the tuned config.

The **export** harness is the exception that *reads* rather than *tunes*: it never
mutates the config, it only exports the live preview (GLB/GLTF) or copies the
config JSON to the clipboard. The **aesthetics** harness is the one with an
explicit "Save as custom preset" button (`api.saveConfig`); the hull / modules /
textures harnesses rely on the shared `appState` working config + the main app's
Save (which stores a full `ShipRecord`) as their save-to-config path.

---

## 8. How to extend the generator

### Add a new *aspect* (a new sub-object of `ShipConfig`)

1. **Schema** — add the sub-object to `SHIP_CONFIG_SCHEMA` in
   `src/core/generator/config.js`. Each leaf uses one of the spec types
   (`number`, `boolean`, `choice`, `string`, `palette`, `object`). This alone makes
   it defaultable, clamped (`normalizeConfig`), validatable (`validateConfig`), and
   randomizable (`randomFromSchema`).
2. **Builder** — add `generate<Aspect>(params, ...)` under `src/core/<aspect>/`
   (or a new directory) that consumes `params` and returns `THREE.Object3D` (or
   `material`/`texture`/`hullInfo` as appropriate). Use only the seeded `rng` —
   never `Math.random`.
3. **Spine** — call the builder from `generateShip` in
   `src/core/generator/index.js`, in the right order, and compose the result into
   the returned `THREE.Group`.
4. **Aesthetic (optional)** — add the aspect's parameter **ranges** to each
   aesthetic's `params` in `src/core/aesthetics/index.js` (range descriptors:
   `N/C/B/P/M`).
5. **Controls (optional)** — add a schema + `paramControls` wiring in the main
   view and/or a new harness so the aspect is tunable.
6. **Verify** — `npm run build` + `npm run lint` green; re-run the determinism check
   (generate twice, diff).

### Add a new *harness*

1. Create `src/harness/<id>.js`:
   ```js
   import { registerHarness } from './framework.js'
   import { paramControls } from './controls.js'

   const SCHEMA = [
     { key: 'length', label: 'Length', type: 'slider', min: 20, max: 150, step: 1, int: true },
     // ...one spec per tunable field (or a flattened view of a sub-object)
   ]

   registerHarness({
     id: '<id>',
     title: 'Title',
     description: 'What this harness tunes.',
     build(controlsEl, api) {
       controlsEl.appendChild(
         paramControls(SCHEMA, api.getConfig().<aspect>, { onPatch: (p) => api.patchConfig({ <aspect>: p }) }),
       )
     },
   })
   ```
2. **Register it** — add `import './<id>.js'` to `src/harness/index.js`.
3. That's it: the router's `#/harness/<id>` route, the harness index card, the
   live preview, and the save-to-config path all come from the framework
   automatically.

The schema-driven `paramControls` (`src/harness/controls.js`) supports
`slider`, `select`, `color`, `toggle`, and `number` leaf types, so most harnesses
are ~15 lines. For nested sub-objects, either flatten the config in the harness
(see `modules.js` / `textures.js`) or use the `path` option of `paramControls`.
