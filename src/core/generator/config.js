// Canonical, JSON-serializable ship configuration schema (SP-02 owns the shape).
//
// One plain-JSON `ShipConfig` object drives the whole generator. Each aspect
// owns exactly one sub-object and is responsible (in its sub-plan) for its
// fields:
//   - hull      -> SP-04  (geometry)
//   - modules   -> SP-05  (superstructure)
//   - texture   -> SP-06  (procedural surface)
//   - aesthetic -> SP-07  (design language; id into AESTHETICS)
//   - seed      -> SP-02  (drives the seeded RNG)
//
// Keeping the whole config plain JSON is what lets us persist it to IndexedDB
// and round-trip it through the tuning harnesses with no (de)serialization.
//
// The schema below is the single source of truth: `normalizeConfig`,
// `validateConfig`, and `randomFromSchema` are all driven by it, so adding a
// field here is all an aspect needs to make it default, clampable, validatable,
// and randomizable.
//
// Leaf spec types:
//   { type: 'number',  min, max, default, int? }
//   { type: 'boolean', default }
//   { type: 'choice',  enum: [...], default }
//   { type: 'string',  default }            // free text (e.g. aesthetic id)
//   { type: 'palette', default: [base, secondary, accent, glow] }
//   { type: 'object',  children: { ... } }

import { HULL_ARCHETYPES, HULL_SECTIONS } from './hull.js'
import {
  BRIDGE_STYLES,
  WEAPON_STYLES,
  WEAPON_POSITIONS,
  NACELLE_STRUT_STYLES,
  NACELLE_LIFT_OPTIONS,
  NACELLE_ANGLE_OPTIONS,
  NACELLE_TAIL_OPTIONS,
  NACELLE_MOUNTS,
  NACELLE_TYPES,
  HANGAR_POSITIONS,
} from './modules.js'
import { listAesthetics } from '../aesthetics/index.js'

const num = (min, max, def, int = false) => ({ type: 'number', min, max, default: def, int })
// numW: like num, but `rand` holds an array of weighted candidate values for
// randomLeaf (the schema-driven randomizer). The aesthetic ranges are separate
// and unaffected. e.g. numW(0, 4, 0, true, [0, 0, 2, 2, 2, 4]) biases toward 0
// and 2 while still allowing 4.
const numW = (min, max, def, int, rand) => ({ type: 'number', min, max, default: def, int, rand })
const flag = (def) => ({ type: 'boolean', default: def })
const choice = (values, def) => ({ type: 'choice', enum: values, default: def })

