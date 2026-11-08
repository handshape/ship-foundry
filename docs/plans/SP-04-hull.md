# SP-04: Procedural hull geometry

**Phase 2** · **Depends on:** SP-02 (contract) · **Primary file:**
`src/core/generator/hull.js`

## Goal
Generate parametric, +Z-forward hull geometry for frigates and larger, with
multiple archetypes and clean surface anchors for modules (SP-05).

## Context
`generateHull(params)` is a stub returning a `BoxGeometry`. The spine (SP-02)
will call it and expect `{ geometry, info }` (see SP-02 contract).

## Scope
- **In:** a **hull-body system** — each archetype is built from *actually
  different* base geometries (not one lofted tube for everything), and composites
  combine several primitives. All bodies are watertight, finite, +Z-forward, and
  share one envelope + surface anchors. Archetypes:
    - `blocky` / `sleek` / `lance` / `dreadnought` → **lofted** cross-section
      (2D profile swept along +Z with a per-station taper curve) — distinct
      silhouettes via different scale curves.
    - `saucer` → a real **DISC** (lenticular scaled sphere) + center dome
      (flying saucer / Enterprise).
    - `wedge` → a real **WEDGE**: flat-decked, keeled, beam tapering to a pointed
      bow (Star Destroyer).
    - `insect` → **SEGMENTED** body: a chain of overlapping ellipsoid segments
      (arthropod).
    - `twin` → **COMPOSITE**: two parallel lofted tubes + a central crossbeam
      (split double-hull).
  Params: `length, beam, height, crossSection` (`hex|ellipse|diamond|octagon`,
  used by lofted/wedge), `noseTaper, sternTaper, deckOffset, keelOffset, chamfer,
  stations`. `generateHull` returns a `THREE.Group` of one or more hull-body
  meshes; the spine assigns the shared texture material to every mesh.
  Export `HullInfo = { length, beam, height, noseZ, sternZ, archetype, anchors }`
  where `anchors` are named surface points (top, bottom, port, starboard, fore,
  aft) as local vectors for module placement.
- **Out:** modules (SP-05), textures (SP-06), aesthetics (SP-07).

## Public contract
```js
generateHull(hullParams) -> { group: THREE.Group, info: HullInfo }
HULL_ARCHETYPES = ['blocky','sleek','lance','dreadnought','saucer','wedge','insect','twin']
HULL_SECTIONS   = ['hex','ellipse','diamond','octagon']
```
- Forward = **+Z**, origin at hull center (fore at +Z, aft at −Z).
- End caps must be wound outward (nose +Z, stern −Z) or backface culling hides them.
- UVs must be sensible so panel-line textures (SP-06) tile predictably.

## Acceptance criteria
- [ ] Each archetype produces a distinct, valid, watertight body (no NaN verts,
      no degenerate triangles).
- [ ] All bodies fit the `length`/`beam`/`height` envelope.
- [ ] `length`/`beam`/`height` scale the hull; tapers shape nose/stern.
- [ ] `info.anchors` are correct (e.g., `fore` at +Z, `aft` at −Z).
- [ ] A hull of length 20+ looks like a frigate-scale craft, not a toy.
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Implement a hull-body system in `src/core/generator/hull.js`. Each archetype is
> built from actually different base geometries: lofted cross-sections (blocky /
> sleek / lance / dreadnought, each with a distinct taper curve), a lenticular
> disc + dome (saucer), a pointed-bow flat-deck wedge (wedge), a chain of
> overlapping ellipsoid segments (insect), and a composite of two tubes + a
> crossbeam (twin). All bodies are watertight, finite, +Z-forward, fit the
> length/beam/height envelope, and end caps are wound outward. Return
> `{ group: THREE.Group, info }` where `info` carries
> `length/beam/height/noseZ/sternZ/archetype/anchors`. Forward is +Z, origin at
> center. Keep build and lint green.
