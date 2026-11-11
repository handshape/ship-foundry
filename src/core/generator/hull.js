import * as THREE from 'three'

// HULL GEOMETRY (SP-04) — hull-body system.
//
// Contract (unchanged — the spine, modules and harnesses rely on it):
//   generateHull(hullParams) -> { group: THREE.Group, info: HullInfo }
//   HullInfo = { length, beam, height, noseZ, sternZ, anchors, archetype, body }
//   anchors  = { top, bottom, port, starboard, fore, aft }  // hull-local vectors
//   - Forward = +Z, origin at hull center (fore at +Z, aft at -Z).
//   - Anchor frame is right-handed: starboard=+X, top=+Y, fore=+Z.
//   - `group` is a Group of one or more hull-body meshes. The spine assigns the
//     shared texture material to every mesh in it (see core/generator/index.js).
//
// DESIGN — instead of one lofted tube for everything, each archetype is built
// from *actually different* base geometries (primitives), and composites
// (twin) combine several of them:
//   blocky      -> lofted slab (blunt)         sleek -> lofted (long, rounded)
//   lance       -> lofted (needle nose)        dreadnought -> lofted (broad fore)
//   saucer      -> a real DISC (lenticular) + center dome        (Enterprise / flying saucer)
//   wedge       -> a real WEDGE: planar deck keel, swept sides, pointed bow (Star Destroyer)
//   insect      -> SEGMENTED body: a chain of overlapping ellipsoid segments (arthropod)
//   twin        -> COMPOSITE: two parallel hull tubes + a connecting crossbeam (split double-hull)
//
// All bodies are deterministic given `hullParams` (no Math.random) and share a
// common `info` envelope (overall length/beam/height) + surface anchors so
// superstructure placement (SP-05) works uniformly across every body type.

export const HULL_ARCHETYPES = [
  'blocky',
  'sleek',
  'lance',
  'dreadnought',
  'saucer',
  'disc',
  'wedge',
  'insect',
  'twin',
]
export const HULL_SECTIONS = ['hex', 'ellipse', 'diamond', 'octagon']

const MIN_SCALE = 0.03
const MIN_PROFILE_PTS = 8

// --- math helpers ------------------------------------------------------------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

// Smoothly varying value through piecewise keyframes [[s, v], ...] (CCW-ordered).
function sampleCurve(stops, s) {
  if (s <= stops[0][0]) return stops[0][1]
  if (s >= stops[stops.length - 1][0]) return stops[stops.length - 1][1]
  // Global Catmull-Rom through ALL control stops (C1-continuous): the tangent
  // is continuous through every stop, so the taper eases smoothly between
  // stations instead of the old per-segment smoothstep (which reset its slope
  // to zero at each stop, producing a stepped/terracotta profile). The control
  // points are at NON-uniform s, so map s -> segment index + local fraction,
  // then evaluate the non-uniform Catmull-Rom with the surrounding stops.
  let i = 1
  while (s > stops[i][0]) i++
  const [s0, v0] = stops[i - 1]
  const [s1, v1] = stops[i]
  const f = (s - s0) / (s1 - s0)
  const p0 = stops[Math.max(0, i - 2)][1]
  const p3 = stops[Math.min(stops.length - 1, i + 1)][1]
  const f2 = f * f
  const f3 = f2 * f
  return (
    0.5 *
    (2 * v0 +
      (-p0 + v1) * f +
      (2 * p0 - 5 * v0 + 4 * v1 - p3) * f2 +
      (-p0 + 3 * v0 - 3 * v1 + p3) * f3)
  )
}

// --- cross-section profiles (for lofted bodies) ------------------------------
function chamferLoop(pts, c) {
  if (c <= 1e-4) return pts
  const n = pts.length
  const out = []
  for (let i = 0; i < n; i++) {
    const prev = pts[i]
    const next = pts[(i + 1) % n]
    const t = clamp(c, 0.05, 0.45)
    out.push(prev)
    out.push({ x: lerp(prev.x, next.x, t), y: lerp(prev.y, next.y, t) })
  }
  out.pop()
  return out
}

function regularPolygon(sides, startAngle = 0) {
  const pts = []
  for (let i = 0; i < sides; i++) {
    const a = startAngle + (2 * Math.PI * i) / sides
    pts.push({ x: 0.5 * Math.cos(a), y: 0.5 * Math.sin(a) })
  }
  return pts
}

