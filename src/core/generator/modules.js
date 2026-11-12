import * as THREE from 'three'
import { createRng } from './rng.js'
import { varyModuleTone, DEFAULT_PALETTE } from './config.js'
import { TWIN_TUBE_OFFSET, TWIN_TUBE_BEAM, TWIN_CROSSBEAM_H, DEFAULT_LENGTH, DEFAULT_BEAM, DEFAULT_HEIGHT } from './hull.js'

// SUPERSTRUCTURE & MODULES (SP-05 owns the full catalog).
//
// Contract:
//   generateModules(moduleParams, hullInfo, { material } = {}) -> THREE.Group
//   - Returns a Group in hull-local space (same space as the hull geometry).
//   - Forward = +Z. Placement uses `hullInfo` (dimensions + anchors).
//   - Uses the supplied `material` when given (shared with the hull), otherwise
//     a default.
//   - Deterministic given (moduleParams, hullInfo, rng): no Math.random.
//
// Catalog: bridge, commandSpike, nacelles, weapons, sensorMast,
// antenna, hangar. Each is a builder (rng, ctx) -> THREE.Group that places
// its meshes on the hull via the anchors. `generateModules` counts instances
// per module from density + per-module config, then calls the builder once per
// instance so the returned group's child count grows with density.
//
// Every module type is a family of distinct multi-part, multi-material,
// multi-style geometries, so nothing is instanced: each instance is built as an
// individual group. Correctness + per-style distinctness matter more than the
// draw-call win (engines are few, 2..8; the other "greeble-like" repeats are
// small counts too).

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const lerp = (a, b, t) => a + (b - a) * t
const PI2 = Math.PI * 2

// --- module tuning constants -------------------------------------------------
// Pod taper ratio (the pod's aft end is narrower than its fore end by this
// fraction). Used by the standard + crystal pod builders.
const POD_TAPER = 0.92

// Weapon mount embed: how far the weapon base is sunk into the hull surface so
// it seats flush rather than floating.
const WEAPON_EMBED = 0.18

// Fit-guard embed: the floor + fraction used by bridge, commandSpike,
// sensorMast, and antenna to keep modules from clipping through the hull.
const EMBED_FLOOR = 0.1
const EMBED_FRAC = 0.2

// Aft pod radius fraction (× min(beam, height) × size).
const AFT_POD_RADIUS_FRAC = 0.2

// Insect hull surface boost: the bin extrema under-sample the ellipsoid bulges,
// so the actual surface is ~11% larger than the single-ellipse formula.
const INSECT_SURFACE_BOOST = 1.11

// Nacelle pair-RNG seed multiplier (per-pair derived seed).
const PAIR_SEED_MULT = 7919

function defaultMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.5, roughness: 0.6 })
}

// Build a glow material from a single emissive colour. One colour is shared by
// EVERY glowing part on a given ship (see `glowColor` in generateModules), so
// a ship reads as a coherent light signature rather than a rainbow of accents.
// `glowColor` is a hex string (palette[3]) or a number; null/undefined falls
// back to the pre-redesign cyan.
function makeGlowMaterial(glowColor) {
  const emissive = glowColor === null || glowColor === undefined ? parseInt(DEFAULT_PALETTE[3].slice(1), 16) : glowColor
  return new THREE.MeshStandardMaterial({
    color: 0x0a1420,
    emissive,
    emissiveIntensity: 1.4,
    roughness: 0.35,
    metalness: 0.2,
  })
}


// Superstructure style options. Each component gets a small family of distinct
// base geometries; a missing/invalid `style` value falls back to the named
// default (the pre-redesign look) in each builder.
// Nacelle strut sweep options (how the support strut slants along the travel
// axis). A missing/invalid value falls back to 'straight' in buildNacelle.
export const NACELLE_STRUT_STYLES = ['forward', 'straight', 'aft']

// Nacelle vertical lift options: how high the pod is raised above the centreline
// on its strut (0 = level with the deck, 1 = raised a full hull-height). A
// missing/invalid value falls back to 0 in buildNacelle. The strut is always long
// enough to clear the hull's tapered flank at the pod's fore end.
export const NACELLE_LIFT_OPTIONS = [0, 0.35, 0.7, 1]

// Nacelle pod angle options: the pod's pitch about its outboard (X) axis, so a
// nacelle can be banked up, held level, or banked down along the travel axis.
// This helps paired nacelles clear each other (e.g. one pair level, the next
// pair angled). A missing/invalid value falls back to 'level' in buildNacelle.
//   up    -> fore end raised (pod noses up)
//   level -> pod runs parallel to the hull (the pre-redesign behaviour)
//   down  -> fore end lowered (pod noses down)
export const NACELLE_ANGLE_OPTIONS = ['up', 'level', 'down']

// Nacelle trailing-end (aft cap) options: the shape of the pod's aft end (-Z).
// A missing/invalid value falls back to 'dome' in buildNacelle. The pod body is
// tapered (narrower at the fore end); these caps finish the aft end in a
// distinct form so a ship's nacelles read as a varied set:
//   dome     -> a glowing hemisphere (mirrors the fore dome, a bright exhaust cap)
//   point    -> a tapered cone to a sharp point (a needle-like exhaust tip)
//   scallop  -> a recessed, scalloped cut-out: a ring with a glowing concave dish
//   flared   -> a flared bell/cone that widens aft (a nozzle-like exhaust)
//   vented   -> a flat cap with a glowing central port + a ring of small vents
export const NACELLE_TAIL_OPTIONS = ['dome', 'point', 'scallop', 'flared', 'vented', 'cowled']
// The pod's BODY type: 'standard' is the current long tapered cylinder pod;
// 'crystal' is a faceted hexagonal prism with pointed caps at both ends (the old
// crystal engine, now a nacelle pod). Independent of mount — a crystal pod can
// be pylon/aft/waist mounted.
export const NACELLE_TYPES = ['standard', 'crystal']
// The pod's MOUNT configuration (replaces the old engineBlocks system): the
// three propulsion layouts a ship can have. Only one mount per ship.
//   pylon -> long pods on swept struts off the flank (the current nacelle look).
//   aft   -> short stubby pods mounted at the stern, no nose components.
//   waist -> a set of pods mounted directly on the hull's waist (midship flank).
export const NACELLE_MOUNTS = ['pylon', 'aft', 'waist']

export const BRIDGE_STYLES = ['faceted', 'dome', 'nose', 'capsule', 'pillbox']
export const COMMAND_SPIKE_STYLES = ['spike', 'dish', 'array']
export const HANGAR_STYLES = ['bay', 'pod', 'dock']
export const HANGAR_POSITIONS = ['side', 'nose', 'chin', 'belly']
export const SENSOR_MAST_STYLES = ['mast', 'pole', 'ring']
export const ANTENNA_STYLES = ['whip', 'array', 'dish']

// Weapon style options (mirror of the other component STYLES). Every weapon
// style keeps its barrel aligned along the axis of travel (+Z, the ship's
// forward); the styles differ in turret/gunhouse silhouette, barrel, and any
// emissive tip. A missing/invalid value falls back to 'turret' (the default) in
// buildWeapon.
//
// Turret / gunhouse families (distinct housings, mat + a +Z barrel):
//   turret, twinTurret, boxy, dome, angular
// Cannon family (thinner barrels, some with emissive tips):
//   cannon, longCannon, muzzleBrake, suppressor, dish, tipGlow
//   railgun (long thin rail + glowing channel, kept from before)
export const WEAPON_STYLES = [
  'turret',
  'twinTurret',
  'boxy',
  'dome',
  'angular',
  'cannon',
  'longCannon',
  'muzzleBrake',
  'suppressor',
  'dish',
  'tipGlow',
  'railgun',
]

// Where on the hull the weapons are mounted (independent of `style`, which is
// the weapon's own geometry). A missing/invalid value falls back to 'top' in
// buildWeapon. `chin` = forward-bottom (under the nose), `belly` = ventral keel
// line, `top` = the classic upper girdle ring (the pre-redesign behaviour).
export const WEAPON_POSITIONS = ['top', 'chin', 'belly', 'nose']

// Per-weapon-style glow accents. Turret/gunhouse styles are mat-only (no glow);
// the cannon variants and railgun get an emissive tip/channel. Every glowing part
// shares the ship's single glow material (ctx.glowMat, built from palette[3] in
// generateModules) so a ship's lights read as one coherent signature.
const WEAPON_GLOW_STYLES = new Set([
  'cannon',
  'longCannon',
  'muzzleBrake',
  'suppressor',
  'dish',
  'tipGlow',
  'railgun',
])
// Return the shared glow material for weapon styles that glow, else null (the
// turret/gunhouse family has no emissive accent).
function weaponGlowMat(style, sharedGlowMat) {
  const s = WEAPON_STYLES.includes(style) ? style : 'turret'
  return WEAPON_GLOW_STYLES.has(s) ? sharedGlowMat : null
}

// Derive a glass tint from the ship's single emissive colour: a brightened
// version for the glass body + a darker attenuation colour so glazing reads as
// the ship's light signature (tinted, refracting, faintly emissive) rather than
// a fixed cyan/violet. Returns a tint/attenuation pair as THREE.Color.
function glassTint(glowColor) {
  const base = new THREE.Color(glowColor === null || glowColor === undefined ? 0x66d9ff : glowColor)
  // Brighten toward white so the glass body reads as lit glazing, not a dark
  // solid; the attenuation colour is the raw emissive hue (the deeper tint).
  const tint = base.clone().lerp(new THREE.Color(0xffffff), 0.55)
  const attenuation = base.clone()
  return { tint, attenuation }
}

// Viewscreen glass: a real transmission material so bridge windows/domes read as
// glazing (see-through, refracting, lightly tinted by the ship's emissive)
// rather than a flat emissive slab. A faint emissive keeps a hint of "lit
// cabin" glow. Built per-ship from the single `glowColor`.
function glassMaterial(glowColor) {
  const { tint, attenuation } = glassTint(glowColor)
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: 0.0,
    roughness: 0.06,
    transmission: 1.0, // fully transmissive -> glass, not a solid
    thickness: 0.6,
    ior: 1.45, // glass index of refraction
    attenuationColor: attenuation,
    attenuationDistance: 4,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.2,
    // A whisper of emissive so the cabin reads as lit, not dead glass.
    emissive: tint.clone().multiplyScalar(0.18),
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 1.0,
  })
}

// Crystal engine glass: a glassy, ONLY-SLIGHTLY-emissive transmission material
// (unlike the bright glow of the other engine styles). The faint emissive +
// transmission makes it read as a glowing crystal in the ship's signature hue.
// Built per-ship from the single `glowColor`.
function crystalGlassMaterial(glowColor) {
  const { tint, attenuation } = glassTint(glowColor)
  return new THREE.MeshPhysicalMaterial({
    color: tint,
    metalness: 0.0,
    roughness: 0.08,
    transmission: 0.92, // mostly glass
    thickness: 1.2,
    ior: 1.6, // crystal-like refraction
    attenuationColor: attenuation,
    attenuationDistance: 2.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.4,
    // Slightly emissive (NOT the bright 1.4 of the glow materials).
    emissive: tint.clone().multiplyScalar(0.55),
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 1.0,
  })
}

// Resolve an anchor vector to a finite fallback when the hull did not provide
// it, so no NaN vertices can ever be produced.
function resolveAnchor(anchors, name, fallback) {
  const v = anchors?.[name]
  if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) return v
  return fallback
}

// --- fit guard: hull-surface query -------------------------------------------
//
// Modules are placed at fixed offsets from the hull ENVELOPE anchors. On some
// bodies (saucer, wedge, insect, twin) the real surface sits INSIDE the
// envelope, so a fixed offset can leave a module's base floating in empty
// space. The fit guard fixes that with two complementary mechanisms:
//
//   1. SURFACE QUERY — makeSurfaceQuery() returns a function that, given a
//      direction and an in-plane coordinate, reports where the ACTUAL hull
//      surface is (not the envelope). It samples the hull group's mesh
//      vertices (world space, the hull group is identity so hull-local ==
//      world) into coarse z-bins, and answers the six directions the builders
//      need: top (max Y at z), side (max |X| at z), aft (min Z), fore (max Z),
//      plus a twin-tube query for the two side modules.
//
//   2. SEAT-ONTO-HULL — each builder seats its base on the queried surface and
//      penetrates it by a small embedding depth (a fraction of the module's
//      own size) so the base is guaranteed to touch/embed the hull even if the
//      query is slightly off.
//
// The query is a pure function of (hullGroup, hullInfo, position): no
// Math.random. When `hullGroup` is absent (backward-compatible fallback) the
// query returns the anchor/envelope values, so the guard degrades to the
// pre-guard behaviour.

// --- truncated icosahedron (soccer ball) geometry ----------------------------
//
// A truncated icosahedron is formed by cutting off each vertex of a regular
// icosahedron at 1/3 of the edge length: each original vertex becomes a regular
// pentagon, each original triangular face becomes a regular hexagon. The result
// is the classic "soccer ball" / "frustrated-points icosahedron" — an
// Archimedean solid with 12 pentagons + 20 hexagons, 60 vertices, 90 edges.
//
// three.js has no built-in for this, so we generate it from the icosahedron's
// own geometry: take an IcosahedronGeometry(r, 0), find its unique vertices and
// faces, compute the trisection points along each edge, and build pentagonal
// faces at the vertices + hexagonal faces from the original triangles. The
// result is a BufferGeometry with flat (non-indexed) triangles so it shades as
// distinct facets (matte, faceted look) rather than a smooth sphere.
//
// Deterministic (no randomness): the icosahedron is regular, so the truncation
// is exact. `r` is the circumradius of the resulting solid (the pentagon/hexagon
// vertices sit at radius ~r from the origin).
function makeTruncatedIcosahedron(r) {
  // Start from a regular icosahedron (12 vertices, 20 faces).
  const ico = new THREE.IcosahedronGeometry(1, 0)
  const pos = ico.attributes.position
  // Collect unique vertices (the icosahedron's 12 corners). IcosahedronGeometry
  // is non-indexed (each face has its own 3 verts), so dedupe by position.
  const uniqueVerts = []
  const vertIndex = new Map()
  const key = (x, y, z) => `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`
  const findOrAdd = (x, y, z) => {
    const k = key(x, y, z)
    if (vertIndex.has(k)) return vertIndex.get(k)
    const idx = uniqueVerts.length
    uniqueVerts.push(new THREE.Vector3(x, y, z).normalize().multiplyScalar(1))
    vertIndex.set(k, idx)
    return idx
  }
  // The 20 faces as [a, b, c] vertex indices (deduped).
  const faces = []
  for (let i = 0; i < pos.count; i += 3) {
    const a = findOrAdd(pos.getX(i), pos.getY(i), pos.getZ(i))
    const b = findOrAdd(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1))
    const c = findOrAdd(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2))
    if (a !== b && b !== c && a !== c) faces.push([a, b, c])
  }
  // The 30 edges (unique pairs of vertex indices) — each icosahedron edge is
  // shared by exactly 2 faces.
  const edgeSet = new Map()
  const addEdge = (u, v) => {
    const k = u < v ? `${u}-${v}` : `${v}-${u}`
    if (!edgeSet.has(k)) edgeSet.set(k, [u, v])
  }
  for (const [a, b, c] of faces) {
    addEdge(a, b)
    addEdge(b, c)
    addEdge(c, a)
  }
  // Truncation: cut each vertex at 1/3 of the edge length from the corner. For
  // each edge (u, v), the two trisection points are:
  //   p_uv = u + (v - u) / 3   (near u)
  //   p_vu = v + (u - v) / 3   (near v)
  // The truncated solid's 60 vertices are these trisection points.
  // For each original vertex u, its 5 incident edges give 5 trisection points
  // (the ones NEAR u), which form a pentagon. For each original face (a,b,c),
  // its 3 edges give 6 trisection points (2 per edge), which form a hexagon.
  const T = (u, v, nearU) => {
    // Trisection point on edge (u,v), `nearU ? 1/3 from u : 1/3 from v`.
    const a = uniqueVerts[u]
    const b = uniqueVerts[v]
    const t = nearU ? 1 / 3 : 2 / 3
    return a.clone().lerp(b, t).normalize().multiplyScalar(r)
  }
  // Build a flat (non-indexed) triangle list.
  const verts = []
  const addTri = (a, b, c) => {
    // Winding: ensure outward-facing (CCW when viewed from outside). We add the
    // triangles in the order the source geometry gives them, which is already
    // outward-facing for the icosahedron; the truncation preserves orientation.
    verts.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
  }
  // Pentagon at each original vertex: the 5 trisection points NEAR that vertex,
  // in the order of its incident edges (which is the CCW order around the vertex).
  const vertEdges = new Map() // vertex idx -> array of edge [u, v] (u is the vertex)
  for (const [u, v] of edgeSet.values()) {
    if (!vertEdges.has(u)) vertEdges.set(u, [])
    if (!vertEdges.has(v)) vertEdges.set(v, [])
    vertEdges.get(u).push([u, v])
    vertEdges.get(v).push([v, u])
  }
  for (let u = 0; u < uniqueVerts.length; u++) {
    const edges = vertEdges.get(u) // 5 edges, each [u, v_k]
    // The pentagon's 5 vertices are the trisection points NEAR u on each edge.
    // Order them CCW around u: sort by the angle of the edge direction around u.
    const pts = edges.map(([_, v]) => T(u, v, true))
    // Sort CCW around u's normal (which is u's position, pointing outward).
    const center = uniqueVerts[u].clone().normalize()
    // Build a local frame at center to compute angles.
    const ref = Math.abs(center.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
    const xAxis = new THREE.Vector3().crossVectors(center, ref).normalize()
    const yAxis = new THREE.Vector3().crossVectors(center, xAxis).normalize()
    const ang = (p) => {
      const d = p.clone().sub(center)
      return Math.atan2(d.dot(yAxis), d.dot(xAxis))
    }
    const order = pts.map((_, i) => i).sort((i, j) => ang(pts[i]) - ang(pts[j]))
    // Fan the pentagon into 3 triangles (vertices in CCW order).
    for (let k = 1; k < 4; k++) {
      addTri(pts[order[0]], pts[order[k]], pts[order[k + 1]])
    }
  }
  // Hexagon at each original face: the 6 trisection points on the face's 3
  // edges, in CCW order. For face (a, b, c) with edges (a,b), (b,c), (c,a):
  // the 6 points are, in CCW order around the face:
  //   T(a,b,near a), T(b,c,near b), T(c,a,near c),
  //   T(a,b,near b), T(b,c,near c), T(c,a,near a)
  // (going around the face, alternating near-vertex points).
  for (const [a, b, c] of faces) {
    const p1 = T(a, b, true)  // near a, on edge (a,b)
    const p2 = T(b, c, true)  // near b, on edge (b,c)
    const p3 = T(c, a, true)  // near c, on edge (c,a)
    const p4 = T(a, b, false) // near b, on edge (a,b)
    const p5 = T(b, c, false) // near c, on edge (b,c)
    const p6 = T(c, a, false) // near a, on edge (c,a)
    // CCW order around the face: p1 (near a on ab), p4 (near b on ab),
    // p2 (near b on bc), p5 (near c on bc), p3 (near c on ca), p6 (near a on ca)
    const hex = [p1, p4, p2, p5, p3, p6]
    // Fan the hexagon into 4 triangles.
    for (let k = 1; k < 5; k++) {
      addTri(hex[0], hex[k], hex[k + 1])
    }
  }
  ico.dispose()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  return geo
}

