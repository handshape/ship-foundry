import * as THREE from 'three'
import { normalizeConfig, randomFromSchema } from './config.js'
import { createRng } from './rng.js'
import { generateHull } from './hull.js'
import { generateModules } from './modules.js'
import { generateTextures, createShipMaterial } from '../textures/index.js'

// TOP-LEVEL SHIP GENERATOR — the deterministic spine (SP-02).
//
// Contract:
//   generateShip(config, seed?) -> { group: THREE.Group, config }
//     - `config` is a plain, JSON-serializable ShipConfig (see config.js).
//     - `seed` (optional) overrides `config.seed`; the effective seed drives the
//       seeded RNG. The returned `config` is the normalized, authoritative one.
//     - `group` is a THREE.Group; forward axis is +Z, origin at ship center.
//     - Deterministic: same config + seed -> identical node names, positions,
//       and material colors. All randomness flows from createRng(effectiveSeed).
//     - PURE: it renders the config it is given and never re-resolves the
//       aesthetic. Aesthetic range resolution is a one-time "new ship" step
//       (see applyAesthetic / randomConfig), so manual edits to the working
//       config survive regeneration.
//   randomConfig(seed) -> ShipConfig
//     - produce a complete, valid config from a seed (placeholder aesthetic).
//   disposeGroup(group) -> dispose geometries/materials (safe on shared mats).
//
// Composition: normalizeConfig -> generateHull -> generateTextures -> build
// shared MeshStandardMaterial -> generateModules (hull-local, shared material)
// -> assemble +Z-forward Group.

export function generateShip(config = {}, seed) {
  const effectiveSeed = seed !== undefined ? seed : config?.seed ?? 0
  const cfg = normalizeConfig({ ...config, seed: effectiveSeed })

  // Hull geometry + placement info (dimensions + surface anchors).
  const hull = generateHull(cfg.hull)

  // Procedural surface maps -> the single PBR material shared by hull + modules.
  // `color` is a convenience base color (palette[0]) for the flat-color
  // placeholder texture; SP-06 reads `palette` directly. Emissive glow is
  // derived from the palette's glow channel (palette[3]) so organic/retro
  // aesthetics get their bioluminescent/chrome glow.
  const textures = generateTextures({ ...cfg.texture, color: cfg.texture.palette?.[0] })
  const material = createShipMaterial(textures, { emissive: cfg.texture.palette?.[3] ?? null })

  // Modules in hull-local space, sharing the material. The hull group is passed
  // so the fit guard can query the hull's real surface (not the envelope) and
  // seat every module base on it; the hull base colour is passed so each module
  // type gets a mildly varied tone (same family, subtle hue/sat/brightness).
  // Backward compatible: if a caller omits them, the guard falls back to
  // anchor/envelope estimates and modules use the shared material.
  const moduleGroup = generateModules(cfg.modules, hull.info, {
    material,
    hullGroup: hull.group,
    color: cfg.texture.palette?.[0] ?? null,
    glowColor: cfg.texture.palette?.[3] ?? null,
    accent: cfg.texture.palette?.[2] ?? null,
  })

  // The hull is a Group of one or more body meshes (lofted, disc, wedge,
  // segmented, or a composite of tubes + crossbeam). Assign the shared texture
  // material to every hull mesh so the whole body is textured consistently.
  hull.group.traverse((o) => {
    if (o.isMesh) o.material = material
  })
  hull.group.name = 'hull'

  const group = new THREE.Group()
  group.name = 'ship'
  group.add(hull.group)
  group.add(moduleGroup)

  return { group, config: cfg }
}

export function randomConfig(seed = 0) {
  const rng = createRng(seed)
  // Draw every field from the schema, then pin the seed to the argument so the
  // returned config reproduces itself via generateShip(config, config.seed).
  const raw = randomFromSchema(rng)
  return normalizeConfig({ ...raw, seed })
}

// Dispose geometries/materials in a group (safe to call on shared materials).
export function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose?.()
    const m = o.material
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose())
    else m?.dispose?.()
  })
}