function ellipseProfile(n) {
  const pts = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    pts.push({ x: 0.5 * Math.cos(a), y: 0.5 * Math.sin(a) })
  }
  return pts
}

const BASE_PROFILES = {
  hex: regularPolygon(6),
  ellipse: ellipseProfile(8),
  diamond: regularPolygon(4),
  octagon: regularPolygon(8),
}

// Build the closed profile (start==end) with chamfer + minimum resolution.
function buildProfile(archetype, crossSection, chamfer) {
  const base = BASE_PROFILES[crossSection] ?? BASE_PROFILES.hex
  const c = clamp(chamfer ?? 0, 0, 0.45)
  let pts = chamferLoop(base, c)
  while (pts.length < MIN_PROFILE_PTS) {
    const extra = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      extra.push(a)
      extra.push({ x: lerp(a.x, b.x, 0.5), y: lerp(a.y, b.y, 0.5) })
    }
    extra.pop()
    pts = extra
  }
  return [...pts, { x: pts[0].x, y: pts[0].y }]
}

function profileExtrema(pts) {
  let topIdx = 0
  let bottomIdx = 0
  let portIdx = 0
  let starIdx = 0
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i].y > pts[topIdx].y) topIdx = i
    if (pts[i].y < pts[bottomIdx].y) bottomIdx = i
    if (pts[i].x < pts[portIdx].x) portIdx = i
    if (pts[i].x > pts[starIdx].x) starIdx = i
  }
  return { topIdx, bottomIdx, portIdx, starIdx }
}

// Per-archetype station scale curves for LOFTED bodies. s in [0,1] maps
// z in [-L/2, L/2]; returns {x, y} multipliers on the unit profile.
const ARCHETYPE_CURVES = {
  blocky: {
    x: [[0, 0.72], [0.06, 1], [0.92, 1], [1, 0.8]],
    y: [[0, 0.9], [0.08, 1], [0.9, 1], [1, 0.92]],
  },
  sleek: {
    x: [[0, 0.18], [0.25, 0.85], [0.4, 1], [0.62, 0.92], [0.85, 0.55], [1, 0.12]],
    y: [[0, 0.3], [0.2, 0.8], [0.4, 1], [0.62, 0.85], [0.85, 0.5], [1, 0.25]],
  },
  lance: {
    x: [[0, 0.68], [0.12, 0.95], [0.3, 1], [0.95, 0.98], [1, 0.98]],
    y: [[0, 0.82], [0.12, 0.98], [0.3, 1], [0.95, 0.92], [1, 0.8]],
  },
  dreadnought: {
    x: [[0, 0.3], [0.15, 0.7], [0.35, 0.95], [0.55, 1], [0.9, 1], [1, 0.95]],
    y: [[0, 0.4], [0.15, 0.8], [0.35, 0.95], [0.55, 1], [0.9, 0.98], [1, 0.9]],
  },
  twin: {
    // Each twin tube: full at midship, tapered toward both ends.
    x: [[0, 0.25], [0.2, 1], [0.8, 1], [1, 0.25]],
    y: [[0, 0.4], [0.25, 1], [0.75, 1], [1, 0.4]],
  },
}

function stationScales(archetype, s) {
  const curve = ARCHETYPE_CURVES[archetype] ?? ARCHETYPE_CURVES.blocky
  return {
    sx: Math.max(MIN_SCALE, sampleCurve(curve.x, s)),
    sy: Math.max(MIN_SCALE, sampleCurve(curve.y, s)),
  }
}

// --- body builders (each returns a THREE.Mesh in hull-local space) -----------