function makeSurfaceQuery(hullGroup, hullInfo) {
  const top = resolveAnchor(hullInfo.anchors, 'top', new THREE.Vector3(0, 0, 0))
  const bottom = resolveAnchor(hullInfo.anchors, 'bottom', new THREE.Vector3(0, 0, 0))
  const port = resolveAnchor(hullInfo.anchors, 'port', new THREE.Vector3(-1, 0, 0))
  const starboard = resolveAnchor(hullInfo.anchors, 'starboard', new THREE.Vector3(1, 0, 0))
  const fore = resolveAnchor(hullInfo.anchors, 'fore', new THREE.Vector3(0, 0, 0))
  const aft = resolveAnchor(hullInfo.anchors, 'aft', new THREE.Vector3(0, 0, 0))
  const halfLen = (hullInfo.length ?? DEFAULT_LENGTH) / 2

  // Sample the hull meshes' vertices into z-bins (one bin per 1% of length).
  // The hull group is added to the ship at identity, so its world positions are
  // hull-local. We keep per-bin extrema only — the query below is exact against
  // the sampled vertices (deterministic, no random).
  const NBINS = 200
  const bins = []
  for (let b = 0; b < NBINS; b++) {
    bins.push({ minY: Infinity, maxY: -Infinity, minX: Infinity, maxX: -Infinity, count: 0 })
  }
  const binIndex = (z) => {
    const f = (z + halfLen) / (2 * halfLen) // 0 at stern .. 1 at nose
    return Math.max(0, Math.min(NBINS - 1, Math.floor(f * NBINS)))
  }
  const zAtBin = (b) => -halfLen + ((b + 0.5) / NBINS) * (2 * halfLen)

  let hasGeometry = false
  if (hullGroup) {
    const v = new THREE.Vector3()
    hullGroup.traverse((o) => {
      if (!o.isMesh) return
      const g = o.geometry
      if (!g) return
      const pos = g.attributes?.position
      if (!pos || pos.count === 0) return
      const mat4 = new THREE.Matrix4()
      o.updateWorldMatrix(true, false)
      mat4.copy(o.matrixWorld)
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mat4)
        const bin = bins[binIndex(v.z)]
        if (v.y < bin.minY) bin.minY = v.y
        if (v.y > bin.maxY) bin.maxY = v.y
        if (v.x < bin.minX) bin.minX = v.x
        if (v.x > bin.maxX) bin.maxX = v.x
        bin.count++
        hasGeometry = true
      }
    })
  }

  // For an empty z-bin, linearly interpolate the nearest non-empty neighbours'
  // extrema so the query is smooth (and falls back to the envelope if every
  // bin is empty).
  const interp = (b, key, fallback) => {
    if (bins[b].count > 0) return bins[b][key]
    let lo = b - 1
    while (lo >= 0 && bins[lo].count === 0) lo--
    let hi = b + 1
    while (hi < NBINS && bins[hi].count === 0) hi++
    if (lo < 0 && hi >= NBINS) return fallback
    if (lo < 0) return bins[hi][key]
    if (hi >= NBINS) return bins[lo][key]
    const t = (zAtBin(b) - zAtBin(lo)) / (zAtBin(hi) - zAtBin(lo))
    return lerp(bins[lo][key], bins[hi][key], clamp(t, 0, 1))
  }

  // Nearest hull surface extent in a given direction at a z. `dir` is one of
  // 'top' | 'bottom' | 'side' | 'aft' | 'fore'. Returns the surface coordinate
  // in that direction (a signed Y, |X|, or Z). Pure in (hullGroup, hullInfo, z).
  // For twin hulls, 'top'/'bottom' use the anchor (crossbeam) rather than the
  // geometry extrema (tube tops), since centreline modules seat on the crossbeam.
  const isTwin = hullInfo.archetype === 'twin'
  function surfaceAt(dir, z) {
    const b = binIndex(z)
    switch (dir) {
      case 'top':
        if (isTwin) return top.y
        return hasGeometry ? interp(b, 'maxY', top.y) : top.y
      case 'bottom':
        if (isTwin) return bottom.y
        return hasGeometry ? interp(b, 'minY', bottom.y) : bottom.y
      case 'side': {
        const mx = hasGeometry ? Math.abs(interp(b, 'maxX', starboard.x)) : Math.abs(starboard.x)
        const mn = hasGeometry ? Math.abs(interp(b, 'minX', port.x)) : Math.abs(port.x)
        return Math.max(mx, mn)
      }
      case 'aft':
        // Furthest aft (-Z) hull point at this z; clamp so the result never
        // runs past the requested z (engines are placed at/inside the stern).
        return hasGeometry ? Math.min(aft.z, z) : Math.min(aft.z, z)
      case 'fore':
        return hasGeometry ? fore.z : fore.z
      default:
        return 0
    }
  }

  // For twin (two side tubes at ±beam*0.28), 'side' returns the max |X| extent
  // at that z, which is the OUTER tube's surface. A side module seated at that
  // extent (and embedded inward) therefore attaches to the nearest tube, not
  // the gap between the tubes.

  // The hull's full cross-section girth (min of the half-beam and half-height
  // extents) at a z, for modules that wrap the hull (the aft engine ring).
  // Uses INTERPOLATED half-extents at the exact Z (via `interp`) so the girth
  // is smooth across all Z values, not just the discrete station rings. A
  // windowed max over nearby non-empty bins (the old approach) under-reads the
  // true girth for tapered sterns because most bins are empty (the lofted hull
  // has only ~14 station rings). The floor is small (5% of the envelope) so it
  // guards against a degenerate zero without over-sizing pods for archetypes
  // with small sterns.
  function girthAt(z) {
    const b0 = binIndex(z)
    const halfBeam = (hullInfo.beam ?? DEFAULT_BEAM) / 2
    const halfHeight = (hullInfo.height ?? DEFAULT_HEIGHT) / 2
    if (!hasGeometry) return Math.min(halfBeam, halfHeight) * 0.1
    const halfX = Math.max(
      Math.abs(interp(b0, 'maxX', halfBeam)),
      Math.abs(interp(b0, 'minX', -halfBeam))
    )
    const halfY = Math.max(
      Math.abs(interp(b0, 'maxY', halfHeight)),
      Math.abs(interp(b0, 'minY', -halfHeight))
    )
    const girth = Math.min(halfX, halfY)
    const floor = Math.min(halfBeam, halfHeight) * 0.05
    return Math.max(girth, floor)
  }

  // The hull's max side extent (max |X|) at a Z, using a windowed max over nearby
  // bins. A single bin can under-read the hull on smooth/domed archetypes (e.g.
  // saucer) where vertex distribution is uneven — some bins get vertices from
  // the curved surface at a smaller radius than the true flank. The windowed max
  // captures the fuller flank so side-mounted pods (waist/pylon) sit on the hull
  // surface rather than inside it.
  function maxSideAt(z, winFrac = 0.04) {
    const b0 = binIndex(z)
    const w = Math.max(1, Math.round(NBINS * winFrac))
    let best = 0
    for (let b = b0 - w; b <= b0 + w; b++) {
      if (b < 0 || b >= NBINS || bins[b].count === 0) continue
      best = Math.max(best, Math.max(Math.abs(bins[b].maxX), Math.abs(bins[b].minX)))
    }
    const halfBeam = (hullInfo.beam ?? DEFAULT_BEAM) / 2
    return Math.max(hasGeometry ? best : 0, halfBeam * 0.5)
  }

  // The Z (within a window around `z`) where the hull's girth is maximal, for
  // placing the aft engine ring on a real cross-section. Scans a window of bins
  // around `z`, but only considers NON-EMPTY bins (actual station rings with
  // vertices). For each candidate, computes the INTERPOLATED girth (via
  // `girthAt`/`interp`, which is smooth across all Z values). This keeps the
  // ring on a real hull cross-section (a station ring) rather than in a
  // vertexless gap between rings where the interpolated surface may be much
  // smaller than the interpolated value suggests.
  function bestGirthZ(z, winFrac = 0.12) {
    const b0 = binIndex(z)
    const w = Math.max(1, Math.round(NBINS * winFrac))
    let bestBin = b0
    let bestGirth = -Infinity
    for (let b = b0 - w; b <= b0 + w; b++) {
      if (b < 0 || b >= NBINS || bins[b].count === 0) continue
      const girth = girthAt(zAtBin(b))
      if (girth > bestGirth) {
        bestGirth = girth
        bestBin = b
      }
    }
    return zAtBin(bestBin)
  }

  // The hull's surface distance from the centreline in the X-Y direction `angle`
  // (radians, 0 = +X/starboard, PI/2 = +Y/top) at a given Z, for the aft engine
  // ring. The hull's cross-section is anisotropic (beam != height), so a pod at
  // angle `angle` sits on the hull surface at a radius that depends on `angle`.
  //
  // The lofted hulls are built from discrete station rings (typically ~14 along
  // the length). Between rings the surface is bilinearly interpolated but has no
  // vertices, so the z-bins in `makeSurfaceQuery` are sparse — most bins are
  // empty. A windowed max over nearby non-empty bins (the old approach)
  // under-reads the true cross-section for tapered sterns: the bin extrema are
  // the max |x| and max |y| at a ring, but a pod at a diagonal angle (e.g. 45°)
  // sits at a smaller radius than either extreme, and the bin's min/max
  // rectangle over-estimates the true surface there.
  //
  // Instead we INTERPOLATE the half-extents (halfX, halfY) at the exact Z using
  // the surrounding station rings (via `interp`), then compute the surface
  // radius from the elliptical cross-section formula:
  //   r = 1 / sqrt( (cos²a)/halfX² + (sin²a)/halfY² )
  // This gives the true surface distance in the pod's direction at the pod's Z,
  // smooth across all Z values (not just the discrete ring stations).
  //
  // TWO-TUBE HULLS (archetype 'twin'): the cross-section is two parallel tubes,
  // not a single ellipse. A pod at a diagonal angle sits in the gap between
  // the tubes. We detect this by checking the X-coverage of the bin's vertices:
  // if the fraction of the X range that contains vertices is low (< 0.65), the
  // section has a gap. For a two-tube section, the pod is placed on the nearest
  // tube's surface (the tube on the pod's side of the centreline).
  function surfaceRadiusAt(angle, z) {
    const b0 = binIndex(z)
    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)
    const halfBeam = (hullInfo.beam ?? DEFAULT_BEAM) / 2
    const halfHeight = (hullInfo.height ?? DEFAULT_HEIGHT) / 2
    if (!hasGeometry) return Math.min(halfBeam, halfHeight) * 0.1
    // Interpolated half-extents at this Z (linear between surrounding rings).
    const halfX = Math.max(
      Math.abs(interp(b0, 'maxX', halfBeam)),
      Math.abs(interp(b0, 'minX', -halfBeam))
    )
    const halfY = Math.max(
      Math.abs(interp(b0, 'maxY', halfHeight)),
      Math.abs(interp(b0, 'minY', -halfHeight))
    )
    // Two-tube detection: check the X-coverage of the bin's vertices. If the
    // fraction of the X range that contains vertices is low, the section has a
    // gap (two tubes). We detect this by the archetype: if hullInfo.archetype
    // is 'twin', the cross-section is two tubes and we place the pod on the
    // nearest tube's surface.
    const isTwin = hullInfo.archetype === 'twin'
    if (isTwin) {
      // For a two-tube section, the tube on the pod's side (sign of cosA) is
      // approximately a circle of radius tubeR centered at (tubeCx, 0). The
      // tube center is at TWIN_TUBE_OFFSET × beam from the centreline and the
      // tube beam is TWIN_TUBE_BEAM × beam, so (in units of halfX ≈ beam/2):
      //   tubeCx = (TWIN_TUBE_OFFSET × beam) / (2 × halfX) × halfX
      //          = TWIN_TUBE_OFFSET × beam / 2  (when halfX ≈ beam/2)
      //   tubeR  = (TWIN_TUBE_BEAM × beam) / 2
      // Using the actual geometry constants so the query matches the built hull.
      const beam = hullInfo.beam ?? DEFAULT_BEAM
      const tubeCx = (TWIN_TUBE_OFFSET * beam) / 2
      const tubeR = (TWIN_TUBE_BEAM * beam) / 2
      const a = cosA
      const b = -2 * tubeCx * a
      const c = tubeCx * tubeCx - tubeR * tubeR
      const disc = b * b - 4 * c
      let r
      if (disc >= 0) {
        r = (-b + Math.sqrt(disc)) / 2
      } else {
        // No intersection (the ray misses the tube) — fall back to the
        // tube's outer edge in the X direction.
        r = tubeCx + tubeR
      }
      const floor = Math.min(halfBeam, halfHeight) * 0.05
      return Math.max(r, floor)
    }
    // Elliptical cross-section: the surface radius in direction (cosA, sinA).
    // Degenerate cases: pod aligned with an axis → the half-extent itself.
    const cos2 = cosA * cosA
    const sin2 = sinA * sinA
    const denom = cos2 / (halfX * halfX) + sin2 / (halfY * halfY)
    if (denom < 1e-12) return 0
    let r = 1 / Math.sqrt(denom)
    // The insect hull is a chain of overlapping ellipsoids. The bin extrema
    // capture the max |x| and |y| at a Z, but the ellipsoids' bulges mean the
    // actual surface can be slightly larger than the single-ellipse formula
    // predicts (the bulge peaks between the bin's sample points). A small boost
    // (11%) keeps the pod outboard of the hull's actual surface.
    if (hullInfo.archetype === 'insect') r *= INSECT_SURFACE_BOOST
    // Small floor guards against a degenerate zero (e.g. a perfectly flat stern
    // cap with no cross-section at the exact Z). Does not push the pod
    // outboard of the real hull.
    const floor = Math.min(halfBeam, halfHeight) * 0.05
    return Math.max(r, floor)
  }

  // Tube surface query for twin hulls: returns the actual geometry's max/min Y
  // at a given Z (the tube's upper/lower surface, following the taper), unlike
  // surfaceAt which returns the fixed anchor for twin hulls. Non-twin hulls
  // just delegate to surfaceAt.
  function tubeSurfaceAt(dir, z) {
    if (!isTwin) return surfaceAt(dir, z)
    const b = binIndex(z)
    if (dir === 'top') return hasGeometry ? interp(b, 'maxY', top.y) : top.y
    if (dir === 'bottom') return hasGeometry ? interp(b, 'minY', bottom.y) : bottom.y
    return surfaceAt(dir, z)
  }

  return { surfaceAt, tubeSurfaceAt, girthAt, surfaceRadiusAt, bestGirthZ, maxSideAt, hasGeometry }
}

// --- module builders ---------------------------------------------------------

// Bridge: superstructure, on the deck (top anchor). `t` is the normalized z of
// this instance (0 = stern, 0.5 = midship, 1 = fore/nose) and is driven by the
// config's `position` field so the bridge can sit ANYWHERE along the hull,
// including right at the nose. A family of distinct silhouettes, each multi-part
// and multi-material (hull `mat` + glass viewscreens + a glowing accent):
//   faceted (default): an angular, bevelled cockpit — chamfered hull body with a
//                      multi-faceted glass windshield (the "block" box, retired).
//   dome:              a rounded glass dome on a low deck collar.
//   capsule:           a TIE-bridge prism (glass or matte) on a round/wedge neck.
//   pillbox:           a low, wide hexagonal frustum with a forward luminous slit.
//   nose:              a forward cockpit hunched on the very tip (always fore.z).
// The bridge is a single CENTRELINE module (built once, on x=0), so it is flagged
// userData.isCentreline and excluded from the port/stbd mirror below.
function buildBridge(rng, ctx) {
  const { mat, glowMat, hull, fore, surface, glowColor } = ctx
  const cfg = ctx.params.bridge
  const style = BRIDGE_STYLES.includes(cfg.style) ? cfg.style : 'faceted'
  const s = cfg.size ?? 1
  const w = hull.beam * 0.3 * s
  const h = hull.height * 0.35 * s
  const d = hull.length * 0.16 * s
  // Position along the hull, from `position` (0 = stern, 0.5 = midship,
  // 1 = fore/nose). The lerp spans the full stern→nose length so the bridge can
  // sit anywhere. The 'nose' style ignores it and always snaps to the very tip.
  const tPos = style === 'nose' ? 1 : clamp(cfg.position ?? 0.5, 0, 1)
  const z = lerp(-fore.z, fore.z, tPos)
  // FIT GUARD: seat the bridge base on the real deck height at this z, not the
  // envelope top anchor (which can be higher on saucer/wedge/insect). The
  // embedding is a fraction of the module's own height so the base penetrates
  // the hull by a meaningful depth (guaranteed contact even if the query is
  // slightly off).
  const baseY = surface.surfaceAt('top', z) - Math.max(EMBED_FLOOR, h * EMBED_FRAC)
  const glass = glassMaterial(glowColor)
  const base = { mat, glowMat, glass, hull, s, w, h, d, z, topY: baseY, fore }

  let g
  switch (style) {
    case 'dome':
      g = buildBridgeDome(base)
      break
    case 'nose':
      g = buildBridgeNose(rng, base)
      break
    case 'capsule':
      g = buildBridgeCapsule(rng, base)
      break
    case 'pillbox':
      g = buildBridgePillbox(base)
      break
    case 'faceted':
    default:
      g = buildBridgeFaceted(base)
      break
  }
  g.userData.isCentreline = true
  return g
}

