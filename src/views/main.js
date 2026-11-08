import { createViewport } from '../core/three/scene.js'
import { generateShip, randomConfig, disposeGroup } from '../core/generator/index.js'
import { exportAndDownload } from '../core/three/exporter.js'
import { storage } from '../persistence/storage.js'
import { buildShipRecord, shipStats, captureThumbnail } from '../persistence/record.js'
import { onCleanup } from '../app/cleanup.js'
import { appState } from '../app/state.js'
import { listAesthetics, applyAesthetic } from '../core/aesthetics/index.js'
import { createRng } from '../core/generator/rng.js'
import { normalizeConfig, randomAestheticId, randomizePalette } from '../core/generator/config.js'
import { paramControls } from '../harness/controls.js'
import { HULL_ARCHETYPES, HULL_SECTIONS } from '../core/generator/hull.js'
import {
  BRIDGE_STYLES,
  COMMAND_SPIKE_STYLES,
  WEAPON_STYLES,
  SENSOR_MAST_STYLES,
  ANTENNA_STYLES,
  HANGAR_STYLES,
  HANGAR_POSITIONS,
  WEAPON_POSITIONS,
  NACELLE_STRUT_STYLES,
  NACELLE_LIFT_OPTIONS,
  NACELLE_ANGLE_OPTIONS,
  NACELLE_TAIL_OPTIONS,
  NACELLE_MOUNTS,
  NACELLE_TYPES,
} from '../core/generator/modules.js'

// MAIN APPLICATION (SP-08).
//
// The production UI: a live 3D viewport driven by the shared app/state working
// config, a schema-driven control panel (aesthetic picker + per-aspect param
// groups built from the ShipConfig schema, debounced regeneration), a ship card
// with derived stats, a saved-ship gallery (thumbnails + load/rename/delete),
// and GLB/GLTF export. Everything visible is reproducible from config + seed:
// the generator path is fully seeded — Math.random appears only to pick a fresh
// seed for the Randomize button, never inside the spine.

// --- schema-driven control specs --------------------------------------------
// The hull group mirrors config.hull; the module groups mirror config.modules;
// the texture group mirrors config.texture. These are plain data read straight
// by paramControls, so the panel can never drift from the live config.

const HULL_CONTROLS = [
  { key: 'archetype', label: 'Archetype', type: 'select', options: HULL_ARCHETYPES },
  { key: 'length', label: 'Length', type: 'slider', min: 20, max: 150, step: 1, int: true },
  { key: 'beam', label: 'Beam', type: 'slider', min: 8, max: 60, step: 1 },
  { key: 'height', label: 'Height', type: 'slider', min: 4, max: 40, step: 1 },
  { key: 'crossSection', label: 'Cross-section (lofted/wedge)', type: 'select', options: HULL_SECTIONS },
  { key: 'noseTaper', label: 'Nose taper', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'sternTaper', label: 'Stern taper', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'deckOffset', label: 'Deck offset', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'keelOffset', label: 'Keel offset', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'chamfer', label: 'Chamfer', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'stations', label: 'Stations', type: 'slider', min: 6, max: 24, step: 1, int: true },
  // Disc archetype params.
  { key: 'discUpperCurve', label: 'Disc upper curve', type: 'select', options: ['convex', 'concave'] },
  { key: 'discLowerCurve', label: 'Disc lower curve', type: 'select', options: ['convex', 'concave'] },
  { key: 'discEdge', label: 'Disc edge', type: 'select', options: ['cylinder', 'frustum'] },
]