// Lofted tube: sweeps a cross-section profile along +Z with per-station taper.
function buildLofted(archetype, params, profile, m, halfLen) {
  const { beam, height, stations, centerY, noseTaper, sternTaper } = params
  const ringCount = stations + 1
  const positions = new Float32Array(ringCount * m * 3)
  const uvs = new Float32Array(ringCount * m * 2)
  const indices = []

  // Cumulative arc length for UV.u (girth fraction).
  const segLen = []
  let totalLen = 0
  for (let i = 0; i < m; i++) {
    const a = profile[i]
    const b = profile[(i + 1) % m]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    segLen.push(d)
    totalLen += d
  }
  const cumU = [0]
  for (let i = 0; i < m; i++) cumU.push(cumU[i] + segLen[i] / totalLen)

  const sternShrink = 1 - 0.55 * sternTaper
  // Nose: instead of shrinking to a finite ring (1 - 0.55*noseTaper) and capping
  // it flat — which reads as a snub/blunt nose — the last portion of the hull
  // tapers toward a NEAR-POINT. The nose tip radius (fraction of full girth)
  // shrinks with noseTaper: 0 = a full rounded nose to a point, 1 = a sharp
  // needle. A small floor (NOSE_TIP_MIN) keeps it from degenerating to a true
  // zero-radius point (which would collapse the cap fan and cause shading
  // artifacts); the rounded nose cap below closes that small opening smoothly.
  const NOSE_TIP_MIN = 0.04
  const noseTipR = lerp(0.22, NOSE_TIP_MIN, clamp(noseTaper, 0, 1))
  // The nose taper occupies the final NNOSE rings (the "cutoff" region). More
  // rings = a longer, smoother taper.
  const nNose = Math.max(3, Math.round(stations * 0.22))

  for (let j = 0; j < ringCount; j++) {
    const s = j / stations
    const z = -halfLen + s * (2 * halfLen)
    const { sx, sy } = stationScales(archetype, s)
    let endShrink
    if (s < 0.5) {
      endShrink = lerp(sternShrink, 1, smoothstep(0, 0.5, s))
    } else {
      // Fore half: ease from full (s=0.5) toward the nose tip radius over the
      // final nNose rings. Use a cosine ease so the taper is smooth (C1) into
      // the tip — this is the "smooth cutoff curve" that removes the snub nose.
      const noseFrac = clamp((s - 0.5) / 0.5, 0, 1) // 0 at midship .. 1 at tip
      const cutoff = 1 - (nNose - 1) / stations // s where the nose taper begins
      if (noseFrac <= cutoff / 1.0) {
        // Before the cutoff region: stay at full scale.
        endShrink = 1
      } else {
        // Within the cutoff: ease 1 -> noseTipR with a smoothstep.
        const t = clamp((noseFrac - cutoff) / (1 - cutoff), 0, 1)
        endShrink = lerp(1, noseTipR, smoothstep(0, 1, t))
      }
    }
    const finalSx = sx * endShrink
    const finalSy = sy * endShrink
    for (let i = 0; i < m; i++) {
      const p = profile[i]
      const idx = (j * m + i) * 3
      positions[idx] = p.x * beam * finalSx
      positions[idx + 1] = p.y * height * finalSy + centerY
      positions[idx + 2] = z
      uvs[(j * m + i) * 2] = s
      uvs[(j * m + i) * 2 + 1] = cumU[i]
    }
  }

  // Side quads (two triangles each), wrapping i 0..m-1 back to 0.
  for (let j = 0; j < ringCount - 1; j++) {
    for (let i = 0; i < m; i++) {
      const i1 = (i + 1) % m
      const a = j * m + i
      const b = j * m + i1
      const c = (j + 1) * m + i1
      const d = (j + 1) * m + i
      indices.push(a, b, c)
      indices.push(a, c, d)
    }
  }

  // --- End caps -------------------------------------------------------------
  // NOSE: a ROUNDED dome cap. The lofted body now tapers to a small near-point
  // ring (radius noseTipR * girth). Instead of capping that ring flat (a snub
  // face), we add a short dome: one extra ring slightly beyond the tip, scaled
  // down and pushed forward, then a single apex vertex. This forms a smooth
  // hemispherical closure so the nose reads as rounded, not blunt.
  // STERN: kept as a flat fan (blunt/flat sterns are a common, intentional
  // silhouette — e.g. blocky military hulls).
  const noseRing = ringCount - 1
  // Nose ring center (the small near-point ring the body tapers to).
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < m; i++) {
    const idx = (noseRing * m + i) * 3
    nx += positions[idx]
    ny += positions[idx + 1]
    nz += positions[idx + 2]
  }
  nx /= m
  ny /= m
  nz /= m
  // Dome apex: pushed a short distance beyond the nose ring, along +Z. The
  // dome height scales with the nose ring radius so a sharper nose (smaller
  // tip) gets a proportionally smaller dome.
  const noseRingR = Math.sqrt(
    positions[(noseRing * m) * 3] ** 2 * 0 +
      (positions[(noseRing * m) * 3] - nx) ** 2 +
      (positions[(noseRing * m) * 3 + 1] - ny) ** 2
  )
  const domeH = Math.max(noseRingR * 1.2, 0.15)
  const apex = [nx, ny, nz + domeH]
  // One intermediate dome ring: halfway to the apex, scaled to ~0.6 of the
  // nose ring radius, so the dome has a curved (2-band) profile, not a cone.
  const domeMidR = 0.6
  const domeMidZ = nz + domeH * 0.45
  const domeMid = []
  for (let i = 0; i < m; i++) {
    const idx = (noseRing * m + i) * 3
    const px = positions[idx]
    const py = positions[idx + 1]
    const rx = px - nx
    const ry = py - ny
    domeMid.push([nx + rx * domeMidR, ny + ry * domeMidR, domeMidZ])
  }

  // Vertex layout: base lofted verts, then dome mid-ring (m verts), then dome
  // apex (1 vert), then stern center (1 vert).
  const baseVertCount = ringCount * m
  const domeMidBase = baseVertCount
  const domeApex = baseVertCount + m
  const sternCenter = baseVertCount + m + 1
  const totalVerts = baseVertCount + m + 2
  const posArr = new Float32Array(totalVerts * 3)
  const uvArr = new Float32Array(totalVerts * 2)
  posArr.set(positions)
  uvArr.set(uvs)
  for (let i = 0; i < m; i++) {
    posArr.set(domeMid[i], (domeMidBase + i) * 3)
    uvArr.set([1, cumU[i]], (domeMidBase + i) * 2)
  }
  posArr.set(apex, domeApex * 3)
  uvArr.set([1, 0.5], domeApex * 2)
  // Stern center (flat fan cap).
  let sx2 = 0
  let sy2 = 0
  let sz2 = 0
  for (let i = 0; i < m; i++) {
    const idx = i * 3
    sx2 += positions[idx]
    sy2 += positions[idx + 1]
    sz2 += positions[idx + 2]
  }
  sx2 /= m
  sy2 /= m
  sz2 /= m
  posArr.set([sx2, sy2, sz2], sternCenter * 3)
  uvArr.set([0, 0.5], sternCenter * 2)

  // Nose dome: band 1 = nose ring -> dome mid ring (quads), band 2 = dome mid
  // ring -> apex (triangles). Profile is CCW as seen from +Z; winding is
  // chosen so the dome faces +Z (outward, visible with backface culling).
  for (let i = 0; i < m; i++) {
    const i1 = (i + 1) % m
    // Band 1: noseRing[i] -> noseRing[i1] -> domeMid[i1] -> domeMid[i]
    const a = noseRing * m + i
    const b = noseRing * m + i1
    const c = domeMidBase + i1
    const d = domeMidBase + i
    indices.push(a, b, c)
    indices.push(a, c, d)
    // Band 2: domeMid[i] -> domeMid[i1] -> apex
    const e = domeMidBase + i
    const f = domeMidBase + i1
    indices.push(e, f, domeApex)
  }
  // Stern fan (facing -Z).
  for (let i = 0; i < m; i++) {
    const i1 = (i + 1) % m
    const a = i
    const b = i1
    indices.push(sternCenter, b, a)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry)
  mesh.name = 'hull'
  return mesh
}

