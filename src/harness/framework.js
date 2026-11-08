import * as THREE from 'three'
import { createViewport } from '../core/three/scene.js'
import { makePlaceholderShip } from '../core/generator/placeholder.js'
import { generateShip, disposeGroup } from '../core/generator/index.js'
import { onCleanup } from '../app/cleanup.js'
import { appState } from '../app/state.js'

// HARNESS FRAMEWORK (SP-09).
//
// A harness isolates ONE tunable aspect of the generator for iterative
// development. Each harness registers an object:
//   { id, title, description, build(controlsEl, api) }
// `build` renders controls into `controlsEl` and uses `api` to drive an
// isolated live-preview three.js scene. runHarness() wires all of that up.
//
// The harness tunes the LIVE ship's config via the shared app/state store:
// api.getConfig() / api.patchConfig() read and mutate that working config and
// regenerate the preview through the deterministic spine (generateShip).
// api.saveConfig() persists the working config as a preset and publishes it to
// app/state so a later main-app load can apply it. A header Compare checkbox
// swaps the preview between the generated ship and the static placeholder.
//
// Adding a new harness = create src/harness/<id>.js that calls registerHarness
// and import it from src/harness/index.js.

const harnesses = []

export function registerHarness(h) {
  harnesses.push(h)
  return h
}

export function getHarness(id) {
  return harnesses.find((h) => h.id === id)
}

export function listHarnesses() {
  return [...harnesses]
}

export function harnessIndexView() {
  const list = listHarnesses()
  const el = document.createElement('div')
  el.className = 'max-w-4xl mx-auto'
  el.innerHTML = `
    <h1 class="text-2xl font-bold mb-1">Tuning Harnesses</h1>
    <p class="text-sm opacity-70 mb-6">
      Each harness isolates one aspect of the generator for iterative tuning,
      with a live preview and a save-to-config path. Pick one to start.
    </p>
  `
  const grid = document.createElement('div')
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4'
  for (const h of list) {
    const card = document.createElement('a')
    card.className = 'card bg-base-100 shadow hover:shadow-lg transition'
    card.href = `#/harness/${h.id}`
    card.innerHTML = `
      <div class="card-body p-4">
        <h2 class="card-title">${h.title}</h2>
        <p class="text-sm opacity-70">${h.description}</p>
      </div>
    `
    grid.appendChild(card)
  }
  el.appendChild(grid)
  return el
}

// Trailing-edge debounce: schedule `fn` to run at most once per `ms`.
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

// Swap the preview between the generated ship and the placeholder (compare).
// Both groups are held in `preview`; only the active one is visible.
function applyCompare(preview, on) {
  preview.generated.visible = !on
  preview.placeholder.visible = on
}

/**
 * Generic harness runner: a two-pane layout (controls + live preview).
 * Returns the page element; registers teardown so the WebGL context is released
 * when the user navigates away.
 */
export function runHarness(harness) {
  const page = document.createElement('div')
  page.className = 'grid grid-cols-1 lg:grid-cols-2 gap-4'
  page.innerHTML = `
    <div class="card bg-base-100 shadow">
      <div class="card-body p-4">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <i data-lucide="sliders-horizontal" class="w-5 h-5"></i>
            <h2 class="card-title text-xl">${harness.title}</h2>
          </div>
          <label class="label cursor-pointer gap-2 select-none" title="Show the placeholder instead of the generated ship">
            <span class="label-text-alt text-xs">Compare</span>
            <input type="checkbox" class="toggle toggle-primary toggle-sm" />
          </label>
        </div>
        <p class="text-sm opacity-70">${harness.description}</p>
        <div class="harness-controls mt-4 space-y-4"></div>
      </div>
    </div>
    <div class="card bg-base-100 shadow">
      <div class="card-body p-2">
        <div class="harness-preview w-full h-[420px] bg-base-300 rounded-lg"></div>
      </div>
    </div>
  `

  const controlsEl = page.querySelector('.harness-controls')
  const previewEl = page.querySelector('.harness-preview')
  const compareInput = page.querySelector('input.toggle')

  const vp = createViewport(previewEl, { preset: 'three-quarter' })

  // The live preview group. It holds both the generated ship and the
  // placeholder; compare mode toggles which is visible.
  const preview = {
    group: null,
    generated: null,
    placeholder: makePlaceholderShip(),
  }

  // Re-generate the preview ship from the current working config. Deterministic:
  // no Math.random anywhere in this path — generateShip is fully seeded.
  function renderPreview() {
    const cfg = appState.get()
    const { group } = generateShip(cfg, cfg.seed)
    const old = preview.generated
    if (old) {
      preview.group.remove(old)
      disposeGroup(old)
    }
    preview.generated = group
    preview.group.add(group)
    // Reframe to the whole preview group so the camera fits the generated ship.
    vp.setShip(preview.group)
  }

  // Initial preview from the shared working config. The preview group holds
  // both the generated ship and the placeholder; compare toggles visibility.
  preview.group = new THREE.Group()
  preview.group.name = 'harness-preview'
  preview.group.add(preview.placeholder)
  preview.placeholder.visible = false
  vp.setShip(preview.group)
  renderPreview()
  vp.startLoop()

  // A debounced regenerate so a slider drag re-frames smoothly instead of
  // re-generating + re-framing on every input tick.
  const regenerate = debounce(renderPreview, 80)

  const api = {
    // The current preview group (holds generated + placeholder).
    get shipRoot() {
      return preview.group
    },
    // Current working ShipConfig (a clone) from the shared app/state store.
    getConfig() {
      return appState.get()
    },
    // Deep-merge `patch` into the working config, normalize, and regenerate the
    // preview through the deterministic spine.
    patchConfig(patch) {
      appState.patchConfig(patch)
      regenerate()
    },
    // Persist the working config as a PRESET and notify app/state so a later
    // main-app load can apply it.
    async saveConfig(name) {
      const id = await appState.savePreset(name || harness.title)
      return id
    },
    // Toggle placeholder-vs-generated in the preview (compare mode).
    setCompare(on) {
      applyCompare(preview, !!on)
      compareInput.checked = !!on
    },
  }

  compareInput.addEventListener('change', () => api.setCompare(compareInput.checked))

  harness.build(controlsEl, api)

  onCleanup(() => {
    vp.dispose()
    if (preview.generated) disposeGroup(preview.generated)
    disposeGroup(preview.placeholder)
  })

  return page
}
