import { registerHarness } from './framework.js'
import { paramControls } from './controls.js'
import {
  BRIDGE_STYLES,
  COMMAND_SPIKE_STYLES,
  SENSOR_MAST_STYLES,
  ANTENNA_STYLES,
  HANGAR_STYLES,
  HANGAR_POSITIONS,
  WEAPON_STYLES,
  WEAPON_POSITIONS,
  NACELLE_STRUT_STYLES,
  NACELLE_LIFT_OPTIONS,
  NACELLE_ANGLE_OPTIONS,
  NACELLE_TAIL_OPTIONS,
  NACELLE_MOUNTS,
  NACELLE_TYPES,
  HULL_FEATURE_STYLES,
  HULL_FEATURE_POSITIONS,
} from '../core/generator/modules.js'

// Modules harness — the thin pattern for SP-10. A flat schema mirrors the
// modules sub-object of the ShipConfig schema: a density slider plus an
// enabled toggle and the numeric fields for each module type. Each edit is
// unflattened into the nested modules shape and patched into the working
// config, so the preview regenerates live through the deterministic spine.

const MODULES_SCHEMA = [
  { key: 'density', label: 'Density', type: 'slider', min: 0, max: 1, step: 0.01 },
  // bridge
  { key: 'bridgeEnabled', label: 'Bridge', type: 'toggle' },
  { key: 'bridgeSize', label: 'Bridge size', type: 'slider', min: 0.5, max: 2, step: 0.01 },
  { key: 'bridgeStyle', label: 'Bridge style', type: 'select', options: BRIDGE_STYLES },
  { key: 'bridgePosition', label: 'Bridge position (0 stern → 1 nose)', type: 'slider', min: 0, max: 1, step: 0.01 },
  // commandSpike
  { key: 'commandSpikeEnabled', label: 'Command spike', type: 'toggle' },
  { key: 'commandSpikeHeight', label: 'Spike height', type: 'slider', min: 1, max: 15, step: 0.5 },
  { key: 'commandSpikeStyle', label: 'Spike style', type: 'select', options: COMMAND_SPIKE_STYLES },
  // nacelles
  { key: 'nacellesEnabled', label: 'Nacelles', type: 'toggle' },
  { key: 'nacellesCount', label: 'Nacelle count', type: 'number', min: 0, max: 4, step: 1, int: true },
  { key: 'nacellesSize', label: 'Nacelle size', type: 'slider', min: 0.5, max: 3, step: 0.01 },
  { key: 'nacellesStrut', label: 'Nacelle strut', type: 'select', options: NACELLE_STRUT_STYLES },
  { key: 'nacellesLift', label: 'Nacelle lift', type: 'select', options: NACELLE_LIFT_OPTIONS.map((v) => ({ value: v, label: v === 0 ? 'Level' : v === 1 ? 'High' : `Mid (${v})` })) },
  { key: 'nacellesAngle', label: 'Nacelle angle', type: 'select', options: NACELLE_ANGLE_OPTIONS },
  { key: 'nacellesTail', label: 'Nacelle tail', type: 'select', options: NACELLE_TAIL_OPTIONS },
  { key: 'nacellesMount', label: 'Nacelle mount', type: 'select', options: NACELLE_MOUNTS },
  { key: 'nacellesType', label: 'Nacelle type', type: 'select', options: NACELLE_TYPES },
  // weapons
  { key: 'weaponsEnabled', label: 'Weapons', type: 'toggle' },
  { key: 'weaponsCount', label: 'Weapon count', type: 'number', min: 0, max: 8, step: 1, int: true },
  { key: 'weaponsSize', label: 'Weapon size', type: 'slider', min: 0.5, max: 2, step: 0.01 },
  { key: 'weaponsStyle', label: 'Weapon style', type: 'select', options: WEAPON_STYLES },
  { key: 'weaponsPosition', label: 'Weapon position', type: 'select', options: WEAPON_POSITIONS },
  // sensorMast
  { key: 'sensorMastEnabled', label: 'Sensor mast', type: 'toggle' },
  { key: 'sensorMastCount', label: 'Mast count', type: 'number', min: 0, max: 4, step: 1, int: true },
  { key: 'sensorMastHeight', label: 'Mast height', type: 'slider', min: 1, max: 10, step: 0.5 },
  { key: 'sensorMastStyle', label: 'Mast style', type: 'select', options: SENSOR_MAST_STYLES },
  // antenna
  { key: 'antennaEnabled', label: 'Antenna', type: 'toggle' },
  { key: 'antennaCount', label: 'Antenna count', type: 'number', min: 0, max: 6, step: 1, int: true },
  { key: 'antennaStyle', label: 'Antenna style', type: 'select', options: ANTENNA_STYLES },
  // hangar
  { key: 'hangarEnabled', label: 'Hangar', type: 'toggle' },
  { key: 'hangarCount', label: 'Hangar count', type: 'number', min: 0, max: 2, step: 1, int: true },
  { key: 'hangarStyle', label: 'Hangar style', type: 'select', options: HANGAR_STYLES },
  { key: 'hangarPosition', label: 'Hangar position', type: 'select', options: HANGAR_POSITIONS },
  // hullFeatures
  { key: 'hullFeaturesEnabled', label: 'Hull features', type: 'toggle' },
  { key: 'hullFeaturesCount', label: 'Feature count', type: 'number', min: 0, max: 16, step: 1, int: true },
  { key: 'hullFeaturesSize', label: 'Feature size', type: 'slider', min: 0.5, max: 2, step: 0.01 },
  { key: 'hullFeaturesStyle', label: 'Feature style', type: 'select', options: HULL_FEATURE_STYLES },
  { key: 'hullFeaturesPosition', label: 'Feature position', type: 'select', options: HULL_FEATURE_POSITIONS },
]

