# SP-06: Procedural textures

**Phase 2** · **Depends on:** SP-02 (contract) · **Primary file:**
`src/core/textures/index.js`

## Goal
Generate self-contained, seeded surface textures (albedo + PBR maps) on a canvas
so ships look finished and exports carry no external images.

## Context
`generateTextures(params)` is a stub returning a flat-color `map`. The spine
(SP-02) consumes the returned maps to build the ship material.

## Scope
- **In:** layered, **seeded** canvas compositing: base albedo from a `palette`;
  `panelLines` (grid/sections); `greebles` (small random machinery detail);
  `wear` (dirt/grime noise, edge highlights); `stripes`/`accents` (bands in
  accent colors); `emblem` (a generated insignia/roundel). Output maps:
  `map` (albedo), `roughnessMap`, `metalnessMap`, optional `normalMap`.
  Params: `palette` (`[base, secondary, accent, glow]`), `panelLines` (on/weight),
  `greeble` (density), `wear` (amount), `stripes` (count/width), `emblem`
  (style/none), `size` (texture px). Provide `createShipMaterial(textures)`
  returning a configured `THREE.MeshStandardMaterial` (sRGB albedo, linear maps).
- **Out:** hull geometry (SP-04), aesthetics (SP-07) — textures take a finished
  param object; they don't decide it.

## Public contract
```js
generateTextures(textureParams) -> { map, roughnessMap?, metalnessMap?, normalMap? }
createShipMaterial(textures, { emissive? } = {}) -> THREE.MeshStandardMaterial
```
- All maps are `THREE.CanvasTexture`; albedo `colorSpace = SRGBColorSpace`.
- Same `textureParams` + seed → identical pixels.

## Acceptance criteria
- [ ] Each layer visibly composites (panel lines, greebles, wear, stripes, emblem).
- [ ] `palette` + accent colors show through.
- [ ] Deterministic: identical params → identical pixels.
- [ ] Exporting a textured ship to GLB bakes the textures in (no 404s in viewer).
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Implement procedural textures in `src/core/textures/index.js`. Composite, in
> order: base albedo, panel lines, greebles, wear, stripes/accents, and an
> emblem — each driven by `textureParams` and a seeded RNG. Return `map` plus
> roughness/metalness (and optional normal) maps as CanvasTextures, and add
> `createShipMaterial` that returns a ready MeshStandardMaterial with correct
> color spaces. Keep it deterministic and build/lint green.