// Disc archetype: a solid of revolution. The upper and lower surfaces are each
// the revolution of a smooth curve (convex or concave) around the Y axis. The
// disc's flat faces point up/down (Y), and the travel direction (+Z) lies in
// the disc's plane. Built as a LatheGeometry from a bottom-to-top 2D profile
// (X = radius, Y = height) for correct outward-facing normals.
function buildDiscSolid(params, discParams = {}) {
  const { beam, height, length } = params
  const g = new THREE.Group()
  g.name = 'hull'

  const radius = beam / 2
  const upperCurve = discParams.upperCurve === 'concave' ? 'concave' : 'convex'
  const lowerCurve = discParams.lowerCurve === 'concave' ? 'concave' : 'convex'
  const upperPeak = height * 0.5
  const lowerPeak = height * 0.5
  const upperEdgeY = height * 0.12
  const lowerEdgeY = -height * 0.12

  // Profile traced bottom-to-top (required for outward normals in LatheGeometry):
  // lower surface center→edge, up the edge, upper surface edge→center.
  const N = 32
  const points = []
  // Lower surface: center (r=0, y=-lowerPeak) to edge (r=radius, y=lowerEdgeY).
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const r = t * radius
    let y
    if (lowerCurve === 'convex') {
      y = lowerEdgeY - (lowerPeak - Math.abs(lowerEdgeY)) * Math.cos(t * Math.PI * 0.5)
    } else {
      y = lowerEdgeY - (lowerPeak - Math.abs(lowerEdgeY)) * Math.pow(1 - t, 2)
    }
    points.push(new THREE.Vector2(r, y))
  }
  // Upper surface: edge (r=radius, y=upperEdgeY) to center (r=0, y=upperPeak).
  for (let i = N; i >= 0; i--) {
    const t = i / N
    const r = t * radius
    let y
    if (upperCurve === 'convex') {
      y = upperEdgeY + (upperPeak - upperEdgeY) * Math.cos(t * Math.PI * 0.5)
    } else {
      y = upperEdgeY + (upperPeak - upperEdgeY) * Math.pow(1 - t, 2)
    }
    points.push(new THREE.Vector2(r, y))
  }

  const lathe = new THREE.LatheGeometry(points, 48)
  // The lathe axis is Y (up). The disc's flat faces already point up/down and
  // its diameter spans the X-Z plane — no rotation needed. Stretch Z so the
  // disc spans a fraction of the ship's length (the lathe's natural Z extent
  // is the full diameter = beam).
  const zScale = (length * 0.8) / beam
  const mesh = new THREE.Mesh(lathe)
  mesh.scale.set(1, 1, zScale)
  mesh.name = 'hull:disc:solid'
  g.add(mesh)

  return g
}

