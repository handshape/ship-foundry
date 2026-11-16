import * as THREE from 'three'

// CUBIC B-SPLINE (NURBS, unit weights) — pure, deterministic surface math.
//
// The installed three.js ships no NURBS classes, so this module provides the
// minimum needed by the skin hull archetypes (see hull.js):
//   - clampedBasis  : cubic B-spline basis weights (clamped / open uniform)
//   - periodicBasis : cubic B-spline basis weights (periodic / closed uniform)
//   - createSurface : a cubic B-spline surface over a [S][G] control cage
//   - tessellate    : the surface -> BufferGeometry (positions, uv, index,
//                     smooth normals) using the hull UV convention
//
// The basis uses the TRUNCATED-POWER (Blossom) formulation, a clean closed
// form for the uniform cubic B-spline:
//   B_i(u) = (u-i+3)_+^3/6 - 4(u-i+2)_+^3/6 + 6(u-i+1)_+^3/6 - (u-i)_+^3/6
// where (x)_+ = max(x, 0). For a clamped (open) knot vector this is exact and
// the curve passes through the first/last control points; for a periodic
// (closed) curve the same formula is evaluated with the index space wrapped
// modulo the control count.
//
// Invariants relied on by the caller (the skin builders in hull.js):
//   - u (the first param) is CLAMPED: s=0 sits on the first control ring and
//     s=1 on the last, so the tessellated ends coincide with the terminal
//     control rings (the builders collapse those rings to close the skin).
//   - v (the second param) is PERIODIC: the surface wraps around the girth
//     with a duplicated seam column (the loft UV convention: uv.x = length
//     fraction, uv.y = girth fraction).
//   - Every function is pure and deterministic: no Math.random, no globals.
//
// A uniform cubic B-spline stays inside the convex hull of each 4x4 patch of
// control points, so a control cage that stays away from the hull axis keeps
// the surface away from it too (no self-intersection through the axis).

// Tessellation density for skin hulls. These are the skin's equivalent of the
// lofted hull's `stations`; skins ignore the configured station count and
// always use these (dense enough that the module surface query's z-bins are
// filled across the whole skin).
export const SKIN_RINGS = 200 // longitudinal stations (u direction); must be
  // >= the module surface query's NBINS (200) so every z-bin gets at least one
  // tessellation ring (the freeform sector table requires non-empty bins).
export const SKIN_GIRTH = 48 // girth samples per loop (v direction); dense
  // enough that every 15° origin sector (FREEFORM_SECTORS=24) is populated by
  // at least one girth sample at every z-bin (the freeform sector table
  // requires non-empty sectors for the origin-ray surfaceRadiusAt query).

// The four cubic B-spline basis values on the local parameter f in [0, 1) for
// the four active control points (in order). These are the classical
// uniform cubic B-spline cardinal basis functions:
//   B0(f) = (1-f)^3/6
//   B1(f) = (3f^3 - 6f^2 + 4)/6
//   B2(f) = (-3f^3 + 3f^2 + 3f + 1)/6
//   B3(f) = f^3/6
function basis4Local(f) {
  const f2 = f * f
  const f3 = f2 * f
  return [
    (1 - f) ** 3 / 6,
    (3 * f3 - 6 * f2 + 4) / 6,
    (-3 * f3 + 3 * f2 + 3 * f + 1) / 6,
    f3 / 6,
  ]
}

// Cubic B-spline basis weights over `n` control points at parameter `t` in
// [0, 1], for the CLAMPED (open) uniform spline. t=0 is on control point 0,
// t=1 on control point n-1. The parameter space has (n - 4) spans; the
// control indices for span s (s = 0..n-5) are [s, s+1, s+2, s+3] clamped to
// [0, n-1] (the clamped knot vector shares the first/last three control
// points across the end spans). Returns a Float64Array of length n.
function clampedBasis(n, t) {
  const w = new Float64Array(n)
  const span = n - 4 // number of spans in the open uniform cubic spline
  const u = Math.max(0, Math.min(span, t * span))
  const s = Math.max(0, Math.min(span - 1, Math.floor(u)))
  const f = u - s
  const [b0, b1, b2, b3] = basis4Local(f)
  const idx = (j) => Math.max(0, Math.min(n - 1, s + j))
  w[idx(0)] += b0
  w[idx(1)] += b1
  w[idx(2)] += b2
  w[idx(3)] += b3
  return w
}

