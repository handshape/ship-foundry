import { registerHarness } from './framework.js'
import { paramControls } from './controls.js'

// Texture harness — the thin pattern for SP-10. The palette (4 colors) is
// expanded into 4 color inputs; the remaining texture sub-object fields become
// toggles/sliders/selects. Each edit patches the working config and regenerates
// the preview through the deterministic spine.
const PALETTE = [
  { key: 'base', label: 'Base', type: 'color' },
  { key: 'secondary', label: 'Secondary', type: 'color' },
  { key: 'accent', label: 'Accent', type: 'color' },
  { key: 'glow', label: 'Glow', type: 'color' },
]
const TEXTURE_SCHEMA = [
  ...PALETTE,
  { key: 'size', label: 'Size', type: 'slider', min: 64, max: 2048, step: 64, int: true },
  { key: 'panelLinesEnabled', label: 'Panel lines', type: 'toggle' },
  { key: 'panelLinesWeight', label: 'Panel weight', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'greeblesEnabled', label: 'Greebles', type: 'toggle' },
  { key: 'greeblesDensity', label: 'Greeble density', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'wearEnabled', label: 'Wear', type: 'toggle' },
  { key: 'wearAmount', label: 'Wear amount', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'stripesEnabled', label: 'Stripes', type: 'toggle' },
  { key: 'stripesCount', label: 'Stripe count', type: 'number', min: 0, max: 8, step: 1, int: true },
  { key: 'stripesWidth', label: 'Stripe width', type: 'slider', min: 0.02, max: 0.5, step: 0.01 },
  { key: 'emblemEnabled', label: 'Emblem', type: 'toggle' },
  { key: 'emblemStyle', label: 'Emblem style', type: 'select', options: ['none', 'roundel', 'chevron', 'bar', 'star', 'target', 'crosshair', 'compass', 'gem', 'hexagon', 'diamond', 'flag', 'sun', 'circleDot', 'medal', 'award', 'eye', 'flame', 'zap', 'atom', 'orbit', 'shieldCheck', 'shieldHalf', 'shieldX', 'anchor', 'wind'] },
]

// Flatten the working config's texture sub-object into the schema's flat keys
// (palette[i] -> base/secondary/accent/glow, nested enabled/weight -> flat).
function flattenTexture(t) {
  return {
    base: t.palette?.[0],
    secondary: t.palette?.[1],
    accent: t.palette?.[2],
    glow: t.palette?.[3],
    size: t.size,
    panelLinesEnabled: t.panelLines?.enabled,
    panelLinesWeight: t.panelLines?.weight,
    greeblesEnabled: t.greebles?.enabled,
    greeblesDensity: t.greebles?.density,
    wearEnabled: t.wear?.enabled,
    wearAmount: t.wear?.amount,
    stripesEnabled: t.stripes?.enabled,
    stripesCount: t.stripes?.count,
    stripesWidth: t.stripes?.width,
    emblemEnabled: t.emblem?.enabled,
    emblemStyle: t.emblem?.style,
  }
}

// Fold a flat patch back into the nested texture shape the schema expects.
function unflattenTexture(flat) {
  const out = {}
  const palette = {}
  let hasPalette = false
  for (let i = 0; i < 4; i++) {
    const k = ['base', 'secondary', 'accent', 'glow'][i]
    if (k in flat) {
      palette[i] = flat[k]
      hasPalette = true
    }
  }
  if (hasPalette) out.palette = palette
  if ('size' in flat) out.size = flat.size
  const nest = (sub, keys) => {
    for (const [fk, nk] of keys) {
      if (fk in flat) {
        out[sub] = out[sub] || {}
        out[sub][nk] = flat[fk]
      }
    }
  }
  nest('panelLines', [['panelLinesEnabled', 'enabled'], ['panelLinesWeight', 'weight']])
  nest('greebles', [['greeblesEnabled', 'enabled'], ['greeblesDensity', 'density']])
  nest('wear', [['wearEnabled', 'enabled'], ['wearAmount', 'amount']])
  nest('stripes', [['stripesEnabled', 'enabled'], ['stripesCount', 'count'], ['stripesWidth', 'width']])
  nest('emblem', [['emblemEnabled', 'enabled'], ['emblemStyle', 'style']])
  return out
}

registerHarness({
  id: 'textures',
  title: 'Textures',
  description: 'Tune procedural surface textures. The preview regenerates live from the working config.',
  build(controlsEl, api) {
    controlsEl.appendChild(
      paramControls(TEXTURE_SCHEMA, flattenTexture(api.getConfig().texture), {
        onPatch: (flat) => api.patchConfig({ texture: unflattenTexture(flat) }),
      }),
    )
  },
})