// Disc / lenticular body (flying saucer, Enterprise saucer): a flat lens formed
// from a scaled sphere, plus a center dome on top.
function buildDisc(params) {
  const { beam, height, length } = params
  const g = new THREE.Group()
  g.name = 'hull'

  const disc = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24))
  disc.scale.set(beam / 2, height / 2, length * 0.5)
  disc.name = 'hull:disc'
  g.add(disc)

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2))
  dome.scale.set(beam * 0.22, height * 0.28, beam * 0.22)
  dome.position.set(0, height * 0.2, length * 0.12)
  dome.name = 'hull:dome'
  g.add(dome)

  return g
}

// Wedge body (Star Destroyer): a flat-decked, keeled slab that tapers to a
// pointed bow. Built by lofting a flat-bottomed profile to a near-point at the
// nose, with a long, blunt stern.
function buildWedge(params, profile, m, halfLen) {
  const { beam, height, stations, centerY } = params
  const ringCount = stations + 1
  const positions = new Float32Array(ringCount * m * 3)
  const uvs = new Float32Array(ringCount * m * 2)
  const indices = []

  for (let j = 0; j < ringCount; j++) {
    const s = j / stations // 0 = stern (-Z), 1 = bow (+Z)
    const z = -halfLen + s * (2 * halfLen)
    // Beam: full at the stern, tapering to a point at the bow.
    const sx = Math.max(MIN_SCALE, lerp(1, 0.04, Math.pow(s, 1.1)))
    // Height: a flat deck near the top, a keel at the bottom; the whole section
    // shrinks slightly toward the bow for a clean pointed tip.
    const sy = Math.max(MIN_SCALE, lerp(1, 0.12, s))
    for (let i = 0; i < m; i++) {
      const p = profile[i]
      const idx = (j * m + i) * 3
      positions[idx] = p.x * beam * sx
      positions[idx + 1] = p.y * height * sy + centerY
      positions[idx + 2] = z
      uvs[(j * m + i) * 2] = s
      uvs[(j * m + i) * 2 + 1] = (i / m)
    }
  }

  for (let j = 0; j < ringCount - 1; j++) {
    for (let i = 0; i < m; i++) {
      const i1 = (i + 1) % m
      const a = j * m + i
      const b = j * m + i1
      const c = (j + 1) * m + i1
      const d = (j + 1) * m + i
      indices.push(a, b, c)
      indices.push(a, c, d)
    }
  }

  // End caps (same outward winding as the lofted body).
  const baseVertCount = ringCount * m
  const noseCenter = baseVertCount
  const sternCenter = baseVertCount + 1
  const totalVerts = baseVertCount + 2
  const posArr = new Float32Array(totalVerts * 3)
  const uvArr = new Float32Array(totalVerts * 2)
  posArr.set(positions)
  uvArr.set(uvs)

  const noseRing = ringCount - 1
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < m; i++) {
    const idx = (noseRing * m + i) * 3
    nx += posArr[idx]
    ny += posArr[idx + 1]
    nz += posArr[idx + 2]
  }
  nx /= m
  ny /= m
  nz /= m
  posArr.set([nx, ny, nz], noseCenter * 3)
  uvArr.set([1, 0.5], noseCenter * 2)

  let sx2 = 0
  let sy2 = 0
  let sz2 = 0
  for (let i = 0; i < m; i++) {
    const idx = i * 3
    sx2 += posArr[idx]
    sy2 += posArr[idx + 1]
    sz2 += posArr[idx + 2]
  }
  sx2 /= m
  sy2 /= m
  sz2 /= m
  posArr.set([sx2, sy2, sz2], sternCenter * 3)
  uvArr.set([0, 0.5], sternCenter * 2)

  for (let i = 0; i < m; i++) {
    const i1 = (i + 1) % m
    const a = noseRing * m + i
    const b = noseRing * m + i1
    indices.push(noseCenter, a, b)
  }
  for (let i = 0; i < m; i++) {
    const i1 = (i + 1) % m
    const a = i
    const b = i1
    indices.push(sternCenter, b, a)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry)
  mesh.name = 'hull'
  return mesh
}