// Nose: a forward-facing cockpit at the very tip of the hull. Three sub-styles:
//   strut:   low base + 2 angled struts + flat faceted canopy + visor.
//   twin:    low platform + two small faceted domes side by side + visor.
//   hooded:  base + single large dome + solid spine/deflector on top + visor.
// Always placed at the fore tip (fore.z), ignoring per-instance `t`.
function buildBridgeNose(rng, b) {
  const { mat, glowMat, glass, w, h, d, topY, fore } = b
  const group = new THREE.Group()
  group.name = 'bridge:nose'

  const tipZ = fore.z - d * 0.25
  const tipY = topY
  const baseW = w * 0.72
  const baseH = h * 0.18
  const baseD = d * 0.55

  // Shared base platform: a low, wide rounded cylinder + dome buffer below.
  const base = new THREE.Mesh(new THREE.CylinderGeometry(baseW * 0.48, baseW * 0.52, baseH, 12), mat)
  base.name = 'bridgeNoseBase'
  base.scale.set(1, 1, baseD / baseW)
  base.position.set(0, tipY + baseH * 0.5, tipZ)
  group.add(base)

  const baseDome = new THREE.Mesh(
    new THREE.SphereGeometry(baseW * 0.44, 12, 6, 0, PI2, Math.PI * 0.5, Math.PI * 0.5),
    mat,
  )
  baseDome.name = 'bridgeNoseBaseDome'
  baseDome.scale.set(1, 1, baseD / baseW)
  baseDome.position.set(0, tipY, tipZ)
  group.add(baseDome)

  // Shared forward visor: a thin, wide rounded slit.
  const visor = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), glowMat)
  visor.name = 'bridgeNoseVisor'
  visor.scale.set(baseW * 0.35, h * 0.015, h * 0.01)
  visor.position.set(0, tipY + baseH * 0.7, tipZ + baseD * 0.45)
  group.add(visor)

  const style = rng.pick(['strut', 'twin', 'hooded'])

  if (style === 'strut') {
    // Side struts: two angled supports connecting the base to the canopy.
    const strutW = w * 0.06
    const strutH = h * 0.22
    const strutD = d * 0.08
    for (const sx of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(strutW, strutH, strutD), mat)
      strut.name = 'bridgeNoseStrut'
      strut.position.set(sx * baseW * 0.38, tipY + baseH + strutH * 0.4, tipZ + baseD * 0.15)
      strut.rotation.z = sx * -0.15
      group.add(strut)
    }
    // Flat, wide, forward-stretched faceted canopy.
    const canR = w * 0.32
    const canopy = new THREE.Mesh(makeTruncatedIcosahedron(canR), glass)
    canopy.name = 'bridgeNoseGlass'
    canopy.scale.set((baseW * 0.42) / canR, (h * 0.22) / canR, (d * 0.38) / canR)
    canopy.position.set(0, tipY + baseH + h * 0.12, tipZ + d * 0.08)
    group.add(canopy)
  } else if (style === 'twin') {
    // Two small faceted domes side by side (tandem seating).
    const domeR = w * 0.2
    const domeGap = w * 0.14
    for (const sx of [-1, 1]) {
      const dome = new THREE.Mesh(makeTruncatedIcosahedron(domeR), glass)
      dome.name = 'bridgeNoseDome'
      dome.scale.set(
        (w * 0.22) / domeR,
        (h * 0.28) / domeR,
        (d * 0.32) / domeR,
      )
      dome.position.set(sx * domeGap, tipY + baseH + h * 0.16, tipZ + d * 0.06)
      group.add(dome)
    }
    // Centre divider: a thin solid rib between the two domes.
    const rib = new THREE.Mesh(new THREE.BoxGeometry(w * 0.04, h * 0.24, d * 0.28), mat)
    rib.name = 'bridgeNoseRib'
    rib.position.set(0, tipY + baseH + h * 0.14, tipZ + d * 0.06)
    group.add(rib)
  } else {
    // Hooded: a single larger dome with a solid spine/deflector above it.
    const domeR = w * 0.3
    const dome = new THREE.Mesh(makeTruncatedIcosahedron(domeR), glass)
    dome.name = 'bridgeNoseGlass'
    dome.scale.set(
      (baseW * 0.38) / domeR,
      (h * 0.26) / domeR,
      (d * 0.42) / domeR,
    )
    dome.position.set(0, tipY + baseH + h * 0.14, tipZ + d * 0.08)
    group.add(dome)
    // Spine/deflector: a solid angular plate above and behind the dome.
    const spineW = w * 0.12
    const spineH = h * 0.14
    const spineD = d * 0.5
    const spine = new THREE.Mesh(new THREE.BoxGeometry(spineW, spineH, spineD), mat)
    spine.name = 'bridgeNoseSpine'
    spine.position.set(0, tipY + baseH + h * 0.32, tipZ - d * 0.05)
    spine.rotation.x = -0.12
    group.add(spine)
  }

  return group
}

// Faceted (default): a low, angular cockpit with an inverted ovoid (mat) whose
// flat face points up (+Y) and seats the bridge on the deck, and a faceted
// glass canopy (glass) crowning the ovoid. The ovoid's curved extent covers
// the bottom half of the canopy so the glass appears to grow out of the hull.
function buildBridgeFaceted(b) {
  const { mat, glass, w, h, d, z, topY } = b
  const group = new THREE.Group()
  group.name = 'bridge:faceted'

  // Faceted glass canopy: a TRUNCATED icosahedron (glass), squashed to a low
  // dome and stretched toward the bow.
  const glassR = Math.min(w, d) * 0.5
  const canopy = new THREE.Mesh(makeTruncatedIcosahedron(glassR), glass)
  canopy.name = 'bridgeGlass'
  canopy.scale.set(w / (glassR * 1.6), (h * 0.45) / glassR, d / (glassR * 1.4))
  canopy.position.set(0, topY + h * 0.26, z)
  group.add(canopy)

  // Inverted ovoid: a lower hemisphere (flat face up) + a flat cap disc on the
  // equator. The flat face sits barely above the deck (y ≈ topY); the ovoid is
  // enlarged so its curved extent fully covers the canopy's lower facets.
  const ovoidR = Math.min(w, d) * 0.6
  const ovoidGeo = new THREE.SphereGeometry(ovoidR, 16, 10, 0, PI2, Math.PI * 0.5, Math.PI * 0.5)
  const ovoid = new THREE.Mesh(ovoidGeo, mat)
  ovoid.name = 'bridgeFacetedOvoid'
  ovoid.scale.set(w / (ovoidR * 1.5), (h * 0.55) / ovoidR, d / (ovoidR * 1.3))
  ovoid.position.set(0, topY + h * 0.26, z)
  group.add(ovoid)
  // Flat cap disc closing the equator (faces up, +Y).
  const cap = new THREE.Mesh(new THREE.CircleGeometry(ovoidR, 16), mat)
  cap.name = 'bridgeFacetedOvoidCap'
  cap.rotation.x = -Math.PI / 2
  cap.scale.set(w / (ovoidR * 1.5), d / (ovoidR * 1.3), 1)
  cap.position.set(0, topY + h * 0.26, z)
  group.add(cap)

  return group
}

// Dome: a rounded glass dome (glass) on a low deck collar (mat).
function buildBridgeDome(b) {
  const { mat, glass, w, h, z, topY } = b
  const group = new THREE.Group()
  group.name = 'bridge:dome'

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.58, w * 0.64, h * 0.3, 16), mat)
  collar.name = 'bridgeDomeCollar'
  collar.position.set(0, topY + (h * 0.3) / 2, z)
  group.add(collar)

  const collarDome = new THREE.Mesh(
    new THREE.SphereGeometry(w * 0.54, 12, 6, 0, PI2, Math.PI * 0.5, Math.PI * 0.5),
    mat,
  )
  collarDome.name = 'bridgeDomeCollarDome'
  collarDome.position.set(0, topY, z)
  group.add(collarDome)

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(w * 0.55, 24, 12, 0, PI2, 0, Math.PI * 0.5),
    glass,
  )
  dome.name = 'bridgeDome'
  dome.scale.y = h / (w * 1.1)
  dome.position.set(0, topY + h * 0.3, z)
  group.add(dome)

     return group
}

// Capsule: a geometric capsule on a neck — a Star Wars TIE-bridge aesthetic.
// The capsule is a widely-stretched even-sided polygonal prism (4, 6, or 8
// sides) extruded along the travel axis (+Z). Orientation: 4 and 8 have flat
// top/bottom faces; 6 has a point at top. Optional edge bevel. Some capsules
// are enclosed glass cockpits (glass material), others are matte prisms (mat).
// Two neck styles:
//   round:  a short tapered cylinder with a flange (classic).
//   wedge:  a triangular prism extruded in X, with its bottom face flush
//           (or slightly embedded) in the hull and its apex reaching into
//           the capsule. The apex has random play in the Y-Z plane.
function buildBridgeCapsule(rng, b) {
  const { mat, glowMat, glass, z, topY } = b
  // Halve the capsule bridge dimensions so it reads as a compact cockpit pod
  // rather than a bulky block. The neck and flange scale with the capsule.
  const w = b.w * 0.5
  const h = b.h * 0.5
  const d = b.d * 0.5
  const group = new THREE.Group()
  group.name = 'bridge:capsule'

  const isGlass = rng.chance(0.4)
  const capsuleMat = isGlass ? glass : mat
  const sides = rng.int(2, 4) * 2
  const rotY = Math.PI / sides
  const capsuleR = w * 0.42
  const capsuleLen = d * 0.7
  const xStretch = 2.2
  const hasBevel = true
  const bevelT = hasBevel ? capsuleR * 0.12 : 0
  const bevelS = hasBevel ? capsuleR * 0.1 : 0

  const neckStyle = rng.chance(0.5) ? 'wedge' : 'round'
  let capY, capZ = z

  if (neckStyle === 'wedge') {
    // Triangular-prism neck: cross-section in the Y-Z plane, extruded in X.
    // Bottom edge flush with (or slightly inside) the deck; apex reaches
    // into the capsule. The apex has random play in Y and Z.
    const wedgeHalfW = w * 0.45
    const wedgeH = h * 0.5
    const apexY = topY + wedgeH + rng.range(-h * 0.04, h * 0.06)
    const apexZ = z + rng.range(-d * 0.06, d * 0.06)
    const botY = topY - h * 0.03

    const shape = new THREE.Shape()
    shape.moveTo(-wedgeHalfW, botY)
    shape.lineTo(wedgeHalfW, botY)
    shape.lineTo(0, apexY)
    shape.closePath()

    // Extrude the triangle along +Z (shape normal), then rotate so the
    // extrusion runs along +X. rotation.y = -PI/2 maps:
    //   +Z (extrusion) -> +X, +X (shape) -> -Z, Y -> Y.
    const prismDepth = wedgeHalfW * 2
    const prismGeo = new THREE.ExtrudeGeometry(shape, { depth: prismDepth, bevelEnabled: false })
    const wedge = new THREE.Mesh(prismGeo, mat)
    wedge.name = 'bridgeCapsuleNeckWedge'
    wedge.rotation.y = -Math.PI / 2
    // Center the extrusion in X: the shape's local Z (extrusion) runs 0..depth
    // which becomes world X 0..depth after rotation. Offset by -depth/2.
    wedge.position.x = -prismDepth / 2
    group.add(wedge)

    capY = apexY + capsuleR * 0.15
    capZ = apexZ
  } else {
    // Round neck: a tapered cylinder rising from the deck, flaring at the base.
    const neckH = h * 0.4
    const neckTopR = w * 0.24
    const neckBotR = w * 0.38
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(neckTopR, neckBotR, neckH, 8), mat)
    neck.name = 'bridgeCapsuleNeck'
    neck.position.set(0, topY + neckH * 0.5, z)
    group.add(neck)

    const flange = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.44, w * 0.5, h * 0.07, 8), mat)
    flange.name = 'bridgeCapsuleFlange'
    flange.position.set(0, topY + h * 0.035, z)
    group.add(flange)

    const flangeDome = new THREE.Mesh(
      new THREE.SphereGeometry(w * 0.42, 10, 5, 0, PI2, Math.PI * 0.5, Math.PI * 0.5),
      mat,
    )
    flangeDome.name = 'bridgeCapsuleFlangeDome'
    flangeDome.position.set(0, topY, z)
    group.add(flangeDome)

    // Distance from capsule center to its lowest point (varies by side count).
    let capBottom = 0
    for (let k = 0; k < sides; k++) {
      const sy = Math.sin((k / sides) * Math.PI * 2 + rotY)
      if (-sy > capBottom) capBottom = -sy
    }
    capY = topY + neckH + capBottom * capsuleR
  }

  // Capsule body: a regular polygon extruded along +Z (the travel axis),
  // stretched in X. The polygon is pre-rotated by rotY = PI/sides in the
  // shape vertices (flat top for 4/8, point at top for 6). Optional bevel on
  // the fore/aft edges.
  const polyShape = new THREE.Shape()
  for (let k = 0; k < sides; k++) {
    const angle = (k / sides) * Math.PI * 2 + rotY
    const px = Math.cos(angle) * capsuleR
    const py = Math.sin(angle) * capsuleR
    if (k === 0) polyShape.moveTo(px, py)
    else polyShape.lineTo(px, py)
  }
  polyShape.closePath()

  const capsuleGeo = new THREE.ExtrudeGeometry(polyShape, {
    depth: capsuleLen,
    bevelEnabled: hasBevel,
    bevelThickness: bevelT,
    bevelSize: bevelS,
    bevelSegments: 1,
  })
  capsuleGeo.translate(0, 0, -capsuleLen / 2)

  const capsule = new THREE.Mesh(capsuleGeo, capsuleMat)
  capsule.name = isGlass ? 'bridgeCapsuleGlass' : 'bridgeCapsulePrism'
  capsule.scale.set(xStretch, 1, 1)
  capsule.position.set(0, capY, capZ)
  group.add(capsule)

  const foreZ = capsuleLen * 0.5 + bevelT

  // For the glass variant: a faceted cone tip pointing fore (+Z).
  if (isGlass) {
    const capR = capsuleR * 0.9
    const capLen = capsuleLen * 0.3
    const cap = new THREE.Mesh(new THREE.ConeGeometry(capR, capLen, sides), glass)
    cap.name = 'bridgeCapsuleCap'
    cap.scale.set(xStretch, 1, 1)
    cap.rotation.y = rotY
    cap.rotation.x = Math.PI / 2
    cap.position.set(0, capY, capZ + foreZ + capLen * 0.5)
    group.add(cap)
  } else {
    const capGeo = new THREE.ExtrudeGeometry(polyShape, { depth: h * 0.04, bevelEnabled: false })
    capGeo.translate(0, 0, -(h * 0.04) / 2)
    for (const [name, dz] of [['bridgeCapsulePrismCapFore', 1], ['bridgeCapsulePrismCapAft', -1]]) {
      const endCap = new THREE.Mesh(capGeo, mat)
      endCap.name = name
      endCap.scale.set(xStretch, 1, 1)
      endCap.position.set(0, capY, capZ + dz * (capsuleLen * 0.5 + bevelT + h * 0.02))
      group.add(endCap)
    }
  }

  // Narrow luminous slit on the capsule's fore flat face (+Z).
  const slitW = capsuleR * 0.6 * xStretch
  const slitH = h * 0.04
  const slit = new THREE.Mesh(new THREE.BoxGeometry(slitW, slitH, h * 0.015), glowMat)
  slit.name = 'bridgeCapsuleSlit'
  const foreFaceZ = capZ + foreZ + (isGlass ? capsuleLen * 0.3 * 0.85 : h * 0.05)
  slit.position.set(0, capY, foreFaceZ)
  group.add(slit)

  return group
}

// Pillbox: a low, wide hexagonal superstructure (mat) with sloped faces and a
// narrow forward-facing luminous slit. The body is a frustum (wider at the
// base, narrower at the top) so all side faces slope inward, giving the
// pillbox an angular, tapered profile rather than flat vertical walls.
function buildBridgePillbox(b) {
  const { mat, glowMat, w, h, d, z, topY } = b
  const group = new THREE.Group()
  group.name = 'bridge:pillbox'

  // Low deck collar (mat) under the pillbox body + dome buffer below.
  // The hexagon geometry is rotated 30° in the YZ plane (flat face forward)
  // so the body and collar share the same orientation.
  const collarGeo = new THREE.CylinderGeometry(w * 0.5, w * 0.56, h * 0.18, 6)
  collarGeo.rotateY(Math.PI / 6)
  const collar = new THREE.Mesh(collarGeo, mat)
  collar.name = 'bridgePillboxCollar'
  collar.position.set(0, topY + h * 0.09, z)
  group.add(collar)

  const collarDome = new THREE.Mesh(
    new THREE.SphereGeometry(w * 0.48, 10, 5, 0, PI2, Math.PI * 0.5, Math.PI * 0.5),
    mat,
  )
  collarDome.name = 'bridgePillboxCollarDome'
  collarDome.position.set(0, topY, z)
  group.add(collarDome)

  // The pillbox body: a hexagonal frustum (6 sides), wider at the base and
  // narrower at the top, so all side faces slope inward. The hexagon geometry
  // is rotated 30° in the YZ plane (flat face forward) BEFORE the Z-stretch,
  // so the stretch and rotation are independent and the pillbox stays
  // symmetric along the YZ plane.
  const bodyR = w * 0.52
  const bodyTopR = w * 0.38
  const bodyH = h * 0.55
  const bodyGeo = new THREE.CylinderGeometry(bodyTopR, bodyR, bodyH, 6)
  bodyGeo.rotateY(Math.PI / 6)
  const body = new THREE.Mesh(bodyGeo, mat)
  body.name = 'bridgePillboxBody'
  body.scale.set(1, 1, d / (bodyR * 2))
  body.position.set(0, topY + h * 0.18 + bodyH * 0.5, z)
  group.add(body)

  // Narrow forward-facing luminous slit on the sloped front face (+Z).
  // The frustum's front face slopes inward, so the slit is positioned at the
  // mid-height radius (average of top and base) and pushed slightly forward
  // to sit on the sloped surface.
  const slitW = w * 0.425
  const slitH = h * 0.04
  const midR = (bodyR + bodyTopR) * 0.5
  const frontZ = z + midR * (d / (bodyR * 2)) * 0.866 + h * 0.01
  const slit = new THREE.Mesh(new THREE.BoxGeometry(slitW, slitH, h * 0.02), glowMat)
  slit.name = 'bridgePillboxSlit'
  slit.position.set(0, topY + h * 0.18 + bodyH * 0.5, frontZ)
  group.add(slit)

  return group
}

// Command spike: tall mast rising from the top anchor near the fore. A family
// of three distinct silhouettes, each multi-part and multi-material (hull `mat`
// + the command-spike green glow accent):
//   spike (default): the existing tapered mast + glowing sensor dome.
//   dish:            a mast topped by a glowing parabolic sensor bowl + feed arm.
//   array:           a mast with a stack of glowing sensor plates + mat cross-bars.
function buildCommandSpike(rng, ctx) {
  const { mat, hull, fore, surface } = ctx
  const cfg = ctx.params.commandSpike
  const style = COMMAND_SPIKE_STYLES.includes(cfg.style) ? cfg.style : 'spike'
  const glowMat = ctx.glowMat
  const t = ctx.t
  const s = cfg.height / 6
  const h = hull.height * 1.1 * s
  const z = lerp(0, fore.z, t)
  // FIT GUARD: the spike's base (mast bottom) embeds into the real deck height
  // by a fraction of its own height (guaranteed contact).
  const baseY = surface.surfaceAt('top', z) - Math.max(EMBED_FLOOR, h * EMBED_FRAC)
  const base = { mat, glowMat, hull, s, h, z, topY: baseY }

  let g
  switch (style) {
    case 'dish':
      g = buildCommandSpikeDish(base)
      break
    case 'array':
      g = buildCommandSpikeArray(base)
      break
    case 'spike':
    default:
      g = buildCommandSpikeSpike(base)
      break
  }
  g.userData.isCentreline = true
  return g
}

// Spike (default): the existing tapered mast + glowing sensor dome.
function buildCommandSpikeSpike(b) {
  const { mat, glowMat, hull, s, h, z, topY } = b
  const group = new THREE.Group()
  group.name = 'commandSpike:spike'

  const spike = new THREE.Mesh(
    new THREE.CylinderGeometry(hull.beam * 0.02 * s + 0.1, hull.beam * 0.05 * s + 0.2, h, 6),
    mat
  )
  spike.name = 'spikeMast'
  spike.position.set(0, topY + h / 2, z)
  group.add(spike)

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(hull.beam * 0.045 * s + 0.15, 10, 6, 0, PI2, 0, Math.PI * 0.5),
    glowMat
  )
  dome.name = 'spikeSensor'
  dome.position.set(0, topY + h, z)
  group.add(dome)

  return group
}

// Dish: a mast (mat) topped by a glowing parabolic sensor bowl (glow) + a feed
// arm (mat) with a glowing feed node.
function buildCommandSpikeDish(b) {
  const { mat, glowMat, hull, s, h, z, topY } = b
  const group = new THREE.Group()
  group.name = 'commandSpike:dish'

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(hull.beam * 0.02 * s + 0.08, hull.beam * 0.05 * s + 0.15, h, 6),
    mat
  )
  mast.name = 'dishMast'
  mast.position.set(0, topY + h / 2, z)
  group.add(mast)

  const bowl = new THREE.Mesh(
    new THREE.SphereGeometry(hull.beam * 0.06 * s + 0.2, 14, 8, 0, PI2, 0, Math.PI * 0.45),
    glowMat
  )
  bowl.name = 'dishBowl'
  bowl.position.set(0, topY + h, z)
  group.add(bowl)

  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, hull.beam * 0.05 * s + 0.2, 4),
    mat
  )
  arm.name = 'dishArm'
  arm.position.set(0, topY + h + (hull.beam * 0.05 * s + 0.2) / 2, z)
  group.add(arm)

  const feed = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glowMat)
  feed.name = 'dishFeed'
  feed.position.set(0, topY + h + hull.beam * 0.05 * s + 0.2, z)
  group.add(feed)

  return group
}

