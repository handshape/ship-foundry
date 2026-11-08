import * as THREE from 'three'
import { createRng } from '../generator/rng.js'

// PROCEDURAL TEXTURES (SP-06).
//
// Contract:
//   generateTextures(textureParams) -> { map, roughnessMap, metalnessMap }
//     `map` is the sRGB albedo (colorSpace = SRGBColorSpace); the PBR maps are
//     linear (NoColorSpace). Every value is a THREE.CanvasTexture produced from
//     an offscreen <canvas>, so it bakes cleanly into a GLTF export.
//   createShipMaterial(textures, { emissive? } = {}) -> THREE.MeshStandardMaterial
//
// Compositing (each layer is a pure function of `params` + `rng`, applied in
// order):
//   1. base albedo        flat fill of palette[0]
//   2. panel lines        grid/section seams, density ~ panelLines.weight
//   3. greebles           small machinery detail, count ~ greebles.density
//   4. wear               scuffs/dirt/edge highlights, strength ~ wear.amount
//   5. stripes/accents    accent bands, count/width from stripes
//   6. emblem             insignia (roundel/chevron/bar/star) by emblem.style
// The same `textureParams` + `seed` always produces identical pixels: all
// randomness flows from createRng(seed); never Math.random.

const DEFAULT_PALETTE = ['#8a94a6', '#5b6472', '#3a86c8', '#66d9ff']

// --- color helpers (deterministic) -------------------------------------------

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0')
  const n = parseInt(full.slice(0, 6), 16)
  if (!Number.isFinite(n)) return [138, 148, 166]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const rgba = (r, g, b, a = 1) => `rgba(${r & 255},${g & 255},${b & 255},${a})`

function mix(c1, c2, t) {
  const a = hexToRgb(c1)
  const b = hexToRgb(c2)
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

// --- canvas plumbing ----------------------------------------------------------

function makeCanvas(size) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  return canvas
}

function toTexture(canvas, srgb) {
  const t = new THREE.CanvasTexture(canvas)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.needsUpdate = true
  return t
}

// --- parameter normalization --------------------------------------------------

// Fill in defaults + clamp so the compositing never sees an undefined/NaN.
function normalizeParams(params = {}) {
  const hasPalette = Array.isArray(params.palette) && params.palette.length > 0
  // Palette precedence: an explicit palette wins; otherwise the convenience
  // `color` (the spine passes palette[0]) becomes the base and the rest default.
  let palette
  if (hasPalette) palette = [...params.palette]
  else if (typeof params.color === 'string' && params.color.length)
    palette = [params.color, ...DEFAULT_PALETTE.slice(1)]
  else palette = [...DEFAULT_PALETTE]
  while (palette.length < 4) palette.push(palette[palette.length - 1])
  palette = palette.slice(0, 4)

  const p = {
    palette,
    panelLines: {
      enabled: params.panelLines?.enabled !== false,
      weight: clamp01(params.panelLines?.weight, 0.6),
    },
    greebles: { enabled: params.greebles?.enabled !== false, density: clamp01(params.greebles?.density, 0.4) },
    wear: { enabled: params.wear?.enabled !== false, amount: clamp01(params.wear?.amount, 0.35) },
    stripes: {
      enabled: params.stripes?.enabled !== false,
      count: clampInt(params.stripes?.count, 0, 8, 2),
      width: clampNum(params.stripes?.width, 0.02, 0.5, 0.1),
    },
    emblem: {
      enabled: params.emblem?.enabled !== false && params.emblem?.style !== 'none',
      style: params.emblem?.style || 'roundel',
    },
    size: clampInt(params.size, 64, 2048, 512),
    seed: params.seed ?? 0,
  }
  return p
}

function clamp01(v, def) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : def
}

function clampInt(v, min, max, def) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.round(n)))
}

function clampNum(v, min, max, def) {
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

// --- layer 1: base albedo -----------------------------------------------------

function drawBase(ctx, size, base) {
  const [r, g, b] = hexToRgb(base)
  ctx.fillStyle = rgba(r, g, b)
  ctx.fillRect(0, 0, size, size)
}

// --- layer 2: panel lines -----------------------------------------------------

function drawPanelLines(ctx, size, rng, base, secondary, weight) {
  const cells = 4 + Math.round(weight * 14)
  const step = size / cells
  ctx.save()
  for (let i = 0; i < cells; i++) {
    const jitter = rng.range(-0.18, 0.18) * step
    const x = i * step + jitter
    const y = i * step + rng.range(-0.18, 0.18) * step
    ctx.strokeStyle = rgba(...hexToRgb(secondary), 0.45)
    ctx.lineWidth = Math.max(1, size * 0.0016 * (0.6 + weight))
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y)
    ctx.stroke()
    // A few short rivet ticks along the seams for structure.
    if (rng.chance(0.5)) {
      const ty = rng.range(0, size)
      ctx.fillStyle = rgba(...hexToRgb(base), 0.5)
      ctx.fillRect(x - 1.5, ty, 3, 3)
      ctx.fillRect(ty, y - 1.5, 3, 3)
    }
  }
  ctx.restore()
}