// Cubic B-spline basis weights over `n` control points at parameter `t` in
// [0, 1], for the PERIODIC (closed) uniform spline. The curve wraps around all
// `n` control points (t=1 is the same as t=0). The parameter space has `n`
// spans; the four active control indices are [k-3, k-2, k-1, k] wrapped
// modulo n, where k = floor(t * n). Returns a Float64Array of length n.
function periodicBasis(n, t) {
  const w = new Float64Array(n)
  // Periodic: the curve wraps around all n controls; t in [0,1] -> u in [0, n).
  const u = ((t * n) % n + n) % n
  const k = Math.floor(u)
  const f = u - k
  const [b0, b1, b2, b3] = basis4Local(f)
  w[((k - 3) % n + n) % n] = b0
  w[((k - 2) % n + n) % n] = b1
  w[((k - 1) % n + n) % n] = b2
  w[k % n] = b3
  return w
}

// Evaluate a cubic B-spline surface over a `rows x cols` cage of THREE.Vector3
// control points (row = u/lengthwise station, col = v/girth). Returns
// { point(s, g) } evaluating the surface at (s, g) in [0, 1]^2. The u
// direction is clamped; the v direction is periodic.
export function createSurface(cage, { periodicV = true } = {}) {
  const rows = cage.length
  const cols = cage[0].length
  return {
    point(s, g) {
      const ws = clampedBasis(rows, s)
      let x = 0
      let y = 0
      let z = 0
      for (let i = 0; i < rows; i++) {
        const wsI = ws[i]
        if (wsI === 0) continue
        const row = cage[i]
        const wg = periodicV ? periodicBasis(cols, g) : clampedBasis(cols, g)
        for (let j = 0; j < cols; j++) {
          const wj = wsI * wg[j]
          if (wj === 0) continue
          const p = row[j]
          x += wj * p.x
          y += wj * p.y
          z += wj * p.z
        }
      }
      return [x, y, z]
    },
  }
}

