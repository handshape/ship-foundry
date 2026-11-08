// AESTHETIC / DESIGN-LANGUAGE REGISTRY (sub-plan 7 / SP-07).
//
// Each aesthetic is an ORIGINAL design language (not a trademarked asset, logo,
// or name) that *parameterizes* the hull, module, and texture aspects. Applying
// one fills the three sub-objects of a ShipConfig with concrete values resolved
// from the aesthetic's parameter RANGES via a seeded rng.
//
// Contract:
//   AESTHETICS: Record<string, Aesthetic>
//   Aesthetic  = { id, label, blurb, params: { hull, modules, texture } }
//   listAesthetics() -> Aesthetic[]
//   applyAesthetic(id, config, rng) -> config
//
// Range resolution (see resolveRange): every field in an aesthetic's `params`
// is either a concrete value or a range descriptor. Ranges are resolved with
// the seeded `rng`, so the same id + same rng is deterministic while different
// seeds give variety within the aesthetic. Ranges stay inside the schema bounds
// so the resolved config always passes validateConfig.

import { BRIDGE_STYLES, WEAPON_STYLES, WEAPON_POSITIONS, NACELLE_STRUT_STYLES, NACELLE_LIFT_OPTIONS, NACELLE_ANGLE_OPTIONS, NACELLE_TAIL_OPTIONS, NACELLE_MOUNTS, NACELLE_TYPES, HANGAR_POSITIONS } from '../generator/modules.js'

// --- range descriptors (internal) --------------------------------------------
// Each is a plain object the resolver understands. `kind` is optional when the
// shape is unambiguous (an array is always a choice set).
//   { kind:'number', min, max, int? }  -> rng.int / rng.range
//   { kind:'choice', options: [...] }  -> rng.pick
//   { kind:'bool',   p? }              -> rng.chance(p ?? 0.5)
//   { kind:'palette', options: [[base, secondary, accent, glow], ...] }
//   { kind:'object', children: { ... } } -> recurse (a module block)
//   [a, b, c]                          -> shorthand for choice
//   anything else                      -> used as-is (a concrete value)

function resolveValue(value, rng) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'object') {
    const out = {}
    for (const [key, child] of Object.entries(value.children)) out[key] = resolveValue(child, rng)
    return out
  }
  if (Array.isArray(value)) return rng.pick(value) // choice shorthand
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    switch (value.kind) {
      case 'number':
        return value.int ? rng.int(value.min, value.max) : rng.range(value.min, value.max)
      case 'choice':
        return rng.pick(value.options)
      case 'bool':
        return rng.chance(value.p ?? 0.5)
      case 'palette':
        return [...rng.pick(value.options)]
      default:
        return value
    }
  }
  return value
}

// Resolve a partial params tree (hull / modules / texture) into concrete values.
// Only fields the aesthetic names are returned; the caller deep-merges them over
// the existing (already normalized) config so untouched fields keep their values.
function resolveRange(params, rng) {
  const out = {}
  for (const [section, spec] of Object.entries(params || {})) {
    const resolved = {}
    for (const [key, range] of Object.entries(spec || {})) resolved[key] = resolveValue(range, rng)
    out[section] = resolved
  }
  return out
}

// Convenience builders for the descriptors.
const N = (min, max, int = false) => ({ kind: 'number', min, max, int })
const C = (options) => ({ kind: 'choice', options })
const B = (p = 0.5) => ({ kind: 'bool', p })
const P = (options) => ({ kind: 'palette', options })
const M = (children) => ({ kind: 'object', children })

// --- the design languages ----------------------------------------------------
// Each is a distinct "universe": silhouette (archetype/section/proportions),
// palette, and surface treatment. All values are original design languages.