// Array: a mast (mat) with a stack of three glowing sensor plates (glow) and
// mat cross-bars between them.
function buildCommandSpikeArray(b) {
  const { mat, glowMat, hull, s, h, z, topY } = b
  const group = new THREE.Group()
  group.name = 'commandSpike:array'

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.18, h, 6),
    mat
  )
  mast.name = 'arrayMast'
  mast.position.set(0, topY + h / 2, z)
  group.add(mast)

  const plateW = hull.beam * 0.05 * s + 0.4
  const plateH = hull.beam * 0.04 * s + 0.25
  const plateGeo = new THREE.BoxGeometry(plateW, plateH, plateH * 0.6)
  for (let k = 0; k < 3; k++) {
    const py = topY + h * (0.55 + 0.2 * k)
    const plate = new THREE.Mesh(plateGeo, glowMat)
    plate.name = 'arrayPlate'
    plate.position.set(0, py, z)
    group.add(plate)
    if (k < 2) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(plateW * 0.55, 0.06, 0.06), mat)
      bar.name = 'arrayBar'
      bar.position.set(0, topY + h * (0.65 + 0.2 * k), z)
      group.add(bar)
    }
  }

  return group
}

// Build an obliquely-cut tube: an open cylinder (the tube wall) whose aft end
// is sheared so the rim becomes a slanted line, giving a "cut at an angle"
// look. The slant runs HORIZONTALLY (shear in X): the port and starboard
// edges of the mouth are cut to different depths, so the opening is an angled
// hole rather than a flat circle.
//   `radius`  — the tube's radius (matches the pod).
//   `length`  — the tube's fore-aft length before the slant.
//   `mat`     — the tube wall material.
// Returns a THREE.Mesh. The tube's fore end is a full circle; the aft end is
// the slanted cut. The tube is OPEN (a hollow wall) — the caller adds a cap
// (e.g. a glow disc deep inside) on the angled face.
function buildObliqueTube(radius, length, mat) {
  const segments = 18
  // The slant: how far the aft rim is offset fore/aft relative to the centre,
  // proportional to the vertex's position along `axis`. A steeper slant gives a
  // more dramatic angled cut.
  const slantFrac = 0.5 // aft rim offset = slantFrac * radius * (pos / radius)
  // Build the tube wall as an open cylinder. CylinderGeometry's axis is Y; we
  // rotate it to Z (rotation.x = PI/2 maps +Y -> +Z) so the tube runs fore-aft.
  // The geometry is built with the fore end at +Y (which becomes +Z after
  // rotation... actually we want the fore at the pod and the cut aft). We build
  // it centred then shift so the fore end is at local z = +length/2 and the aft
  // (cut) end toward -Z.
  const geo = new THREE.CylinderGeometry(radius, radius, length, segments, 1, true)
  // Shear: offset each vertex's local Y (which maps to world Z after rotation)
  // proportional to its X or Y coordinate, creating the slanted aft rim. The
  // shear is applied in the geometry's local Y-axis frame BEFORE rotation.
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    // Only shear the AFT half (local y < 0, which becomes the -Z/aft side).
    // The fore half (y > 0) stays a full circle. The shear magnitude grows
    // linearly from 0 at the centre (y=0) to max at the aft rim (y=-length/2).
    if (v.y < 0) {
      const t = -v.y / (length / 2) // 0 at centre, 1 at the aft rim
      // Shift the vertex toward -Y (aft) proportional to its X coordinate:
      // vertices further outboard (larger |x|) are pushed further aft, creating
      // the horizontal slant.
      v.y -= Math.abs(v.x) * slantFrac * t
    }
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = Math.PI / 2 // tube axis -> +Z (fore-aft)
  return mesh
}

// Nacelle trailing-end (aft cap) builder. `tail` selects the form (see
// NACELLE_TAIL_OPTIONS); the cap is +Z-aligned and centred on the pod's aft face
// at (x, y, z). `r` is the pod radius, `len` its length (used to scale the cap).
// The cap finishes the pod's aft end in a distinct form so a ship's nacelles read
// as a varied set. All caps are added to `group` (the nacelle's group).
function buildNacelleTail(group, tail, x, y, z, r, len, mat, glowMat) {
  switch (tail) {
    case 'point': {
      // A tapered cone to a sharp point, narrowing aft to a needle-like exhaust tip.
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(r * POD_TAPER, r * 0.04, len * 0.22, 14), mat)
      cone.name = 'nacelleTailPoint'
      cone.rotation.x = Math.PI / 2 // local +Y -> world +Z; the narrow end (radius 0.04) faces aft (-Z)
      cone.position.set(x, y, z - len * 0.11)
      group.add(cone)
      // A small glowing tip at the point.
      const tip = new THREE.Mesh(new THREE.SphereGeometry(r * 0.06, 8, 6), glowMat)
      tip.name = 'nacelleTailPointTip'
      tip.position.set(x, y, z - len * 0.22)
      group.add(tip)
      break
    }
    case 'scallop': {
      // A recessed, scalloped cut-out: a matte ring framing a glowing concave dish
      // set inboard, so the aft end reads as a scalloped exhaust port. The ring
      // sits in the Y-Z plane (normal along X) so it frames the aft face; the
      // torus's default plane is X-Y (normal +Z), so rotate it into Y-Z via
      // rotation.y = PI/2. Wait — that puts the normal along X. For the ring to
      // frame the aft face (normal along Z, ring in Y-Z... no). The aft face is
      // the X-Y plane at a given Z. The ring should be in the X-Y plane (normal
      // along Z) to frame that face. TorusGeometry default is X-Y plane (normal
      // +Z), so NO rotation is needed — the ring already frames the X-Y face.
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, r * 0.14, 8, 18), mat)
      ring.name = 'nacelleTailScallopRing'
      // No rotation: the torus is in the X-Y plane (normal along Z), framing the
      // aft face (which is the X-Y plane at z).
      ring.position.set(x, y, z)
      group.add(ring)
      // The concave dish: a sphere cap, CONCAVE toward -Z (open rim faces aft),
      // glowing. The cap's pole is at +Y; rotation.x = PI/2 maps +Y -> +Z, so the
      // dome bulges fore (+Z) and the open rim faces aft (-Z) — a concave dish.
      const dish = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.78, 14, 8, 0, PI2, 0, Math.PI * 0.4),
        glowMat
      )
      dish.name = 'nacelleTailScallopDish'
      dish.rotation.x = Math.PI / 2
      dish.position.set(x, y, z + r * 0.12) // recessed fore of the rim, so the dish is concave aft
      group.add(dish)
      // Scallops: a ring of small glowing bumps around the rim's inner edge, so the
      // cut-out reads as scalloped rather than a plain circle. The ring and dish
      // sit in the X-Y plane (normal along Z, framing the aft face), so the bumps
      // are placed in X-Y (x + cos, y + sin) — NOT Y-Z.
      const nScallop = 8
      for (let k = 0; k < nScallop; k++) {
        const a = (k / nScallop) * PI2
        const bump = new THREE.Mesh(new THREE.SphereGeometry(r * 0.1, 6, 5), glowMat)
        bump.name = 'nacelleTailScallopBump'
        bump.position.set(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, z)
        group.add(bump)
      }
      break
    }
    case 'flared': {
      // A flared bell/cone that widens aft (a nozzle-like exhaust): the pod tapers
      // into a cone that flares out to a wider rim at the very aft end, with a
      // glowing inner disc.
      const flare = new THREE.Mesh(new THREE.CylinderGeometry(r * POD_TAPER, r * 1.25, len * 0.18, 14, 1, true), mat)
      flare.name = 'nacelleTailFlare'
      flare.rotation.x = Math.PI / 2 // local +Y -> world +Z; the wider end (radius 1.25) faces aft
      flare.position.set(x, y, z - len * 0.09)
      group.add(flare)
      // A glowing inner disc at the flare's aft opening (the exhaust). The disc
      // faces aft (-Z): CircleGeometry's normal is +Z local, so rotation.y = PI
      // flips it to -Z (aft).
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 1.18, 18), glowMat)
      disc.name = 'nacelleTailFlareDisc'
      disc.rotation.y = Math.PI // normal toward -Z (aft)
      disc.position.set(x, y, z - len * 0.18)
      group.add(disc)
      break
    }
    case 'vented': {
      // A flat matte cap with a glowing central port + a ring of small glowing
      // vents around it, so the aft end reads as a vented exhaust plate.
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r * 0.95, r * 0.12, 14), mat)
      cap.name = 'nacelleTailVentedCap'
      cap.rotation.x = Math.PI / 2
      cap.position.set(x, y, z)
      group.add(cap)
      // A glowing central port. The port faces aft (-Z): CircleGeometry's normal
      // is +Z local, so rotation.y = PI flips it to -Z (aft).
      const port = new THREE.Mesh(new THREE.CircleGeometry(r * 0.4, 16), glowMat)
      port.name = 'nacelleTailVentedPort'
      port.rotation.y = Math.PI // normal toward -Z (aft)
      port.position.set(x, y, z - r * 0.07)
      group.add(port)
      // A ring of small glowing vents around the port, each facing aft (-Z).
      // The vents are distributed in the X-Y plane (the aft face plane), so
      // they spread radially around the central port in the plane of the cap.
      const nVent = 6
      for (let k = 0; k < nVent; k++) {
        const a = (k / nVent) * PI2
        const vent = new THREE.Mesh(new THREE.CircleGeometry(r * 0.12, 8), glowMat)
        vent.name = 'nacelleTailVentedVent'
        vent.rotation.y = Math.PI // normal toward -Z (aft)
        vent.position.set(x + Math.cos(a) * r * 0.68, y + Math.sin(a) * r * 0.68, z - r * 0.07)
        group.add(vent)
      }
      break
    }
    case 'cowled': {
      // A cowed exhaust: a HOLLOW extension of the nacelle tube, cut off at an
      // angle. The tube continues the pod's radius and is sliced obliquely so
      // you can look INTO the tube through the angled mouth. The slant runs
      // HORIZONTALLY (shear in X): the port and starboard edges of the mouth are
      // cut to different depths, so the opening is a parallelogram-ish angled
      // hole rather than a flat circle.
      const tube = buildObliqueTube(r, len * 0.22, mat)
      tube.name = 'nacelleTailCowl'
      tube.position.set(x, y, z - len * 0.11)
      group.add(tube)
      // A glowing disc deep inside the tube (the exhaust glow seen through the
      // angled mouth), facing aft (-Z) and tilted to the slant.
      const inner = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 18), glowMat)
      inner.name = 'nacelleTailCowlInner'
      inner.rotation.y = Math.PI
      inner.rotation.z = Math.atan2(len * 0.22 * 0.5, r * 2) // tilt to the horizontal slant
      inner.position.set(x, y, z - len * 0.2)
      group.add(inner)
      break
    }
    case 'dome':
    default: {
      // A glowing hemisphere at the aft end (mirrors the fore dome), a bright
      // exhaust cap.
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(r * POD_TAPER, 14, 10, 0, PI2, 0, Math.PI * 0.5),
        glowMat
      )
      dome.name = 'nacelleTailDome'
      dome.rotation.x = -Math.PI / 2 // local +Y -> world -Z, so the dome faces aft
      dome.position.set(x, y, z)
      group.add(dome)
      break
    }
  }
}

// Nacelles: the ship's propulsion pods. One mount configuration per ship
// (NACELLE_MOUNTS) + one pod body type (NACELLE_TYPES). Each instance is one
// pod; the side is derived from the instance index (even = port, odd =
// starboard). The three mounts:
//   pylon -> long pods on swept struts off the flank (the original look).
//   aft   -> short stubby pods at the stern, no nose components (old engine
//            mounting logic), seated against the aft surface.
//   waist -> pods mounted directly on the hull's waist (midship flank), no strut.
function buildNacelle(rng, ctx) {
  const { mat, glowMat, hull, fore, aft, surface, glowColor } = ctx
  const cfg = ctx.params.nacelles
  const t = ctx.t
  const i = ctx.i
  const s = cfg.size ?? 1
  const mount = NACELLE_MOUNTS.includes(cfg.mount) ? cfg.mount : 'pylon'
  const type = NACELLE_TYPES.includes(cfg.type) ? cfg.type : 'standard'
  const n = cfg.count || 2
  // Waist mounts a single pair: the half-group holds one pod at +X, mirrored to
  // the -X twin. Force side=+1 so the lone half-group pod always sits at +X.
  const side = mount === 'waist' ? 1 : i % 2 === 0 ? -1 : 1

  // Per-pair sub-RNG: keyed on (shipSeed + instance index) so each pair (mirror
  // twins share the same i) gets consistent per-pair variation, while different
  // instances can differ. Keeps the mirror symmetric (same i → same values).
  const pairRng = createRng((ctx.params._seed ?? 0) + i * PAIR_SEED_MULT)

  // --- Placement (z, side offset, pod dimensions) depends on the mount --------
  let r, len, z, sideExtent, cy, hasStrut, hasNose
  let aftRingOverride = false

  if (mount === 'pylon') {
    // Long, thin pod on a swept strut. Spread [0.2, 0.7] (midship-biased).
    r = Math.min(hull.beam, hull.height) * 0.16 * s
    const baseLen = hull.length * 0.64 * s
    const zSpread = (0.7 - 0.2) * hull.length
    const maxLenBySpacing = n > 1 ? (zSpread / (n - 1)) * 0.82 : baseLen
    len = Math.min(baseLen, maxLenBySpacing)
    z = lerp(-hull.length * 0.5, fore.z, t)
    const hullSideExtent = surface.maxSideAt(z)
    const lift = NACELLE_LIFT_OPTIONS.includes(cfg.lift) ? cfg.lift : 0
    cy = hull.height * 0.5 * lift
    hasStrut = true
    hasNose = true
    // The pod sits ON its pylon, outboard of the hull surface by `reach` so the
    // strut has a clear length and the pod reads as a distinct element (the
    // strut's hub sits on the pod). The reach also clears the hull's fore-end
    // taper (the pod's fore end sits where the hull is smaller).
    const reach = Math.max(
      r * 2.0,
      hullSideExtent - surface.maxSideAt(z + len * 0.5) + r * 1.15
    )
    sideExtent = hullSideExtent + reach
  } else if (mount === 'aft') {
    // Short stubby pod at the stern, no nose. The pods sit in a RING around the
    // stern and are EMBEDDED in the hull: the front face is buried inside the
    // stern, the back face protrudes outward. They read as part of the hull
    // (like engine housings carved into the stern), not as pods bolted on
    // outboard. The ring is placed at the stern tip; each pod's radial
    // position is on the hull surface in its slot angle's direction (the
    // cross-section is anisotropic, so the surface radius varies with angle).
    // The pod center is shifted aft so the back face protrudes and the front
    // face is inside the hull.
    const sternZ = surface.surfaceAt('aft', aft.z)
    const sternGirth = surface.girthAt(sternZ)
    const requestedRadius = Math.min(hull.beam, hull.height) * AFT_POD_RADIUS_FRAC * s
    const perSide = Math.max(1, ctx.n ?? n)
    r = aftPodRadius(sternGirth, perSide, requestedRadius)
    len = hull.length * 0.30 * s
    // The aft pods wrap the FULL stern ring. `n` instances are built in the
    // half-group across the RIGHT half-ring (angle -PI/2 .. PI/2 in the X-Y
    // plane, i.e. from bottom through +X/starboard to top). The mirror (flip X)
    // then fills the LEFT half-ring (PI/2 .. 3PI/2), so the full ring has `2n`
    // evenly-spaced pods. Slot `i` of `n` is centred in its cell so no pod sits
    // on the centreline (angle 0/PI) and adjacent pods don't overlap.
    // Spread the slots across the ACTUAL built per-side count (ctx.n), not the
    // raw config count, so the pods are evenly spaced regardless of the cap.
    const half = Math.max(1, ctx.n ?? n)
    const slot = i
    const angle = -Math.PI / 2 + ((slot + 0.5) / half) * Math.PI
    // Place the ring at the stern. For hulls with a flat stern (lofted, wedge,
    // blocky) the stern tip has a real cross-section, so the radial position is
    // evaluated at sternZ. For hulls with a rounded stern tip (insect, saucer
    // dome) the very tip has near-zero cross-section; `bestGirthZ` finds the
    // nearest Z (within a window) where the hull has its fullest real
    // cross-section (a station ring), and the radial position is evaluated
    // there. The pod center is shifted aft so the back face protrudes and the
    // front face is buried inside.
    const ringZ = surface.bestGirthZ(sternZ)
    // The protrusion must be large enough that the back face extends past the
    // stern. The distance from ringZ to the stern is (sternZ - ringZ) (negative,
    // since the stern is aft). The back face is at (z - len/2) = (ringZ -
    // protrude*0.5 - len/2). For this to be < sternZ:
    //   ringZ - protrude*0.5 - len/2 < sternZ
    //   protrude > 2 * (ringZ - sternZ - len/2)
    // Use a protrude that guarantees the back face clears the stern with a
    // small margin.
    const minProtrude = 2 * (ringZ - sternZ - len * 0.5) + len * 0.1
    const protrude = Math.max(len * 0.4, minProtrude)
    z = ringZ - protrude * 0.5
    // Radial position around the stern ring (X-Y plane). Each pod sits on the
    // hull SURFACE in its slot angle's direction at ringZ (where the hull has
    // a real cross-section). The pod is then shifted aft; the radial position
    // stays fixed so the pod center is on the hull surface, with the back face
    // protruding and the front face buried inside.
    const surfaceR = surface.surfaceRadiusAt(angle, ringZ)
    const radial = surfaceR
    cy = Math.sin(angle) * radial
    sideExtent = Math.cos(angle) * radial
    hasStrut = false
    // Standard aft pods get a rounded dome nose cap (the front face is buried
    // in the stern, so the dome reads as a smooth rounded engine housing).
    // Crystal aft pods keep their built-in pointed cap (the crystal builder
    // always adds its own nose cap, so hasNose is ignored for crystals).
    hasNose = type === 'standard'
    // Override the side sign: the aft ring uses the angle's cos for X, not the
    // port/stbd `side`. Force side=1 so podCenter.x = +sideExtent (the angle's
    // own sign is already in sideExtent).
    aftRingOverride = true
  } else {
    // Waist: a single pair of pods mounted directly on the midship flank, no
    // strut. Only one pair (generateModules caps the count at 1, mirrored to 2
    // world pods) and the pod is LONGER than the pylon length, so the single
    // pair reads as a long engine block rather than a short pod.
    r = Math.min(hull.beam, hull.height) * 0.18 * s
    len = hull.length * 0.84 * s
    // Waist = midship: place around the centre (t maps across the midship band).
    z = lerp(-hull.length * 0.25, hull.length * 0.1, t)
    // Use the windowed max side extent (not the single-bin value) so the pod
    // sits on the hull's actual flank — a single bin can under-read on smooth/
    // domed archetypes (e.g. saucer) where vertex distribution is uneven.
    sideExtent = surface.maxSideAt(z)
    cy = 0
    hasStrut = false
    hasNose = true
  }

  const group = new THREE.Group()
  group.name = 'nacelle'

  // --- Pod body + caps + tail -------------------------------------------------
  // The aft ring uses the angle's own sign for X (no port/stbd flip); other
  // mounts use `side` to place the pod on the port/stbd flank.
  const podCenterX = aftRingOverride ? sideExtent : side * sideExtent
  const podCenter = new THREE.Vector3(podCenterX, cy, z)
  // Aft pods (embedded in the stern) use the non-luminous mat for the dome
  // cap; other mounts alternate mat/glow per instance.
  buildNacellePod(group, type, podCenter, r, len, hasNose, mat, glowMat, glowColor, i, mount === 'aft')

  // The pod's AFT end cap (distinct exhaust form per ship). Crystal pods have
  // their own pointed stern cap (built in buildNacellePod), so no tail decoration.
  if (type !== 'crystal') {
    const tail = NACELLE_TAIL_OPTIONS.includes(cfg.tail) ? cfg.tail : 'dome'
    const aftZ = z - len * 0.5
    buildNacelleTail(group, tail, podCenter.x, podCenter.y, aftZ, r, len, mat, glowMat)
  }

  // --- Mount hardware (strut + flange + hub) for the pylon mount --------------
  if (hasStrut) {
    buildNacelleStrut(group, side, surface, sideExtent, cy, z, len, r, mat, pairRng)
  }

  return group
}

