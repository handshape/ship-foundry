# SP-05: Superstructure & modules

**Phase 2** · **Depends on:** SP-02, SP-04 (`hullInfo`) · **Primary file:**
`src/core/generator/modules.js`

## Goal
Place parametric superstructure and functional modules on the hull so generated
ships read as frigates and larger, not bare hulls.

## Context
`generateModules(params, hullInfo)` is a stub returning an empty `Group`. The
hull (SP-04) provides `hullInfo` with dimensions + `anchors`.

## Scope
- **In:** a module catalog, each a builder `(rng, mat) -> THREE.Group`:
  `bridge` (superstructure + windows), `commandSpike`, `nacelles` (side pods),
  `engineBlocks` (rear, on −Z, with emissive thrusters), `weapons`
  (turrets/cannon hardpoints), `sensorMast`, `antenna`, `hangar`, `hangarDoor`.
  Params: `density` (overall busyness 0..1), per-module `enabled` + counts +
  size ranges + placement bias. Placement uses `hullInfo.anchors` so modules sit
  on the hull consistently across archetypes. Modules are named groups so the
  exporter and stats (SP-03) can count them.
- **Out:** hull (SP-04), textures (SP-06) — modules use a material supplied by
  the spine, or a default when none is given.

## Public contract
```js
generateModules(moduleParams, hullInfo, { material } = {}) -> THREE.Group
MODULE_CATALOG = { bridge, commandSpike, nacelles, engineBlocks, weapons,
                   sensorMast, antenna, hangar }
```
- Returns a `Group` positioned in hull-local space (same space as the hull
  geometry). Forward = +Z.

## Acceptance criteria
- [ ] `density` 0 → sparse; `density` 1 → busy; intermediate values scale
      module counts smoothly.
- [ ] Modules sit on the hull for all archetypes (no floating/intersecting
      obvious misplacement).
- [ ] `engineBlocks` are on the −Z (aft) side; `bridge` on top near fore.
- [ ] Returned group's child count grows with `density` (drives SP-03 stats).
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Implement module placement in `src/core/generator/modules.js`. Build the
> catalog (bridge, commandSpike, nacelles, engineBlocks, weapons, sensorMast,
> antenna, hangar) as named groups, place them using `hullInfo.anchors`, and
> scale counts by the `density` param and per-module counts. Engine blocks go
> aft (−Z); bridge goes on top near the fore. Accept an optional `material`.
> Keep build and lint green.