// --- layer 3: greebles --------------------------------------------------------

function drawGreebles(ctx, size, rng, base, secondary, accent, density) {
  const count = Math.round(20 + density * 170)
  for (let i = 0; i < count; i++) {
    const kind = rng.int(0, 4)
    const cx = rng.range(0, size)
    const cy = rng.range(0, size)
    const w = rng.range(size * 0.008, size * 0.05)
    const h = rng.range(size * 0.008, size * 0.04)
    const shade = rng.range(-0.16, 0.16)
    const col = kind === 2 ? accent : shade >= 0 ? base : secondary
    const [r, g, b] = mix(col, shade >= 0 ? '#ffffff' : '#000000', Math.abs(shade))
    ctx.fillStyle = rgba(r, g, b, 0.9)
    if (kind === 0) {
      // panel plate
      ctx.fillRect(cx, cy, w, h)
      ctx.strokeStyle = rgba(...hexToRgb(base), 0.5)
      ctx.lineWidth = 1
      ctx.strokeRect(cx, cy, w, h)
    } else if (kind === 1) {
      // vent: a few horizontal slats
      const rows = 2 + (w / size) * 20
      for (let s = 0; s < rows; s++) {
        ctx.fillRect(cx, cy + (s + 0.5) * (h / rows), w, Math.max(0.5, h / rows * 0.4))
      }
    } else if (kind === 2) {
      // glowing detail (accent)
      ctx.fillRect(cx, cy, w * 0.7, h)
    } else if (kind === 3) {
      // circular detail
      ctx.beginPath()
      ctx.arc(cx, cy, Math.min(w, h) * 0.6, 0, Math.PI * 2)
      ctx.fill()
    } else {
      // line / conduit
      ctx.strokeStyle = rgba(r, g, b, 0.9)
      ctx.lineWidth = Math.max(0.5, size * 0.002)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + w * (rng.bool() ? 1 : -1) * 2.5, cy + h * (rng.bool() ? 1 : -1) * 2.5)
      ctx.stroke()
    }
  }
}

// --- layer 4: wear ------------------------------------------------------------

function drawWear(ctx, size, rng, base, amount) {
  // 1. Soft grime blotches, more with amount.
  const blotches = Math.round(6 + amount * 44)
  for (let i = 0; i < blotches; i++) {
    const cx = rng.range(0, size)
    const cy = rng.range(0, size)
    const rad = rng.range(size * 0.03, size * 0.16)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, rgba(...hexToRgb('#20242a'), 0.12 + amount * 0.22))
    g.addColorStop(1, rgba(...hexToRgb('#20242a'), 0))
    ctx.fillStyle = g
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
  }
  // 2. Bright scuffs / abrasions (worn metal showing lighter).
  const scuffs = Math.round(3 + amount * 40)
  for (let i = 0; i < scuffs; i++) {
    const cx = rng.range(0, size)
    const cy = rng.range(0, size)
    const len = rng.range(size * 0.01, size * 0.07)
    const ang = rng.range(0, Math.PI * 2)
    const [r, g, b] = mix(base, '#ffffff', rng.range(0.25, 0.55))
    ctx.strokeStyle = rgba(r, g, b, 0.08 + amount * 0.22)
    ctx.lineWidth = Math.max(0.5, rng.range(size * 0.001, size * 0.004))
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len)
    ctx.stroke()
  }
  // 3. Edge highlights around random panel corners.
  if (rng.chance(0.6 + amount * 0.4)) {
    const [r, g, b] = mix(base, '#ffffff', 0.4)
    ctx.strokeStyle = rgba(r, g, b, 0.05 + amount * 0.12)
    ctx.lineWidth = 1
    for (let i = 0; i < 6 + Math.round(amount * 10); i++) {
      const x = rng.range(0, size)
      const y = rng.range(0, size)
      const w = rng.range(size * 0.02, size * 0.08)
      ctx.strokeRect(x, y, w, w * rng.range(0.4, 1.6))
    }
  }
}

