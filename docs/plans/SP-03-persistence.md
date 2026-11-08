# SP-03: Persistence records (ship record + thumbnails + versioning)

**Phase 1** · **Depends on:** SP-02 (config shape) · **Primary files:**
`src/persistence/db.js`, `src/persistence/storage.js` (new: `src/persistence/record.js`)

## Goal
Formalize what gets stored so a saved ship can be re-loaded and regenerated
exactly, and add lightweight thumbnails + derived stats + schema versioning.

## Context
`db.js` already opens IndexedDB with `ships` + `presets` stores (keyed by `id`).
`storage.js` has working save/load/list/delete for both. The scaffold main view
saves `{ config }` and lists by date.

## Scope
- **In:** a `ShipRecord` shape `{ id, v, name, savedAt, config, thumbnail?, stats }`
  where `v` is a schema version, `thumbnail` is a small PNG **data URL**, and
  `stats` are derived values (class, hull archetype, module count, texture size).
  A `captureThumbnail(viewport, { w, h })` helper (offscreen render → data URL).
  Derived `shipStats(config)`. A `loadShipAndRegenerate(id)` helper. A versioned
  upgrade/migration path in `db.js`. Preset records gain `{ name, config, aesthetic }`.
- **Out:** the generator (SP-02) and UI (SP-08) — this only stores/loads.

## Public contracts
```js
// record.js
buildShipRecord({ id?, name, config, thumbnail?, stats? }) -> ShipRecord
shipStats(config) -> { className, hullArchetype, moduleCount, ... }
captureThumbnail(viewport, { w = 256, h = 160 } = {}) -> Promise<string>  // data URL
// storage.js (extended)
saveShip({ name, config, thumbnail?, stats? }) -> id
loadShipAndRegenerate(id, generateShip) -> Promise<{ group, config } | null>
listShips() -> ShipRecord[]   // newest first
// db.js: onupgradeneeded handles version bumps; add `v` to records.
```

## Rules
- A record's `config` + `config.seed` must fully regenerate the ship
  (thumbnails/stats are caches, never the source of truth).
- No secrets, no large blobs beyond small thumbnails.

## Acceptance criteria
- [ ] Save a ship → reload it → regenerate → identical ship.
- [ ] Saved list shows thumbnails + name + class, newest first.
- [ ] Bumping `DB_VERSION` migrates old records (adds `v`) without loss.
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Formalize persistence in `src/persistence/`. Add `record.js` with
> `buildShipRecord`, `shipStats`, and `captureThumbnail` (render a viewport to a
> small PNG data URL). Extend `storage.js` with `saveShip({name,config,thumbnail,stats})`
> and `loadShipAndRegenerate(id, generateShip)`, and make `listShips()` newest-first.
> Add a `v` field and a versioned upgrade path in `db.js`. Keep build and lint green.
