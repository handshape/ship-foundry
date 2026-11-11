import * as THREE from 'three'
import { createRng } from '../generator/rng.js'
import Shield from 'lucide/dist/esm/icons/shield.mjs'
import Cross from 'lucide/dist/esm/icons/cross.mjs'
import Crown from 'lucide/dist/esm/icons/crown.mjs'
import Star from 'lucide/dist/esm/icons/star.mjs'
import Target from 'lucide/dist/esm/icons/target.mjs'
import Crosshair from 'lucide/dist/esm/icons/crosshair.mjs'
import Compass from 'lucide/dist/esm/icons/compass.mjs'
import Gem from 'lucide/dist/esm/icons/gem.mjs'
import Hexagon from 'lucide/dist/esm/icons/hexagon.mjs'
import Diamond from 'lucide/dist/esm/icons/diamond.mjs'
import Flag from 'lucide/dist/esm/icons/flag.mjs'
import Sun from 'lucide/dist/esm/icons/sun.mjs'
import CircleDot from 'lucide/dist/esm/icons/circle-dot.mjs'
import Medal from 'lucide/dist/esm/icons/medal.mjs'
import Award from 'lucide/dist/esm/icons/award.mjs'
import Eye from 'lucide/dist/esm/icons/eye.mjs'
import Flame from 'lucide/dist/esm/icons/flame.mjs'
import Zap from 'lucide/dist/esm/icons/zap.mjs'
import Atom from 'lucide/dist/esm/icons/atom.mjs'
import Orbit from 'lucide/dist/esm/icons/orbit.mjs'
import ShieldCheck from 'lucide/dist/esm/icons/shield-check.mjs'
import ShieldHalf from 'lucide/dist/esm/icons/shield-half.mjs'
import ShieldX from 'lucide/dist/esm/icons/shield-x.mjs'
import Anchor from 'lucide/dist/esm/icons/anchor.mjs'
import Wind from 'lucide/dist/esm/icons/wind.mjs'

// PROCEDURAL TEXTURES (SP-06).
//
// Contract:
//   generateTextures(textureParams) -> { map, roughnessMap, metalnessMap, normalMap, aoMap }
//     `map` is the sRGB albedo (colorSpace = SRGBColorSpace); all PBR maps are
//     linear (NoColorSpace). Every value is a THREE.CanvasTexture produced from
//     an offscreen <canvas>, so it bakes cleanly into a GLTF export.
//   createShipMaterial(textures, { emissive?, clearcoat? } = {}) -> THREE.MeshPhysicalMaterial
//
// Compositing (each layer is a pure function of `params` + `rng`, applied in
// order):
//   1. base albedo        flat fill of palette[0]
//   2. organic            voronoi cells / vein network / scale pattern (if enabled)
//   3. panel lines        grid/section seams, density ~ panelLines.weight
//   4. greebles           small machinery detail, count ~ greebles.density
//   5. wear               scuffs/dirt/edge highlights, strength ~ wear.amount
//   6. rust               corrosion patches (if wear.amount > threshold)
//   7. stripes/accents    accent bands, count/width from stripes
//   8. emblem             insignia: a Lucide icon (shield/cross/crown/star) by
//                         emblem.style, rasterized + tinted into the texture
//
// PBR maps:
//   roughnessMap: panel grooves, greeble smoothing, wear roughening, rust roughening
//   metalnessMap: painted base, exposed metal patches, accent/emblem metal, rust (low)
//   normalMap:    panel indentations, rivet bumps, scratch grooves
//   aoMap:        panel joint darkening, greeble crevices, edge occlusion
//
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

// --- emblem rasterizer (Lucide icons) ----------------------------------------
// Lucide ships each icon as a flat list of leaf nodes [tag, attrs] in its 24x24
// coordinate space (tags: path / line / circle / rect). We draw each node
// directly onto the texture canvas with the 2D context (Path2D for paths,
// native line/arc/rect for the rest), scaled into the emblem box. This is fully
// synchronous and deterministic — no image decode, so the emblem is always baked
// into the texture before it is uploaded (and therefore into the GLTF export).
const EMBLEM_ICONS = {
  // Legacy styles (kept for saved configs that already reference them).
  roundel: Shield,
  chevron: Cross,
  bar: Crown,
  star: Star,
  // Expanded candidates.
  target: Target,
  crosshair: Crosshair,
  compass: Compass,
  gem: Gem,
  hexagon: Hexagon,
  diamond: Diamond,
  flag: Flag,
  sun: Sun,
  circleDot: CircleDot,
  medal: Medal,
  award: Award,
  eye: Eye,
  flame: Flame,
  zap: Zap,
  atom: Atom,
  orbit: Orbit,
  shieldCheck: ShieldCheck,
  shieldHalf: ShieldHalf,
  shieldX: ShieldX,
  anchor: Anchor,
  wind: Wind,
}