// Build the nacelle pod body (+ fore nose if hasNose) at podCenter, aligned
// along +Z. `type` selects the body geometry: 'standard' (tapered cylinder +
// domed nose) or 'crystal' (faceted hexagonal prism + pointed caps).
function buildNacellePod(group, type, center, r, len, hasNose, mat, glowMat, glowColor, i, forceMat = false) {
  if (type === 'crystal') {
    // Faceted hexagonal prism (crystal glass) with pointed caps at both ends.
    const crystalGlass = crystalGlassMaterial(glowColor)
    const prismR = r * 0.85
    const prismLen = len * 0.8
    const prism = new THREE.Mesh(new THREE.CylinderGeometry(prismR, prismR, prismLen, 6), crystalGlass)
    prism.name = 'nacelleCrystalPrism'
    prism.rotation.x = Math.PI / 2 // axis -> +Z
    prism.position.copy(center)
    group.add(prism)
    // Pointed caps (same radius/segments as the prism, base flush with the
    // prism end — reads as a facet carved off the crystal).
    const capLen = len * 0.2
    const prismEnd = prismLen / 2
    const noseCap = new THREE.Mesh(new THREE.ConeGeometry(prismR, capLen, 6), crystalGlass)
    noseCap.name = 'nacelleCrystalNose'
    noseCap.rotation.x = Math.PI / 2
    noseCap.position.set(center.x, center.y, center.z + prismEnd + capLen / 2)
    group.add(noseCap)
    const sternCap = new THREE.Mesh(new THREE.ConeGeometry(prismR, capLen, 6), crystalGlass)
    sternCap.name = 'nacelleCrystalStern'
    sternCap.rotation.x = -Math.PI / 2
    sternCap.position.set(center.x, center.y, center.z - prismEnd - capLen / 2)
    group.add(sternCap)
    // Luminous thread down the centre of the crystal prism (the ship's glow
    // colour). A thin cylinder running the full prism length, slightly
    // protruding into the caps so it reads as the crystal's inner core.
    const threadR = prismR * 0.06
    const thread = new THREE.Mesh(
      new THREE.CylinderGeometry(threadR, threadR, prismLen + capLen, 8),
      glowMat
    )
    thread.name = 'nacelleCrystalThread'
    thread.rotation.x = Math.PI / 2 // axis -> +Z
    thread.position.copy(center)
    group.add(thread)
    return
  }

  // Standard: long tapered cylinder + domed fore nose (if hasNose).
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(r * POD_TAPER, r, len, 14), mat)
  pod.name = 'nacellePod'
  pod.rotation.x = Math.PI / 2
  pod.position.copy(center)
  group.add(pod)

  if (hasNose) {
    // Domed forward cap at the pod's fore end (+Z). Alternates mat/glow per
    // instance so a ship's nacelles read as a varied set. Aft pods (embedded
    // in the stern) always use the non-luminous mat for the dome.
    const domeMat = forceMat ? mat : (i % 2 === 0 ? mat : glowMat)
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(r * POD_TAPER, 14, 10, 0, PI2, 0, Math.PI * 0.5),
      domeMat
    )
    dome.name = 'nacelleDome'
    dome.rotation.x = Math.PI / 2
    dome.position.set(center.x, center.y, center.z + len * 0.5)
    group.add(dome)
  }
}

// Build the nacelle's swept support strut (pylon mount): a strut from the hull
// flank root to the pod, with a flange normal to the hull + a hub at the pod.
function buildNacelleStrut(group, side, surface, sideExtent, cy, z, len, r, mat, pairRng) {
  // Strut sweep along +Z (per-pair): the hull root is offset fore/aft of the
  // pod so the strut slants. Per-pair so each z-pair sweeps independently.
  const sweep = pairRng.pick(NACELLE_STRUT_STYLES)
  const sweepZ = (sweep === 'forward' ? -1 : sweep === 'aft' ? 1 : 0) * len * 0.55
  const rootZ = z + sweepZ
  // Root sits on the flank at the ROOT's z (sampled at rootZ) so the flange
  // stays on the hull surface even when the sweep shifts the root fore/aft of
  // the pod (where the tapered hull may have retreated).
  const rootSideExtent = surface.maxSideAt(rootZ)
  // The pod is already outboard of the hull by `reach` (buildNacelle places the
  // pod at hullSideExtent + reach). The strut runs from the hull flank root
  // (on the hull surface, swept fore/aft per-pair) to the POD centre (at
  // `sideExtent`, fixed), so the hub always sits on the pod and the strut
  // visibly connects hull -> pod. The per-pair sweep slants the strut by moving
  // the root fore/aft of the pod, not by tilting the attach off the pod.
  const root = new THREE.Vector3(side * rootSideExtent, 0, rootZ)
  const attach = new THREE.Vector3(side * sideExtent, cy, z)

  const dir = new THREE.Vector3().subVectors(attach, root)
  const d = dir.length() || 1
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize())
  const strut = new THREE.Mesh(new THREE.BoxGeometry(r * 0.8, r * 0.32, d), mat)
  strut.name = 'nacelleStrut'
  strut.position.copy(root).add(attach).multiplyScalar(0.5)
  strut.quaternion.copy(q)
  group.add(strut)

  // Flange normal to the hull side (outboard X) at the root + dome buffer
  // curving toward the hull surface.
  const flangeNormal = new THREE.Vector3(side, 0, 0)
  const flangeQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), flangeNormal)
  const flange = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.58, r * 0.2, 12), mat)
  flange.name = 'nacelleFlange'
  flange.position.copy(root)
  flange.quaternion.copy(flangeQ)
  group.add(flange)

  const flangeDome = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.46, 10, 5, 0, PI2, Math.PI * 0.5, Math.PI * 0.5),
    mat,
  )
  flangeDome.name = 'nacelleFlangeDome'
  flangeDome.position.copy(root).addScaledVector(flangeNormal, -r * 0.1)
  flangeDome.quaternion.copy(flangeQ)
  group.add(flangeDome)

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r * 0.4, r * 0.16, 12), mat)
  hub.name = 'nacelleHub'
  hub.position.copy(attach)
  hub.quaternion.copy(q)
  group.add(hub)
}

// Weapons: turret/cannon/railgun hardpoints on the upper girdle ring. The
// MOUNT stays on the hull surface (placed around the ring by `angle`); the
// BARREL always points along the axis of travel (+Z, the ship's forward), NOT
// outward-and-diagonal. `count` is spread around the ring; each instance is one
// weapon.
//
// A family of three silhouettes, each a multi-part group (hull `mat` + an
// optional glowing accent). The barrel is a cylinder whose axis is rotated to
// +Z via `rotation.x = PI/2` (local +Y -> world +Z, so its forward direction is
// exactly (0,0,1)); the barrel's centre is placed at the mount + a +Z offset so
// it extends forward from the mount.
//
// Not instanced (was): the multi-part, multi-style, multi-material families do
// not batch into InstancedMesh the way the old single mount + barrel did, and
// the +Z-alignment correctness + per-style distinctness matter more than the
// draw-call win (see MODULE_SPECS).
function buildWeapon(rng, ctx) {
  const { hull, fore, bottom, surface, color, accent } = ctx
  const cfg = ctx.params.weapons
  const style = WEAPON_STYLES.includes(cfg.style) ? cfg.style : 'turret'
  let position = WEAPON_POSITIONS.includes(cfg.position) ? cfg.position : 'top'
  const glowMat = weaponGlowMat(style, ctx.glowMat)
  // Weapons get their OWN material, derived from the palette's ACCENT colour
  // (palette[2] passed in as `accent`) — the saturated, identity colour of each
  // aesthetic. The base colour (palette[0]) is deliberately desaturated, so
  // deriving the weapon tone from it produces a neutral grey that loses the
  // ship's colour identity. The accent is the colourful "pop" of the palette
  // (blue for hardpoint, purple for gothic, green for biopunk, orange for
  // blocky, etc.), so darkening it gives a distinct gun-emplacment tone that
  // clearly belongs to the ship's design language.
  //
  // This is a fresh MeshStandardMaterial — NOT a clone of the shared hull mat
  // — so it can never be affected by (or affect) the hull material's state.
  //
  // The accent is darkened by reducing lightness (-0.25) and keeping its
  // saturation, so the weapons read as a darker, richer version of the ship's
  // accent colour. Metalness is moderate (0.35): the scene has no environment
  // map, so a highly metallic surface would reflect nothing and render black.
  const accentHex = accent ?? color ?? DEFAULT_PALETTE[1]
  const weaponBaseColor = new THREE.Color(accentHex)
  const weaponMat = new THREE.MeshStandardMaterial({
    color: weaponBaseColor,
    metalness: 0.35,
    roughness: 0.5,
  })
  // Chin and nose mounts are tight, single-point zones (under-nose / the very
  // tip), so a high count degenerates into overlapping guns. Cap those at 2.
  // Disc hulls have a thin keel edge (not a broad flat bottom), so multiple
  // belly weapons read as cluttered — cap belly at 1 for disc archetypes.
  // Top/belly on other archetypes spread along a line and tolerate the full count.
  const isDisc = ctx.hull?.archetype === 'disc'
  const maxForPos =
    position === 'chin' || position === 'nose' ? 2
    : position === 'belly' && isDisc ? 1
    : 8
  const n = Math.min(cfg.count || 3, maxForPos)
  const s = cfg.size ?? 1
  const i = ctx.i
  const t = ctx.t
  // `nose` mounts at the very tip of the hull (a fixed fore position) rather than
  // spreading fore/aft with `t` — the nose is a single point, not a line.
  // `belly` on a disc: the disc's belly is a single point at the center (z=0),
  // not a line along the length. Force z=0 so the weapon mounts at the disc's
  // centre rather than 40% toward the nose.
  const isDiscBelly = position === 'belly' && isDisc
  const isTwin = hull.archetype === 'twin'
  // Twin hull constraints:
  //   - Single nose / chin mounts are forbidden → reposition to top / bottom
  //     (centre of the crossbeam).
  //   - Single top / bottom → centre of the crossbeam's upper / lower surface.
  //   - Paired top → tube tops (Y along +Y), paired bottom → tube bottoms
  //     (Y along -Y).
  if (isTwin) {
    if (position === 'nose' && n === 1) position = 'top'
    else if (position === 'chin' && n === 1) position = 'belly'
  }
  const z = position === 'nose' ? fore.z * 0.94
    : isDiscBelly || (isTwin && position === 'belly') ? 0
    : lerp(0, fore.z, t * 0.8)
  // Halved from 0.6 -> 0.3 so weapons read as compact gun emplacements, not
  // bulky blocks. The len factor is halved proportionally (0.55 -> 0.275).
  const R = Math.min(hull.beam, hull.height) * 0.3 * s
  const len = Math.min(hull.beam, hull.height) * 0.275 * s

  // `dirY` flips the weapon's vertical orientation: +1 for top/nose (hull below,
  // features face up), -1 for chin/belly (hull above, features face down).
  const dirY = (position === 'chin' || position === 'belly') ? -1 : 1

  let mountX
  let mountY
  let barrelY
  // Outward surface normal at the mount point, in the X-Y plane (Z-free). Used
  // to rotate top/belly weapons so their local +Y (up) is normal to the hull.
  let surfaceNormal = null
  if (position === 'nose') {
    // Nose: a row of weapons across the very tip (fixed z). Centred on the
    // centreline and spread in X so each instance is distinct; flagged
    // isCentreline below so the mirror does not double them.
    const topExt = surface.surfaceAt('top', z)
    mountX = (ctx.i - (ctx.n - 1) / 2) * R * 0.7
    mountY = topExt * 0.55
    barrelY = mountY + dirY * R * 0.2
  } else if (position === 'chin') {
    // Chin / forward-bottom: mounted under the nose, on the hull's lower-forward
    // surface. `top` is a single instance (its own mirror); `side` pairs port/stbd.
    const side = n > 1 ? (i % 2 === 0 ? -1 : 1) : 0
    const sideExt = surface.surfaceAt('side', z)
    const bottomExt = surface.surfaceAt('bottom', z)
    mountX = side * Math.min(R * 0.8, sideExt * 0.4)
    mountY = bottomExt * 0.55
    barrelY = mountY + dirY * R * 0.2
  } else if (position === 'belly') {
    if (isTwin) {
      // Twin belly: single → centre of the crossbeam's lower surface; paired →
      // tube bottoms (Y along -Y). The tube surface height at this Z is the
      // overall envelope bottom scaled by the tube height fraction, so the
      // mount follows the hull's taper.
      const tubeOffset = hull.beam * TWIN_TUBE_OFFSET
      // Query the actual geometry for the tube bottom at this Z (the bins
      // capture the tube vertices, so minY is the tube's lower surface, not
      // the crossbeam). Falls back to the anchor if no geometry is available.
      const tubeBottom = surface.tubeSurfaceAt('bottom', z)
      const crossbeamBottom = -(hull.height * TWIN_CROSSBEAM_H) / 2
      if (n === 1) {
        mountX = 0
        mountY = crossbeamBottom - R * WEAPON_EMBED
      } else {
        mountX = (i % 2 === 0 ? -1 : 1) * tubeOffset
        mountY = tubeBottom - R * WEAPON_EMBED
      }
      barrelY = mountY + dirY * R * 0.2
      surfaceNormal = new THREE.Vector3(0, 1, 0)
    } else {
      // Belly / ventral: a line of weapons down the keel (bottom surface),
      // spread fore/aft along the lower hull.
      const bottomExt = surface.surfaceAt('bottom', z)
      const keelY = bottom?.y ?? -hull.height * 0.5
      mountX = 0
      mountY = Math.min(bottomExt, keelY) - R * WEAPON_EMBED
      barrelY = mountY + dirY * R * 0.2
      surfaceNormal = new THREE.Vector3(0, 1, 0)
    }
  } else {
    // Top (default): the classic upper girdle ring, spread around the deck.
    if (isTwin) {
      // Twin top: single → centre of the crossbeam's upper surface; paired →
      // tube tops (Y along +Y). The tube surface height at this Z is the
      // overall envelope top scaled by the tube height fraction, so the
      // mount follows the hull's taper.
      const tubeOffset = hull.beam * TWIN_TUBE_OFFSET
      // Query the actual geometry for the tube top at this Z (the bins capture
      // the tube vertices, so maxY is the tube's upper surface, not the
      // crossbeam). Falls back to the anchor if no geometry is available.
      const tubeTop = surface.tubeSurfaceAt('top', z)
      const crossbeamTop = (hull.height * TWIN_CROSSBEAM_H) / 2
      if (n === 1) {
        mountX = 0
        mountY = crossbeamTop + R * WEAPON_EMBED
      } else {
        mountX = (i % 2 === 0 ? -1 : 1) * tubeOffset
        mountY = tubeTop + R * WEAPON_EMBED
      }
      barrelY = mountY + dirY * R * 0.25
      // Y axis along +Y (no rotation needed — the weapon is already built with
      // its up-axis along +Y).
      surfaceNormal = new THREE.Vector3(0, 1, 0)
    } else {
      // Each weapon seats on the hull's ACTUAL surface: `surfaceRadiusAt` gives
      // the true surface distance in the weapon's direction. We place the base
      // at that radius and embed it slightly inward so the housing sits flush
      // on (or just inside) the deck rather than floating in the air above it.
      const angle = (i / n) * PI2
      const surfR = surface.surfaceRadiusAt(angle, z)
      const embed = R * WEAPON_EMBED
      const rr = Math.max(surfR - embed, surfR * 0.5)
      mountX = Math.cos(angle) * rr
      mountY = Math.sin(angle) * rr
      barrelY = mountY + dirY * R * 0.25
      // Outward normal of the cross-section ellipse at this angle.
      const halfX = Math.max(surface.surfaceAt('side', z), 1e-3)
      const halfY = Math.max(surface.surfaceAt('top', z), 1e-3)
      surfaceNormal = new THREE.Vector3(
        Math.cos(angle) / halfX,
        Math.sin(angle) / halfY,
        0,
      ).normalize()
    }
  }

  const base = { mat: weaponMat, glowMat, R, len, mountX, mountY, z, barrelX: mountX, barrelY, dirY }
  let g
  switch (style) {
    // Turret / gunhouse family (distinct housings, mat + a +Z barrel).
    case 'twinTurret':
      g = buildWeaponTwinTurret(base)
      break
    case 'boxy':
      g = buildWeaponBoxy(base)
      break
    case 'dome':
      g = buildWeaponDome(base)
      break
    case 'angular':
      g = buildWeaponAngular(base)
      break
    // Cannon family (thinner barrels, some with emissive tips).
    case 'longCannon':
      g = buildWeaponLongCannon(base)
      break
    case 'muzzleBrake':
      g = buildWeaponMuzzleBrake(base)
      break
    case 'suppressor':
      g = buildWeaponSuppressor(base)
      break
    case 'dish':
      g = buildWeaponDish(base)
      break
    case 'tipGlow':
      g = buildWeaponTipGlow(base)
      break
    case 'cannon':
      g = buildWeaponCannon(base)
      break
    case 'railgun':
      g = buildWeaponRailgun(base)
      break
    case 'turret':
    default:
      g = buildWeaponTurret(base)
      break
  }
  // Top and belly weapons: rotate the whole group about Z so its local +Y
  // (the "up" axis the geometry is built around) aligns with the outward hull
  // normal at the mount point. This keeps the housing's up-axis normal to the
  // deck/keel on curved sections, while the +Z barrel keeps its travel
  // direction (rotation is about Z, so it is untouched).
  if (surfaceNormal) {
    const pivot = new THREE.Vector3(mountX, mountY, z)
    g.position.copy(pivot)
    // Rotate so the weapon's local +Y maps to the outward surface normal. The
    // weapon's base (contact plate) is on the -normal side (toward the hull) and
    // the barrel on the +normal side (away), which is the correct orientation.
    // We need the SIGNED angle from up (0,1) to the normal — `angleTo` returns
    // only the magnitude, which rotates the wrong way for normals past 90°.
    const up = new THREE.Vector3(0, 1, 0)
    const theta = Math.atan2(
      up.x * surfaceNormal.y - up.y * surfaceNormal.x, // cross (z-component)
      up.x * surfaceNormal.x + up.y * surfaceNormal.y, // dot
    )
    g.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), theta)
    g.position.sub(pivot)
  }

  // `nose` (centred X row at a fixed z), `belly` (keel line, x=0), and `chin`
  // at count=1 (x=0) are centreline placements; exclude them from the
  // port/stbd mirror so they aren't doubled onto themselves.
  if (position === 'nose' || position === 'belly' || (position === 'chin' && mountX === 0)) g.userData.isCentreline = true
  return g
}

