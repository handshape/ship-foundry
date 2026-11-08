# SP-02: Generation spine (RNG + `generateShip` + config schema)

**Phase 1** · **Depends on:** — · **Primary files:** `src/core/generator/index.js`,
`src/core/generator/config.js`, `src/core/generator/rng.js`

## Goal
Build the deterministic "spine" that turns a `ShipConfig` + `seed` into a
`THREE.Group`, and define the canonical config schema that every aspect fills in.
This is the contract the aspects (SP-04…07) code against.

## Context
`rng.js` has a working xorshift32 (`createRng`). `generateShip`/`randomConfig`
are stubs returning a placeholder ship. `config.js` has an empty schema. The
aspect stubs (`hull.js`, `modules.js`) exist.

## Scope
- **In:** finalize `createRng` (add `gauss`, `weighted`, `stringSeed` hash);
  a full `ShipConfig` schema with per-aspect defaults + ranges +
  `normalizeConfig` (fill defaults, clamp) + `validateConfig`; `randomConfig(seed)`
  that produces a *complete, valid* config using the RNG + aesthetic ranges;
  `generateShip(config, seed)` that assembles hull + modules + textured material
  into a `THREE.Group` (+Z forward, origin center).
- **Out:** the actual hull/module/texture/aesthetic *implementations* (their
  sub-plans). The spine calls their exported functions.

## Public contracts (authoritative — aspects must match)
```js
// rng.js
createRng(seed) -> { next, range, int, pick, chance, bool,
                     gauss(mean, std), weighted(pairs), }
// config.js
DEFAULT_SHIP_CONFIG, cloneConfig(c), normalizeConfig(c), validateConfig(c) -> {ok, errors}
// index.js
generateShip(config, seed) -> { group: THREE.Group, config }   // deterministic
randomConfig(seed) -> ShipConfig                                // complete + valid
// hull.js  (SP-04 implements; spine consumes this shape)
generateHull(hullParams) -> { geometry: THREE.BufferGeometry, info: HullInfo }
//   HullInfo = { length, beam, height, noseZ, sternZ, anchors }
// modules.js (SP-05)
generateModules(moduleParams, hullInfo) -> THREE.Group
// textures/index.js (SP-06)
generateTextures(textureParams) -> { map, roughnessMap?, metalnessMap?, normalMap? }
// aesthetics/index.js (SP-07)
AESTHETICS, listAesthetics(), applyAesthetic(id, config) -> config
```

## Determinism rule
`generateShip(config, seed)` must be pure: same input → same geometry/materials.
No `Math.random()` anywhere in the generator path; only `createRng(seed)`.

## Acceptance criteria
- [ ] `randomConfig(s)` returns a config that passes `validateConfig`.
- [ ] Two calls to `generateShip(c, s)` produce equivalent ships (same node
      names, positions, material colors).
- [ ] Changing only `seed` changes the ship; changing only an aspect sub-object
      changes only that aspect.
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Implement the generation spine in `src/core/generator/`. Finalize `createRng`
> (add gauss/weighted/stringSeed). Define the full `ShipConfig` schema in
> `config.js` with defaults + ranges + `normalizeConfig`/`validateConfig`.
> Implement `randomConfig` and `generateShip` to compose hull + modules +
> textured material into a +Z-forward `THREE.Group`, calling the aspect
> functions listed in the contract (treat their stubs as the interface). Use only
> `createRng` for randomness. Keep build and lint green.