// Draw a single Lucide node (tag + attrs) in the 24x24 icon space.
// `path` nodes go through Path2D (which parses the `d` string natively);
// line / circle / rect use the equivalent native context primitives.
function drawIconNode(ctx, tag, attrs) {
  if (tag === 'path') {
    if (!attrs.d) return
    ctx.stroke(new Path2D(attrs.d))
  } else if (tag === 'line') {
    ctx.beginPath()
    ctx.moveTo(attrs.x1, attrs.y1)
    ctx.lineTo(attrs.x2, attrs.y2)
    ctx.stroke()
  } else if (tag === 'circle') {
    ctx.beginPath()
    ctx.arc(attrs.cx, attrs.cy, attrs.r, 0, Math.PI * 2)
    ctx.stroke()
  } else if (tag === 'rect') {
    const rx = attrs.rx || 0
    const ry = attrs.ry || rx
    if (rx > 0) ctx.stroke(new Path2D(rectPathD(attrs.x, attrs.y, attrs.width, attrs.height, rx, ry)))
    else ctx.strokeRect(attrs.x, attrs.y, attrs.width, attrs.height)
  }
}

// Build a `d` string for a rounded rect (used by rect nodes that carry rx/ry).
function rectPathD(x, y, w, h, rx, ry) {
  const r = Math.min(rx, w / 2, ry, h / 2)
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`
}

// Render the whole icon centered at (cx, cy), scaled so the 24x24 viewBox maps
// to a `box`-size square. Stroke color / width / cap are applied by the caller
// before the transform so they scale correctly with the icon.
function drawIcon(ctx, icon, cx, cy, box, color, lineWidth, alpha) {
  const scale = box / 24
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.translate(cx, cy)
  ctx.scale(scale, scale)
  ctx.translate(-12, -12)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth / scale // keep on-screen width constant after scaling
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const [tag, attrs] of icon) drawIconNode(ctx, tag, attrs)
  ctx.restore()
}

// --- parameter normalization --------------------------------------------------

function normalizeParams(params = {}) {
  const hasPalette = Array.isArray(params.palette) && params.palette.length > 0
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
    organic: {
      enabled: params.organic?.enabled === true,
      style: params.organic?.style || 'voronoi',
    },
    windows: {
      enabled: params.windows?.enabled !== false,
      density: clamp01(params.windows?.density, 0.4),
    },
    size: clampInt(params.size, 64, 4096, 1024),
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

// --- albedo layers -------------------------------------------------------------

function drawBase(ctx, size, base) {
  const [r, g, b] = hexToRgb(base)
  ctx.fillStyle = rgba(r, g, b)
  ctx.fillRect(0, 0, size, size)
}

// Organic patterns: voronoi cells, vein network, or scale/plate pattern.
// Uses a dedicated rng (derived from the ship seed) so the same seed points
// can be regenerated in the normal map builder.
function drawOrganic(ctx, size, rng, base, secondary, glow, style) {
  if (style === 'voronoi') {
    // True per-pixel voronoi: each pixel colored by distance to its nearest
    // seed point. Cell borders are darker (larger distance to nearest seed).
    const n = 20 + Math.round(rng.range(0, 16))
    const seeds = []
    const seedShades = []
    for (let i = 0; i < n; i++) {
      seeds.push([rng.range(0, size), rng.range(0, size)])
      seedShades.push(rng.range(0, 1))
    }
    const imgData = ctx.getImageData(0, 0, size, size)
    const data = imgData.data
    const [br, bg, bb] = hexToRgb(base)
    const [sr2, sg2, sb2] = hexToRgb(secondary)
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        let minD = Infinity
        let minIdx = 0
        for (let i = 0; i < n; i++) {
          const dx = px - seeds[i][0]
          const dy = py - seeds[i][1]
          const d = dx * dx + dy * dy
          if (d < minD) { minD = d; minIdx = i }
        }
        const dist = Math.sqrt(minD)
        const shade = seedShades[minIdx]
        // Color: blend base/secondary by seed shade, darken by distance (border).
        const borderF = Math.min(1, dist / (size * 0.08))
        const t = shade * 0.4 * borderF
        const r = Math.round(br + (sr2 - br) * t)
        const g = Math.round(bg + (sg2 - bg) * t)
        const b = Math.round(bb + (sb2 - bb) * t)
        const dim = 0.7 + 0.3 * (1 - borderF)
        const idx = (py * size + px) * 4
        data[idx] = Math.round(r * dim)
        data[idx + 1] = Math.round(g * dim)
        data[idx + 2] = Math.round(b * dim)
        data[idx + 3] = 255
      }
    }
    ctx.putImageData(imgData, 0, 0)
  } else if (style === 'veins') {
    // Recursive branching vein network with bioluminescent glow.
    const [gr, gg, gb] = hexToRgb(glow)
    const drawBranch = (x, y, ang, len, width, depth) => {
      if (depth <= 0 || len < 2) return
      const x2 = x + Math.cos(ang) * len
      const y2 = y + Math.sin(ang) * len
      ctx.strokeStyle = rgba(gr, gg, gb, 0.15 + depth * 0.06)
      ctx.lineWidth = width
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      const branches = depth > 2 ? 2 : 1
      for (let b = 0; b < branches; b++) {
        const spread = rng.range(0.3, 0.8) * (b === 0 ? 1 : -1)
        drawBranch(x2, y2, ang + spread, len * rng.range(0.55, 0.75), width * 0.6, depth - 1)
      }
    }
    const roots = 3 + rng.int(0, 4)
    for (let i = 0; i < roots; i++) {
      drawBranch(
        rng.range(size * 0.1, size * 0.9),
        rng.range(size * 0.1, size * 0.9),
        rng.range(0, Math.PI * 2),
        size * rng.range(0.08, 0.18),
        rng.range(2, 4),
        4 + rng.int(0, 2),
      )
    }
  } else if (style === 'scales') {
    // Overlapping arc pattern (fish scales / armored plates).
    const scaleW = size * rng.range(0.06, 0.1)
    const scaleH = scaleW * 0.6
    for (let row = 0; row < size / scaleH + 2; row++) {
      const offset = row % 2 === 0 ? 0 : scaleW * 0.5
      for (let col = -1; col < size / scaleW + 2; col++) {
        const cx = col * scaleW + offset
        const cy = row * scaleH
        const shade = rng.range(-0.08, 0.08)
        const [r, g, b] = mix(secondary, shade >= 0 ? '#ffffff' : '#000000', Math.abs(shade))
        ctx.strokeStyle = rgba(r, g, b, 0.4)
        ctx.lineWidth = Math.max(1, scaleW * 0.08)
        ctx.beginPath()
        ctx.arc(cx, cy, scaleW * 0.5, 0, Math.PI)
        ctx.stroke()
      }
    }
  }
}

function drawPanelLines(ctx, size, seed, base, secondary, weight) {
  // Dedicated derived RNG so the jitter values match the normal map's panel
  // lines (which uses the same offset). The main RNG is NOT consumed here, so
  // the albedo's other layers (greebles, wear, etc.) are unaffected.
  const rng = createRng((seed + 31337) >>> 0)
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
    if (rng.chance(0.5)) {
      const ty = rng.range(0, size)
      ctx.fillStyle = rgba(...hexToRgb(base), 0.5)
      ctx.fillRect(x - 1.5, ty, 3, 3)
      ctx.fillRect(ty, y - 1.5, 3, 3)
    }
  }
  ctx.restore()
}

function drawGreebles(ctx, size, rng, base, secondary, accent, density) {
  const count = Math.round(60 + density * 400)
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
      ctx.fillRect(cx, cy, w, h)
      ctx.strokeStyle = rgba(...hexToRgb(base), 0.5)
      ctx.lineWidth = 1
      ctx.strokeRect(cx, cy, w, h)
    } else if (kind === 1) {
      const rows = 2 + (w / size) * 20
      for (let s = 0; s < rows; s++) {
        ctx.fillRect(cx, cy + (s + 0.5) * (h / rows), w, Math.max(0.5, h / rows * 0.4))
      }
    } else if (kind === 2) {
      ctx.fillRect(cx, cy, w * 0.7, h)
    } else if (kind === 3) {
      ctx.beginPath()
      ctx.arc(cx, cy, Math.min(w, h) * 0.6, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = rgba(r, g, b, 0.9)
      ctx.lineWidth = Math.max(0.5, size * 0.002)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + w * (rng.bool() ? 1 : -1) * 2.5, cy + h * (rng.bool() ? 1 : -1) * 2.5)
      ctx.stroke()
    }
  }
}

function drawWear(ctx, size, rng, base, amount) {
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

// Rust / corrosion: orange-brown patches with rough, mottled edges.
function drawRust(ctx, size, rng, base, amount) {
  if (amount < 0.2) return
  const rustCount = Math.round(4 + amount * 20)
  for (let i = 0; i < rustCount; i++) {
    const cx = rng.range(0, size)
    const cy = rng.range(0, size)
    const rad = rng.range(size * 0.02, size * 0.1)
    const rustCol = mix('#8b4513', '#a0522d', rng.range(0, 1))
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, rgba(...rustCol, 0.25 + amount * 0.3))
    g.addColorStop(0.6, rgba(...mix(rustCol, '#654321', 0.3), 0.15 + amount * 0.2))
    g.addColorStop(1, rgba(...rustCol, 0))
    ctx.fillStyle = g
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
    // Mottled spots within the rust patch.
    const spots = 3 + Math.round(amount * 8)
    for (let s = 0; s < spots; s++) {
      const sx = cx + rng.range(-rad * 0.7, rad * 0.7)
      const sy = cy + rng.range(-rad * 0.7, rad * 0.7)
      const sr = rng.range(1, rad * 0.2)
      ctx.fillStyle = rgba(...mix(rustCol, '#3d2010', rng.range(0.3, 0.7)), 0.3)
      ctx.beginPath()
      ctx.arc(sx, sy, sr, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

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
      ctx.fillStyle = rgba(...hexToRgb('#111418'), 0.5)
      ctx.fillRect(0, pos - bw * 0.12, size, Math.max(1, bw * 0.12))
    } else {
      ctx.fillRect(pos, 0, bw, size)
      ctx.fillStyle = rgba(...hexToRgb('#111418'), 0.5)
      ctx.fillRect(pos - bw * 0.12, 0, Math.max(1, bw * 0.12), size)
    }
  }
}

// Emblem: draw a Lucide icon (by emblem.style) at the texture center, tinted by
// the accent channel. A soft glow halo is drawn behind the icon for the
// bioluminescent accent. Rendering is synchronous, so the emblem is always
// baked into the texture before it is uploaded.
function drawEmblem(ctx, size, accent, glow, style) {
  const icon = EMBLEM_ICONS[style]
  if (!icon) return
  const cx = size * 0.5
  const cy = size * 0.5
  const R = size * 0.16
  const [gr, gg, gb] = hexToRgb(glow)

  // Glow halo behind the insignia.
  const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.7)
  halo.addColorStop(0, rgba(gr, gg, gb, 0.25))
  halo.addColorStop(1, rgba(gr, gg, gb, 0))
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, size, size)

  // Tint the Lucide stroke by the accent channel and draw it.
  const [ar, ag, ab] = hexToRgb(accent)
  const box = R * 2.4
  // Stroke width in the 24x24 icon space (Lucide default is 2); scaled up
  // slightly for texture legibility.
  const lineWidth = 2.25
  drawIcon(ctx, icon, cx, cy, box, rgba(ar, ag, ab, 1), lineWidth, 0.95)
}

// --- PBR maps -----------------------------------------------------------------

// Roughness: panel line grooves (smoother), greeble smoothing, wear roughening,
// rust roughening, scratch marks, and subtle noise for surface variation.
function buildRoughness(size, rng, p) {
  const canvas = makeCanvas(size)
  const rctx = canvas.getContext('2d')
  const base = 150
  rctx.fillStyle = `rgb(${base},${base},${base})`
  rctx.fillRect(0, 0, size, size)

  // Panel line grooves: darker (smoother) along the seams.
  if (p.panelLines.enabled) {
    const cells = 4 + Math.round(p.panelLines.weight * 14)
    const step = size / cells
    rctx.strokeStyle = 'rgba(80,80,80,0.5)'
    rctx.lineWidth = Math.max(1, size * 0.002 * (0.6 + p.panelLines.weight))
    for (let i = 0; i < cells; i++) {
      const x = i * step + rng.range(-0.18, 0.18) * step
      const y = i * step + rng.range(-0.18, 0.18) * step
      rctx.beginPath()
      rctx.moveTo(x, 0)
      rctx.lineTo(x, size)
      rctx.stroke()
      rctx.beginPath()
      rctx.moveTo(0, y)
      rctx.lineTo(size, y)
      rctx.stroke()
    }
  }

  // Greeble smoothing (darker = smoother over machinery).
  if (p.greebles.enabled) {
    const gRng = createRng((p.seed + 104729) >>> 0)
    const count = Math.round(60 + p.greebles.density * 400)
    for (let i = 0; i < count; i++) {
      const cx = gRng.range(0, size)
      const cy = gRng.range(0, size)
      const rad = gRng.range(size * 0.01, size * 0.04)
      const g = rctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      g.addColorStop(0, 'rgba(70,70,70,0.6)')
      g.addColorStop(1, 'rgba(70,70,70,0)')
      rctx.fillStyle = g
      rctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
    }
  }

  // Wear roughening (lighter = rougher over dirty areas).
  if (p.wear.enabled) {
    const blotches = Math.round(6 + p.wear.amount * 44)
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
    // Rust roughening: very rough (near white) over rust patches.
    if (p.wear.amount > 0.2) {
      const rustCount = Math.round(4 + p.wear.amount * 20)
      for (let i = 0; i < rustCount; i++) {
        const cx = rng.range(0, size)
        const cy = rng.range(0, size)
        const rad = rng.range(size * 0.02, size * 0.08)
        const g = rctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
        g.addColorStop(0, 'rgba(250,250,250,0.5)')
        g.addColorStop(1, 'rgba(250,250,250,0)')
        rctx.fillStyle = g
        rctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
      }
    }
  }

  // Diagonal scratch marks (subtle roughness variation).
  const scratches = Math.round(8 + (p.wear.enabled ? p.wear.amount * 20 : 0))
  rctx.strokeStyle = 'rgba(200,200,200,0.15)'
  rctx.lineWidth = 1
  for (let i = 0; i < scratches; i++) {
    const x = rng.range(0, size)
    const y = rng.range(0, size)
    const len = rng.range(size * 0.01, size * 0.06)
    const ang = rng.range(0, Math.PI)
    rctx.beginPath()
    rctx.moveTo(x, y)
    rctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len)
    rctx.stroke()
  }

  // Subtle noise for micro-surface variation.
  const noiseCount = Math.round(size * 0.3)
  for (let i = 0; i < noiseCount; i++) {
    const x = rng.range(0, size)
    const y = rng.range(0, size)
    const v = 140 + Math.round(rng.range(-15, 15))
    rctx.fillStyle = `rgba(${v},${v},${v},0.1)`
    rctx.fillRect(x, y, 2, 2)
  }

  return canvas
}

// Metalness: painted base (low), exposed metal patches (high), accent/emblem
// metal (high), rust zones (low — oxide is non-metallic).
function buildMetalness(size, rng, p) {
  const canvas = makeCanvas(size)
  const mctx = canvas.getContext('2d')
  const base = 40
  mctx.fillStyle = `rgb(${base},${base},${base})`
  mctx.fillRect(0, 0, size, size)

  // Exposed metal patches: worn areas where paint has chipped off.
  const metalPatches = Math.round(4 + (p.wear.enabled ? p.wear.amount * 16 : 0))
  for (let i = 0; i < metalPatches; i++) {
    const cx = rng.range(0, size)
    const cy = rng.range(0, size)
    const rad = rng.range(size * 0.015, size * 0.06)
    const g = mctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, 'rgba(180,180,180,0.6)')
    g.addColorStop(0.7, 'rgba(120,120,120,0.3)')
    g.addColorStop(1, 'rgba(120,120,120,0)')
    mctx.fillStyle = g
    mctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
  }

  // Stripe/accent metal.
  if (p.stripes.enabled && p.stripes.count > 0) {
    const horizontal = rng.bool()
    const bandW = size / (p.stripes.count * 2 + 1)
    const bw = size * p.stripes.width
    mctx.fillStyle = 'rgb(190,190,190)'
    for (let i = 0; i < p.stripes.count; i++) {
      const pos = bandW * (2 * i + 1) + rng.range(-bandW * 0.3, bandW * 0.3)
      if (horizontal) mctx.fillRect(0, pos, size, bw)
      else mctx.fillRect(pos, 0, bw, size)
    }
  }

  // Emblem metal.
  if (p.emblem.enabled) {
    const cx = size * 0.5
    const cy = size * 0.5
    const R = size * 0.16
    mctx.fillStyle = 'rgb(200,200,200)'
    mctx.beginPath()
    mctx.arc(cx, cy, R, 0, Math.PI * 2)
    mctx.fill()
  }

  // Rust zones: lower metalness (oxide is non-metallic).
  if (p.wear.enabled && p.wear.amount > 0.2) {
    const rustCount = Math.round(4 + p.wear.amount * 20)
    for (let i = 0; i < rustCount; i++) {
      const cx = rng.range(0, size)
      const cy = rng.range(0, size)
      const rad = rng.range(size * 0.02, size * 0.08)
      const g = mctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      g.addColorStop(0, 'rgba(15,15,15,0.6)')
      g.addColorStop(1, 'rgba(15,15,15,0)')
      mctx.fillStyle = g
      mctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
    }
  }

  return canvas
}

// Normal map: tangent-space (R=X, G=Y, B=Z). Flat = (128,128,255).
// Panel lines create indentations, rivets create small bumps, scratches create
// diagonal grooves, organic patterns create cell/vein/scale relief.
function buildNormalMap(size, rng, p) {
  const canvas = makeCanvas(size)
  const nctx = canvas.getContext('2d')
  // Flat normal: (128, 128, 255)
  nctx.fillStyle = 'rgb(128,128,255)'
  nctx.fillRect(0, 0, size, size)

  const normalLine = (x1, y1, x2, y2, strength) => {
    // A groove: darken the G channel (push down) along the line.
    const s = Math.round(strength * 60)
    nctx.strokeStyle = `rgb(128,${128 - s},255)`
    nctx.lineWidth = Math.max(1, size * 0.002)
    nctx.beginPath()
    nctx.moveTo(x1, y1)
    nctx.lineTo(x2, y2)
    nctx.stroke()
    // Highlight edge (lighten G on one side) for the groove lip.
    nctx.strokeStyle = `rgb(128,${128 + s},${255})`
    nctx.lineWidth = 1
    nctx.beginPath()
    nctx.moveTo(x1 + 1, y1)
    nctx.lineTo(x2 + 1, y2)
    nctx.stroke()
  }

  // Panel line indentations. Uses the same derived RNG as the albedo's
  // drawPanelLines (seed + 31337) so the jitter values — and therefore the
  // groove positions — align exactly with the coloured panel lines.
  if (p.panelLines.enabled) {
    const plRng = createRng((p.seed + 31337) >>> 0)
    const cells = 4 + Math.round(p.panelLines.weight * 14)
    const step = size / cells
    for (let i = 0; i < cells; i++) {
      const x = i * step + plRng.range(-0.18, 0.18) * step
      const y = i * step + plRng.range(-0.18, 0.18) * step
      normalLine(x, 0, x, size, p.panelLines.weight)
      normalLine(0, y, size, y, p.panelLines.weight)
      // Rivet bumps along the seams (same 0.5 probability as the albedo).
      if (plRng.chance(0.5)) {
        const ty = plRng.range(0, size)
        nctx.fillStyle = 'rgb(128,170,255)'
        nctx.beginPath()
        nctx.arc(x, ty, Math.max(1.5, size * 0.003), 0, Math.PI * 2)
        nctx.fill()
        nctx.beginPath()
        nctx.arc(ty, y, Math.max(1.5, size * 0.003), 0, Math.PI * 2)
        nctx.fill()
      }
    }
  }

  // Greeble bumps (raised machinery). Consumes the same 6 RNG values per
  // greeble as the albedo's drawGreebles (kind, cx, cy, w, h, shade) so the
  // bump positions align exactly with the coloured greebles. Only cx/cy are
  // used for the bump centre; the rest are consumed to keep the RNG in sync.
  if (p.greebles.enabled) {
    const gRng = createRng((p.seed + 104729) >>> 0)
    const count = Math.round(60 + p.greebles.density * 400)
    for (let i = 0; i < count; i++) {
      gRng.int(0, 4) // kind (consumed, not used)
      const cx = gRng.range(0, size)
      const cy = gRng.range(0, size)
      gRng.range(size * 0.008, size * 0.05) // w (consumed, not used)
      gRng.range(size * 0.008, size * 0.04) // h (consumed, not used)
      gRng.range(-0.16, 0.16) // shade (consumed, not used)
      const rad = Math.max(1, size * 0.008)
      const g = nctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
      g.addColorStop(0, 'rgba(128,128,255,0.4)')
      g.addColorStop(0.5, 'rgba(140,140,230,0.2)')
      g.addColorStop(1, 'rgba(128,128,255,0)')
      nctx.fillStyle = g
      nctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2)
    }
  }

  // Scratch grooves (diagonal, subtle).
  const scratches = Math.round(5 + (p.wear.enabled ? p.wear.amount * 25 : 0))
  for (let i = 0; i < scratches; i++) {
    const x = rng.range(0, size)
    const y = rng.range(0, size)
    const len = rng.range(size * 0.02, size * 0.08)
    const ang = rng.range(0, Math.PI * 2)
    normalLine(x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, 0.3)
  }

  // Organic pattern relief: uses the same derived seed as the albedo so the
  // normal map aligns with the colour map.
  if (p.organic.enabled) {
    const oRng = createRng((p.seed + 7919) >>> 0)
    if (p.organic.style === 'voronoi') {
      // Per-pixel: normal points away from the cell border (toward seed),
      // creating raised cell interiors with grooved borders.
      const n = 20 + Math.round(oRng.range(0, 16))
      const seeds = []
      for (let i = 0; i < n; i++) {
        seeds.push([oRng.range(0, size), oRng.range(0, size)])
        oRng.range(0, 1) // skip shade (used in albedo)
      }
      const imgData = nctx.getImageData(0, 0, size, size)
      const d = imgData.data
      for (let py = 1; py < size - 1; py++) {
        for (let px = 1; px < size - 1; px++) {
          // Find nearest seed and compute gradient of distance.
          let minD = Infinity
          let sx = 0, sy = 0
          for (let i = 0; i < n; i++) {
            const dx = px - seeds[i][0]
            const dy = py - seeds[i][1]
            const dd = dx * dx + dy * dy
            if (dd < minD) { minD = dd; sx = seeds[i][0]; sy = seeds[i][1] }
          }
          // Gradient: direction from seed to pixel (normalized).
          const gx = (px - sx) / (Math.sqrt(minD) || 1)
          const gy = (py - sy) / (Math.sqrt(minD) || 1)
          // Normal: raised toward seed center, grooved at borders.
          const strength = Math.min(1, Math.sqrt(minD) / (size * 0.06)) * 0.5
          const idx = (py * size + px) * 4
          d[idx] = Math.round(128 + gx * strength * 80)
          d[idx + 1] = Math.round(128 - gy * strength * 80)
          // B channel stays high (mostly flat Z).
        }
      }
      nctx.putImageData(imgData, 0, 0)
    } else if (p.organic.style === 'veins') {
      // Raised ridges along the vein paths (same branch structure as albedo).
      const drawBranch = (x, y, ang, len, width, depth) => {
        if (depth <= 0 || len < 2) return
        const x2 = x + Math.cos(ang) * len
        const y2 = y + Math.sin(ang) * len
        // Raised ridge: lighten the normal (push up).
        nctx.strokeStyle = `rgba(128,${128 + Math.round(width * 8)},255,0.5)`
        nctx.lineWidth = width * 1.5
        nctx.lineCap = 'round'
        nctx.beginPath()
        nctx.moveTo(x, y)
        nctx.lineTo(x2, y2)
        nctx.stroke()
        const branches = depth > 2 ? 2 : 1
        for (let b = 0; b < branches; b++) {
          const spread = oRng.range(0.3, 0.8) * (b === 0 ? 1 : -1)
          drawBranch(x2, y2, ang + spread, len * oRng.range(0.55, 0.75), width * 0.6, depth - 1)
        }
      }
      const roots = 3 + oRng.int(0, 4)
      for (let i = 0; i < roots; i++) {
        drawBranch(
          oRng.range(size * 0.1, size * 0.9),
          oRng.range(size * 0.1, size * 0.9),
          oRng.range(0, Math.PI * 2),
          size * oRng.range(0.08, 0.18),
          oRng.range(2, 4),
          4 + oRng.int(0, 2),
        )
      }
    } else if (p.organic.style === 'scales') {
      // Raised scale bumps: each arc is a small dome.
      const scaleW = size * oRng.range(0.06, 0.1)
      const scaleH = scaleW * 0.6
      for (let row = 0; row < size / scaleH + 2; row++) {
        const offset = row % 2 === 0 ? 0 : scaleW * 0.5
        for (let col = -1; col < size / scaleW + 2; col++) {
          oRng.range(-0.08, 0.08) // skip shade (used in albedo)
          const cx = col * scaleW + offset
          const cy = row * scaleH
          const rad = scaleW * 0.4
          const g = nctx.createRadialGradient(cx, cy - rad * 0.3, 0, cx, cy - rad * 0.3, rad)
          g.addColorStop(0, 'rgba(128,180,255,0.4)')
          g.addColorStop(1, 'rgba(128,128,255,0)')
          nctx.fillStyle = g
          nctx.fillRect(cx - rad, cy - rad * 1.5, rad * 2, rad * 2)
        }
      }
    }
  }

  return canvas
}

// AO map: white = no occlusion, dark = occluded. Panel joints and greeble
// crevices get darkened to simulate ambient occlusion.
function buildAO(size, rng, p) {
  const canvas = makeCanvas(size)
  const actx = canvas.getContext('2d')
  // No occlusion by default.
  actx.fillStyle = 'rgb(255,255,255)'
  actx.fillRect(0, 0, size, size)

  // Panel joint darkening.
  if (p.panelLines.enabled) {
    const cells = 4 + Math.round(p.panelLines.weight * 14)
    const step = size / cells
    const jointW = Math.max(2, size * 0.004)
    for (let i = 0; i < cells; i++) {
      const x = i * step + rng.range(-0.18, 0.18) * step
      const y = i * step + rng.range(-0.18, 0.18) * step
      // Soft dark band along vertical joint.
      const gv = actx.createLinearGradient(x - jointW, 0, x + jointW, 0)
      gv.addColorStop(0, 'rgba(255,255,255,0)')
      gv.addColorStop(0.5, 'rgba(140,140,140,0.5)')
      gv.addColorStop(1, 'rgba(255,255,255,0)')
      actx.fillStyle = gv
      actx.fillRect(x - jointW, 0, jointW * 2, size)
      // Soft dark band along horizontal joint.
      const gh = actx.createLinearGradient(0, y - jointW, 0, y + jointW)
      gh.addColorStop(0, 'rgba(255,255,255,0)')
      gh.addColorStop(0.5, 'rgba(140,140,140,0.5)')
      gh.addColorStop(1, 'rgba(255,255,255,0)')
      actx.fillStyle = gh
      actx.fillRect(0, y - jointW, size, jointW * 2)
    }
  }

  // Greeble crevices (dark spots around machinery).
  if (p.greebles.enabled) {
    const gRng = createRng((p.seed + 104729) >>> 0)
    const count = Math.round(60 + p.greebles.density * 400)
    for (let i = 0; i < count; i++) {
      const cx = gRng.range(0, size)
      const cy = gRng.range(0, size)
      const rad = gRng.range(size * 0.01, size * 0.035)
      const g = actx.createRadialGradient(cx, cy, rad * 0.3, cx, cy, rad * 1.5)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.5, 'rgba(160,160,160,0.3)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      actx.fillStyle = g
      actx.fillRect(cx - rad * 1.5, cy - rad * 1.5, rad * 3, rad * 3)
    }
  }

  // Edge vignette: slight corner darkening for a grounded look.
  const vigSize = size * 0.04
  for (const [cx, cy] of [[0, 0], [size, 0], [0, size], [size, size]]) {
    const g = actx.createRadialGradient(cx, cy, 0, cx, cy, vigSize * 2)
    g.addColorStop(0, 'rgba(180,180,180,0.2)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    actx.fillStyle = g
    actx.fillRect(cx - vigSize * 2, cy - vigSize * 2, vigSize * 4, vigSize * 4)
  }

  return canvas
}

// Emissive map: mostly black (no glow) with bright spots at window locations.
// The material's emissive colour (the palette's glow channel) is multiplied by
// this map, so only the windows glow — the rest of the hull stays dark.
//
// Windows are small dots or short lines scattered across the texture. Their
// density is modulated by UV.u (girth fraction): the hull's vertical surfaces
// (port/starboard sides) map to u ≈ 0.25 and u ≈ 0.75, so windows are denser
// there. The horizontal surfaces (top/bottom) at u ≈ 0 and u ≈ 0.5 get fewer.
function buildEmissiveMap(size, rng, p) {
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')
  // Black = no emissive.
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)
  if (!p.windows.enabled) return canvas

  const density = p.windows.density
  const count = Math.round(30 + density * 200)
  // Window brightness (0..1) — how bright the glow is at each window.
  const brightness = 0.5 + density * 0.4

  // Density bias by UV.v (girth, after the UV swap): peaks at v=0 and v=0.5
  // (the hull's vertical sides — the cross-section profiles start at the
  // starboard side, angle 0°, and go CCW, so the sides are at v=0 and v=0.5),
  // troughs at v≈0.25 and v≈0.75 (top/bottom). cos(4πv) peaks at 0 and 0.5.
  const sideBias = (v) => 0.25 + 0.75 * (0.5 + 0.5 * Math.cos(4 * Math.PI * v))

  for (let i = 0; i < count; i++) {
    const u = rng.range(0.02, 0.98) // u = length (0=stern, 1=nose)
    const v = rng.range(0.02, 0.98) // v = girth (0..1 around cross-section)
    // Accept/reject based on side bias: windows are more likely on the sides.
    if (rng.range(0, 1) > sideBias(v)) continue

    const cx = u * size
    const cy = (1 - v) * size // v=0 is one side of the girth, v=1 is the other
    const isLine = rng.chance(0.35)

    if (isLine) {
      // Short horizontal line (a row of portholes running fore-to-aft,
      // i.e. along the hull's length). After the UV swap, u (length) is the
      // horizontal axis, so a fore-aft line is horizontal in the canvas.
      const len = rng.range(size * 0.015, size * 0.04)
      const h = Math.max(1.5, size * 0.004)
      ctx.fillStyle = `rgba(255,255,255,${brightness})`
      ctx.fillRect(cx - len / 2, cy - h / 2, len, h)
    } else {
      // Small dot (a single porthole).
      const rad = Math.max(1, size * 0.003)
      ctx.fillStyle = `rgba(255,255,255,${brightness})`
      ctx.beginPath()
      ctx.arc(cx, cy, rad, 0, Math.PI * 2)
      ctx.fill()
    }
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
  if (p.organic.enabled) {
    const organicRng = createRng((p.seed + 7919) >>> 0)
    drawOrganic(ctx, size, organicRng, base, secondary, glow, p.organic.style)
  }
  if (p.panelLines.enabled) drawPanelLines(ctx, size, p.seed, base, secondary, p.panelLines.weight)
  if (p.greebles.enabled) {
    const greebleRng = createRng((p.seed + 104729) >>> 0)
    drawGreebles(ctx, size, greebleRng, base, secondary, accent, p.greebles.density)
  }
  if (p.wear.enabled) drawWear(ctx, size, rng, base, p.wear.amount)
  if (p.wear.enabled) drawRust(ctx, size, rng, base, p.wear.amount)
  if (p.stripes.enabled) drawStripes(ctx, size, rng, accent, secondary, p.stripes.count, p.stripes.width)
  if (p.emblem.enabled) drawEmblem(ctx, size, accent, glow, p.emblem.style)

  const map = toTexture(canvas, true)
  const roughnessMap = toTexture(buildRoughness(size, rng, p), false)
  const metalnessMap = toTexture(buildMetalness(size, rng, p), false)
  const normalMap = toTexture(buildNormalMap(size, rng, p), false)
  const aoMap = toTexture(buildAO(size, rng, p), false)
  const emissiveMap = toTexture(buildEmissiveMap(size, rng, p), false)

  return { map, roughnessMap, metalnessMap, normalMap, aoMap, emissiveMap }
}

// Build a ready MeshPhysicalMaterial from generated texture maps.
// MeshPhysicalMaterial extends MeshStandardMaterial with clearcoat (painted
// hull look: glossy top layer over the base texture).
export function createShipMaterial(textures = {}, { emissive, clearcoat = 0.4 } = {}) {
  const emissiveColor = emissive ?? null
  const material = new THREE.MeshPhysicalMaterial({
    map: textures.map ?? null,
    roughnessMap: textures.roughnessMap ?? null,
    metalnessMap: textures.metalnessMap ?? null,
    normalMap: textures.normalMap ?? null,
    aoMap: textures.aoMap ?? null,
    normalScale: new THREE.Vector2(0.4, 0.4),
    aoMapIntensity: 0.6,
    // Base PBR scalars; the (linear) maps modulate these.
    metalness: 0.55,
    roughness: 0.7,
    // Clearcoat: a glossy painted layer over the base surface.
    clearcoat,
    clearcoatRoughness: 0.25,
  })
  // Emissive: the glow colour (palette[3]) is multiplied by the emissive map,
  // so only the windows (bright spots in the map) glow — the rest of the hull
  // stays dark. Without the map the emissive would wash the whole hull.
  if (emissiveColor !== null) {
    material.emissive = new THREE.Color(emissiveColor)
    material.emissiveMap = textures.emissiveMap ?? null
    material.emissiveIntensity = 1.0
  }
  return material
}
