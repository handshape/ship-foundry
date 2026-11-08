# SP-07: Aesthetic / design-language system

**Phase 2** · **Depends on:** SP-02 (contract) · **Primary file:**
`src/core/aesthetics/index.js` (new: `src/core/aesthetics/presets/*.js`)

## Goal
Give the generator a variety of distinct **design languages** so ships can read
as different "universes". These are inspired by popular sci-fi *aesthetics* —
we encode parameter ranges and palettes, **not** trademarked assets, logos, or
names.

## Context
`AESTHETICS` is a registry with one `placeholder` entry; `applyAesthetic` merges
an aesthetic into a config. `listAesthetics` exists.

## Scope
- **In:** a set of aesthetic presets, each `{ id, label, blurb, params }` where
  `params` are concrete ranges/defaults for `hull`, `modules`, `texture` (palette
  + layer settings). Suggested languages (names are our own):
    - `hardpoint` — hard-surface military; blocky/lance, grey-white, panel lines,
      functional, few accents.
    - `sleek` — clean colonial/corporate; sleek/lance, white/light-grey, subtle
      wear, minimal modules.
    - `organic` — biopunk; rounded/asymmetric, dark hulls, greeble-heavy,
      bioluminescent glow accents.
    - `retro` — retro-futurism; chrome, fins, domes, bold accent bands.
    - `gothic` — ornate dreadnought; spires, dark, heavy greeble, tall silhouette.
    - `minimal` — monolithic minimalist; smooth, matte, very few modules.
    - `blocky` — modular industrial freighter; boxy, cargo, lots of panels.
  `applyAesthetic(id, config, rng)` resolves ranges to concrete values via `rng`.
- **Out:** the geometry/texture implementations — aesthetics only *parameterize*
  them.

## Public contract
```js
AESTHETICS = { <id>: { id, label, blurb, params: { hull, modules, texture } } }
listAesthetics() -> Aesthetic[]
applyAesthetic(id, config, rng?) -> config   // fills hull/modules/texture from ranges
```
- Every aesthetic must produce a `config` that passes `validateConfig` (SP-02).

## Acceptance criteria
- [ ] ≥ 6 distinct aesthetics, each visually clearly different in the preview.
- [ ] `applyAesthetic` yields a valid, complete config each time.
- [ ] Re-applying the same id with the same `rng` is deterministic.
- [ ] No trademarked names, logos, or assets anywhere (only design *languages*).
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Implement the aesthetic system in `src/core/aesthetics/`. Create at least six
> design-language presets (hardpoint, sleek, organic, retro, gothic, minimal,
> blocky) as `{ id, label, blurb, params }` with concrete ranges for hull,
> modules, and texture (incl. palette + layer settings). Make
> `applyAesthetic(id, config, rng)` resolve ranges to concrete values so the
> result passes `validateConfig`. These must be original design languages, not
> trademarked assets or names. Keep build and lint green.
