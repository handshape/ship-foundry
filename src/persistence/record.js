import * as THREE from 'three'

// PERSISTENCE RECORDS (SP-03).
//
// A ShipRecord is what IndexedDB stores for a saved ship:
//   { id, v, name, savedAt, config, thumbnail?, stats }
//   - v         record schema version (RECORD_VERSION); db.js migrates on bump
//   - config    the canonical ShipConfig (plain JSON). config + config.seed
//               fully regenerate the ship; everything else is a cache.
//   - thumbnail small PNG data URL (cache only, never the source of truth)
//   - stats     derived values, recomputable from config (cache only)

export const RECORD_VERSION = 1

export const uid = () =>
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

// Default display name for a record with no explicit name.
export const defaultShipName = (id) => `Ship ${String(id).slice(0, 8)}`

// --- derived stats -----------------------------------------------------------

// Ship class from hull length. The schema floor is frigate-scale (length 20),
// and 150 is the capital-ship ceiling, so thresholds sit in between.
function classFromLength(length) {
  if (length < 50) return 'frigate'
  if (length < 80) return 'destroyer'
  if (length < 115) return 'cruiser'
  return 'battleship'
}

// Count of enabled superstructure modules. Entries with a numeric `count`
// contribute that many; entries without one (bridge, commandSpike) count 1.
function countModules(modules) {
  let total = 0
  for (const value of Object.values(modules ?? {})) {
    if (value && typeof value === 'object' && value.enabled) {
      total += Number.isFinite(value.count) ? value.count : 1
    }
  }
  return total
}

// Derived, cache-only stats for a config. Never the source of truth.
export function shipStats(config) {
  const hull = config?.hull ?? {}
  const texture = config?.texture ?? {}
  return {
    className: classFromLength(Number(hull.length) || 0),
    hullArchetype: hull.archetype ?? 'unknown',
    moduleCount: countModules(config?.modules),
    textureSize: Number(texture.size) || 0,
  }
}

// --- record construction -------------------------------------------------------

// Build a full ShipRecord. `id`, `name`, `savedAt` default when omitted;
// `stats` defaults to values derived from the config; `thumbnail` is stored
// only when provided (older records may legitimately lack one).
export function buildShipRecord({ id, name, config, thumbnail, stats, savedAt } = {}) {
  const recordId = id ?? uid()
  const record = {
    id: recordId,
    v: RECORD_VERSION,
    name: name || defaultShipName(recordId),
    savedAt: savedAt ?? Date.now(),
    config,
    stats: stats ?? shipStats(config),
  }
  if (thumbnail !== undefined) record.thumbnail = thumbnail
  return record
}

// --- thumbnails -----------------------------------------------------------------

// Render a duck-typed viewport ({ scene, camera }) — the SP-01 viewport or a
// scaffold scene both qualify — into a temporary offscreen WebGLRenderer and
// resolve with a small PNG data URL. The temp renderer is disposed (and its
// context force-released) immediately, so no WebGL context leaks.
export function captureThumbnail(viewport, { w = 256, h = 160 } = {}) {
  return new Promise((resolve, reject) => {
    const { scene, camera } = viewport ?? {}
    if (!scene || !camera) {
      reject(new Error('captureThumbnail: expected a viewport exposing { scene, camera }'))
      return
    }
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false })
      renderer.setSize(w, h)
      renderer.render(scene, makeThumbnailCamera(camera, w / h))
      resolve(renderer.domElement.toDataURL('image/png'))
    } catch (err) {
      reject(err)
    } finally {
      renderer?.dispose()
      renderer?.forceContextLoss?.()
    }
  })
}

// A throwaway camera that matches the source view but uses the thumbnail's
// aspect ratio, so the live viewport camera is never mutated.
function makeThumbnailCamera(camera, aspect) {
  if (camera.isPerspectiveCamera) {
    const cam = new THREE.PerspectiveCamera(camera.fov, aspect, camera.near, camera.far)
    cam.position.copy(camera.position)
    cam.quaternion.copy(camera.quaternion)
    cam.updateProjectionMatrix()
    return cam
  }
  const cam = camera.clone()
  if ('aspect' in cam) {
    cam.aspect = aspect
    cam.updateProjectionMatrix?.()
  }
  return cam
}