// Build a SINGLE weapon mounted on the flat top of a rectangular block — a
// deterministic test fixture for the weapons harness. The block is described by
// `block = { width, height, depth }`; the weapon sits on its top face (y =
// height/2) at the centreline, barrel pointing +Z. Reuses `buildWeapon` with a
// synthetic flat "hull" (a box HullInfo) so the weapon's own geometry is
// identical to a ship-mounted one. Returns the weapon THREE.Group (unpositioned
// relative to the block's origin, i.e. the block is centred at the origin).
export function buildWeaponOnBlock(rng, weaponCfg, block) {
  const { width, height, depth } = block
  const hullInfo = {
    length: depth,
    beam: width,
    height,
    noseZ: depth / 2,
    sternZ: -depth / 2,
    archetype: 'blocky',
    body: 'blocky',
    anchors: {
      top: new THREE.Vector3(0, height / 2, 0),
      bottom: new THREE.Vector3(0, -height / 2, 0),
      port: new THREE.Vector3(-width / 2, 0, 0),
      starboard: new THREE.Vector3(width / 2, 0, 0),
      fore: new THREE.Vector3(0, height / 2, depth / 2),
      aft: new THREE.Vector3(0, 0, -depth / 2),
    },
  }
  // A flat-top surface query: every point on the top face is at y = height/2.
  const flatTop = height / 2
  const surface = {
    surfaceAt: (dir) => (dir === 'top' ? flatTop : dir === 'bottom' ? -flatTop : width / 2),
    tubeSurfaceAt: (dir, _z) => surface.surfaceAt(dir, _z),
    girthAt: () => Math.min(width, height),
    surfaceRadiusAt: (angle) => Math.max(Math.abs(Math.cos(angle)) * (width / 2), Math.abs(Math.sin(angle)) * (height / 2)),
    bestGirthZ: () => 0,
    maxSideAt: () => width / 2,
    hasGeometry: true,
  }
  const glowMat = makeGlowMaterial(null)
  const params = { weapons: { ...weaponCfg, count: 1 } }
  const ctx = {
    mat: defaultMaterial(),
    glowMat,
    hull: hullInfo,
    top: hullInfo.anchors.top,
    bottom: hullInfo.anchors.bottom,
    port: hullInfo.anchors.port,
    starboard: hullInfo.anchors.starboard,
    fore: hullInfo.anchors.fore,
    aft: hullInfo.anchors.aft,
    params,
    surface,
    glowColor: null,
    color: DEFAULT_PALETTE[0],
    accent: DEFAULT_PALETTE[2],
    i: 0,
    t: 0.5,
    n: 1,
  }
  const g = buildWeapon(rng, ctx)
  // `buildWeapon` places the weapon relative to the hull origin with the barrel
  // pointing +Z; the flat-top mount already sits on y = height/2 (the top face),
  // so the returned group is ready to add to a scene where the block is centred
  // at the origin.
  return g
}

// --- weapon geometry helpers -------------------------------------------------
// A +Z-aligned barrel: cylinder rotated so its axis points +Z (direction of
// travel). Centred at (x, y, z + len*0.5) so its base sits at z and extends
// forward. 16 radial segments for a smooth profile.
function addBarrel(group, mat, x, y, z, r, len, name = 'weaponBarrel') {
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, len, 16), mat)
  barrel.name = name
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(x, y, z + len * 0.5)
  group.add(barrel)
  return barrel
}

// Thin ring bands spaced along the barrel to break up the smooth tube.
function addBarrelBands(group, mat, x, y, z, r, len, count = 2) {
  for (let k = 0; k < count; k++) {
    const t = (k + 1) / (count + 1)
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.18, r * 1.18, r * 0.045, 16),
      mat,
    )
    band.name = `weaponBand${k}`
    band.rotation.x = Math.PI / 2
    band.position.set(x, y, z + len * t)
    group.add(band)
  }
}

// A short, slightly wider cylinder at the barrel tip to define the muzzle.
function addMuzzleStep(group, mat, x, y, z, r) {
  const step = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.85, r * 1.25, r * 0.18, 16),
    mat,
  )
  step.name = 'weaponMuzzleStep'
  step.rotation.x = Math.PI / 2
  step.position.set(x, y, z + r * 0.09)
  group.add(step)
  return step
}

// Narrow flange + hemisphere on the hull-facing side. The dome buffers visual
// gaps between the flat mount base and the curved hull surface.
// `dirY` = +1 (hull below) or -1 (hull above).
function addContactPlate(group, mat, x, y, z, r, dirY = 1) {
  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.42, r * 0.48, r * 0.05, 16),
    mat,
  )
  flange.name = 'weaponContactPlate'
  flange.position.set(x, y - dirY * r * 0.025, z)
  group.add(flange)

  // Hemisphere curving toward the hull (bottom half for dirY=+1, top for -1).
  const thetaStart = dirY === 1 ? Math.PI * 0.5 : 0
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.44, 12, 6, 0, PI2, thetaStart, Math.PI * 0.5),
    mat,
  )
  dome.name = 'weaponContactDome'
  dome.position.set(x, y - dirY * r * 0.05, z)
  group.add(dome)
}

// A thin box going aft from the mount toward the hull (structural trail).
// `dirY` = +1 (hull below) or -1 (hull above); the arm points toward the hull.
function addAftArm(group, mat, x, y, z, r, dirY = 1) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(r * 0.12, r * 0.1, r * 0.45), mat)
  arm.name = 'weaponAftArm'
  arm.position.set(x, y - dirY * r * 0.06, z - r * 0.28)
  group.add(arm)
  return arm
}

// U-shaped cradle fork (two side plates + rear plate) that the barrel passes
// through, giving turret-style weapons a mounted-in-a-fork appearance.
function addCradle(group, mat, x, y, z, r, len) {
  const pw = r * 0.05
  const ph = r * 0.25
  const sw = r * 0.15
  const cl = len * 0.5
  const left = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, cl), mat)
  left.name = 'weaponCradleL'
  left.position.set(x - sw, y, z + cl * 0.5)
  group.add(left)
  const right = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, cl), mat)
  right.name = 'weaponCradleR'
  right.position.set(x + sw, y, z + cl * 0.5)
  group.add(right)
  const rear = new THREE.Mesh(new THREE.BoxGeometry(sw * 2 + pw, ph, pw), mat)
  rear.name = 'weaponCradleRear'
  rear.position.set(x, y, z)
  group.add(rear)
}

// Turret (default): a low, rounded mat turret dome on a mount ring + a short
// mat +Z-aligned barrel in a cradle fork. No glow accent.
function buildWeaponTurret(b) {
  const { mat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:turret'
  const bl = len * 0.6
  const br = R * 0.1

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const mount = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.42, R * 0.52, R * 0.32, 16), mat)
  mount.name = 'weaponMount'
  mount.position.set(mountX, mountY, z)
  group.add(mount)

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.36, 16, 10, 0, PI2, 0, Math.PI * 0.55),
    mat,
  )
  dome.name = 'weaponTurretDome'
  dome.position.set(mountX, mountY + dirY * R * 0.14, z)
  if (dirY === -1) dome.rotation.z = Math.PI
  group.add(dome)

  addCradle(group, mat, barrelX, barrelY, z + R * 0.12, R, bl)
  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)
  return group
}

// Twin turret: a hexagonal mat gunhouse with TWO thin barrels side by side,
// both +Z, each with a band and muzzle step.
function buildWeaponTwinTurret(b) {
  const { mat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:twinTurret'
  const bl = len * 0.8
  const br = R * 0.08
  const off = R * 0.16

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const house = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.36, R * 0.42, R * 0.44, 6), mat)
  house.name = 'weaponTwinHouse'
  house.position.set(mountX, mountY + dirY * R * 0.06, z)
  group.add(house)

  addBarrel(group, mat, barrelX - off, barrelY, z + R * 0.2, br, bl, 'weaponTwinBarrelL')
  addBarrel(group, mat, barrelX + off, barrelY, z + R * 0.2, br, bl, 'weaponTwinBarrelR')
  addBarrelBands(group, mat, barrelX - off, barrelY, z + R * 0.2, br, bl, 1)
  addBarrelBands(group, mat, barrelX + off, barrelY, z + R * 0.2, br, bl, 1)
  addMuzzleStep(group, mat, barrelX - off, barrelY, z + R * 0.2 + bl, br)
  addMuzzleStep(group, mat, barrelX + off, barrelY, z + R * 0.2 + bl, br)
  return group
}

// Boxy gunhouse: an angular, blocky mat gunhouse with a single +Z barrel in a
// cradle fork. The cheek guard frames the barrel.
function buildWeaponBoxy(b) {
  const { mat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:boxy'
  const bl = len * 0.7
  const br = R * 0.1

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const house = new THREE.Mesh(new THREE.BoxGeometry(R * 0.62, R * 0.52, R * 0.72), mat)
  house.name = 'weaponBoxyHouse'
  house.position.set(mountX, mountY + dirY * R * 0.06, z)
  group.add(house)

  const cheek = new THREE.Mesh(new THREE.BoxGeometry(R * 0.4, R * 0.16, R * 0.45), mat)
  cheek.name = 'weaponBoxyCheek'
  cheek.position.set(mountX, mountY + dirY * R * 0.3, z + R * 0.22)
  group.add(cheek)

  addCradle(group, mat, barrelX, barrelY, z + R * 0.12, R, bl)
  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)
  return group
}

// Dome gunhouse: a rounded, faceted (icosahedron detail 1) mat dome with a
// short +Z barrel.
function buildWeaponDome(b) {
  const { mat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:dome'
  const bl = len * 0.55
  const br = R * 0.1

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(R * 0.42, 1), mat)
  dome.name = 'weaponDomeHouse'
  dome.scale.set(1, 0.72, 1.1)
  dome.position.set(mountX, mountY + dirY * R * 0.12, z)
  group.add(dome)

  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)
  return group
}

// Angular gunhouse: a chamfered hexagonal mat housing with a flat deck plate
// and a +Z barrel.
function buildWeaponAngular(b) {
  const { mat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:angular'
  const bl = len * 0.7
  const br = R * 0.09

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  // A chamfered hexagonal housing (6-sided cylinder for an angular profile).
  const wedge = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.38, R * 0.48, R * 0.55, 6, 1), mat)
  wedge.name = 'weaponAngularHouse'
  wedge.rotation.x = Math.PI / 2
  wedge.position.set(mountX, mountY + dirY * R * 0.08, z)
  group.add(wedge)

  const deck = new THREE.Mesh(new THREE.BoxGeometry(R * 0.4, R * 0.1, R * 0.45), mat)
  deck.name = 'weaponAngularDeck'
  deck.position.set(mountX, mountY + dirY * R * 0.28, z + R * 0.05)
  group.add(deck)

  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)
  return group
}

// Cannon: a hexagonal mat mount + a thick mat cannon barrel along +Z, with a
// glowing muzzle ring (accent) at the +Z muzzle.
function buildWeaponCannon(b) {
  const { mat, glowMat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:cannon'
  const bl = len * 0.8
  const br = R * 0.12

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const mount = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.28, R * 0.36, R * 0.38, 6), mat)
  mount.name = 'weaponCannonMount'
  mount.position.set(mountX, mountY + dirY * R * 0.04, z)
  group.add(mount)

  addAftArm(group, mat, mountX, mountY, z, R, dirY)

  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)

  const muzzle = new THREE.Mesh(new THREE.TorusGeometry(R * 0.09, R * 0.025, 8, 16), glowMat)
  muzzle.name = 'weaponMuzzle'
  muzzle.position.set(barrelX, barrelY, z + R * 0.2 + bl + R * 0.1)
  group.add(muzzle)

  return group
}

// Long cannon: a long, very thin barrel (the classic "lance" cannon) with a
// small glowing tip (accent) at the muzzle.
function buildWeaponLongCannon(b) {
  const { mat, glowMat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:longCannon'
  const bl = len * 1.8
  const br = R * 0.06

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const mount = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.3, R * 0.38, R * 0.34, 6), mat)
  mount.name = 'weaponLongMount'
  mount.position.set(mountX, mountY + dirY * R * 0.04, z)
  group.add(mount)

  addAftArm(group, mat, mountX, mountY, z, R, dirY)

  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl, 'weaponLongBarrel')
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl, 3)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)

  const tip = new THREE.Mesh(new THREE.SphereGeometry(R * 0.07, 10, 8), glowMat)
  tip.name = 'weaponLongTip'
  tip.position.set(barrelX, barrelY, z + R * 0.2 + bl + R * 0.1)
  group.add(tip)

  return group
}

// Muzzle brake: a cannon barrel with a flared, slotted glowing muzzle brake at
// the +Z tip (accent) — the classic "brake" that vents the shot.
function buildWeaponMuzzleBrake(b) {
  const { mat, glowMat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:muzzleBrake'
  const bl = len * 1.0
  const br = R * 0.11

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const mount = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.26, R * 0.34, R * 0.38, 6), mat)
  mount.name = 'weaponBrakeMount'
  mount.position.set(mountX, mountY + dirY * R * 0.04, z)
  group.add(mount)

  addAftArm(group, mat, mountX, mountY, z, R, dirY)

  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl, 'weaponBrakeBarrel')
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)

  // A flared brake housing (mat) at the muzzle.
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.15, R * 0.1, R * 0.24, 12), mat)
  brake.name = 'weaponBrakeHousing'
  brake.rotation.x = Math.PI / 2
  brake.position.set(barrelX, barrelY, z + R * 0.2 + bl + R * 0.12)
  group.add(brake)

  // Glowing brake slots (accent) — small emissive blocks outside the housing.
  const slotGeo = new THREE.BoxGeometry(R * 0.04, R * 0.04, R * 0.1)
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * PI2 + Math.PI / 4
    const slot = new THREE.Mesh(slotGeo, glowMat)
    slot.name = 'weaponBrakeSlot'
    slot.position.set(
      barrelX + Math.cos(a) * R * 0.17,
      barrelY + Math.sin(a) * R * 0.17,
      z + R * 0.2 + bl + R * 0.12,
    )
    group.add(slot)
  }

  return group
}

// Suppressor: a cannon barrel with a long glowing suppressor shroud (accent)
// at the +Z end — a "silencer" that glows.
function buildWeaponSuppressor(b) {
  const { mat, glowMat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:suppressor'
  const bl = len * 1.4
  const br = R * 0.07

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const mount = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.26, R * 0.34, R * 0.38, 6), mat)
  mount.name = 'weaponSupMount'
  mount.position.set(mountX, mountY + dirY * R * 0.04, z)
  group.add(mount)

  addAftArm(group, mat, mountX, mountY, z, R, dirY)

  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl, 'weaponSupBarrel')
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)

  // A glowing suppressor shroud (accent): a wider glowing cylinder at the muzzle.
  const sup = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.1, R * 0.1, R * 0.3, 12), glowMat)
  sup.name = 'weaponSuppressor'
  sup.rotation.x = Math.PI / 2
  sup.position.set(barrelX, barrelY, z + R * 0.2 + bl + R * 0.15)
  group.add(sup)

  return group
}

// Dish cannon: a barrel ending in a glowing parabolic energy dish (accent) at
// the +Z tip — a "laser dish" emitter.
function buildWeaponDish(b) {
  const { mat, glowMat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:dish'
  const bl = len * 0.9
  const br = R * 0.09

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const mount = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.28, R * 0.36, R * 0.4, 6), mat)
  mount.name = 'weaponDishMount'
  mount.position.set(mountX, mountY + dirY * R * 0.04, z)
  group.add(mount)

  addAftArm(group, mat, mountX, mountY, z, R, dirY)

  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl, 'weaponDishBarrel')
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)

  // A glowing dish (accent): a shallow sphere cap, CONCAVE toward +Z.
  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(R * 0.18, 16, 10, 0, PI2, 0, Math.PI * 0.42),
    glowMat,
  )
  dish.name = 'weaponDish'
  dish.rotation.x = -Math.PI / 2
  dish.position.set(barrelX, barrelY, z + R * 0.2 + bl + R * 0.08)
  group.add(dish)

  // A small feed node at the dish's focus (glow), touching the dish surface.
  const feed = new THREE.Mesh(new THREE.SphereGeometry(R * 0.05, 8, 6), glowMat)
  feed.name = 'weaponDishFeed'
  feed.position.set(barrelX, barrelY, z + R * 0.2 + bl + R * 0.14)
  group.add(feed)

  return group
}

// Tip glow: a standard cannon barrel with a bright, emissive energy tip (accent)
// — a "charged" muzzle.
function buildWeaponTipGlow(b) {
  const { mat, glowMat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:tipGlow'
  const bl = len * 1.0
  const br = R * 0.09

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const mount = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.3, R * 0.38, R * 0.36, 6), mat)
  mount.name = 'weaponTipMount'
  mount.position.set(mountX, mountY + dirY * R * 0.04, z)
  group.add(mount)

  addAftArm(group, mat, mountX, mountY, z, R, dirY)

  addBarrel(group, mat, barrelX, barrelY, z + R * 0.2, br, bl, 'weaponTipBarrel')
  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, br, bl)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + bl, br)

  // A bright emissive tip (accent): a glowing cone at the muzzle, touching the step.
  const tip = new THREE.Mesh(new THREE.ConeGeometry(R * 0.09, R * 0.2, 12), glowMat)
  tip.name = 'weaponTip'
  tip.rotation.x = Math.PI / 2
  tip.position.set(barrelX, barrelY, z + R * 0.2 + bl + R * 0.18)
  group.add(tip)

  return group
}

// Railgun: a sleek low hexagonal profile (mat) with a long thin +Z rail and a
// visible glowing energy channel (accent) running its length.
function buildWeaponRailgun(b) {
  const { mat, glowMat, R, len, mountX, mountY, z, barrelX, barrelY, dirY } = b
  const group = new THREE.Group()
  group.name = 'weapon:railgun'
  const rl = len * 1.2

  addContactPlate(group, mat, mountX, mountY, z, R, dirY)

  const profile = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.24, R * 0.3, R * 0.36, 6), mat)
  profile.name = 'weaponProfile'
  profile.position.set(mountX, mountY + dirY * R * 0.04, z)
  group.add(profile)

  addAftArm(group, mat, mountX, mountY, z, R, dirY)

  const rail = new THREE.Mesh(new THREE.BoxGeometry(R * 0.1, R * 0.14, rl), mat)
  rail.name = 'weaponRail'
  rail.position.set(barrelX, barrelY, z + R * 0.2 + rl * 0.5)
  group.add(rail)

  // Glowing channel (accent) sitting on the outer face of the rail so it is visible.
  const channel = new THREE.Mesh(new THREE.BoxGeometry(R * 0.04, R * 0.04, rl * 0.88), glowMat)
  channel.name = 'weaponChannel'
  channel.position.set(barrelX, barrelY + dirY * R * 0.09, z + R * 0.2 + rl * 0.5)
  group.add(channel)

  addBarrelBands(group, mat, barrelX, barrelY, z + R * 0.2, R * 0.05, rl, 2)
  addMuzzleStep(group, mat, barrelX, barrelY, z + R * 0.2 + rl, R * 0.05)

  return group
}