const AESTHETIC_DEFS = {
  // 1. Hard-surface military: blocky slab or lance, grey-white, strong panel
  // lines, functional superstructure, minimal accents.
  hardpoint: {
    id: 'hardpoint',
    label: 'Hardpoint',
    blurb: 'Hard-surface military. Blocky slab hulls, grey-white palette, strong panel lines, functional modules, few accents.',
    params: {
      hull: {
        archetype: C(['blocky', 'lance']),
        length: N(34, 70),
        beam: N(16, 34),
        height: N(8, 18),
        crossSection: C(['hex', 'octagon']),
        noseTaper: N(0.2, 0.6),
        sternTaper: N(0.2, 0.5),
        deckOffset: N(0, 0.1),
        keelOffset: N(0, 0.05),
        chamfer: N(0.05, 0.25),
        stations: N(12, 20, true),
      },
      modules: {
        density: N(0.45, 0.7),
        bridge: M({ enabled: true, size: N(0.8, 1.4) }),
        commandSpike: M({ enabled: B(0.4), height: N(4, 8) }),
        nacelles: M({ enabled: true, count: C([2, 2, 2, 4, 4]), size: N(0.5, 1.0), strut: C(NACELLE_STRUT_STYLES), lift: C(NACELLE_LIFT_OPTIONS), angle: C(NACELLE_ANGLE_OPTIONS), tail: C(NACELLE_TAIL_OPTIONS), mount: C(NACELLE_MOUNTS), type: C(NACELLE_TYPES) }),
        weapons: M({ enabled: true, count: N(2, 5, true), size: N(0.8, 1.4), style: C(WEAPON_STYLES), position: C(WEAPON_POSITIONS) }),
        sensorMast: M({ enabled: B(0.5), count: C([1, 2]), height: N(3, 6) }),
        antenna: M({ enabled: B(0.6), count: N(1, 3, true) }),
        hangar: M({ enabled: B(0.3), count: 1, position: C(HANGAR_POSITIONS) }),
      },
      texture: {
        palette: P([
          ['#8a94a6', '#5b6472', '#3a86c8', '#66d9ff'],
          ['#9aa3b2', '#6b7280', '#c0392b', '#e8c34a'],
          ['#a7adb8', '#71788a', '#2e86ab', '#9fdcff'],
        ]),
        panelLines: M({ enabled: true, weight: N(0.7, 1) }),
        greebles: M({ enabled: true, density: N(0.35, 0.6) }),
        wear: M({ enabled: true, amount: N(0.3, 0.55) }),
        stripes: M({ enabled: B(0.35), count: C([1, 2]), width: N(0.05, 0.18) }),
        emblem: M({ enabled: B(0.4), style: C(['roundel', 'bar', 'none']) }),
        size: 512,
      },
    },
  },

  // 2. Clean colonial / corporate: sleek or lance, white/light-grey, subtle
  // wear, minimal modules, low accents.
  sleek: {
    id: 'sleek',
    label: 'Sleek',
    blurb: 'Clean colonial / corporate. Long sleek hulls, white and light-grey, subtle wear, minimal modules, low accents.',
    params: {
      hull: {
        archetype: C(['sleek', 'lance']),
        length: N(45, 90),
        beam: N(10, 22),
        height: N(6, 14),
        crossSection: C(['ellipse', 'diamond']),
        noseTaper: N(0.5, 0.9),
        sternTaper: N(0.3, 0.6),
        deckOffset: N(0, 0.05),
        keelOffset: N(0, 0.05),
        chamfer: N(0.2, 0.4),
        stations: N(14, 24, true),
      },
      modules: {
        density: N(0.2, 0.4),
        bridge: M({ enabled: true, size: N(0.7, 1.2), style: C(BRIDGE_STYLES) }),
        commandSpike: M({ enabled: B(0.2), height: N(2, 5) }),
        nacelles: M({ enabled: true, count: C([2, 2, 2, 4, 4]), size: N(0.5, 0.9), strut: C(NACELLE_STRUT_STYLES), lift: C(NACELLE_LIFT_OPTIONS), angle: C(NACELLE_ANGLE_OPTIONS), tail: C(NACELLE_TAIL_OPTIONS), mount: C(NACELLE_MOUNTS), type: C(NACELLE_TYPES) }),
        weapons: M({ enabled: B(0.4), count: C([0, 1, 2]), size: N(0.5, 0.9), style: C(WEAPON_STYLES), position: C(WEAPON_POSITIONS) }),
        sensorMast: M({ enabled: B(0.3), count: 1, height: N(2, 4) }),
        antenna: M({ enabled: B(0.4), count: C([0, 1]) }),
        hangar: M({ enabled: false, count: 0, position: C(HANGAR_POSITIONS) }),
      },
      texture: {
        palette: P([
          ['#e8ecf1', '#c3cad4', '#4a90d9', '#bfe6ff'],
          ['#f2f4f7', '#d6dbe2', '#3a7bd5', '#d3ecff'],
          ['#dde3ea', '#aab3c0', '#5b8dc9', '#cfeaff'],
        ]),
        panelLines: M({ enabled: true, weight: N(0.3, 0.6) }),
        greebles: M({ enabled: B(0.4), density: N(0.15, 0.3) }),
        wear: M({ enabled: true, amount: N(0.1, 0.3) }),
        stripes: M({ enabled: B(0.3), count: C([1, 2]), width: N(0.03, 0.08) }),
        emblem: M({ enabled: B(0.3), style: C(['none', 'roundel']) }),
        size: 512,
      },
    },
  },

  // 3. Biopunk: rounded / asymmetric (ellipse, diamond), dark hulls,
  // greeble-heavy, bioluminescent glow accents.
  organic: {
    id: 'organic',
    label: 'Organic',
    blurb: 'Biopunk. Rounded, asymmetric hulls in deep darks, greeble-heavy skin, bioluminescent glow accents.',
    params: {
      hull: {
        archetype: C(['sleek', 'saucer']),
        length: N(30, 60),
        beam: N(14, 30),
        height: N(8, 18),
        crossSection: C(['ellipse', 'diamond']),
        noseTaper: N(0.4, 0.8),
        sternTaper: N(0.3, 0.6),
        deckOffset: N(0.05, 0.2),
        keelOffset: N(0.05, 0.2),
        chamfer: N(0.3, 0.5),
        stations: N(12, 22, true),
      },
      modules: {
        density: N(0.55, 0.85),
        bridge: M({ enabled: true, size: N(0.9, 1.5), style: C(BRIDGE_STYLES) }),
        commandSpike: M({ enabled: B(0.4), height: N(3, 7) }),
        nacelles: M({ enabled: true, count: C([2, 2, 2, 4, 4]), size: N(0.5, 1.1), strut: C(NACELLE_STRUT_STYLES), lift: C(NACELLE_LIFT_OPTIONS), angle: C(NACELLE_ANGLE_OPTIONS), tail: C(NACELLE_TAIL_OPTIONS), mount: C(NACELLE_MOUNTS), type: C(NACELLE_TYPES) }),
        weapons: M({ enabled: B(0.5), count: N(2, 6, true), size: N(0.7, 1.3), style: C(WEAPON_STYLES), position: C(WEAPON_POSITIONS) }),
        sensorMast: M({ enabled: B(0.6), count: C([1, 2]), height: N(3, 7), style: 'ring' }),
        antenna: M({ enabled: B(0.5), count: N(2, 4, true) }),
        hangar: M({ enabled: B(0.3), count: 1, position: C(HANGAR_POSITIONS) }),
      },
      texture: {
        palette: P([
          ['#1a2b2f', '#0f2027', '#39ff8e', '#00e5ff'],
          ['#14232a', '#0a1a20', '#41ff9d', '#00d2ff'],
          ['#1d2b22', '#101d1a', '#7bff66', '#00ffc8'],
        ]),
        panelLines: M({ enabled: true, weight: N(0.4, 0.7) }),
        greebles: M({ enabled: true, density: N(0.65, 1) }),
        wear: M({ enabled: true, amount: N(0.2, 0.5) }),
        stripes: M({ enabled: B(0.25), count: C([1, 2]), width: N(0.04, 0.12) }),
        emblem: M({ enabled: B(0.2), style: C(['none', 'star']) }),
        size: 512,
      },
    },
  },

  // 4. Retro-futurism: chrome / high metalness, bold accent bands, fins
  // (nacelles) prominent, domed bridge, blocky / saucer silhouettes.
  retro: {
    id: 'retro',
    label: 'Retro',
    blurb: 'Retro-futurism. Chrome hulls, bold accent bands, prominent fins and domed bridge, atomic-age flair.',
    params: {
      hull: {
        archetype: C(['blocky', 'saucer', 'lance']),
        length: N(30, 60),
        beam: N(18, 36),
        height: N(10, 20),
        crossSection: C(['octagon', 'hex', 'ellipse']),
        noseTaper: N(0.3, 0.6),
        sternTaper: N(0.2, 0.5),
        deckOffset: N(0, 0.1),
        keelOffset: N(0, 0.1),
        chamfer: N(0.15, 0.35),
        stations: N(12, 20, true),
      },
      modules: {
        density: N(0.5, 0.75),
        bridge: M({ enabled: true, size: N(1.0, 1.8), style: C(BRIDGE_STYLES) }),
        commandSpike: M({ enabled: B(0.4), height: N(4, 9), style: 'dish' }),
        nacelles: M({ enabled: true, count: C([2, 2, 2, 4, 4]), size: N(0.6, 1.2), strut: C(NACELLE_STRUT_STYLES), lift: C(NACELLE_LIFT_OPTIONS), angle: C(NACELLE_ANGLE_OPTIONS), tail: C(NACELLE_TAIL_OPTIONS), mount: C(NACELLE_MOUNTS), type: C(NACELLE_TYPES) }),
        weapons: M({ enabled: B(0.5), count: N(2, 5, true), size: N(0.8, 1.4), style: C(WEAPON_STYLES), position: C(WEAPON_POSITIONS) }),
        sensorMast: M({ enabled: B(0.5), count: C([1, 2]), height: N(3, 6) }),
        antenna: M({ enabled: B(0.7), count: N(2, 4, true) }),
        hangar: M({ enabled: B(0.2), count: 1, position: C(HANGAR_POSITIONS) }),
      },
      texture: {
        palette: P([
          ['#c0c0c8', '#8e9aa6', '#ff6b35', '#ffd23f'],
          ['#b8bfc9', '#7f8b99', '#e63946', '#f4a261'],
          ['#cfd4db', '#9aa5b1', '#ff7a18', '#ffe14d'],
        ]),
        panelLines: M({ enabled: true, weight: N(0.5, 0.8) }),
        greebles: M({ enabled: true, density: N(0.4, 0.65) }),
        wear: M({ enabled: true, amount: N(0.25, 0.5) }),
        stripes: M({ enabled: true, count: C([2, 3, 4]), width: N(0.1, 0.3) }),
        emblem: M({ enabled: B(0.6), style: C(['roundel', 'star', 'chevron']) }),
        size: 512,
      },
    },
  },

  // 5. Ornate dreadnought: tall silhouette, dark palette, heavy greeble,
  // spires / command spike prominent.
  gothic: {
    id: 'gothic',
    label: 'Gothic',
    blurb: 'Ornate dreadnought. Tall, dark silhouette, heavy greeble, prominent command spires, brooding palette.',
    params: {
      hull: {
        archetype: C(['dreadnought', 'lance']),
        length: N(60, 110),
        beam: N(24, 48),
        height: N(18, 34),
        crossSection: C(['diamond', 'hex']),
        noseTaper: N(0.2, 0.5),
        sternTaper: N(0.1, 0.4),
        deckOffset: N(0, 0.1),
        keelOffset: N(0, 0.1),
        chamfer: N(0.1, 0.3),
        stations: N(16, 24, true),
      },
      modules: {
        density: N(0.65, 0.9),
        bridge: M({ enabled: true, size: N(1.2, 2), style: C(BRIDGE_STYLES) }),
        commandSpike: M({ enabled: true, height: N(10, 15), style: 'array' }),
        nacelles: M({ enabled: true, count: C([2, 2, 2, 4, 4]), size: N(0.6, 1.1), strut: C(NACELLE_STRUT_STYLES), lift: C(NACELLE_LIFT_OPTIONS), angle: C(NACELLE_ANGLE_OPTIONS), tail: C(NACELLE_TAIL_OPTIONS), mount: C(NACELLE_MOUNTS), type: C(NACELLE_TYPES) }),
        weapons: M({ enabled: true, count: N(4, 8, true), size: N(1.0, 1.8), style: C(WEAPON_STYLES), position: C(WEAPON_POSITIONS) }),
        sensorMast: M({ enabled: B(0.7), count: C([2, 4]), height: N(6, 10) }),
        antenna: M({ enabled: B(0.6), count: N(3, 6, true) }),
        hangar: M({ enabled: B(0.4), count: 1, position: C(HANGAR_POSITIONS) }),
      },
      texture: {
        palette: P([
          ['#2b2d3a', '#1a1c26', '#9b59b6', '#d4af37'],
          ['#23242f', '#15161f', '#8e44ad', '#c9a227'],
          ['#2f2a35', '#1c1a22', '#7d3c98', '#e0b040'],
        ]),
        panelLines: M({ enabled: true, weight: N(0.6, 1) }),
        greebles: M({ enabled: true, density: N(0.7, 1) }),
        wear: M({ enabled: true, amount: N(0.4, 0.7) }),
        stripes: M({ enabled: B(0.4), count: C([1, 2]), width: N(0.06, 0.15) }),
        emblem: M({ enabled: B(0.5), style: C(['star', 'chevron', 'roundel']) }),
        size: 512,
      },
    },
  },

  // 6. Monolithic minimalist: smooth (octagon / ellipse), matte, very few
  // modules, no stripes or emblem.
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    blurb: 'Monolithic minimalist. Smooth matte hulls, very few modules, no stripes or emblem, calm neutral palette.',
    params: {
      hull: {
        archetype: C(['sleek', 'lance', 'blocky']),
        length: N(35, 70),
        beam: N(12, 26),
        height: N(8, 16),
        crossSection: C(['octagon', 'ellipse']),
        noseTaper: N(0.3, 0.7),
        sternTaper: N(0.2, 0.5),
        deckOffset: N(0, 0.05),
        keelOffset: N(0, 0.05),
        chamfer: N(0.35, 0.55),
        stations: N(12, 20, true),
      },
      modules: {
        density: N(0.1, 0.25),
        bridge: M({ enabled: true, size: N(0.6, 1), style: C(BRIDGE_STYLES) }),
        commandSpike: M({ enabled: false, height: 1 }),
        nacelles: M({ enabled: true, count: C([2, 2, 2, 4, 4]), size: N(0.5, 0.8), strut: C(NACELLE_STRUT_STYLES), lift: C(NACELLE_LIFT_OPTIONS), angle: C(NACELLE_ANGLE_OPTIONS), tail: C(NACELLE_TAIL_OPTIONS), mount: C(NACELLE_MOUNTS), type: C(NACELLE_TYPES) }),
        weapons: M({ enabled: false, count: 0, size: 0.5 }),
        sensorMast: M({ enabled: false, count: 0, height: 1 }),
        antenna: M({ enabled: false, count: 0 }),
        hangar: M({ enabled: false, count: 0, position: C(HANGAR_POSITIONS) }),
      },
      texture: {
        palette: P([
          ['#c9cccf', '#a9adb1', '#7d8085', '#d9dadb'],
          ['#d4d6d8', '#b2b5b8', '#8c8f94', '#e4e5e6'],
          ['#c0c3c6', '#9ea1a5', '#70737a', '#d0d2d4'],
        ]),
        panelLines: M({ enabled: B(0.3), weight: N(0.2, 0.4) }),
        greebles: M({ enabled: false, density: 0 }),
        wear: M({ enabled: B(0.4), amount: N(0.1, 0.25) }),
        stripes: M({ enabled: false, count: 0, width: 0.02 }),
        emblem: M({ enabled: false, style: 'none' }),
        size: 512,
      },
    },
  },

  // 7. Modular industrial freighter: boxy (hex / octagon), lots of panels,
  // cargo hangar, high module density, utilitarian palette.
  blocky: {
    id: 'blocky',
    label: 'Blocky',
    blurb: 'Modular industrial freighter. Boxy hex hulls, heavy paneling and greebles, cargo hangar, high module density.',
    params: {
      hull: {
        archetype: C(['blocky']),
        length: N(45, 90),
        beam: N(22, 44),
        height: N(12, 24),
        crossSection: C(['hex', 'octagon']),
        noseTaper: N(0.1, 0.4),
        sternTaper: N(0.1, 0.35),
        deckOffset: N(0, 0.1),
        keelOffset: N(0, 0.05),
        chamfer: N(0.05, 0.2),
        stations: N(10, 18, true),
      },
      modules: {
        density: N(0.7, 0.95),
        bridge: M({ enabled: true, size: N(1.0, 1.6), style: C(BRIDGE_STYLES) }),
        commandSpike: M({ enabled: B(0.5), height: N(4, 8) }),
        nacelles: M({ enabled: true, count: C([2, 2, 2, 4, 4]), size: N(0.6, 1.1), strut: C(NACELLE_STRUT_STYLES), lift: C(NACELLE_LIFT_OPTIONS), angle: C(NACELLE_ANGLE_OPTIONS), tail: C(NACELLE_TAIL_OPTIONS), mount: C(NACELLE_MOUNTS), type: C(NACELLE_TYPES) }),
        weapons: M({ enabled: B(0.4), count: N(1, 4, true), size: N(0.7, 1.2), style: C(WEAPON_STYLES), position: C(WEAPON_POSITIONS) }),
        sensorMast: M({ enabled: B(0.5), count: C([1, 2]), height: N(3, 6) }),
        antenna: M({ enabled: B(0.7), count: N(2, 5, true) }),
        hangar: M({ enabled: B(0.85), count: 1, position: C(HANGAR_POSITIONS) }),
      },
      texture: {
        palette: P([
          ['#7a8290', '#525a68', '#e8a33d', '#c8ccd2'],
          ['#857f72', '#5c564a', '#d99a3a', '#cfc9bd'],
          ['#6f7684', '#4a515e', '#e0b040', '#bcc2ca'],
        ]),
        panelLines: M({ enabled: true, weight: N(0.7, 1) }),
        greebles: M({ enabled: true, density: N(0.7, 1) }),
        wear: M({ enabled: true, amount: N(0.5, 0.8) }),
        stripes: M({ enabled: B(0.5), count: C([1, 2]), width: N(0.06, 0.18) }),
        emblem: M({ enabled: B(0.4), style: C(['bar', 'none']) }),
        size: 512,
      },
    },
  },

  // 8. Placeholder (default; used by randomConfig). A balanced, generic ship.
  placeholder: {
    id: 'placeholder',
    label: 'Standard',
    blurb: 'Generic baseline. Balanced proportions and a neutral palette; the default until a design language is chosen.',
    params: {
      hull: {
        archetype: C(['blocky', 'sleek', 'lance']),
        length: N(30, 70),
        beam: N(12, 30),
        height: N(8, 18),
        crossSection: C(['hex', 'octagon', 'ellipse']),
        noseTaper: N(0.2, 0.7),
        sternTaper: N(0.1, 0.5),
        deckOffset: N(0, 0.1),
        keelOffset: N(0, 0.05),
        chamfer: N(0.1, 0.3),
        stations: N(10, 20, true),
      },
      modules: {
        density: N(0.3, 0.7),
        bridge: M({ enabled: true, size: N(0.7, 1.4), style: C(BRIDGE_STYLES) }),
        commandSpike: M({ enabled: B(0.5), height: N(3, 8) }),
        nacelles: M({ enabled: true, count: C([2, 2, 2, 4, 4]), size: N(0.5, 1.0), strut: C(NACELLE_STRUT_STYLES), lift: C(NACELLE_LIFT_OPTIONS), angle: C(NACELLE_ANGLE_OPTIONS), tail: C(NACELLE_TAIL_OPTIONS), mount: C(NACELLE_MOUNTS), type: C(NACELLE_TYPES) }),
        weapons: M({ enabled: B(0.6), count: N(0, 4, true), size: N(0.6, 1.2), style: C(WEAPON_STYLES), position: C(WEAPON_POSITIONS) }),
        sensorMast: M({ enabled: B(0.5), count: C([1, 2]), height: N(2, 5) }),
        antenna: M({ enabled: B(0.5), count: N(0, 3, true) }),
        hangar: M({ enabled: B(0.2), count: 1, position: C(HANGAR_POSITIONS) }),
      },
      texture: {
        palette: P([
          ['#8a94a6', '#5b6472', '#3a86c8', '#66d9ff'],
          ['#7d8794', '#50586a', '#2e86ab', '#7fd4ff'],
          ['#96a0ad', '#667084', '#c0392b', '#ffd23f'],
        ]),
        panelLines: M({ enabled: true, weight: N(0.4, 0.8) }),
        greebles: M({ enabled: true, density: N(0.25, 0.6) }),
        wear: M({ enabled: true, amount: N(0.2, 0.5) }),
        stripes: M({ enabled: B(0.4), count: C([0, 1, 2]), width: N(0.04, 0.14) }),
        emblem: M({ enabled: B(0.5), style: C(['none', 'roundel', 'bar']) }),
        size: 512,
      },
    },
  },
}

export const AESTHETICS = AESTHETIC_DEFS

export function listAesthetics() {
  return Object.values(AESTHETICS)
}

// Resolve the aesthetic's param ranges to concrete values via `rng` and merge
// them over `config` (hull / modules / texture), returning the new config. The
// aesthetic id is pinned onto `aesthetic` so the config round-trips. Unknown ids
// are a no-op. `rng` falls back to a fixed-seed instance so the call is always
// deterministic (the spine always passes the seeded rng).
export function applyAesthetic(id, config, rng) {
  const a = AESTHETICS[id]
  if (!a) return config
  const base = config && typeof config === 'object' ? config : {}
  const resolved = resolveRange(a.params, rng)
  const out = {}
  for (const section of ['hull', 'modules', 'texture']) {
    out[section] = { ...(base[section] && typeof base[section] === 'object' ? base[section] : {}), ...resolved[section] }
  }
  return { ...base, ...out, aesthetic: id }
}