export const SHIP_CONFIG_SCHEMA = {
  seed: num(0, 4294967295, 0, true),
  // Free string so SP-07 can add aesthetic ids without re-validating here.
  aesthetic: { type: 'string', default: 'placeholder' },

  hull: {
    type: 'object',
    children: {
      archetype: choice(HULL_ARCHETYPES, 'blocky'),
      // Frigate-scale: length 20+ reads as a capital-ship silhouette, not a toy.
      length: num(20, 150, 40),
      beam: num(8, 60, 14),
      height: num(4, 40, 8),
      crossSection: choice(HULL_SECTIONS, 'hex'),
      noseTaper: num(0, 1, 0.5),
      sternTaper: num(0, 1, 0.35),
      deckOffset: num(0, 1, 0),
      keelOffset: num(0, 1, 0),
      chamfer: num(0, 1, 0.15),
      stations: num(6, 24, 12, true),
      // Disc archetype params (upper/lower curve shape + edge shape).
      discUpperCurve: choice(['convex', 'concave'], 'convex'),
      discLowerCurve: choice(['convex', 'concave'], 'convex'),
      discEdge: choice(['cylinder', 'frustum'], 'cylinder'),
    },
  },

  modules: {
    type: 'object',
    children: {
      density: num(0, 1, 0.5),
      bridge: {
        type: 'object',
        children: {
          enabled: flag(true),
          size: num(0.5, 2, 1),
          style: choice(BRIDGE_STYLES, 'faceted'),
        },
      },
      commandSpike: {
        type: 'object',
        children: {
          enabled: flag(true),
          height: num(1, 15, 6),
          style: choice(['spike', 'dish', 'array'], 'spike'),
        },
      },
      nacelles: {
        type: 'object',
        children: {
          enabled: flag(true),
          // The pod's MOUNT configuration: the single propulsion layout the ship
          // has. Replaces the old engineBlocks system (which was redundant with
          // nacelles — both were propulsion). Only one mount per ship.
          //   pylon -> long pods on swept struts off the flank.
          //   aft   -> short stubby pods at the stern, no nose components.
          //   waist -> pods mounted directly on the hull's waist.
          mount: choice(NACELLE_MOUNTS, 'pylon'),
          // The pod's BODY type: 'standard' (long tapered cylinder) or
          // 'crystal' (faceted hexagonal prism + pointed caps).
          type: choice(NACELLE_TYPES, 'standard'),
          count: numW(0, 4, 2, true, [2, 2, 2, 4, 4]),
          size: numW(0.5, 3, 1, false, [0.5, 0.6, 0.7, 0.8, 1.0, 1.4, 2.0, 3.0]),
          // How the nacelle's support strut sweeps along the travel axis (+Z):
          //   forward  -> strut slants from a hull root AFT of the pod, reaching
          //                up-and-fwd to the pod (a leading-edge pylon).
          //   straight -> strut is perpendicular to the hull (pure side offset).
          //   aft      -> strut slants from a hull root FORWARD of the pod,
          //                reaching back-and-up to the pod (a trailing pylon).
          strut: choice(NACELLE_STRUT_STYLES, 'straight'),
          // How high the pod is raised above the centreline on its strut (a
          // fraction of the hull height: 0 = level, 1 = a full hull-height up).
          // The strut is always long enough to clear the tapered hull flank.
          lift: choice(NACELLE_LIFT_OPTIONS, 0),
          // The pod's pitch about its outboard axis (up / level / down), so a
          // nacelle can be banked to clear its neighbours. Paired nacelles share
          // this angle; different pairs (at different z) can differ.
          angle: choice(NACELLE_ANGLE_OPTIONS, 'level'),
          // The shape of the pod's aft (trailing) end: dome / point / scallop /
          // flared / vented. A distinct exhaust form per ship.
          tail: choice(NACELLE_TAIL_OPTIONS, 'dome'),
        },
      },
      weapons: {
        type: 'object',
        children: {
          enabled: flag(true),
          count: num(0, 8, 3, true),
          size: num(0.5, 2, 1),
          style: choice(WEAPON_STYLES, 'turret'),
          // WHERE on the hull the weapons are mounted (the barrel still always
          // points along +Z, the travel axis). `top` is the classic deck ring;
          // `chin` is the forward-bottom (under the nose); `belly` is the
          // ventral keel line.
          position: choice(WEAPON_POSITIONS, 'top'),
        },
      },
      sensorMast: {
        type: 'object',
        children: {
          enabled: flag(true),
          count: num(0, 4, 1, true),
          height: num(1, 10, 4),
          style: choice(['mast', 'pole', 'ring'], 'mast'),
        },
      },
      antenna: {
        type: 'object',
        children: {
          enabled: flag(true),
          count: num(0, 6, 2, true),
          style: choice(['whip', 'array', 'dish'], 'whip'),
        },
      },
      hangar: {
        type: 'object',
        children: {
          enabled: flag(false),
          count: num(0, 2, 1, true),
          style: choice(['bay', 'pod', 'dock'], 'bay'),
          position: choice(HANGAR_POSITIONS, 'side'),
        },
      },
    },
  },

  texture: {
    type: 'object',
    children: {
      // [base, secondary, accent, glow] — 4 hex color strings.
      palette: { type: 'palette', default: ['#8a94a6', '#5b6472', '#3a86c8', '#66d9ff'] },
      panelLines: {
        type: 'object',
        children: { enabled: flag(true), weight: num(0, 1, 0.6) },
      },
      greebles: {
        type: 'object',
        children: { enabled: flag(true), density: num(0, 1, 0.4) },
      },
      wear: {
        type: 'object',
        children: { enabled: flag(true), amount: num(0, 1, 0.35) },
      },
      stripes: {
        type: 'object',
        children: {
          enabled: flag(true),
          count: num(0, 8, 2, true),
          width: num(0.02, 0.5, 0.1),
        },
      },
      emblem: {
        type: 'object',
        children: {
          enabled: flag(true),
          style: choice(['none', 'roundel', 'chevron', 'bar', 'star'], 'roundel'),
        },
      },
      size: num(64, 2048, 512, true),
    },
  },
}