// --- layer 5: stripes / accents ----------------------------------------------

function drawStripes(ctx, size, rng, accent, secondary, count, widthFrac) {
  if (count <= 0) return
  const horizontal = rng.bool()
  const bw = size * widthFrac
  const bandW = size / (count * 2 + 1)
  for (let i = 0; i < count; i++) {
    const pos = bandW * (2 * i + 1) + rng.range(-bandW * 0.3, bandW * 0.3)
    const color = rng.chance(0.5) ? accent : secondary
    const [r, g, b] = hexToRgb(color)
    ctx.fillStyle = rgba(r, g, b, 0.92)
    if (horizontal) {
      ctx.fillRect(0, pos, size, bw)
      // Thin dark pinline for contrast.
      ctx.fillStyle = rgba(...hexToRgb('#111418'), 0.5)
      ctx.fillRect(0, pos - bw * 0.12, size, Math.max(1, bw * 0.12))
    } else {
      ctx.fillRect(pos, 0, bw, size)
      ctx.fillStyle = rgba(...hexToRgb('#111418'), 0.5)
      ctx.fillRect(pos - bw * 0.12, 0, Math.max(1, bw * 0.12), size)
    }
  }
}

// --- layer 6: emblem ----------------------------------------------------------

function drawEmblem(ctx, size, rng, accent, glow, style) {
  const cx = size * 0.5
  const cy = size * 0.5
  const R = size * 0.16
  const [ar, ag, ab] = hexToRgb(accent)
  const [gr, gg, gb] = hexToRgb(glow)
  ctx.save()
  // Soft glow halo behind the mark.
  const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.7)
  halo.addColorStop(0, rgba(gr, gg, gb, 0.25))
  halo.addColorStop(1, rgba(gr, gg, gb, 0))
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)
  switch (style) {
    case 'roundel':
      ctx.fillStyle = rgba(ar, ag, ab, 0.95)
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = rgba(gr, gg, gb, 0.9)
      ctx.lineWidth = R * 0.18
      ctx.beginPath()
      ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillStyle = rgba(255, 255, 255, 0.85)
      ctx.beginPath()
      ctx.arc(cx, cy, R * 0.28, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'chevron': {
      const tilt = rng.range(-0.3, 0.3)
      ctx.translate(cx, cy)
      ctx.rotate(tilt)
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = rgba(ar, ag, ab, 0.9 - k * 0.15)
        ctx.beginPath()
        ctx.moveTo(-R, R * 0.5 - k * R * 0.5)
        ctx.lineTo(0, -R * 0.7 - k * R * 0.1)
        ctx.lineTo(R, R * 0.5 - k * R * 0.5)
        ctx.lineTo(R * 0.7, R * 0.5 - k * R * 0.5)
        ctx.lineTo(0, -R * 0.35 - k * R * 0.1)
        ctx.lineTo(-R * 0.7, R * 0.5 - k * R * 0.5)
        ctx.closePath()
        ctx.fill()
      }
      break
    }
    case 'bar': {
      ctx.rotate(rng.range(-0.2, 0.2))
      const n = 2 + rng.int(0, 2)
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = k % 2 === 0 ? rgba(ar, ag, ab, 0.95) : rgba(gr, gg, gb, 0.9)
        ctx.fillRect(-R, -R * 0.55 + (k * R * 1.1) / n, R * 2, R * 0.9 / n)
      }
      break
    }
    case 'star': {
      const spikes = 5
      ctx.fillStyle = rgba(ar, ag, ab, 0.95)
      ctx.beginPath()
      for (let i = 0; i < spikes * 2; i++) {
        const rad = i % 2 === 0 ? R : R * 0.45
        const a = (i * Math.PI) / spikes - Math.PI / 2
        const x = cx + Math.cos(a) * rad
        const y = cy + Math.sin(a) * rad
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fill()
      ctx.strokeStyle = rgba(gr, gg, gb, 0.9)
      ctx.lineWidth = R * 0.12
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2)
      ctx.stroke()
      break
    }
    default:
      break
  }
  ctx.restore()
}

// --- PBR maps -----------------------------------------------------------------

