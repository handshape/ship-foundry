import * as THREE from 'three'
import { registerHarness } from './framework.js'
import { paramControls } from './controls.js'
import { createViewport } from '../core/three/scene.js'
import { disposeGroup } from '../core/generator/index.js'
import { onCleanup } from '../app/cleanup.js'
import { createRng } from '../core/generator/rng.js'
import { WEAPON_STYLES, WEAPON_POSITIONS, buildWeaponOnBlock } from '../core/generator/modules.js'

// Weapons harness — a focused style browser. Unlike the other harnesses (which
// regenerate the full ship from the working config), this one owns its preview
// (ownsPreview: true) and renders an isolated scene: a single semitransparent
// block with ONE weapon mounted on its top face. Selecting a style/position
// renders that one weapon, so the catalog can be refined in isolation without
// the rest of the ship.

const WEAPONS_SCHEMA = [
  { key: 'style', label: 'Weapon style', type: 'select', options: WEAPON_STYLES },
  { key: 'position', label: 'Weapon position', type: 'select', options: WEAPON_POSITIONS },
  { key: 'size', label: 'Weapon size', type: 'slider', min: 0.5, max: 2, step: 0.01 },
]

// A fixed seed keeps the preview deterministic: the same style always renders
// the same weapon.
const HARNESS_SEED = 1234

// Block dimensions for the preview mount (a centred rectangular box).
const BLOCK = { width: 8, height: 3, depth: 10 }

// Build the semitransparent block that the weapon is mounted on.
function buildBlock() {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8a94a6,
    transparent: true,
    opacity: 0.3,
    metalness: 0.2,
    roughness: 0.6,
  })
  const block = new THREE.Mesh(new THREE.BoxGeometry(BLOCK.width, BLOCK.height, BLOCK.depth), mat)
  block.name = 'weapons-block'
  return block
}

registerHarness({
  id: 'weapons',
  title: 'Weapons',
  description:
    'Browse the weapon catalog. Select a style and position; a single instance is mounted on the block.',
  ownsPreview: true,
  build(controlsEl, api) {
    const vp = createViewport(api.previewEl, { preset: 'three-quarter' })

    const sceneGroup = new THREE.Group()
    sceneGroup.name = 'weapons-preview'
    const block = buildBlock()
    sceneGroup.add(block)
    let weapon = null
    vp.setShip(sceneGroup)

    function renderWeapon(cfg) {
      if (weapon) {
        sceneGroup.remove(weapon)
        disposeGroup(weapon)
      }
      const rng = createRng(HARNESS_SEED)
      weapon = buildWeaponOnBlock(rng, cfg, BLOCK)
      sceneGroup.add(weapon)
      vp.setShip(sceneGroup)
    }

    const initial = {
      style: api.getConfig().modules.weapons.style ?? 'turret',
      position: api.getConfig().modules.weapons.position ?? 'top',
      size: api.getConfig().modules.weapons.size ?? 1,
    }
    renderWeapon(initial)
    vp.startLoop()

    controlsEl.appendChild(
      paramControls(WEAPONS_SCHEMA, initial, {
        onPatch: (patch) => {
          Object.assign(api.getConfig().modules.weapons, patch)
          renderWeapon(api.getConfig().modules.weapons)
        },
      }),
    )

    onCleanup(() => {
      vp.dispose()
      if (weapon) disposeGroup(weapon)
      disposeGroup(block)
    })
  },
})