// The texture group: the 4-color palette first (color inputs), then the
// layer toggles + their numeric params, and the texture size. The palette is
// flattened into base/secondary/accent/glow so it reads straight from the
// live config, and folded back on patch.
const PALETTE_KEYS = ['base', 'secondary', 'accent', 'glow']
const TEXTURE_CONTROLS = [
  { key: 'base', label: 'Base', type: 'color' },
  { key: 'secondary', label: 'Secondary', type: 'color' },
  { key: 'accent', label: 'Accent', type: 'color' },
  { key: 'glow', label: 'Glow', type: 'color' },
  { key: 'size', label: 'Size', type: 'slider', min: 64, max: 2048, step: 64, int: true },
  { key: 'panelLines.enabled', label: 'Panel lines', type: 'toggle' },
  { key: 'panelLines.weight', label: 'Panel weight', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'greebles.enabled', label: 'Greebles', type: 'toggle' },
  { key: 'greebles.density', label: 'Greeble density', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'wear.enabled', label: 'Wear', type: 'toggle' },
  { key: 'wear.amount', label: 'Wear amount', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'stripes.enabled', label: 'Stripes', type: 'toggle' },
  { key: 'stripes.count', label: 'Stripe count', type: 'number', min: 0, max: 8, step: 1, int: true },
  { key: 'stripes.width', label: 'Stripe width', type: 'slider', min: 0.02, max: 0.5, step: 0.01 },
  { key: 'emblem.enabled', label: 'Emblem', type: 'toggle' },
  { key: 'emblem.style', label: 'Emblem style', type: 'select', options: ['none', 'roundel', 'chevron', 'bar', 'star'] },
]

// The module groups: the top-level density, then one collapsible group per
// module type (enabled + counts/sizes). Built dynamically from the live config
// so the set of module types always matches what the generator produces.
const MODULE_LABELS = {
  density: 'Density',
  bridge: 'Bridge',
  commandSpike: 'Command spike',
  nacelles: 'Nacelles',
  weapons: 'Weapons',
  sensorMast: 'Sensor mast',
  antenna: 'Antenna',
  hangar: 'Hangar',
}
const MODULE_FIELD_LABELS = {
  enabled: 'Enabled',
  count: 'Count',
  size: 'Size',
  height: 'Height',
  style: 'Style',
  layout: 'Layout',
  strut: 'Strut',
  position: 'Position',
  lift: 'Lift',
  angle: 'Angle',
  tail: 'Tail',
  mount: 'Mount',
  type: 'Type',
}
// String-valued module fields render as a select over these options. Each
// module's `style` select reads its options from the corresponding STYLES
// export in modules.js (single source of truth for the available styles).
const MODULE_FIELD_OPTIONS = {
  'bridge.style': BRIDGE_STYLES,
  'commandSpike.style': COMMAND_SPIKE_STYLES,
  'weapons.style': WEAPON_STYLES,
  'weapons.position': WEAPON_POSITIONS,
  'nacelles.strut': NACELLE_STRUT_STYLES,
  'nacelles.lift': NACELLE_LIFT_OPTIONS.map((v) => ({ value: v, label: v === 0 ? 'Level' : v === 1 ? 'High' : `Mid (${v})` })),
  'nacelles.angle': NACELLE_ANGLE_OPTIONS,
  'nacelles.tail': NACELLE_TAIL_OPTIONS,
  'nacelles.mount': NACELLE_MOUNTS,
  'nacelles.type': NACELLE_TYPES,
  'sensorMast.style': SENSOR_MAST_STYLES,
  'antenna.style': ANTENNA_STYLES,
  'hangar.style': HANGAR_STYLES,
  'hangar.position': HANGAR_POSITIONS,
}

// Camera preset buttons (mapped onto the viewport's preset names).
const CAMERA_PRESETS = [
  { key: 'front', label: 'Front', icon: 'arrow-up' },
  { key: 'side', label: 'Side', icon: 'arrow-right' },
  { key: 'top', label: 'Top', icon: 'arrow-big-up' },
  { key: 'three-quarter', label: '3/4', icon: 'box' },
]

// --- small helpers -----------------------------------------------------------

// Trailing-edge debounce: run `fn` at most once per `ms` after the last call.
function debounce(fn, ms) {
  let timer = 0
  return (...args) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = 0
      fn(...args)
    }, ms)
  }
}