// Segmented / insect body: a distinct head, thorax, and abdomen, each with a
// clear upper/lower carapace split. The three regions read as a proper
// arthropod:
//   abdomen (stern half): a tapered, multi-segmented tail with 4 overlapping
//     dorsal plate ellipsoids (upper carapace) — reads as a segmented tail.
//   thorax (middle): a broad, boxy segment with a flat dorsal plate (upper
//     carapace) and a ventral plate (lower carapace), connected by side
//     struts. The widest part of the body.
//   head (fore): a compact, faceted cap with a distinct dorsal ridge — reads
//     as a head distinct from the thorax.
function buildInsect(params) {
  const { beam, height, length } = params
  const g = new THREE.Group()
  g.name = 'hull'
  const halfLen = length / 2

  // --- Region boundaries (Z positions) ----------------------------------------
  // The body is divided into three regions along Z. The head is at the fore
  // (+Z), the abdomen at the stern (-Z), and the thorax in the middle.
  const headStart = halfLen * 0.35   // head: [headStart, +halfLen]
  const thoraxStart = halfLen * 0.05 // thorax: [thoraxStart, headStart]
  // abdomen: [-halfLen, thoraxStart]

  // --- Abdomen: 4 overlapping dorsal plate ellipsoids -------------------------
  // The abdomen is the stern half. It's built from 4 overlapping ellipsoids
  // that taper toward the stern tip. Each ellipsoid is the upper carapace
  // (dorsal plate) — the lower side is implied by the overlap.
  const abdCount = 4
  const abdLen = thoraxStart + halfLen // total abdomen length
  const abdSegLen = (abdLen / abdCount) * 0.85 // each segment's Z radius (overlap)
  const abdStep = (abdLen - abdSegLen) / (abdCount - 1) // spacing between centers
  for (let k = 0; k < abdCount; k++) {
    const t = abdCount === 1 ? 0.5 : k / (abdCount - 1) // 0 = stern, 1 = fore
    // First segment centered so its back face reaches the stern tip; last
    // segment centered so its front face reaches thoraxStart.
    const z = -halfLen + abdSegLen + k * abdStep
    // Taper: smaller at the stern, fuller toward the thorax. The minimum taper
    // (0.6) keeps the stern wide enough for aft-mounted engines to sit on.
    const taper = 0.6 + 0.4 * t
    const r = beam * 0.45 * taper
    const h = height * 0.42 * taper
    const plate = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14))
    plate.scale.set(r, h, abdSegLen)
    plate.position.set(0, h * 0.15, z) // slightly above centreline (dorsal)
    plate.name = `hull:abdomen:${k}`
    g.add(plate)
  }

  // --- Thorax: broad boxy segment with dorsal + ventral plates ---------------
  // The thorax is the widest part. It has a flat dorsal plate (upper
  // carapace) and a ventral plate (lower carapace), connected by side struts.
  const thoraxLen = headStart - thoraxStart
  const thoraxR = beam * 0.48
  const thoraxH = height * 0.42
  const plateThick = height * 0.12
  // Dorsal plate (upper carapace): a flat, wide ellipsoid on top.
  const dorsal = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12))
  dorsal.scale.set(thoraxR, plateThick * 0.5, thoraxLen * 0.55)
  dorsal.position.set(0, thoraxH * 0.85, (thoraxStart + headStart) / 2)
  dorsal.name = 'hull:thorax:dorsal'
  g.add(dorsal)
  // Ventral plate (lower carapace): a flat, slightly narrower ellipsoid below.
  const ventral = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12))
  ventral.scale.set(thoraxR * 0.85, plateThick * 0.4, thoraxLen * 0.5)
  ventral.position.set(0, -thoraxH * 0.75, (thoraxStart + headStart) / 2)
  ventral.name = 'hull:thorax:ventral'
  g.add(ventral)
  // Side hull fill: a box connecting the dorsal
  // and ventral plates on the sides).
  const fill = new THREE.Mesh(new THREE.BoxGeometry(thoraxR * 1.6, thoraxH * 0.9, thoraxLen * 0.9))
  fill.position.set(0, 0, (thoraxStart + headStart) / 2)
  fill.name = 'hull:thorax:fill'
  g.add(fill)

  // --- Head: compact faceted cap with dorsal ridge ---------------------------
  // The head is a distinct, smaller region at the fore. It has a faceted
  // (diamond-shaped) main body and a dorsal ridge.
  const headLen = halfLen - headStart
  const headR = beam * 0.35
  const headH = height * 0.35
  const headCz = (headStart + halfLen) / 2
  // Main head body: an octahedron (faceted, reads as a distinct head).
  const headBody = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0))
  headBody.scale.set(headR, headH, headLen * 0.5)
  headBody.position.set(0, 0, headCz)
  headBody.name = 'hull:head:body'
  g.add(headBody)
  // Dorsal ridge: a small elongated ellipsoid on top of the head.
  const ridge = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8))
  ridge.scale.set(headR * 0.3, headH * 0.25, headLen * 0.4)
  ridge.position.set(0, headH * 0.9, headCz)
  ridge.name = 'hull:head:ridge'
  g.add(ridge)
  // Head-to-thorax connector: a tapered cylinder bridging the head and the
  // thorax dorsal plate.
  const conn = new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.6, thoraxR * 0.7, headStart - thoraxStart + headLen * 0.3, 8))
  conn.rotation.x = Math.PI / 2
  conn.position.set(0, thoraxH * 0.4, headStart + headLen * 0.1)
  conn.name = 'hull:head:connector'
  g.add(conn)

  return g
}

