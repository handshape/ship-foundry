# Ship Foundry — Architecture

A guide to how Ship Foundry works end to end: the data flow, the canonical
config model, the module map, the +Z convention, persistence, the harness
pattern, and how to extend the generator (a new aspect) or add a new harness.

---

## 1. The data flow

Everything is derived from one plain-JSON `ShipConfig` + a seed. The ship is
never stored as geometry — it is always regenerated from config, so a saved ship
round-trips perfectly.

There are two distinct stages:

- **The new-ship step** (one-time, UI-side): roll a raw config from the schema,
  pick a design language, resolve its parameter ranges to concrete values, and
  store the result. This is what the Randomize button, the aesthetic picker, the
  `?seed=`/`?aesthetic=` URL boot, and the aesthetics harness all do.
- **The spine** (`generateShip`): a PURE function of `config` + `seed`. It
  renders the config it is given and never re-resolves the aesthetic, so manual
  edits to the working config survive regeneration.

```
 New-ship step (one-time):
   rng = createRng(seed)
   raw = randomConfig(seed)                    # every leaf drawn from the schema
   raw.aesthetic = randomAestheticId(rng)      # varied design language
   raw.texture.palette = randomPalette(rng)    # desaturated base + derived tones
   cfg = normalizeConfig(applyAesthetic(id, raw, rng))
                  ┌─────────────────────────────────────────────────────────┐
                  │                       ShipConfig                        │
                  │  { seed, aesthetic, hull{}, modules{}, texture{} }       │
                  │  (plain JSON — the single source of truth)               │
                  └───────────────┬─────────────────────────────────────────┘
                                  │
                                  ▼
              generateShip(config, seed?)       src/core/generator/index.js
                                  │
      ┌───────────────┬───────────┼──────────────────┬─────────────────┐
      ▼               ▼           ▼                  ▼                 ▼
  normalizeConfig  generateHull  generateTextures  two materials    generateModules
  (clamp+defaults) (hull.js:     (textures:        hull:   MeshPhysicalMaterial
                     9 archetypes + canvas maps:   with the emissive
                     + anchors)      albedo, roughness, (window-light) map;
                                     metalness, normal, module: same maps, no
                                     AO, emissive)      emissive
      └───────────────┴───────────┴──────────────────┴─────────────────┘
                                  ▼
                      THREE.Group (name = "ship", +Z forward, origin at center)
                      ├─ hull (Group of 1..N body meshes, hull material)
                      └─ modules (Group; per-module multi-part meshes)
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
(`SHIP_CONFIG_SCHEMA`) is the single source of truth: `normalizeConfig` and
`randomFromSchema` are both driven by it, so adding a field is all an aspect
needs to make it defaultable, clamped, and randomizable.

| Field       | Type   | Owner      | Consumed by                                   |
| ----------- | ------ | ---------- | --------------------------------------------- |
| `seed`      | number | spine      | `createRng` (all randomness flows from here)  |
| `aesthetic` | string | aesthetics | `applyAesthetic` (id into `AESTHETICS`)       |
| `hull`      | object | hull       | `generateHull` (9 archetypes)                 |
| `modules`   | object | modules    | `generateModules` (superstructure)            |
| `texture`   | object | textures   | `generateTextures` (procedural surface maps)  |

```js
{
  seed: 12345,                 // drives createRng
  aesthetic: 'hardpoint',      // id into AESTHETICS (design language)
  hull: {                      // geometry
    archetype,                 // 9 archetypes (see §4)
    length, beam, height,
    crossSection,              // hex | ellipse | diamond | octagon
    noseTaper, sternTaper, deckOffset, keelOffset, chamfer, stations,
    discUpperCurve, discLowerCurve, discEdge,   // disc archetype only
  },
  modules: {                   // superstructure
    density,
    bridge:       { enabled, size, style, position },
    commandSpike: { enabled, height, style },
    nacelles:     { enabled, mount, type, count, size, strut, lift, angle, tail },
    weapons:      { enabled, count, size, style, position },
    sensorMast:   { enabled, count, height, style },
    antenna:      { enabled, count, style },
    hangar:       { enabled, count, style, position },
  },
  texture: {                   // procedural surface
    palette: [base, secondary, accent, glow],
    panelLines: { enabled, weight },
    greebles:   { enabled, density },
    wear:       { enabled, amount },
    stripes:    { enabled, count, width },
    emblem:     { enabled, style },
    windows:    { enabled, density },
    size,                      // texture resolution (px), 64..2048
  },
}
```

Notes on the module fields:

- **nacelles** are the ship's propulsion pods, with a single mount layout per
  ship: `mount` = `pylon` (long pods on struts off the flank) | `aft` (stubby
  pods at the stern) | `waist` (pods on the hull's waist); `type` = one of 7
  body forms (standard, crystal, cluster, spindle, spindleX, spindleY, boxy);
  `strut` (forward/straight/aft sweep), `lift` (height off the centreline),
  `angle` (up/level/down pitch), and `tail` (dome/point/scallop/flared/vented/
  cowled exhaust form) complete the layout. The old separate `engineBlocks`
  system was folded into this.
- Each other module block has a `style` choice (e.g. 5 bridge styles, 12 weapon
  styles) and, where it makes sense, a `position` (where on the hull it sits)
  plus a bounded `count`.

Because the whole config is plain JSON, it persists to IndexedDB and round-trips
through the harnesses with **no serialization code**. `normalizeConfig` fills
missing fields with schema defaults and clamps out-of-range values, so any
partial config (e.g. a harness patch) becomes a complete, in-range config.

The **aesthetic** is a design *language* that *parameterizes* the other three
aspects. `applyAesthetic(id, config, rng)` resolves the aesthetic's parameter
**ranges** to concrete values via the seeded `rng` and merges them over
`hull` / `modules` / `texture`. It is a one-time "new ship" step — the spine
never re-resolves it. Different seeds give variety *within* an aesthetic while
the resolved config always stays inside the schema bounds. Range descriptors in
`src/core/aesthetics/index.js`: `N(min, max)` number range, `C(options)`
choice, `B(p)` boolean with probability, `P(options)` palette, `M(children)`
nested object.

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
    main.js               main application view (viewport, controls, save, export)
  core/
    three/
      scene.js            createViewport / frameToObject; +Z convention
      exporter.js         exportGLTF / exportAndDownload (GLTFExporter)
    generator/
      index.js            generateShip / randomConfig / disposeGroup (the spine)
      config.js           ShipConfig schema + normalize/random/clone + palette helpers
      rng.js              createRng seeded PRNG (xorshift32)
      hull.js             generateHull (9 archetypes) + shared hull constants
      modules.js          generateModules + MODULE_CATALOG + module style constants
      placeholder.js      static scaffold ship (compare mode)
    aesthetics/
      index.js            AESTHETICS registry + applyAesthetic (8 design languages)
    textures/
      index.js            generateTextures / createShipMaterial (canvas PBR maps)
  persistence/
    db.js                 IndexedDB wrapper (ships + presets stores) + migrations
    record.js             ShipRecord shape, shipStats, captureThumbnail
    storage.js            saveShip/loadShip/listShips/deleteShip + presets
  harness/
    framework.js          registerHarness / runHarness / harnessIndexView
    controls.js           schema-driven DaisyUI controls (paramControls, ...)
    index.js              imports each harness (side-effect registration)
    hull.js               hull harness
    modules.js            modules harness
    textures.js           texture harness
    weapons.js            weapons harness (ownsPreview: isolated style browser)
    aesthetics.js         aesthetic harness
    export.js             export harness
```