// Sensor mast: slender mast + sensor head, rising from the top deck. `count`
// masts are placed at staggered z along the deck. A family of three distinct
// silhouettes, each multi-part and multi-material (hull `mat` + the sensor-mast
// violet glow accent):
//   mast (default): the existing mast + glowing sensor head.
//   pole:           a thin lattice pole with a glowing sensor pod mid-height.
//   ring:           a mast topped by a glowing horizontal sensor ring + supports.
//
// Not instanced (was): the multi-part, multi-material styles do not batch into
// InstancedMesh the way the old single-mast + head did, and distinctness matters
// more than the draw-call win here (see MODULE_SPECS).
function buildSensorMast(rng, ctx) {
  const { mat, hull, fore, surface } = ctx
  const cfg = ctx.params.sensorMast
  const style = SENSOR_MAST_STYLES.includes(cfg.style) ? cfg.style : 'mast'
  const glowMat = ctx.glowMat
  const h = hull.height * 0.9 * (cfg.height / 4)
  // Centreline deck features: placed on x=0 and staggered fore/aft via ctx.t
  // (not mirrored — see PAIRED). No per-instance jitter, so the set is symmetric.
  const z = lerp(hull.length * 0.05, fore.z * 0.9, ctx.t)
  const x = 0
  // FIT GUARD: seat the mast base on the real deck height at this z, embedding
  // by a fraction of its own height (guaranteed contact).
  const baseY = surface.surfaceAt('top', z) - Math.max(EMBED_FLOOR, h * EMBED_FRAC)
  const base = { mat, glowMat, hull, h, x, z, topY: baseY }

  let g
  switch (style) {
    case 'pole':
      g = buildSensorMastPole(base)
      break
    case 'ring':
      g = buildSensorMastRing(base)
      break
    case 'mast':
    default:
      g = buildSensorMastMast(base)
      break
  }
  g.userData.isCentreline = true
  return g
}

// Mast (default): the existing slender mast + glowing sensor head.
function buildSensorMastMast(b) {
  const { mat, glowMat, h, x, z, topY } = b
  const group = new THREE.Group()
  group.name = 'sensorMast:mast'

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, h, 6), mat)
  mast.name = 'mast'
  mast.position.set(x, topY + h / 2, z)
  group.add(mast)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), glowMat)
  head.name = 'sensorHead'
  head.position.set(x, topY + h, z)
  group.add(head)

  return group
}

// Pole: a thin lattice pole (mat) with a glowing sensor pod (glow) mid-height.
function buildSensorMastPole(b) {
  const { mat, glowMat, h, x, z, topY } = b
  const group = new THREE.Group()
  group.name = 'sensorMast:pole'

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, h, 5), mat)
  pole.name = 'pole'
  pole.position.set(x, topY + h / 2, z)
  group.add(pole)

  const pod = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), glowMat)
  pod.name = 'polePod'
  pod.scale.set(0.8, 1.3, 0.8)
  pod.position.set(x, topY + h * 0.55, z)
  group.add(pod)

  return group
}

// Ring: a mast (mat) topped by a glowing horizontal sensor ring (glow torus) +
// two mat supports.
function buildSensorMastRing(b) {
  const { mat, glowMat, h, x, z, topY } = b
  const group = new THREE.Group()
  group.name = 'sensorMast:ring'

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, h, 6), mat)
  mast.name = 'ringMast'
  mast.position.set(x, topY + h / 2, z)
  group.add(mast)

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 8, 20), glowMat)
  ring.name = 'sensorRing'
  ring.rotation.x = Math.PI / 2
  ring.position.set(x, topY + h, z)
  group.add(ring)

  const supportGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 4)
  for (const sgn of [-1, 1]) {
    const sup = new THREE.Mesh(supportGeo, mat)
    sup.name = 'ringSupport'
    sup.position.set(x + sgn * 0.45, topY + h - 0.2, z)
    group.add(sup)
  }

  return group
}

// Antenna: whip/element cluster mounted on the top deck near the fore. `count`
// clusters at staggered z. A family of three distinct silhouettes, each
// multi-part and multi-material (hull `mat` + the antenna magenta glow accent):
//   whip (default): the existing thin whip + tip (tip now glows).
//   array:          a small mast with 2-3 short glowing whip elements fanned out.
//   dish:           a thin mast with a glowing micro-dish at the top.
//
// Not instanced (was): the multi-part, multi-material styles do not batch into
// InstancedMesh the way the old single whip + tip did, and distinctness matters
// more than the draw-call win here (see MODULE_SPECS).
function buildAntenna(rng, ctx) {
  const { mat, hull, fore, surface } = ctx
  const cfg = ctx.params.antenna
  const style = ANTENNA_STYLES.includes(cfg.style) ? cfg.style : 'whip'
  const glowMat = ctx.glowMat
  const h = hull.height * 0.7
  // Centreline deck features: placed on x=0 and staggered fore/aft via ctx.t
  // (not mirrored — see PAIRED).
  const z = lerp(hull.length * 0.1, fore.z * 0.95, ctx.t)
  const x = 0
  // FIT GUARD: seat the whip base on the real deck height at this z, embedding
  // by a fraction of its own height (guaranteed contact).
  const baseY = surface.surfaceAt('top', z) - Math.max(EMBED_FLOOR, h * EMBED_FRAC)
  const base = { mat, glowMat, hull, h, x, z, topY: baseY }

  let g
  switch (style) {
    case 'array':
      g = buildAntennaArray(base)
      break
    case 'dish':
      g = buildAntennaDish(base)
      break
    case 'whip':
    default:
      g = buildAntennaWhip(base)
      break
  }
  g.userData.isCentreline = true
  return g
}

// Whip (default): the existing thin whip + tip; the tip now glows.
function buildAntennaWhip(b) {
  const { mat, glowMat, h, x, z, topY } = b
  const group = new THREE.Group()
  group.name = 'antenna:whip'

  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, h, 4), mat)
  whip.name = 'antennaWhip'
  whip.position.set(x, topY + h / 2, z)
  group.add(whip)

  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), glowMat)
  tip.name = 'antennaTip'
  tip.position.set(x, topY + h, z)
  group.add(tip)

  return group
}

// Array: a small mast (mat) with three short glowing whip elements (glow)
// fanned out around the top.
function buildAntennaArray(b) {
  const { mat, glowMat, h, x, z, topY } = b
  const group = new THREE.Group()
  group.name = 'antenna:array'

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, h, 5), mat)
  mast.name = 'arrayMast'
  mast.position.set(x, topY + h / 2, z)
  group.add(mast)

  const elH = h * 0.4
  const elGeo = new THREE.CylinderGeometry(0.03, 0.05, elH, 4)
  const elR = 0.45
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * PI2
    const el = new THREE.Mesh(elGeo, glowMat)
    el.name = 'arrayElement'
    el.rotation.z = Math.cos(a) * 0.45
    el.rotation.x = -Math.sin(a) * 0.45
    el.position.set(x + Math.cos(a) * elR, topY + h * 0.78 + (elH / 2) * 0.4, z + Math.sin(a) * elR)
    group.add(el)
  }

  return group
}

// Dish: a thin mast (mat) with a glowing micro-dish (glow) at the top + a small
// mat feed node.
function buildAntennaDish(b) {
  const { mat, glowMat, h, x, z, topY } = b
  const group = new THREE.Group()
  group.name = 'antenna:dish'

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, h, 5), mat)
  mast.name = 'dishMast'
  mast.position.set(x, topY + h / 2, z)
  group.add(mast)

  const dish = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 6, 0, PI2, 0, Math.PI * 0.5),
    glowMat
  )
  dish.name = 'microDish'
  dish.position.set(x, topY + h, z)
  group.add(dish)

  const feed = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), mat)
  feed.name = 'dishFeed'
  feed.position.set(x, topY + h + 0.16, z)
  group.add(feed)

  return group
}

// Hangar: large bay on the port/starboard side. `count` is 1 or 2 (one per
// side when 2). A family of three distinct silhouettes, each multi-part and
// Fog-like emissive fill for hangar interiors: a semi-transparent volume that
// sits inside the cavity and gives the "interior" a soft, volumetric glow
// rather than a flat emissive panel. Uses MeshBasicMaterial (unlit) with low
// opacity + BackSide so it reads as a glowing mist from outside the opening.
function makeHangarFog(glowMat) {
  const color = glowMat.emissive
    ? new THREE.Color(glowMat.emissive)
    : new THREE.Color(0x36c8ff)
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.25,
    side: THREE.BackSide,
    depthWrite: false,
  })
}

// multi-material (hull `mat` + the hangar amber glow accent):
//   bay (default): the existing boxy bay + inset door.
//   pod:           a rounded hangar pod with a glowing docking-ring door.
//   dock:          an open docking gantry with glowing guide-lights at the mouth.
function buildHangar(rng, ctx) {
  const { mat, hull, surface, fore, t } = ctx
  const cfg = ctx.params.hangar
  const style = HANGAR_STYLES.includes(cfg.style) ? cfg.style : 'bay'
  const position = HANGAR_POSITIONS.includes(cfg.position) ? cfg.position : 'side'
  const glowMat = ctx.glowMat
  const n = cfg.count || 1
  const i = ctx.i
  const side = n > 1 ? (i % 2 === 0 ? -1 : 1) : 1

  // Shallow cavity: the hangar protrudes only slightly from the hull surface
  // (0.25 of beam) so it reads as a recessed bay rather than a bulky box.
  const w = hull.beam * 0.25
  const h = hull.height * 0.42
  const d = hull.length * 0.18

  let cx, cy, cz, rotY = 0, rotX = 0
  // Centreline positions (chin, belly, nose) sit on the hull's bottom/fore
  // centreline. They must NOT be mirrored: the half-group mirror would
  // duplicate them at the same position with a flipped X, causing overlapping
  // geometry that can appear to float outside the hull. `isCentreline` flags
  // these so the caller can skip the mirror.
  const isCentreline = position === 'chin' || position === 'belly' || position === 'nose'
  if (position === 'side') {
    cz = -hull.length * 0.08
    const sideExt = surface.surfaceAt('side', cz)
    cx = side * (sideExt + w * 0.1)
    cy = 0
  } else if (position === 'nose') {
    // Mounted on the hull's nose, opening forward (+Z).
    const noseZ = surface.surfaceAt('fore', 0)
    cz = noseZ + d * 0.25
    cx = 0
    cy = hull.height * 0.1
  } else if (position === 'chin') {
    // Under the nose, opening forward-and-down. Placed at the fore anchor's
    // z, below the hull's bottom surface.
    const zChin = lerp(-hull.length * 0.1, fore.z, 0.6)
    const botY = -Math.abs(surface.surfaceAt('bottom', zChin))
    cz = zChin
    cx = 0
    cy = botY - h * 0.3
    rotX = Math.PI * 0.35
  } else {
    // belly: on the hull's bottom, midship, opening downward. The outboard face
    // (built along local +X) must point straight down (-Y). We handle this with
    // a dedicated inner Z-rotation (see below) rather than the group's Y/X
    // rotation, because mapping +X to -Y requires a rotation about Z.
    cz = lerp(-hull.length * 0.3, hull.length * 0.1, t)
    const botY = -Math.abs(surface.surfaceAt('bottom', cz))
    cx = 0
    cy = botY - h * 0.15
  }

  // For centreline positions, the hangar's "outboard" face should point down
  // (or forward for nose), not along X. The inner builders use `side` to
  // orient the outboard face; for centreline hangars we use side=1 (so the
  // outboard face is +X in local space) and then rotate the whole group so
  // that +X maps to the desired world direction:
  //   nose: +X -> +Z (rotY = PI/2)
  //   chin: +X -> down-and-forward (rotY = PI/2, then rotX = PI*0.35)
  //   belly: handled by a dedicated inner Z-rotation (rotZ = -PI/2)
  if (position === 'nose') rotY = Math.PI / 2
  else if (position === 'chin') rotY = Math.PI / 2

  // Inner geometry is built at the local origin (cx=0, cy=0, z=0) with the
  // outboard face along +X. The outer group handles world positioning and
  // rotation, so the inner builders just need the dimensions + side=1.
  const base = { mat, glowMat, hull, w, h, d, z: 0, cx: 0, cy: 0, side: 1 }

  const group = new THREE.Group()
  group.name = 'hangar'
  let inner
  switch (style) {
    case 'pod':
      inner = buildHangarPod(base)
      break
    case 'dock':
      inner = buildHangarDock(base)
      break
    case 'bay':
    default:
      inner = buildHangarBay(base)
      break
  }
  // For belly, the outboard face (local +X) must point straight down (-Y).
  // Mapping +X to -Y requires a rotation about Z, which the group's Y/X
  // rotation (order 'YXZ', used by nose/chin) cannot express. So we wrap the
  // inner geometry in a dedicated group rotated -90° about Z: this maps +X
  // -> -Y (outboard face down) and keeps +Z (depth) along the hull's fore-aft
  // axis, so the bay's length runs fore-to-aft and the opening faces down.
  let content = inner
  if (position === 'belly') {
    const zRot = new THREE.Group()
    zRot.name = 'hangar:bellyZ'
    zRot.rotation.z = -Math.PI / 2
    zRot.add(inner)
    content = zRot
  }
  group.add(content)
  group.position.set(cx, cy, cz)
  group.rotation.order = 'YXZ'
  group.rotation.y = rotY
  group.rotation.x = rotX
  group.userData.isCentreline = isCentreline
  return group
}

// Bay (default): an OPEN hangar bay — a concave void on the hull's side, not a
// closed box with a door. The outboard face is a recessed opening framed by four
// matte walls (top, bottom, fore, aft); the BACK of the bay (recessed inboard)
// is a single emissive panel, so the opening reads as a dark cavity glowing from
// within. `side` is +1 (starboard) or -1 (port); the opening faces outboard
// (the +X side for starboard, -X for port).
function buildHangarBay(b) {
  const { mat, glowMat, w, h, d, z, cx, cy, side } = b
  const group = new THREE.Group()
  group.name = 'hangar:bay'

  // Wall thickness and recess depth: the opening is set in from the outboard
  // face, so the back wall (emissive) sits recessed, creating the concave void.
  const t = Math.min(w, h) * 0.12 // wall thickness
  const recess = w * 0.32 // how deep the cavity is (inboard from the outboard face)

  // The four framing walls (mat). Each is a box spanning the full bay height/depth
  // minus the opening, positioned to leave a rectangular void on the outboard face.
  // Top and bottom walls: span the bay's X (outboard) and Z (fore-aft), thin in Y.
  const topWall = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), mat)
  topWall.name = 'hangarWallTop'
  topWall.position.set(cx, cy + h * 0.5 - t * 0.5, z)
  group.add(topWall)
  const botWall = new THREE.Mesh(new THREE.BoxGeometry(w, t, d), mat)
  botWall.name = 'hangarWallBottom'
  botWall.position.set(cx, cy - h * 0.5 + t * 0.5, z)
  group.add(botWall)
  // Fore and aft walls: span the bay's X and Y (between top/bottom walls), thin in Z.
  const innerH = h - t * 2 // height between the top and bottom walls
  const foreWall = new THREE.Mesh(new THREE.BoxGeometry(w, innerH, t), mat)
  foreWall.name = 'hangarWallFore'
  foreWall.position.set(cx, cy, z + d * 0.5 - t * 0.5)
  group.add(foreWall)
  const aftWall = new THREE.Mesh(new THREE.BoxGeometry(w, innerH, t), mat)
  aftWall.name = 'hangarWallAft'
  aftWall.position.set(cx, cy, z - d * 0.5 + t * 0.5)
  group.add(aftWall)

  // The BACK of the bay (emissive): a single panel recessed inboard from the
  // outboard face, spanning the opening's Y-Z rectangle. This is the glowing
  // "interior" seen through the open void.
  const openW = d - t * 2 // opening width along Z (between fore/aft walls)
  const openH = h - t * 2 // opening height along Y (between top/bottom walls)
  const back = new THREE.Mesh(new THREE.BoxGeometry(t * 0.5, openH, openW), glowMat)
  back.name = 'hangarBack'
  // Recessed inboard: the outboard face is at cx + side*(w/2); the back wall sits
  // `recess` inboard of that (toward the hull), at the cavity floor. `cx` is
  // already signed (positive for starboard, negative for port), so the inboard
  // direction is -side.
  const backX = cx - side * recess
  back.position.set(backX, cy, z)
  group.add(back)

  // Fog volume: a semi-transparent box filling the cavity interior, giving the
  // hangar a soft volumetric glow instead of a flat back panel.
  const fogMat = makeHangarFog(glowMat)
  const fog = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.8, openH * 0.9, openW * 0.9),
    fogMat,
  )
  fog.name = 'hangarFog'
  fog.position.set(cx - side * recess * 0.5, cy, z)
  group.add(fog)

  // A thin emissive rim lining the opening's inner edges (the void's lip), so the
  // cavity reads as a lit opening rather than a flat hole. Four thin bars framing
  // the outboard face of the opening.
  const rimT = t * 0.4
  const rimOutX = cx + side * (w * 0.5) // outboard face x (cx is already signed)
  const rimTop = new THREE.Mesh(new THREE.BoxGeometry(rimT, rimT, openW), glowMat)
  rimTop.name = 'hangarRimTop'
  rimTop.position.set(rimOutX, cy + h * 0.5 - rimT * 0.5, z)
  group.add(rimTop)
  const rimBot = new THREE.Mesh(new THREE.BoxGeometry(rimT, rimT, openW), glowMat)
  rimBot.name = 'hangarRimBottom'
  rimBot.position.set(rimOutX, cy - h * 0.5 + rimT * 0.5, z)
  group.add(rimBot)
  const rimFore = new THREE.Mesh(new THREE.BoxGeometry(rimT, openH - rimT * 2, rimT), glowMat)
  rimFore.name = 'hangarRimFore'
  rimFore.position.set(rimOutX, cy, z + d * 0.5 - rimT * 0.5)
  group.add(rimFore)
  const rimAft = new THREE.Mesh(new THREE.BoxGeometry(rimT, openH - rimT * 2, rimT), glowMat)
  rimAft.name = 'hangarRimAft'
  rimAft.position.set(rimOutX, cy, z - d * 0.5 + rimT * 0.5)
  group.add(rimAft)

  return group
}