// Read a possibly-dotted key (e.g. 'panelLines.weight') from a nested object.
function readDot(obj, path) {
  if (!path.includes('.')) return obj?.[path]
  return path.split('.').reduce((cur, k) => (cur != null ? cur[k] : undefined), obj)
}

// Flatten the live config's texture sub-object so paramControls can read each
// palette color and nested layer field straight off a flat object.
function flattenTexture(t) {
  const flat = {}
  PALETTE_KEYS.forEach((k, i) => {
    flat[k] = t?.palette?.[i]
  })
  for (const c of TEXTURE_CONTROLS) {
    if (c.key.includes('.')) flat[c.key] = readDot(t, c.key)
  }
  if (t?.size !== undefined) flat.size = t.size
  return flat
}

// Fold a flat patch (palette colors + nested layer fields) back into the nested
// texture shape the ShipConfig schema expects.
function unflattenTexture(flat) {
  const out = {}
  const palette = []
  for (let i = 0; i < 4; i++) {
    if (PALETTE_KEYS[i] in flat) palette[i] = flat[PALETTE_KEYS[i]]
  }
  if (palette.length === 4) out.palette = palette
  if ('size' in flat) out.size = flat.size
  const byParent = {}
  for (const [k, v] of Object.entries(flat)) {
    if (k.includes('.')) {
      const [parent, leaf] = k.split('.')
      ;(byParent[parent] ||= {})[leaf] = v
    }
  }
  for (const [parent, leafObj] of Object.entries(byParent)) out[parent] = leafObj
  return out
}