---

## 4. The +Z convention

Global and non-negotiable:

- A ship's **forward axis is +Z**; the nose is at +Z, the stern at −Z.
- A ship's **origin is its center** (the hull spans `z ∈ [−L/2, +L/2]`).
- The default camera sits on the **−Z** side, so the nose points away from the
  camera into the scene (the `three-quarter` preset is the default).
- The hull's anchor frame is right-handed: **starboard = +X, top = +Y, fore = +Z**.
- A green +Z axis arrow is drawn in every viewport so the convention is visible.

`generateHull` returns a `THREE.Group` of one or more hull-body meshes. Each
archetype is built from actually different base geometries — lofted
cross-sections (`blocky`/`sleek`/`lance`/`dreadnought`, each with its own taper
curve), a lenticular **disc** + dome (`saucer`), a **solid of revolution**
(`disc`, LatheGeometry profile revolved and aligned to Z, with configurable
convex/concave upper/lower curves and a cylinder or frustum edge), a pointed-bow
**wedge** (`wedge`), a chain of overlapping ellipsoid **segments** (`insect`),
and a **composite** of two tubes + a crossbeam (`twin`). Lofted/wedge bodies run
s=0 at the stern (−Z) to s=1 at the nose (+Z) and cap both ends with
outward-wound fans (so backface culling keeps them visible). All bodies fit the
length/beam/height envelope. `generateHull` also returns `hullInfo` with the
anchors (`top`, `bottom`, `port`, `starboard`, `fore`, `aft`) used to seat
superstructure in the same hull-local space; the spine assigns the hull material
to every hull mesh.

---

## 5. Persistence model

All persistence is in browser storage (IndexedDB) — no backend, no network.

### Stores (`src/persistence/db.js`)

A thin wrapper around `indexedDB` opens one database (`ship-foundry`) with two
object stores, each keyed by `id`:

