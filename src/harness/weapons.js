import * as THREE from 'three'
import { registerHarness } from './framework.js'
import { paramControls } from './controls.js'
import { createViewport } from '../core/three/scene.js'
import { disposeGroup } from '../core/generator/index.js'
import { onCleanup } from '../app/cleanup.js'
import { createRng } from '../core/generator/rng.js'
import { WEAPON_POSITIONS, buildWeaponOnBlock } from '../core/generator/modules.js'

// Weapons harness — a focused random-weapon viewer. Unlike the other harnesses
// (which regenerate the full ship from the working config), this one owns its
// preview (ownsPreview: true) and renders an isolated scene: a single
// semitransparent block with ONE weapon mounted on its top face. Every weapon
// is a random modular assortment (mount + barrels + tip, rolled from the
// seeded rng), so the harness lets you roll new weapons and tune their
// position/size in isolation without the rest of the ship.

const WEAPONS_SCHEMA = [
  { key: 'position', label: 'Weapon position', type: 'select', options: WEAPON_POSITIONS },
  { key: 'size', label: 'Weapon size', type: 'slider', min: 0.5, max: 2, step: 0.01 },
]

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
    'Every weapon is a random modular assortment (mount + barrels + tip). Roll new weapons and tune their position and size on the block.',
  ownsPreview: true,
  build(controlsEl, api) {
    const vp = createViewport(api.previewEl, { preset: 'three-quarter' })

    const sceneGroup = new THREE.Group()
    sceneGroup.name = 'weapons-preview'
    const block = buildBlock()
    sceneGroup.add(block)
    let weapon = null
    // Set the ship once (it disposes the previous group's contents, so calling
    // it again would destroy the block + new weapon). Subsequent renders swap
    // the weapon child in place and re-frame instead of re-adding the group.
    vp.setShip(sceneGroup)

    // The seed for the preview's rng. The weapon combination (mount/barrels/
    // tip) is rolled from this seed; it only changes when "Roll new weapon" is
    // clicked, so tuning position/size re-renders the SAME weapon with new
    // placement rather than re-rolling the assortment.
    let weaponSeed = 1

    function renderWeapon(cfg) {
      if (weapon) {
        sceneGroup.remove(weapon)
        disposeGroup(weapon)
      }
      const rng = createRng(weaponSeed)
      weapon = buildWeaponOnBlock(rng, cfg, BLOCK)
      sceneGroup.add(weapon)
      vp.reFrame()
    }

    // Local working copy of the weapon params. The harness owns its preview and
    // renders an isolated fixture, so it keeps its own state rather than writing
    // through the shared store (api.getConfig() returns a throwaway clone, so
    // mutating it would not survive the next read).
    const cfg = {
      position: api.getConfig().modules.weapons.position ?? 'top',
      size: api.getConfig().modules.weapons.size ?? 1,
    }
    renderWeapon(cfg)
    vp.startLoop()

    controlsEl.appendChild(
      paramControls(WEAPONS_SCHEMA, cfg, {
        onPatch: (patch) => {
          Object.assign(cfg, patch)
          renderWeapon(cfg)
        },
      }),
    )

    // "Roll new weapon" button: re-roll the modular assortment (new mount,
    // barrels, tip). Bumps the seed so every roll is a different weapon.
    const rollBtn = document.createElement('button')
    rollBtn.className = 'btn btn-primary btn-sm w-full mt-2'
    rollBtn.textContent = 'Roll new weapon'
    rollBtn.addEventListener('click', () => {
      weaponSeed += 1
      renderWeapon(cfg)
    })
    controlsEl.appendChild(rollBtn)

    onCleanup(() => {
      vp.dispose()
      if (weapon) disposeGroup(weapon)
      disposeGroup(block)
    })
  },
})
