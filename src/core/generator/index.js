import * as THREE from 'three'
import { normalizeConfig, randomFromSchema } from './config.js'
import { createRng } from './rng.js'
import { generateHull, SKIN_ARCHETYPES } from './hull.js'
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

  // Hull geometry + placement info (dimensions + surface anchors). The seed is
  // passed so the skin archetypes (pod/slug/cluster/twinSkin/insectSkin) can
  // derive their seeded wobble/meander/lobes; non-skin archetypes ignore it.
  const hull = generateHull(cfg.hull, { seed: effectiveSeed })

  // Procedural surface maps -> PBR materials. Two materials are created:
  //   - hullMaterial:   includes the emissive map (windows glow) — hull only.
  //   - moduleMaterial: no emissive map — nacelles, bridges, weapons, etc.
  // Both share the same texture maps (albedo, roughness, metalness, normal, AO)
  // so the surface detail is identical; only the emissive differs.
  const textures = generateTextures({ ...cfg.texture, color: cfg.texture.palette?.[0] })
  const glowColor = cfg.texture.palette?.[3] ?? null
  const hullMaterial = createShipMaterial(textures, { emissive: glowColor })
  const moduleMaterial = createShipMaterial(textures, { emissive: null })

  // Modules in hull-local space, using the windowless material. The hull group
  // is passed so the fit guard can query the hull's real surface (not the
  // envelope) and seat every module base on it; the hull base colour is passed
  // so each module type gets a mildly varied tone (same family, subtle
  // hue/sat/brightness). Backward compatible: if a caller omits them, the
  // guard falls back to anchor/envelope estimates.
  const moduleGroup = generateModules(cfg.modules, hull.info, {
    material: moduleMaterial,
    hullGroup: hull.group,
    color: cfg.texture.palette?.[0] ?? null,
    glowColor,
    accent: cfg.texture.palette?.[2] ?? null,
    seed: effectiveSeed,
  })

  // The hull is a Group of one or more body meshes (lofted, disc, wedge,
  // segmented, or a composite of tubes + crossbeam). Assign the hull material
  // (with the window emissive map) to every hull mesh.
  hull.group.traverse((o) => {
    if (o.isMesh) o.material = hullMaterial
  })
  hull.group.name = 'hull'

  const group = new THREE.Group()
  group.name = 'ship'
  group.add(hull.group)
  group.add(moduleGroup)

  if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug')) {
    const m = cfg.modules
    const t = cfg.texture
    console.group(`[ship] seed=${cfg.seed} aesthetic=${cfg.aesthetic}`)
    console.log(`hull: ${cfg.hull.archetype} ${cfg.hull.length}x${cfg.hull.beam}x${cfg.hull.height} ${cfg.hull.crossSection}`)
    if (SKIN_ARCHETYPES.includes(cfg.hull.archetype)) {
      console.log(`  skin: wobble=${cfg.hull.skinWobble} ripple=${cfg.hull.skinRipple} lobes=${cfg.hull.lobeCount} lobeSize=${cfg.hull.lobeSize}`)
    }
    console.log(`palette: ${t.palette?.join(' ')}`)
    // Bridge
    const b = m.bridge
    if (b) console.log(`  bridge: enabled=${b.enabled} size=${b.size} style=${b.style} pos=${b.position}`)
    // Nacelles
    const nc = m.nacelles
    if (nc) {
      const len = nc.mount === 'pylon' ? 'long' : nc.mount === 'aft' ? 'stubby' : 'waist-long'
      console.log(`  nacelles: enabled=${nc.enabled} mount=${nc.mount} (${len}) type=${nc.type} count=${nc.count} size=${nc.size} strut=${nc.strut} lift=${nc.lift} angle=${nc.angle} tail=${nc.tail}`)
    }
    // Other modules (generic)
    for (const k of ['commandSpike', 'weapons', 'sensorMast', 'antenna', 'hangar', 'hullFeatures']) {
      const v = m[k]
      if (!v || typeof v !== 'object') continue
      const parts = [`enabled=${v.enabled}`]
      if (v.count != null) parts.push(`count=${v.count}`)
      if (v.style != null) parts.push(`style=${v.style}`)
      if (v.position != null) parts.push(`pos=${v.position}`)
      if (v.size != null) parts.push(`size=${v.size}`)
      if (v.height != null) parts.push(`height=${v.height}`)
      console.log(`  ${k}: ${parts.join(' ')}`)
    }
    console.log(`texture: greebles=${t.greebles?.enabled}/${t.greebles?.density} wear=${t.wear?.enabled}/${t.wear?.amount} stripes=${t.stripes?.enabled}/${t.stripes?.count} emblem=${t.emblem?.style} windows=${t.windows?.enabled}/${t.windows?.density}`)
    console.groupEnd()
  }

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