// --- helpers -----------------------------------------------------------------

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function describe(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function clampNum(value, spec) {
  let n = Number(value)
  if (!Number.isFinite(n)) n = spec.default
  if (n < spec.min) n = spec.min
  if (n > spec.max) n = spec.max
  if (spec.int) n = Math.round(n)
  return n
}

function isGoodPalette(v) {
  return Array.isArray(v) && v.length === 4 && v.every((c) => typeof c === 'string' && c.length)
}

// --- normalization (fill defaults + clamp) -----------------------------------

function normalizeLeaf(value, spec) {
  switch (spec.type) {
    case 'number':
      return clampNum(value, spec)
    case 'boolean':
      return typeof value === 'boolean' ? value : spec.default
    case 'choice':
      return spec.enum.includes(value) ? value : spec.default
    case 'string':
      return typeof value === 'string' && value.length ? value : spec.default
    case 'palette':
      return isGoodPalette(value) ? [...value] : [...spec.default]
    case 'object': {
      const src = isObject(value) ? value : {}
      const out = {}
      for (const [key, childSpec] of Object.entries(spec.children)) {
        out[key] = normalizeLeaf(src[key], childSpec)
      }
      return out
    }
    default:
      return spec.default
  }
}

export function normalizeConfig(config = {}) {
  const src = isObject(config) ? config : {}
  const out = {}
  for (const [key, spec] of Object.entries(SHIP_CONFIG_SCHEMA)) {
    out[key] = normalizeLeaf(src[key], spec)
  }
  return out
}

// --- validation --------------------------------------------------------------

function validateLeaf(value, spec, path, errors) {
  if (value === undefined) return // missing -> default fills in
  switch (spec.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`${path}: expected a finite number, got ${describe(value)}`)
        return
      }
      if (value < spec.min || value > spec.max) {
        errors.push(`${path}: ${value} is out of range [${spec.min}, ${spec.max}]`)
      }
      break
    }
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${path}: expected a boolean, got ${describe(value)}`)
      }
      break
    case 'choice':
      if (!spec.enum.includes(value)) {
        errors.push(`${path}: '${value}' is not one of [${spec.enum.join(', ')}]`)
      }
      break
    case 'string':
      if (typeof value !== 'string' || !value.length) {
        errors.push(`${path}: expected a non-empty string, got ${describe(value)}`)
      }
      break
    case 'palette':
      if (!isGoodPalette(value)) {
        errors.push(`${path}: expected an array of 4 color strings, got ${describe(value)}`)
      }
      break
    case 'object': {
      if (!isObject(value)) {
        errors.push(`${path}: expected an object, got ${describe(value)}`)
        return
      }
      for (const [key, childSpec] of Object.entries(spec.children)) {
        validateLeaf(value[key], childSpec, `${path}.${key}`, errors)
      }
      break
    }
    // Unknown leaf spec types are ignored (forward-compatible).
  }
}

export function validateConfig(config = {}) {
  const src = isObject(config) ? config : {}
  const errors = []
  for (const [key, spec] of Object.entries(SHIP_CONFIG_SCHEMA)) {
    validateLeaf(src[key], spec, key, errors)
  }
  return { ok: errors.length === 0, errors }
}

// --- randomization -----------------------------------------------------------

// --- HSL color helpers (deterministic, seeded) --------------------------------
// Used to bias the random palette: the base colour is desaturated with a wide
// brightness range, the other slots are derived from the base with mild
// hue/saturation/brightness variation, and the module tone is a mild shift of
// the base (see varyModuleTone, consumed by the modules + spine).

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)))

// HSL (h in degrees, s/l in 0..1) -> [r, g, b] 0..255.
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360
  let r, g, b
  if (s === 0) {
    r = g = b = l
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s
    const p = 2 * l - q
    r = hue2rgb(p, q, h + 1 / 3)
    g = hue2rgb(p, q, h)
    b = hue2rgb(p, q, h - 1 / 3)
  }
  return [clampByte(r * 255), clampByte(g * 255), clampByte(b * 255)]
}

function rgbToHex(r, g, b) {
  const byte = (v) => clampByte(v).toString(16).padStart(2, '0')
  return `#${byte(r)}${byte(g)}${byte(b)}`
}

// Parse a hex colour to [r, g, b] (0..255).
function hexToRgbArr(hex) {
  const h = String(hex || '').replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0')
  const n = parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(n)) return [138, 148, 166]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// [r, g, b] (0..255) -> { h (0..360), s (0..1), l (0..1) }.
function rgbToHsl(r, g, b) {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
    }
    h *= 60
  }
  return { h, s, l }
}

// A desaturated base colour: low saturation (strong bias toward muted/grey tones)
// with a WIDE brightness range that trends toward the DARK end (more variation,
// but a darker floor so hulls read as deep, moody tones rather than washed-out
// light greys). Returns an [r, g, b] triple.
export function randomDesaturatedBase(rng) {
  const h = rng.range(0, 360)
  // Strong desaturation: s in [0.05, 0.30], skewed toward the low end.
  const s = 0.05 + Math.pow(rng.next(), 1.6) * 0.25
  // Brightness: l in [0.14, 0.72], skewed toward the low end (darker hulls).
  // pow > 1 pushes the distribution down; the cap keeps a few mid tones.
  const l = 0.14 + Math.pow(rng.next(), 1.5) * 0.58
  return hslToRgb(h, s, l)
}