// Twin / split double-hull composite: two parallel lofted tubes (offset in X)
// joined by a central crossbeam. A genuine composite of several primitives.
// The proportions below are shared with modules.js (weapon/nacelle placement)
// so the surface queries match the actual geometry.
export const TWIN_TUBE_OFFSET = 0.28 // X offset of each tube from centreline (× beam)
export const TWIN_TUBE_BEAM = 0.42   // tube beam (× hull beam)
export const TWIN_TUBE_HEIGHT = 0.7  // tube height (× hull height)
export const TWIN_CROSSBEAM_W = 0.5  // crossbeam width (× hull beam)
export const TWIN_CROSSBEAM_H = 0.28 // crossbeam height (× hull height)
export const TWIN_CROSSBEAM_L = 0.4  // crossbeam length (× hull length)

function buildTwin(params, profile, m, halfLen) {
  const { beam, height, length } = params
  const g = new THREE.Group()
  g.name = 'hull'
  const offset = beam * TWIN_TUBE_OFFSET
  const tubeBeam = beam * TWIN_TUBE_BEAM
  const tubeHeight = height * TWIN_TUBE_HEIGHT

  const mk = (x, name) => {
    const tube = buildLofted(
      'twin',
      { ...params, beam: tubeBeam, height: tubeHeight, centerY: 0 },
      profile,
      m,
      halfLen,
    )
    tube.position.x = x
    tube.name = name
    return tube
  }
  g.add(mk(-offset, 'hull:tube:port'))
  g.add(mk(offset, 'hull:tube:starboard'))

  const beamMesh = new THREE.Mesh(
    new THREE.BoxGeometry(beam * TWIN_CROSSBEAM_W, height * TWIN_CROSSBEAM_H, length * TWIN_CROSSBEAM_L),
  )
  beamMesh.name = 'hull:crossbeam'
  g.add(beamMesh)

  return g
}

