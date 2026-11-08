import { registerHarness } from './framework.js'
import { paramControls } from './controls.js'
import { HULL_ARCHETYPES, HULL_SECTIONS } from '../core/generator/hull.js'

// Hull harness — the thin pattern for SP-10: a schema (mirroring the hull
// sub-object of the ShipConfig schema) + a build that wires onPatch to the
// framework's api.patchConfig. The preview regenerates live via the spine.
const HULL_SCHEMA = [
  { key: 'archetype', label: 'Archetype', type: 'select', options: HULL_ARCHETYPES },
  { key: 'length', label: 'Length', type: 'slider', min: 20, max: 150, step: 1, int: true },
  { key: 'beam', label: 'Beam', type: 'slider', min: 8, max: 60, step: 1 },
  { key: 'height', label: 'Height', type: 'slider', min: 4, max: 40, step: 1 },
  { key: 'crossSection', label: 'Cross-section', type: 'select', options: HULL_SECTIONS },
  { key: 'noseTaper', label: 'Nose taper', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'sternTaper', label: 'Stern taper', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'chamfer', label: 'Chamfer', type: 'slider', min: 0, max: 1, step: 0.01 },
  { key: 'stations', label: 'Stations', type: 'slider', min: 6, max: 24, step: 1, int: true },
  // Disc archetype params.
  { key: 'discUpperCurve', label: 'Disc upper curve', type: 'select', options: ['convex', 'concave'] },
  { key: 'discLowerCurve', label: 'Disc lower curve', type: 'select', options: ['convex', 'concave'] },
  { key: 'discEdge', label: 'Disc edge', type: 'select', options: ['cylinder', 'frustum'] },
]

registerHarness({
  id: 'hull',
  title: 'Hull',
  description: 'Tune hull geometry. The preview regenerates live from the working config.',
  build(controlsEl, api) {
    controlsEl.appendChild(paramControls(HULL_SCHEMA, api.getConfig().hull, { onPatch: (p) => api.patchConfig(p) }))
  },
})