// Derive the secondary/accent/glow slots from the base [r, g, b]: mild hue +
// saturation shifts and brightness variation. `i` selects the slot's character:
//   0 secondary (near the base, darker), 1 accent (more hue shift, brighter),
//   2 glow (saturated, bright).
export function derivePaletteSlot(rng, baseRgb, i) {
  const { h, s, l } = rgbToHsl(baseRgb[0], baseRgb[1], baseRgb[2])
  const hueShift = [rng.range(-18, 18), rng.range(35, 90), rng.range(40, 120)][i]
  const sat = [
    clamp01(s + rng.range(-0.05, 0.1)),
    clamp01(s + rng.range(0.1, 0.4)),
    clamp01(s + rng.range(0.35, 0.6)),
  ][i]
  const light = [
    clamp01(l + rng.range(-0.18, -0.02)),
    clamp01(l + rng.range(0.0, 0.2)),
    clamp01(l + rng.range(0.15, 0.45)),
  ][i]
  const rgb = hslToRgb(h + hueShift, sat, light)
  return rgbToHex(rgb[0], rgb[1], rgb[2])
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))

// A full 4-slot palette [base, secondary, accent, glow] with the desaturated
// base + brightness-varied derived tones described above.
export function randomPalette(rng) {
  const base = randomDesaturatedBase(rng)
  return [
    rgbToHex(base[0], base[1], base[2]),
    derivePaletteSlot(rng, base, 0),
    derivePaletteSlot(rng, base, 1),
    derivePaletteSlot(rng, base, 2),
  ]
}

// A MILD colour variation of the hull base colour for a given module: a small
// shift in hue, saturation, OR brightness (chosen per call) so modules on a
// hull read as the same family with subtle tonal differences. Returns hex.
export function varyModuleTone(rng, baseHex, amount = 0.12) {
  const [r, g, b] = hexToRgbArr(baseHex)
  const { h, s, l } = rgbToHsl(r, g, b)
  const mode = rng.int(0, 2) // 0 hue, 1 saturation, 2 brightness
  let dh = 0
  let ds = 0
  let dl = 0
  if (mode === 0) dh = rng.range(-14, 14) * (amount / 0.12)
  else if (mode === 1) ds = clamp01(s + rng.range(-0.12, 0.12) * (amount / 0.12)) - s
  else dl = clamp01(l + rng.range(-0.1, 0.1) * (amount / 0.12)) - l
  const rgb = hslToRgb(h + dh, clamp01(s + ds), clamp01(l + dl))
  return rgbToHex(rgb[0], rgb[1], rgb[2])
}

function randomLeaf(rng, spec) {
  switch (spec.type) {
    case 'number':
      if (Array.isArray(spec.rand)) return rng.pick(spec.rand)
      return spec.int ? rng.int(spec.min, spec.max) : rng.range(spec.min, spec.max)
    case 'boolean':
      return rng.bool()
    case 'choice':
      return rng.pick(spec.enum)
    case 'string':
      // Aesthetic id — SP-02 uses the placeholder; SP-07 will vary it.
      return spec.default
    case 'palette':
      // Desaturated base + brightness-varied derived tones (see randomPalette).
      return randomPalette(rng)
    case 'object': {
      const out = {}
      for (const [key, childSpec] of Object.entries(spec.children)) {
        out[key] = randomLeaf(rng, childSpec)
      }
      return out
    }
    default:
      return spec.default
  }
}

// Build a complete config by drawing every leaf from the schema via `rng`.
// The caller should run the result through normalizeConfig to be safe.
export function randomFromSchema(rng) {
  const out = {}
  for (const [key, spec] of Object.entries(SHIP_CONFIG_SCHEMA)) {
    out[key] = randomLeaf(rng, spec)
  }
  return out
}

// The set of aesthetic ids the main-app "Randomize" button can roll, read from
// the aesthetics registry so the UI gets a varied (not always-placeholder)
// design language per random ship.
function aestheticIds() {
  const list = listAesthetics()
  return Array.isArray(list) && list.length ? list.map((a) => a.id) : ['placeholder']
}

// A random aesthetic id from the registry (for the UI "Randomize" button).
export function randomAestheticId(rng) {
  const ids = aestheticIds()
  return ids.length ? rng.pick(ids) : 'placeholder'
}

// A fresh biased palette (desaturated base + derived tones) for the UI
// "Randomize" button. Returns a 4-slot [base, secondary, accent, glow] array.
export function randomizePalette(rng) {
  return randomPalette(rng)
}

// --- public config utilities -------------------------------------------------

// A deep clone of the given config (plain JSON round-trip helper).
export function cloneConfig(config = {}) {
  return JSON.parse(JSON.stringify(config ?? {}))
}

// The full default config, derived from the schema so it can never drift.
export const DEFAULT_SHIP_CONFIG = normalizeConfig({})