// Tessellate a B-spline surface into a BufferGeometry following the hull UV
// convention (uv.x = length fraction 0..1 stern->nose, uv.y = girth fraction).
// The girth seam column (v=1) duplicates v=0 so the texture wraps cleanly.
//   rings : number of longitudinal stations (u) — the surface is sampled at
//           u = 0..1 inclusive (rings+1 rows of vertices).
//   girth : girth samples per loop (v) — girth+1 columns per row (seam dup).
//   caps  : when true, add a flat fan cap over each open terminal ring (the
//           clamped B-spline ends at a finite ring, not a point, so the skin
//           has a small open disc at each end; the cap closes it).
export function tessellate(surface, { rings, girth, caps = false } = {}) {
  const rows = rings + 1
  const cols = girth + 1
  const baseVerts = rows * cols
  const totalVerts = caps ? baseVerts + 2 : baseVerts
  const positions = new Float32Array(totalVerts * 3)
  const uvs = new Float32Array(totalVerts * 2)
  const indices = []
  for (let r = 0; r < rows; r++) {
    const s = r / rings
    for (let c = 0; c < cols; c++) {
      // The last column (c = girth) is the duplicated seam: it samples the
      // SAME surface point as c = 0 (periodic), but carries uv.v = 1 so the
      // texture wraps cleanly across the seam.
      const g = (c % girth) / girth
      const [x, y, z] = surface.point(s, g)
      const idx = (r * cols + c) * 3
      positions[idx] = x
      positions[idx + 1] = y
      positions[idx + 2] = z
      uvs[(r * cols + c) * 2] = s
      uvs[(r * cols + c) * 2 + 1] = c === girth ? 1 : g
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < girth; c++) {
      const a = r * cols + c
      const b = r * cols + c + 1
      const d = (r + 1) * cols + c
      const e = (r + 1) * cols + c + 1
      // Outward winding: the cage is CCW around +Z (seen from +Z) and the
      // surface normal must point away from the hull axis (outward). With
      // vertex row r (u) and column c (v), the quad (a, b, e, d) is wound so
      // that (a, b, e) and (a, e, d) face outward (away from the axis).
      indices.push(a, b, e)
      indices.push(a, e, d)
    }
  }
  // Flat fan caps over the open terminal rings (the clamped B-spline ends at
  // a finite ring, not a point, leaving a small open disc at each end). The
  // cap center is the ring's centroid; the fan triangles are wound to face
  // outward (stern cap faces -Z, nose cap faces +Z).
  if (caps) {
    const ringCenter = (r) => {
      let cx = 0, cy = 0, cz = 0
      for (let c = 0; c < girth; c++) {
        const i = (r * cols + c) * 3
        cx += positions[i]
        cy += positions[i + 1]
        cz += positions[i + 2]
      }
      return [cx / girth, cy / girth, cz / girth]
    }
    // Stern cap (r = 0): center vertex + fan facing -Z (outward at the stern).
    // The ring is CCW around +Z; a fan (center, next, current) has normal
    // (next-current) × (center-current) = -Z, so this winding faces -Z.
    const sternC = ringCenter(0)
    positions.set(sternC, baseVerts * 3)
    uvs.set([0.5, 0.5], baseVerts * 2)
    for (let c = 0; c < girth; c++) {
      const c1 = (c + 1) % girth
      indices.push(baseVerts, c1, c)
    }
    // Nose cap (r = rows-1): center vertex + fan facing +Z (outward at the
    // nose). A fan (center, current, next) has normal (current-next) ×
    // (center-next) = +Z, so this winding faces +Z.
    const noseC = ringCenter(rows - 1)
    const noseIdx = baseVerts + 1
    positions.set(noseC, noseIdx * 3)
    uvs.set([0.5, 0.5], noseIdx * 2)
    for (let c = 0; c < girth; c++) {
      const c1 = (c + 1) % girth
      indices.push(noseIdx, (rows - 1) * cols + c, (rows - 1) * cols + c1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

// Build a smooth, seeded radial displacement field over a [rows][cols] cage:
// displacement[col][row] = amplitude * smooth 2D field. The field is a sum of
// a few low-frequency sinusoids with seeded phases, so the surface stays
// smooth (elastic) and deterministic. Returns a 2D array [rows][cols] of
// values in [-1, 1].
export function smoothDisplacementField(rows, cols, rng, { freqU = 1, freqV = 2, waves = 3 } = {}) {
  // Seeded wave parameters (fixed consumption order: per-wave phaseU, phaseV,
  // weight). Deterministic for a given rng.
  const wavesParams = []
  for (let w = 0; w < waves; w++) {
    wavesParams.push({
      phU: rng.range(0, Math.PI * 2),
      phV: rng.range(0, Math.PI * 2),
      wgt: rng.range(0.4, 1),
      fU: freqU * (1 + w * 0.5),
      fV: freqV * (1 + w * 0.5),
    })
  }
  const field = []
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols)
    const u = r / (rows - 1)
    for (let c = 0; c < cols; c++) {
      // v wraps (periodic in the girth): use an angle so the field is
      // continuous across the seam.
      const v = (c / cols) * Math.PI * 2
      let sum = 0
      let wsum = 0
      for (const w of wavesParams) {
        sum += w.wgt * Math.sin(w.fU * u * Math.PI + w.phU) * Math.sin(w.fV * v + w.phV)
        wsum += w.wgt
      }
      row[c] = sum / wsum
    }
    field.push(row)
  }
  return field
}