| Store     | Contents                          |
| --------- | --------------------------------- |
| `ships`   | saved `ShipRecord`s               |
| `presets` | named config presets (harnesses)  |

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
textureSize }`. `className` is a length bucket (frigate / destroyer / cruiser /
battleship).
`moduleCount` sums the `count` of each enabled module block (or 1 for modules
without a count, like `bridge`/`commandSpike`), so it stays meaningful and
independent of how the modules are drawn.

### Capturing a thumbnail

`captureThumbnail(viewport)` renders the live scene to a **temporary** offscreen
`WebGLRenderer`, grabs a PNG data URL, and immediately disposes the renderer and
force-loses its context — so it never leaks a WebGL context.

---

## 6. Determinism, no-`Math.random`, and performance

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
`config` + `seed` produces an identical ship (same node names, positions, and
material colors) on every call, in every surface (main app, harnesses, export,
reload). This is verified with a headless Node check (generate the same
config+seed twice and diff node names / world positions / material colors).

### Module geometry (no instancing)

The earlier `InstancedMesh` budgeting was dropped. Each module type is now a
*family* of distinct multi-part, multi-style, multi-material variants (12 weapon
styles, 7 nacelle body types, 5 bridge styles, 3 hangar styles, ...) — those
don't batch into `InstancedMesh` the way a single repeated geometry did, and
visual distinctness matters more than shaving draw calls. Every module is
therefore drawn as individual meshes.

Part counts stay small and bounded by the schema's `count` fields (weapons ≤ 8,
nacelles ≤ 4, antennas ≤ 6, sensor masts ≤ 4, hangars ≤ 2), so the per-ship draw
call count is modest and predictable. `shipStats.moduleCount` counts from the
config's `count` fields, not from the scene-graph child count, so it reads
correctly regardless.

### Materials and texture resolution

`generateTextures` sizes every `CanvasTexture` (albedo + roughness + metalness +
normal + AO + emissive) from `texture.size` (64..2048, default 512) and the
spine builds **two** `MeshPhysicalMaterial`s from the same maps:

- **hull material** — clearcoat (painted-ship look) and the emissive map, so
  only the window lights (`texture.windows`) glow via the ship's single glow
  colour (`palette[3]`); the rest of the hull stays dark.
- **module material** — same PBR maps, no emissive map.

Every glowing part on the ship (window lights, engine/weapon/antenna glows, glass
tints) shares the one emissive colour derived from `palette[3]`, so a ship's
lights read as one coherent signature. The maps bake cleanly into GLTF exports.

### Dispose correctness / no WebGL leaks

Every view disposes its WebGL context on unmount via `app/cleanup.js`:

- The router calls `flushCleanups()` **before** mounting the next view.
- Each viewport (`createViewport`) registers an `onCleanup` that stops the render
  loop, disconnects the `ResizeObserver`, disposes the scene contents, calls
  `renderer.dispose()`, and **force-loses the WebGL context**.

This was verified with a headless Chromium navigation stress test: navigating
main ↔ every harness many times keeps the live canvas / WebGL context count at
exactly 1 at all times — i.e. zero leaks.

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
| `shipRoot`          | the current preview group (holds generated + placeholder)      |
| `getConfig()`       | the current working `ShipConfig` from `appState`               |
| `patchConfig(patch)`| deep-merge `patch` into the working config, normalize, regenerate the preview (debounced) |
| `saveConfig(name)`  | persist the working config as a **preset** + publish to `appState` so a later main-app load applies it |
| `setCompare(on)`    | swap the preview between the generated ship and the placeholder |

The preview regenerates live through the deterministic spine (`generateShip`),
debounced so a slider drag re-frames smoothly. A header **Compare** checkbox
swaps the preview between the generated ship and the static placeholder.

A harness may opt out of the default full-ship preview with
`ownsPreview: true`: the framework then hands `build` a reduced API
(`getConfig`, `patchConfig`, `saveConfig`, plus the raw `previewEl` DOM node)
and the harness builds its own scene. The **weapons** harness uses this: it
renders an isolated semitransparent block with a single weapon mounted on it, so
the style catalog can be refined without the rest of the ship (a fixed seed keeps
the preview deterministic).

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
textures / weapons harnesses rely on the shared `appState` working config + the
main app's Save (which stores a full `ShipRecord`) as their save-to-config path.

---

## 8. How to extend the generator

### Add a new *aspect* (a new sub-object of `ShipConfig`)

1. **Schema** — add the sub-object to `SHIP_CONFIG_SCHEMA` in
   `src/core/generator/config.js`. Each leaf uses one of the spec types
   (`number`, `boolean`, `choice`, `string`, `palette`, `object`). This alone
   makes it defaultable, clamped (`normalizeConfig`), and randomizable
   (`randomFromSchema`).
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