// Flatten the working config's modules sub-object into the schema's flat keys
// (nested { enabled, size, ... } -> <name>Enabled / <name>Size / ...).
function flattenModules(m) {
  return {
    density: m.density,
    bridgeEnabled: m.bridge?.enabled,
    bridgeSize: m.bridge?.size,
    bridgeStyle: m.bridge?.style,
    bridgePosition: m.bridge?.position,
    commandSpikeEnabled: m.commandSpike?.enabled,
    commandSpikeHeight: m.commandSpike?.height,
    commandSpikeStyle: m.commandSpike?.style,
    nacellesEnabled: m.nacelles?.enabled,
    nacellesCount: m.nacelles?.count,
    nacellesSize: m.nacelles?.size,
    nacellesStrut: m.nacelles?.strut,
    nacellesLift: m.nacelles?.lift,
    nacellesAngle: m.nacelles?.angle,
    nacellesTail: m.nacelles?.tail,
    nacellesMount: m.nacelles?.mount,
    nacellesType: m.nacelles?.type,
    weaponsEnabled: m.weapons?.enabled,
    weaponsCount: m.weapons?.count,
    weaponsSize: m.weapons?.size,
    weaponsStyle: m.weapons?.style,
    weaponsPosition: m.weapons?.position,
    sensorMastEnabled: m.sensorMast?.enabled,
    sensorMastCount: m.sensorMast?.count,
    sensorMastHeight: m.sensorMast?.height,
    sensorMastStyle: m.sensorMast?.style,
    antennaEnabled: m.antenna?.enabled,
    antennaCount: m.antenna?.count,
    antennaStyle: m.antenna?.style,
    hangarEnabled: m.hangar?.enabled,
    hangarCount: m.hangar?.count,
    hangarStyle: m.hangar?.style,
    hangarPosition: m.hangar?.position,
    hullFeaturesEnabled: m.hullFeatures?.enabled,
    hullFeaturesCount: m.hullFeatures?.count,
    hullFeaturesSize: m.hullFeatures?.size,
    hullFeaturesStyle: m.hullFeatures?.style,
    hullFeaturesPosition: m.hullFeatures?.position,
  }
}

// Fold a flat patch back into the nested modules shape the schema expects.
// Only the keys present in the patch are written, so untouched modules keep
// their existing values through the shared deep-merge in appState.
function unflattenModules(flat) {
  const out = {}
  if ('density' in flat) out.density = flat.density
  const nest = (sub, keys) => {
    for (const [fk, nk] of keys) {
      if (fk in flat) {
        out[sub] = out[sub] || {}
        out[sub][nk] = flat[fk]
      }
    }
  }
  nest('bridge', [['bridgeEnabled', 'enabled'], ['bridgeSize', 'size'], ['bridgeStyle', 'style'], ['bridgePosition', 'position']])
  nest('commandSpike', [['commandSpikeEnabled', 'enabled'], ['commandSpikeHeight', 'height'], ['commandSpikeStyle', 'style']])
  nest('nacelles', [['nacellesEnabled', 'enabled'], ['nacellesCount', 'count'], ['nacellesSize', 'size'], ['nacellesStrut', 'strut'], ['nacellesLift', 'lift'], ['nacellesAngle', 'angle'], ['nacellesTail', 'tail'], ['nacellesMount', 'mount'], ['nacellesType', 'type']])
  nest('weapons', [['weaponsEnabled', 'enabled'], ['weaponsCount', 'count'], ['weaponsSize', 'size'], ['weaponsStyle', 'style'], ['weaponsPosition', 'position']])
  nest('sensorMast', [['sensorMastEnabled', 'enabled'], ['sensorMastCount', 'count'], ['sensorMastHeight', 'height'], ['sensorMastStyle', 'style']])
  nest('antenna', [['antennaEnabled', 'enabled'], ['antennaCount', 'count'], ['antennaStyle', 'style']])
  nest('hangar', [['hangarEnabled', 'enabled'], ['hangarCount', 'count'], ['hangarStyle', 'style'], ['hangarPosition', 'position']])
  nest('hullFeatures', [['hullFeaturesEnabled', 'enabled'], ['hullFeaturesCount', 'count'], ['hullFeaturesSize', 'size'], ['hullFeaturesStyle', 'style'], ['hullFeaturesPosition', 'position']])
  return out
}

registerHarness({
  id: 'modules',
  title: 'Modules',
  description: 'Tune the superstructure. The preview regenerates live from the working config.',
  build(controlsEl, api) {
    controlsEl.appendChild(
      paramControls(MODULES_SCHEMA, flattenModules(api.getConfig().modules), {
        onPatch: (flat) => api.patchConfig({ modules: unflattenModules(flat) }),
      }),
    )
  },
})