export function mainView() {
  const el = document.createElement('div')
  el.className = 'grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4'
  el.innerHTML = `
    <div class="space-y-4">
      <div class="card bg-base-100 shadow">
        <div class="card-body p-2">
          <div class="viewport w-full h-[520px] bg-base-300 rounded-lg"></div>
          <div class="flex flex-wrap items-center gap-2 px-2 pb-2 pt-1">
            <span class="label-text-alt text-xs mr-1">Camera</span>
            <div class="btn-group" id="cam-group"></div>
          </div>
        </div>
      </div>
      <div class="card bg-base-100 shadow">
        <div class="card-body p-4">
          <h3 class="card-title text-base mb-2">Saved ships</h3>
          <div id="gallery" class="space-y-2"></div>
        </div>
      </div>
    </div>
    <div class="space-y-4">
      <div class="card bg-base-100 shadow">
        <div class="card-body p-4">
          <div class="flex items-center gap-2 mb-3">
            <i data-lucide="rocket" class="w-5 h-5"></i>
            <h2 class="card-title text-lg">Ship</h2>
          </div>
          <input id="ship-name" class="input input-bordered w-full mb-3" placeholder="Ship name" />
          <div id="ship-card" class="stats stats-vertical sm:stats-horizontal w-full mb-3"></div>
          <div id="ship-aesthetic" class="badge badge-outline mb-3"></div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-primary btn-sm" id="btn-random"><i data-lucide="shuffle" class="w-4 h-4"></i> Randomize</button>
            <button class="btn btn-outline btn-sm" id="btn-export-glb"><i data-lucide="download" class="w-4 h-4"></i> GLB</button>
            <button class="btn btn-outline btn-sm" id="btn-export-gltf">GLTF</button>
            <button class="btn btn-success btn-sm" id="btn-save"><i data-lucide="save" class="w-4 h-4"></i> Save</button>
          </div>
          <div class="mt-3 flex items-center gap-2">
            <i data-lucide="file-down" class="w-4 h-4 opacity-60"></i>
            <input id="export-name" class="input input-bordered input-sm flex-1" value="ship-foundry" placeholder="export filename" />
          </div>
          <p class="text-xs opacity-60 mt-3 min-h-4" id="status"></p>
        </div>
      </div>
      <div class="card bg-base-100 shadow">
        <div class="card-body p-4">
          <h3 class="card-title text-base mb-3">Design</h3>
          <div class="form-control mb-4">
            <label class="label pb-1"><span class="label-text">Aesthetic</span></label>
            <select id="aesthetic" class="select select-bordered select-sm w-full"></select>
            <p id="aesthetic-blurb" class="label-text-alt text-xs mt-1"></p>
          </div>
          <div id="controls" class="space-y-4 max-h-[420px] overflow-y-auto pr-1"></div>
        </div>
      </div>
    </div>
  `

  const viewport = el.querySelector('.viewport')
  const statusEl = el.querySelector('#status')
  const galleryEl = el.querySelector('#gallery')
  const shipCardEl = el.querySelector('#ship-card')
  const aestheticBadgeEl = el.querySelector('#ship-aesthetic')
  const nameInput = el.querySelector('#ship-name')
  const exportNameInput = el.querySelector('#export-name')
  const aestheticSelect = el.querySelector('#aesthetic')
  const aestheticBlurb = el.querySelector('#aesthetic-blurb')
  const controlsEl = el.querySelector('#controls')
  const camGroup = el.querySelector('#cam-group')
  const note = (msg) => { statusEl.textContent = msg }

  // --- viewport + ship state -------------------------------------------------
  const vp = createViewport(viewport, { preset: 'three-quarter' })
  let currentGroup = null

  // Re-generate from the shared working config and swap the ship into the
  // viewport (which disposes the old group and reframes). Fully deterministic.
  function regenerate() {
    const cfg = appState.get()
    const { group } = generateShip(cfg, cfg.seed)
    const old = currentGroup
    currentGroup = group
    vp.setShip(group)
    if (old) disposeGroup(old)
    updateShipCard(cfg)
  }

  const debouncedRegenerate = debounce(regenerate, 120)

  // Aesthetic label for the badge (falls back to the raw id if unknown).
  function aestheticLabel(id) {
    const a = listAesthetics().find((x) => x.id === id)
    return a ? a.label : id || 'Standard'
  }

  // --- ship card -------------------------------------------------------------
  function updateShipCard(cfg) {
    const stats = shipStats(cfg)
    shipCardEl.innerHTML = `
      <div class="stat">
        <div class="stat-title">Class</div>
        <div class="stat-value text-xl">${stats.className}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Hull</div>
        <div class="stat-value text-lg">${stats.hullArchetype}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Modules</div>
        <div class="stat-value text-xl">${stats.moduleCount}</div>
      </div>
      <div class="stat">
        <div class="stat-title">Texture</div>
        <div class="stat-value text-lg">${stats.textureSize}px</div>
      </div>
    `
    aestheticBadgeEl.textContent = `Aesthetic: ${aestheticLabel(cfg.aesthetic)}`
    if (!nameInput.value) nameInput.value = cfg.aesthetic ? aestheticLabel(cfg.aesthetic) + ' ship' : 'Ship'
  }

  // --- control panel ---------------------------------------------------------
  // Aesthetic picker from listAesthetics(). On change, re-roll the params
  // within the chosen aesthetic's ranges using a seeded rng from the current
  // seed, then regenerate.
  function buildAestheticSelect(cfg) {
    aestheticSelect.replaceChildren()
    for (const a of listAesthetics()) {
      const o = document.createElement('option')
      o.value = a.id
      o.textContent = a.label
      if (a.id === cfg.aesthetic) o.selected = true
      aestheticSelect.appendChild(o)
    }
    const current = listAesthetics().find((x) => x.id === cfg.aesthetic)
    aestheticBlurb.textContent = current ? current.blurb : ''
  }

  // Rebuild the param groups from the current config. Hull + texture read
  // straight from the schema-shaped sub-objects; modules are built dynamically.
  function buildControls(cfg) {
    controlsEl.replaceChildren()

    // Hull group.
    const hullGroup = document.createElement('div')
    hullGroup.className = 'space-y-3'
    hullGroup.append(sectionHeader('Hull'), paramControls(HULL_CONTROLS, cfg.hull, { onPatch: (p) => debouncedPatch({ hull: p }) }))
    controlsEl.appendChild(hullGroup)

    // Modules group: density + per-module collapsibles.
    const modGroup = document.createElement('div')
    modGroup.className = 'space-y-3'
    modGroup.appendChild(sectionHeader('Modules'))
    const density = paramControls(
      [{ key: 'density', label: 'Density', type: 'slider', min: 0, max: 1, step: 0.01 }],
      cfg.modules,
      { onPatch: (p) => debouncedPatch({ modules: p }) },
    )
    modGroup.appendChild(density)
    for (const [name, value] of Object.entries(cfg.modules)) {
      if (name === 'density' || !value || typeof value !== 'object') continue
      const group = document.createElement('div')
      group.className = 'rounded-lg border border-base-300 p-3 space-y-3'
      const header = document.createElement('div')
      header.className = 'flex items-center justify-between gap-2 mb-1'
      const enabledInput = document.createElement('input')
      enabledInput.type = 'checkbox'
      enabledInput.className = 'toggle toggle-primary toggle-sm'
      enabledInput.checked = !!value.enabled
      enabledInput.addEventListener('change', () => {
        debouncedPatch({ modules: { [name]: { enabled: enabledInput.checked } } })
      })
      const label = document.createElement('span')
      label.className = 'label-text text-sm font-medium'
      label.textContent = MODULE_LABELS[name] ?? name
      header.append(label, enabledInput)
      group.appendChild(header)

      // The module's option controls, wrapped so they collapse (hide) when the
      // module is toggled off. The panel is rebuilt on every config change, so
      // flipping the toggle off hides these on the next rebuild.
      const options = document.createElement('div')
      options.className = 'space-y-3'
      if (!value.enabled) options.classList.add('hidden')

      const fieldSpecs = []
      for (const [fk, fv] of Object.entries(value)) {
        if (fk === 'enabled') continue
        if (typeof fv === 'string') {
          fieldSpecs.push({ key: fk, label: MODULE_FIELD_LABELS[fk] ?? fk, type: 'select', options: MODULE_FIELD_OPTIONS[`${name}.${fk}`] ?? [] })
        } else {
          fieldSpecs.push({
            key: fk,
            label: MODULE_FIELD_LABELS[fk] ?? fk,
            type: typeof fv === 'number' ? (fk === 'count' ? 'number' : 'slider') : 'toggle',
            min: 0,
            max: fk === 'count' ? 8 : 1,
            int: fk === 'count',
            step: 0.01,
          })
        }
      }
      if (fieldSpecs.length) {
        options.appendChild(
          paramControls(fieldSpecs, value, { onPatch: (p) => debouncedPatch({ modules: { [name]: p } }) }),
        )
      }
      group.appendChild(options)
      modGroup.appendChild(group)
    }
    controlsEl.appendChild(modGroup)

    // Texture group (palette + layer toggles), flattened for paramControls.
    const texGroup = document.createElement('div')
    texGroup.className = 'space-y-3'
    texGroup.append(sectionHeader('Texture'), paramControls(TEXTURE_CONTROLS, flattenTexture(cfg.texture), { onPatch: (p) => debouncedPatch({ texture: unflattenTexture(p) }) }))
    controlsEl.appendChild(texGroup)
  }

  function sectionHeader(title) {
    const h = document.createElement('h4')
    h.className = 'text-sm font-semibold text-base-content/70 mb-1'
    h.textContent = title
    return h
  }

  // Patch the shared config (normalizes + notifies) and regenerate (debounced).
  function debouncedPatch(patch) {
    appState.patchConfig(patch)
    debouncedRegenerate()
  }

  // Keep the working config in sync with the viewport/card/controls whenever it
  // changes — including when a harness publishes a tuned config (lastSaved) or
  // the user edits a control.
  function applyExternalConfig(cfg) {
    const { group } = generateShip(cfg, cfg.seed)
    const old = currentGroup
    currentGroup = group
    vp.setShip(group)
    if (old) disposeGroup(old)
    buildAestheticSelect(cfg)
    buildControls(cfg)
    updateShipCard(cfg)
  }

  // --- aesthetic picker ------------------------------------------------------
  aestheticSelect.addEventListener('change', () => {
    const id = aestheticSelect.value
    // Re-roll the params within this aesthetic's ranges, seeded from the
    // current seed so the result is reproducible from config + seed.
    const current = appState.get()
    const rng = createRng(current.seed)
    const rerolled = applyAesthetic(id, current, rng)
    appState.setConfig({ ...rerolled, seed: current.seed })
    note(`Applied ${aestheticLabel(id)}.`)
  })

  // --- camera presets --------------------------------------------------------
  for (const p of CAMERA_PRESETS) {
    const btn = document.createElement('button')
    btn.className = 'btn btn-sm btn-outline'
    btn.innerHTML = `<i data-lucide="${p.icon}" class="w-4 h-4"></i> ${p.label}`
    btn.addEventListener('click', () => vp.setCameraPreset(p.key))
    camGroup.appendChild(btn)
  }

  // --- randomize -------------------------------------------------------------
  el.querySelector('#btn-random').addEventListener('click', () => {
    // A fresh, UI-side random seed (Math.random is fine here — it never enters
    // the generator path, which stays fully seeded by config.seed). Draw every
    // field from the schema (hull / modules / texture incl. a biased palette),
    // roll a varied aesthetic from the registry, and re-resolve the palette to
    // the desaturated-base + brightness-varied tones. The result is a fully
    // randomized ship, reproducible from config + seed.
    const seed = Math.floor(Math.random() * 4294967295)
    const rng = createRng(seed)
    const raw = randomConfig(seed)
    raw.aesthetic = randomAestheticId(rng)
    raw.texture.palette = randomizePalette(rng)
    const cfg = normalizeConfig(applyAesthetic(raw.aesthetic, raw, rng))
    appState.setConfig(cfg)
    note(`New ship (seed ${seed}).`)
  })

  // --- export ----------------------------------------------------------------
  function exportName(ext) {
    const base = exportNameInput.value.trim().replace(/[\\/:*?"<>|]/g, '') || 'ship-foundry'
    return `${base}.${ext}`
  }
  el.querySelector('#btn-export-glb').addEventListener('click', async () => {
    if (!currentGroup) return
    try {
      const bytes = await exportAndDownload(currentGroup, exportName('glb'), { binary: true })
      note(`Exported ${(bytes / 1024).toFixed(1)} KB as GLB.`)
    } catch (err) {
      console.error(err)
      note('Export failed.')
    }
  })
  el.querySelector('#btn-export-gltf').addEventListener('click', async () => {
    if (!currentGroup) return
    try {
      const bytes = await exportAndDownload(currentGroup, exportName('gltf'), { binary: false })
      note(`Exported ${(bytes / 1024).toFixed(1)} KB as GLTF.`)
    } catch (err) {
      console.error(err)
      note('Export failed.')
    }
  })

  // --- save + gallery --------------------------------------------------------
  el.querySelector('#btn-save').addEventListener('click', async () => {
    if (!currentGroup) return
    try {
      const cfg = appState.get()
      const thumbnail = await captureThumbnail(vp, { w: 256, h: 160 })
      const record = buildShipRecord({ name: nameInput.value.trim() || undefined, config: cfg, thumbnail, stats: shipStats(cfg) })
      await storage.saveShip(record)
      await renderGallery()
      note(`Saved "${record.name}".`)
    } catch (err) {
      console.error(err)
      note('Save failed.')
    }
  })

  async function renderGallery() {
    try {
      const ships = await storage.listShips()
      galleryEl.replaceChildren()
      if (!ships.length) {
        galleryEl.innerHTML = '<div class="text-sm opacity-70">No ships saved yet.</div>'
        return
      }
      for (const s of ships) {
        const stats = s.stats ?? shipStats(s.config)
        const row = document.createElement('div')
        row.className = 'flex items-center gap-3 p-2 rounded-lg border border-base-300'
        const thumb = s.thumbnail
          ? `<img src="${s.thumbnail}" alt="${s.name}" class="w-20 h-12 object-cover rounded bg-base-300 shrink-0" />`
          : '<div class="w-20 h-12 rounded bg-base-300 shrink-0 flex items-center justify-center text-xs opacity-60">no image</div>'
        row.innerHTML = `
          ${thumb}
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium">${escapeHtml(s.name)}</div>
            <div class="text-xs opacity-70">${stats.className} · ${stats.hullArchetype} · ${new Date(s.savedAt).toLocaleDateString()}</div>
          </div>
          <button class="btn btn-xs btn-ghost" data-act="load" data-id="${s.id}" title="Load"><i data-lucide="folder-open" class="w-4 h-4"></i></button>
          <button class="btn btn-xs btn-ghost" data-act="rename" data-id="${s.id}" title="Rename"><i data-lucide="pencil" class="w-4 h-4"></i></button>
          <button class="btn btn-xs btn-ghost" data-act="delete" data-id="${s.id}" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        `
        galleryEl.appendChild(row)
      }
      galleryEl.querySelectorAll('[data-act="load"]').forEach((btn) => btn.addEventListener('click', () => loadShip(btn.dataset.id)))
      galleryEl.querySelectorAll('[data-act="rename"]').forEach((btn) => btn.addEventListener('click', () => renameShip(btn.dataset.id)))
      galleryEl.querySelectorAll('[data-act="delete"]').forEach((btn) => btn.addEventListener('click', () => deleteShip(btn.dataset.id)))
    } catch (err) {
      console.error(err)
      galleryEl.innerHTML = '<div class="text-sm opacity-70">Could not read saved ships.</div>'
    }
  }

  async function loadShip(id) {
    try {
      const result = await storage.loadShipAndRegenerate(id, generateShip)
      if (!result) {
        note('Could not load that ship.')
        return
      }
      // Adopt the loaded ship's config as the working config. The subscription
      // below regenerates + re-frames and rebuilds the panels to match.
      appState.setConfig(result.config)
      note('Loaded ship from storage.')
    } catch (err) {
      console.error(err)
      note('Load failed.')
    }
  }

  async function renameShip(id) {
    try {
      const record = await storage.loadShip(id)
      if (!record) return
      const next = window.prompt('Rename ship', record.name)
      if (next === null) return
      record.name = next.trim() || record.name
      await storage.saveShip(record)
      await renderGallery()
      note(`Renamed to "${record.name}".`)
    } catch (err) {
      console.error(err)
      note('Rename failed.')
    }
  }

  async function deleteShip(id) {
    try {
      await storage.deleteShip(id)
      await renderGallery()
      note('Deleted ship.')
    } catch (err) {
      console.error(err)
      note('Delete failed.')
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  // --- boot ------------------------------------------------------------------
  // Start from the shared working config. If it hasn't been resolved from its
  // aesthetic yet (e.g. a fresh session before any harness touched it), resolve
  // the aesthetic once (one-time "new ship" step) so the store holds a concrete,
  // fully-resolved config. Then generate + render.
  const initial = appState.get()
  const bootCfg = normalizeConfig(applyAesthetic(initial.aesthetic, initial, createRng(initial.seed)))
  appState.setConfig(bootCfg)
  buildAestheticSelect(bootCfg)
  buildControls(bootCfg)
  const { group } = generateShip(bootCfg, bootCfg.seed)
  currentGroup = group
  vp.setShip(group)
  updateShipCard(bootCfg)
  renderGallery()

  // Keep in sync with external changes: a harness publishes a tuned config
  // (appState.lastSaved) or the user patches from another surface. Regenerate +
  // re-frame and rebuild the panels to match. The subscription is registered
  // AFTER boot so the boot setConfig above does not trigger it (no double
  // generate on load).
  appState.subscribe((cfg) => applyExternalConfig(cfg))

  vp.startLoop()

  // Tear down the WebGL context on route change.
  onCleanup(() => {
    vp.dispose()
    if (currentGroup) disposeGroup(currentGroup)
    currentGroup = null
  })

  return el
}