// Roughness: mid-gray base (modulated by material.roughness), darker (smoother)
// over greebles, brighter (rougher) over wear. Grayscale -> linear (NoColorSpace).
function buildRoughness(size, rng, greebles, wear) {
  const canvas = makeCanvas(size)
  const rctx = canvas.getContext('2d')
  const base = 150
  rctx.fillStyle = `rgb(${base},${base},${base})`
  rctx.fillRect(0, 0, size, size)
  // Smooth the greebles (darker).
  if (greebles.enabled) {
    const count = Math.round(20 + greebles.density * 170)
    for (let i = 0; i < count; i++) {
      const cx = rng.range(0, size)
      const cy = rng.range(0, size)
      const rad = rng.range(size * 0.01, size * 0.04)
      const g = rctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      g.addColorStop(0, 'rgba(70,70,70,0.6)')
      g.addColorStop(1, 'rgba(70,70,70,0)')
      rctx.fillStyle = g
      rctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
    }
  }
  // Roughen the wear (lighter).
  if (wear.enabled) {
    const blotches = Math.round(6 + wear.amount * 44)
    for (let i = 0; i < blotches; i++) {
      const cx = rng.range(0, size)
      const cy = rng.range(0, size)
      const rad = rng.range(size * 0.03, size * 0.14)
      const g = rctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      g.addColorStop(0, 'rgba(235,235,235,0.5)')
      g.addColorStop(1, 'rgba(235,235,235,0)')
      rctx.fillStyle = g
      rctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
    }
  }
  return canvas
}

// Metalness: mostly non-metal hull; accent stripes + emblem read as metal.
// Grayscale -> linear (NoColorSpace).
function buildMetalness(size, rng, p) {
  const canvas = makeCanvas(size)
  const mctx = canvas.getContext('2d')
  const base = 40
  mctx.fillStyle = `rgb(${base},${base},${base})`
  mctx.fillRect(0, 0, size, size)
  const paint = (x, y, w, h, v) => {
    mctx.fillStyle = `rgb(${v},${v},${v})`
    mctx.fillRect(x, y, w, h)
  }
  if (p.stripes.enabled && p.stripes.count > 0) {
    // Reproduce the band positions exactly as drawn on the albedo.
    const horizontal = rng.bool()
    const bandW = size / (p.stripes.count * 2 + 1)
    const bw = size * p.stripes.width
    for (let i = 0; i < p.stripes.count; i++) {
      const pos = bandW * (2 * i + 1) + rng.range(-bandW * 0.3, bandW * 0.3)
      if (horizontal) paint(0, pos, size, bw, 190)
      else paint(pos, 0, bw, size, 190)
    }
  }
  if (p.emblem.enabled) {
    const cx = size * 0.5
    const cy = size * 0.5
    const R = size * 0.16
    mctx.fillStyle = 'rgb(200,200,200)'
    mctx.beginPath()
    mctx.arc(cx, cy, R, 0, Math.PI * 2)
    mctx.fill()
  }
  return canvas
}

// --- public API ---------------------------------------------------------------

export function generateTextures(params = {}) {
  const p = normalizeParams(params)
  const rng = createRng(p.seed)
  const size = p.size
  const [base, secondary, accent, glow] = p.palette

  // Albedo: composite every layer in order.
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')
  drawBase(ctx, size, base)
  if (p.panelLines.enabled) drawPanelLines(ctx, size, rng, base, secondary, p.panelLines.weight)
  if (p.greebles.enabled) drawGreebles(ctx, size, rng, base, secondary, accent, p.greebles.density)
  if (p.wear.enabled) drawWear(ctx, size, rng, base, p.wear.amount)
  if (p.stripes.enabled) drawStripes(ctx, size, rng, accent, secondary, p.stripes.count, p.stripes.width)
  if (p.emblem.enabled) drawEmblem(ctx, size, rng, accent, glow, p.emblem.style)

  const map = toTexture(canvas, true)
  const roughnessMap = toTexture(buildRoughness(size, rng, p.greebles, p.wear), false)
  const metalnessMap = toTexture(buildMetalness(size, rng, p), false)

  return { map, roughnessMap, metalnessMap }
}

// Build a ready MeshStandardMaterial from generated texture maps.
export function createShipMaterial(textures = {}, { emissive } = {}) {
  const emissiveColor = emissive ?? null
  const material = new THREE.MeshStandardMaterial({
    map: textures.map ?? null,
    roughnessMap: textures.roughnessMap ?? null,
    metalnessMap: textures.metalnessMap ?? null,
    // Base PBR scalars; the (linear) maps modulate these.
    metalness: 0.55,
    roughness: 0.7,
    ...(emissiveColor !== null ? { emissive: new THREE.Color(emissiveColor), emissiveIntensity: 0.6 } : {}),
  })
  // Albedo is sRGB; PBR maps stay linear (NoColorSpace) on the CanvasTextures.
  return material
}