// Pod: a rounded hangar pod (mat) with an OPEN circular void on its outboard
// face — a concave docking port. The interior back of the pod (recessed inboard)
// is a glowing disc, so the opening reads as a dark cavity lit from within. A
// glowing ring lines the opening's rim. `side` is +1 (starboard) or -1 (port);
// the opening faces outboard (the +X side for starboard, -X for port).
function buildHangarPod(b) {
  const { mat, glowMat, w, h, d, z, cx, cy, side } = b
  const group = new THREE.Group()
  group.name = 'hangar:pod'

  // The pod body: a rounded ellipsoid (mat). The outboard face is where the
  // opening is; the pod's interior back is recessed inboard.
  const pod = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat)
  pod.name = 'hangarPod'
  pod.scale.set(w * 0.5, h * 0.5, d * 0.5)
  pod.position.set(cx, cy, z)
  group.add(pod)

  // The opening's radius (the circular void on the outboard face).
  const openR = Math.min(h, d) * 0.32
  // The recess depth: how far inboard the glowing back sits from the outboard
  // face, creating the concave void.
  const recess = w * 0.25
  // The outboard face x (the pod's outermost point on the side axis).
  const outX = cx + side * (w * 0.5)
  // The back of the pod (emissive): a glowing disc recessed inboard, facing the
  // opening. This is the "interior" seen through the open void.
  const back = new THREE.Mesh(new THREE.CircleGeometry(openR, 24), glowMat)
  back.name = 'hangarPodBack'
  back.position.set(outX - side * recess, cy, z)
  // Face the back toward the opening (outboard): +X for starboard, -X for port.
  back.rotation.y = side === 1 ? Math.PI / 2 : -Math.PI / 2
  group.add(back)

  // Fog volume: a semi-transparent sphere filling the pod interior.
  const fogMat = makeHangarFog(glowMat)
  const fog = new THREE.Mesh(
    new THREE.SphereGeometry(openR * 0.9, 16, 12),
    fogMat,
  )
  fog.name = 'hangarPodFog'
  fog.scale.set(w * 0.4 / (openR * 0.9), 1, 1)
  fog.position.set(cx + side * (w * 0.1), cy, z)
  group.add(fog)

  // A glowing ring lining the opening's rim (the void's lip), so the cavity
  // reads as a lit port rather than a flat hole.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(openR, Math.min(h, d) * 0.03, 10, 24), glowMat)
  ring.name = 'hangarPodRing'
  ring.position.set(outX, cy, z)
  // The ring faces outboard (its plane is perpendicular to the side/X axis).
  ring.rotation.y = Math.PI / 2
  group.add(ring)

  return group
}

// Dock: a semi-cylindrical docking bay — a curved canopy (half-cylinder shell)
// with an arched opening facing outboard. The interior back is an emissive disc
// recessed inboard, and a glowing curved rim (torus segment) lines the opening's
// edge. A few small emissive guide lights sit along the rim. `side` is +1
// (starboard) or -1 (port); the opening faces outboard.
function buildHangarDock(b) {
  const { mat, glowMat, w, h, d, z, cx, cy, side } = b
  const group = new THREE.Group()
  group.name = 'hangar:dock'

  // The curved canopy: a half-cylinder (180° arc) with the axis along the
  // inboard direction (X for side mounts). The open end faces outboard. The
  // cylinder's Y-axis (default) is rotated to align with X.
  const shellR = Math.min(h, d) * 0.45 // radius of the half-cylinder
  const shellLen = w * 0.7 // inboard depth of the canopy
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(shellR, shellR, shellLen, 24, 1, true, Math.PI, Math.PI),
    mat,
  )
  shell.name = 'dockShell'
  // Rotate so the cylinder's axis (Y) points along X (inboard direction).
  // The half-cylinder's flat face (the diameter) faces down (-Y in local space),
  // which maps to the hull surface after rotation.
  shell.rotation.z = Math.PI / 2 // Y -> X
  shell.rotation.x = Math.PI / 2 // so the flat face points toward the hull
  shell.position.set(cx - side * shellLen * 0.5, cy, z)
  group.add(shell)

  // The outboard face (opening) is at the outer end of the cylinder.
  const outX = cx + side * (w * 0.5)

  // The back of the bay (emissive): a disc recessed inboard, spanning the
  // opening. This is the glowing "interior" seen through the arched void.
  const backR = shellR * 0.85
  const recess = w * 0.35
  const back = new THREE.Mesh(new THREE.CircleGeometry(backR, 24), glowMat)
  back.name = 'dockBack'
  back.position.set(outX - side * recess, cy, z)
  back.rotation.y = side === 1 ? Math.PI / 2 : -Math.PI / 2
  group.add(back)

  // Fog volume: a semi-transparent cylinder filling the dock interior.
  const fogMat = makeHangarFog(glowMat)
  const fog = new THREE.Mesh(
    new THREE.CylinderGeometry(shellR * 0.8, shellR * 0.8, shellLen * 0.7, 16, 1, true),
    fogMat,
  )
  fog.name = 'dockFog'
  fog.rotation.z = Math.PI / 2
  fog.rotation.x = Math.PI / 2
  fog.position.set(cx - side * shellLen * 0.3, cy, z)
  group.add(fog)

  // A glowing curved rim (torus segment, 180°) lining the opening's edge.
  const rimR = shellR
  const rimTube = Math.min(h, d) * 0.035
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(rimR, rimTube, 10, 24, Math.PI),
    glowMat,
  )
  rim.name = 'dockRim'
  // The torus lies in the Y-Z plane by default; rotate so it faces outboard
  // (perpendicular to X). The arc (Math.PI) covers the top half, matching
  // the half-cylinder's opening.
  rim.rotation.y = Math.PI / 2
  rim.rotation.z = 0 // arc starts at 0 (right side) and sweeps to PI (left side)
  rim.position.set(outX, cy, z)
  group.add(rim)

  // A few small emissive guide lights along the curved rim, spaced evenly
  // across the 180° arc.
  const lightR = rimTube * 0.6
  const lightGeo = new THREE.SphereGeometry(lightR, 8, 6)
  const lightCount = 5
  for (let k = 0; k < lightCount; k++) {
    const angle = (k / (lightCount - 1)) * Math.PI // 0 to PI across the arc
    const lx = outX
    const ly = cy + Math.sin(angle) * rimR
    const lz = z - Math.cos(angle) * rimR
    const light = new THREE.Mesh(lightGeo, glowMat)
    light.name = 'dockGuideLight'
    light.position.set(lx, ly, lz)
    group.add(light)
  }

  return group
}

// --- catalog + placement -----------------------------------------------------

// Aft-mount pod fit. The aft pods wrap the FULL stern ring: `n` instances are
// built on one side (the half-group) and mirrored, giving `2n` pods evenly
// spaced around the full circumference 2*PI*girth. For `2n` pods of radius r to
// fit without overlapping, 2*PI*girth >= 2n * 2 * r * margin, i.e.
// PI*girth >= n * 2 * r * margin. `maxAftPodCount` returns the max total count
// (2n) that fits at a given radius; `aftPodRadius` returns the clamped radius
// that fits a given total count. Both are shared by generateModules (cap the
// count) and buildNacelle (size the pod) so they agree on the fit.
const AFT_POD_MARGIN = 1.25 // small gap between adjacent pods in the ring
// `n` pods are built in the half-group and mirrored, giving 2n total around the
// full ring (2*PI*girth). For 2n pods of radius r to fit without overlapping,
// (2r/girth) * margin <= PI/n  =>  r <= PI*girth / (2n * margin).
// `maxAftN` returns the max n (per-side count) that fits at a given radius;
// `aftPodRadius` returns the clamped radius that fits a given n. Both are shared
// by generateModules (cap count=n) and buildNacelle (size the pod) so they agree.
function maxAftN(sternGirth, radius) {
  const arc = Math.max(1, Math.PI * Math.max(1, sternGirth))
  const n = Math.floor(arc / (2 * Math.max(0.15, radius) * AFT_POD_MARGIN))
  return Math.max(1, n)
}
function aftPodRadius(sternGirth, n, requestedRadius) {
  const arc = Math.max(1, Math.PI * Math.max(1, sternGirth))
  return Math.max(0.15, Math.min(requestedRadius, arc / (2 * Math.max(1, n) * AFT_POD_MARGIN)))
}

// Per-module spec: builder, minimum density at which the module appears, and
// how its instance count scales with density (0..maxCount). No module is
// instanced now: every module type is a family of distinct multi-part,
// multi-material, multi-style geometries (see the build* builders), which do
// not batch into InstancedMesh the way the old single-geometry repeats did.
// Weapons and nacelles in particular are always built as individual groups —
// correctness + per-style distinctness matter more than the draw-call win here.
const MODULE_SPECS = [
  { key: 'bridge', build: buildBridge, min: 0 },
  // The other multi-style families (bridge / commandSpike / sensorMast /
  // antenna / hangar) are also always built as individual groups for the same
  // reason: their styles are distinct multi-part, multi-material geometries.
  { key: 'commandSpike', build: buildCommandSpike, min: 0.15 },
  // weapons is not instanced: its three styles are distinct multi-part,
  // multi-material groups (see buildWeapon*), which do not batch into
  // InstancedMesh — +Z-alignment correctness + distinctness over the draw-call
  // win.
  { key: 'weapons', build: buildWeapon, min: 0.3 },
  // Nacelles are the ship's propulsion (the unified nacelle/engine system) —
  // every ship has them, so they're essential (min 0): always present when
  // enabled, not density-ramped.
  { key: 'nacelles', build: buildNacelle, min: 0 },
  { key: 'sensorMast', build: buildSensorMast, min: 0.45 },
  { key: 'antenna', build: buildAntenna, min: 0.5 },
  { key: 'hangar', build: buildHangar, min: 0.6 },
]

function moduleCount(key, p, density, maxCount) {
  if (!p.enabled) return 0
  const spec = MODULE_SPECS.find((s) => s.key === key)
  if (spec && density < spec.min) return 0
  if (maxCount <= 0) return 0
  // Essentials (min <= 0) are always present when enabled.
  if (spec && spec.min <= 0) return Math.max(1, Math.round(maxCount))
  // Others: ramp 0 -> maxCount as density rises from the module's min to 1.
  const span = Math.max(1e-6, 1 - spec.min)
  const frac = clamp((density - spec.min) / span, 0, 1)
  return Math.round(frac * maxCount)
}

// Deterministic normalized z (0..1, fore-ward) for the `count` instances of a
// module, spread evenly across the hull length. No per-instance jitter: the
// strong-symmetry bias places instances on a symmetric grid (paired counts +
// mirrored placement, see generateModules) so jitter would break the mirror.
function instanceTs(count, key, _rng) {
  const spread = {
    commandSpike: [0.6, 0.85],
    // Nacelles are biased toward MIDSHIP, away from the nose and stern tapers.
    // The spread [0.2, 0.7] keeps pods in the central 50% of the hull so their
    // pylon roots mount on the full-girth flank rather than the tapered ends
    // (where the hull retreats and the flange can lose contact). The pod-length
    // clamp in buildNacelle reads this spread.
    nacelles: [0.2, 0.7],
    weapons: [0.2, 0.85],
    sensorMast: [0.3, 0.8],
    antenna: [0.25, 0.9],
  }
  const [a, b] = spread[key] ?? [0.2, 0.8]
  const ts = []
  for (let i = 0; i < count; i++) {
    const base = count === 1 ? (a + b) / 2 : a + ((b - a) * i) / (count - 1)
    ts.push(clamp(base, 0, 1))
  }
  return ts
}

export const MODULE_CATALOG = {
  bridge: buildBridge,
  commandSpike: buildCommandSpike,
  nacelles: buildNacelle,
  weapons: buildWeapon,
  sensorMast: buildSensorMast,
  antenna: buildAntenna,
  hangar: buildHangar,
}

export function generateModules(
  params = {},
  hullInfo = {},
  { material = null, hullGroup = null, color = null, glowColor = null, accent = null } = {}
) {
  const group = new THREE.Group()
  group.name = 'modules'

  const rng = createRng(params._seed ?? 0)
  const beam = hullInfo.beam ?? DEFAULT_BEAM
  const height = hullInfo.height ?? DEFAULT_HEIGHT
  const length = hullInfo.length ?? DEFAULT_LENGTH
  const hull = {
    beam,
    height,
    length,
    noseZ: hullInfo.noseZ ?? length / 2,
    sternZ: hullInfo.sternZ ?? -length / 2,
    archetype: hullInfo.archetype ?? 'blocky',
  }

  // FIT GUARD: query the hull's real surface so module bases are seated on it
  // (not the envelope). `hullGroup` is optional — when absent (backward
  // compatible) the query falls back to the anchor/envelope estimates.
  const surface = makeSurfaceQuery(hullGroup, hullInfo)

  const mat = material ?? defaultMaterial()
  // The ship's single emissive colour (palette[3]) drives every glowing part:
  // the shared window glow, the per-module glows (command spike / sensor mast /
  // antenna / hangar), the engine glows, the weapon tips, and the glass tints.
  // One colour per ship = a coherent light signature.
  const glowMat = makeGlowMaterial(glowColor)
  // Component variant materials: 3 variants derived from the hull base colour
  // with distinct hue/saturation/brightness shifts. Module types are assigned
  // to variants by index so paired components (same type) share the same
  // variant. When no palette is provided, all modules use the shared mat.
  const variants = []
  if (color) {
    for (let vi = 0; vi < 3; vi++) {
      const v = mat.clone()
      v.color = new THREE.Color(varyModuleTone(rng, color, 0.25))
      variants.push(v)
    }
  }
  const variantFor = (idx) => (variants.length ? variants[idx % variants.length] : mat)

  const top = resolveAnchor(hullInfo.anchors, 'top', new THREE.Vector3(0, height / 2, 0))
  const bottom = resolveAnchor(hullInfo.anchors, 'bottom', new THREE.Vector3(0, -height / 2, 0))
  const port = resolveAnchor(hullInfo.anchors, 'port', new THREE.Vector3(-beam / 2, 0, 0))
  const starboard = resolveAnchor(hullInfo.anchors, 'starboard', new THREE.Vector3(beam / 2, 0, 0))
  const fore = resolveAnchor(
    hullInfo.anchors,
    'fore',
    new THREE.Vector3(0, height / 2, hull.noseZ)
  )
  const aft = resolveAnchor(
    hullInfo.anchors,
    'aft',
    new THREE.Vector3(0, height / 2, hull.sternZ)
  )

  const density = clamp(params.density ?? 0.5, 0, 1)
  const ctxBase = { mat, glowMat, hull, top, bottom, port, starboard, fore, aft, params, surface, glowColor, color, accent }

  // Strong-symmetry bias: paired modules are built as a single "half" group and
  // then mirrored across the hull centreline (X) to their port twin. Modules
  // that sit on the centreline (bridge / command spike / sensor mast / antenna /
  // hangar) are flagged userData.isCentreline by their builder and are excluded
  // from the mirror. The per-builder placement is jitter-free (see instanceTs)
  // so the mirror is exact.
  const PAIRED = new Set(['nacelles', 'weapons'])
  const moduleGroup = new THREE.Group()
  moduleGroup.name = 'modules:half'

  for (const spec of MODULE_SPECS) {
    const p = params[spec.key] ?? {}
    let maxCount =
      spec.key === 'bridge' || spec.key === 'commandSpike'
        ? Math.max(1, p.count ?? 1)
        : Math.max(0, p.count ?? 0)
    // Weapon count caps (reduce the INSTANCE count, not just per-instance
    // placement):
    //   chin/nose: tight single-point zones; cap at 2 so a high count doesn't
    //     degenerate into overlapping guns.
    //   disc belly: thin keel edge (not a broad flat bottom); cap at 1 so
    //     multiple weapons don't read as cluttered.
    if (spec.key === 'weapons') {
      if (p.position === 'chin' || p.position === 'nose') {
        maxCount = Math.min(maxCount, 2)
      } else if (p.position === 'belly' && hull.archetype === 'disc') {
        maxCount = Math.min(maxCount, 1)
      }
    }
    let count = moduleCount(spec.key, p, density, maxCount)
    if (count <= 0) continue

    // Nacelle count depends on the mount:
    //   waist -> a single pair (count 2) of LONG pods on the midship flank; the
    //            extra length comes from buildNacelle, not from more instances.
    //            The waist is NOT mirrored (it's a fixed pair, not a paired
    //            module), so count 2 gives exactly 2 world pods.
    //   aft   -> a ring of pods around the stern, whose NUMBER is capped by the
    //            real stern girth so the bank never overlaps (see aftPodRadius);
    //            the radius is clamped to the same fit in buildNacelle.
    let waistSingle = false
    if (spec.key === 'nacelles') {
      if (p.mount === 'waist') {
        // One pair: a single pod in the half-group (placed at +X by buildNacelle)
        // mirrored to the -X twin, giving exactly 2 world pods. Cap at 1 and skip
        // the paired even-count forcing (waistSingle) so buildCount stays 1.
        count = Math.min(count, 1)
        waistSingle = count > 0
      } else if (p.mount === 'aft') {
        const sternGirth = surface.girthAt(aft.z)
        const requestedRadius = Math.min(hull.beam, hull.height) * AFT_POD_RADIUS_FRAC * (p.size ?? 1)
        // Cap the per-side count (n) at 8 AND at the count that fits the stern
        // girth at the requested radius (the radius is clamped to the same fit in
        // buildNacelle), so the 2n-pod bank never overlaps.
        count = clamp(count, 1, 8)
        count = Math.min(count, maxAftN(sternGirth, requestedRadius))
      }
    }

    // Belly weapons sit on the centreline (not mirrored), so they don't need
    // the even-count forcing that paired modules use. Skip the pairing for belly
    // so count N yields exactly N instances (no doubling to the next even).
    const bellySingle = spec.key === 'weapons' && p.position === 'belly'
    // The waist nacelle is a single fixed pair (one pod per side), not a paired
    // module: skip the even-count forcing so count 1 yields buildCount 1 (one
    // pod in the half-group, mirrored to its twin).
    const paired = PAIRED.has(spec.key) && !waistSingle && !bellySingle
    // For paired modules, the config's `count` is the TOTAL number of instances
    // (e.g. 4 = 2 per side). The half-group holds one side, so divide by 2 to
    // get the per-side count. The mirror handles the symmetry — no even-count
    // forcing is needed (an odd per-side count is fine: 3 per side × 2 = 6).
    const perSide = paired ? Math.max(1, Math.ceil(count / 2)) : count
    // Centreline modules (non-paired, odd count) carry one instance on the
    // centreline (its own mirror) plus an even number off-centre.
    const centreline = !paired && count % 2 === 1
    const buildCount = centreline ? count - 1 : perSide
    const evenCount = buildCount

    const ts = instanceTs(evenCount, spec.key, rng)

    // Assign a variant material to this module type (by spec index).
    const modMat = variantFor(MODULE_SPECS.indexOf(spec))

    for (let i = 0; i < evenCount; i++) {
      // Pass the actual per-side instance count so ring mounts (aft) can spread
      // their slots across the built count, not the raw config count.
      const ctx = { ...ctxBase, mat: modMat, i, t: ts[i], n: evenCount }
      const g = spec.build(rng, ctx)
      if (g) moduleGroup.add(g)
    }

    if (centreline) {
      // A single instance on the centreline (t=0.5), which is its own mirror.
      const ctx = { ...ctxBase, mat: modMat, i: 0, t: 0.5 }
      const g = spec.build(rng, ctx)
      if (g) moduleGroup.add(g)
    }
  }

  // Mirror the half-group across the centreline to produce the symmetric pair.
  // Centreline modules (flagged via userData.isCentreline) are excluded from
  // the mirror: they sit on the hull's centreline and would overlap with their
  // own mirror twin.
  const mirrored = new THREE.Group()
  mirrored.name = 'modules:mirror'
  mirrored.scale.x = -1
  for (const child of moduleGroup.children) {
    if (child.userData?.isCentreline) {
      // Centreline module: add to the mirror group without flipping (it's
      // already symmetric). Actually, just skip it — it's already in
      // moduleGroup which is added to the ship.
      continue
    }
    const clone = child.clone()
    mirrored.add(clone)
  }
  group.add(moduleGroup)
  if (mirrored.children.length > 0) group.add(mirrored)

  return group
}