// --- anchors (hull-local, on the envelope surface) ---------------------------

function buildAnchors(info, { topY, bottomY, foreZ, aftZ }) {
  const { beam } = info
  return {
    top: new THREE.Vector3(0, topY, 0),
    bottom: new THREE.Vector3(0, bottomY, 0),
    port: new THREE.Vector3(-beam / 2, 0, 0),
    starboard: new THREE.Vector3(beam / 2, 0, 0),
    fore: new THREE.Vector3(0, topY * 0.4, foreZ),
    aft: new THREE.Vector3(0, 0, aftZ),
  }
}

// --- main --------------------------------------------------------------------

export function generateHull(params = {}) {
  const length = clamp(params.length ?? 40, 4, 500)
  const beam = clamp(params.beam ?? 14, 2, 500)
  const height = clamp(params.height ?? 8, 1, 500)
  const crossSection = HULL_SECTIONS.includes(params.crossSection) ? params.crossSection : 'hex'
  const archetype = HULL_ARCHETYPES.includes(params.archetype) ? params.archetype : 'blocky'
  const stations = clamp(Math.round(params.stations ?? 12), 4, 64)
  const chamfer = clamp(params.chamfer ?? 0.15, 0, 1)

  const halfLen = length / 2
  const centerY = ((clamp(params.deckOffset ?? 0, 0, 1) - clamp(params.keelOffset ?? 0, 0, 1)) / 2) * (height / 2)

  const resolved = {
    length,
    beam,
    height,
    crossSection,
    stations,
    chamfer,
    centerY,
    noseTaper: clamp(params.noseTaper ?? 0.5, 0, 1),
    sternTaper: clamp(params.sternTaper ?? 0.35, 0, 1),
  }

  const profile = buildProfile(archetype, crossSection, chamfer)
  const m = profile.length - 1
  const { topIdx, bottomIdx } = profileExtrema(profile)
  const topFrac = profile[topIdx].y * 2 // ~1 for most profiles (unit half-extent 0.5)
  const bottomFrac = profile[bottomIdx].y * 2

  // Disc archetype params (upper/lower curve shape + edge shape).
  const discUpperCurve = params.discUpperCurve === 'concave' ? 'concave' : 'convex'
  const discLowerCurve = params.discLowerCurve === 'concave' ? 'concave' : 'convex'
  const discEdge = params.discEdge === 'frustum' ? 'frustum' : 'cylinder'

  // Per-archetype body construction.
  let group
  switch (archetype) {
    case 'saucer':
      group = buildDisc(resolved)
      break
    case 'disc':
      group = buildDiscSolid(resolved, { upperCurve: discUpperCurve, lowerCurve: discLowerCurve, edge: discEdge })
      break
    case 'wedge':
      group = new THREE.Group()
      group.add(buildWedge(resolved, profile, m, halfLen))
      break
    case 'insect':
      group = buildInsect(resolved)
      break
    case 'twin':
      group = buildTwin(resolved, profile, m, halfLen)
      break
    case 'blocky':
    case 'sleek':
    case 'lance':
    case 'dreadnought':
    default:
      group = new THREE.Group()
      group.add(buildLofted(archetype, resolved, profile, m, halfLen))
      break
  }

  // Envelope + anchors shared by every body type.
  const info = {
    length,
    beam,
    height,
    noseZ: halfLen,
    sternZ: -halfLen,
    archetype,
    body: archetype,
  }
  info.anchors = buildAnchors(info, {
    topY: topFrac * (height / 2) + centerY,
    bottomY: bottomFrac * (height / 2) + centerY,
    foreZ: halfLen,
    aftZ: -halfLen,
  })

  // Twin hull: the top/bottom anchors must point to the crossbeam (the only
  // surface at x=0), not the tube extrema. The tubes are offset in X; modules
  // placed at the centreline need the crossbeam height.
  if (archetype === 'twin') {
    const crossH = height * 0.14
    info.anchors.top.set(0, crossH + centerY, 0)
    info.anchors.bottom.set(0, -crossH + centerY, 0)
  }

  return { group, info }
}
