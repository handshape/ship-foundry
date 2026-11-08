import { normalizeConfig, cloneConfig } from '../core/generator/config.js'
import { randomConfig } from '../core/generator/index.js'
import { applyAesthetic } from '../core/aesthetics/index.js'
import { createRng } from '../core/generator/rng.js'
import { storage } from '../persistence/storage.js'

// SHARED APP STATE — the single live working ShipConfig.
//
// A tiny, dependency-free store shared by the harnesses (SP-09) and, later, the
// main app (SP-08). It holds the config the user is currently tuning: the
// harnesses read it as their starting point and write back as they tune, and
// `savePreset` publishes a snapshot so a later main-app load can apply it.
//
// All config writes go through normalizeConfig, so the stored value is always a
// complete, in-range ShipConfig (missing fields filled, out-of-range clamped).
// Listeners are notified on every mutation; they may be async (e.g. re-generate
// the preview).

// The live working config. Lazy-init to a deterministic ship (seed 1) so a
// harness tunes a concrete ship rather than the all-defaults baseline. The
// aesthetic is resolved once here (one-time "new ship" step) so the store holds
// a fully-resolved config; generateShip then renders it purely without
// re-rolling, so later manual edits survive regeneration.
let config = null
function ensure() {
  if (!config) {
    const raw = randomConfig(1)
    const rng = createRng(raw.seed)
    config = normalizeConfig(applyAesthetic(raw.aesthetic, raw, rng))
  }
  return config
}

const listeners = new Set()

function notify() {
  for (const fn of [...listeners]) {
    try {
      fn(cloneConfig(ensure()))
    } catch (err) {
      console.error('state listener failed', err)
    }
  }
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// Recursive merge of plain-object `patch` onto plain-object `target` (in place).
// Primitives, arrays, and null overwrite; plain objects merge recursively.
function deepMerge(target, patch) {
  if (isObject(target) && isObject(patch)) {
    for (const key of Object.keys(patch)) {
      if (isObject(patch[key])) {
        if (!isObject(target[key])) target[key] = {}
        deepMerge(target[key], patch[key])
      } else {
        target[key] = patch[key]
      }
    }
  }
  return target
}

// Persist the working config as a named preset via storage, and publish a
// snapshot so a later main-app load can apply it. Returns the saved preset id.
async function savePreset(name) {
  const cfg = cloneConfig(ensure())
  const presetName = name || `Preset ${new Date().toLocaleString()}`
  const id = await storage.savePreset({
    name: presetName,
    config: cfg,
    aesthetic: cfg.aesthetic,
  })
  appState.publish(id, cfg)
  return id
}

export const appState = {
  // Snapshot of the last published preset ({ id, config, aesthetic, at }).
  // The main app (SP-08) can apply it after a harness save.
  lastSaved: null,

  // Current working ShipConfig (a clone, so callers can't mutate the store).
  get() {
    return cloneConfig(ensure())
  },

  // Subscribe to config changes. Returns an unsubscribe function.
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  // Deep-merge `patch` into the working config, normalize, and notify.
  patchConfig(patch) {
    ensure()
    deepMerge(config, patch)
    config = normalizeConfig(config)
    notify()
    return cloneConfig(config)
  },

  // Replace the working config wholesale (normalized) and notify.
  setConfig(next) {
    config = normalizeConfig(next)
    notify()
    return cloneConfig(config)
  },

  // Publish the tuned config back so the main app can apply it. `snapshot` is
  // a plain { id, config, aesthetic, at } the main app (SP-08) can consume.
  publish(id, cfg) {
    appState.lastSaved = {
      id,
      config: cloneConfig(cfg),
      aesthetic: cfg?.aesthetic ?? null,
      at: Date.now(),
    }
    notify()
    return appState.lastSaved
  },

  savePreset,
}

export default appState
