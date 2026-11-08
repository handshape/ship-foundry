import { registerHarness } from './framework.js'
import { select } from './controls.js'
import { listAesthetics, applyAesthetic } from '../core/aesthetics/index.js'
import { createRng } from '../core/generator/rng.js'

// Aesthetics harness — the thin pattern for SP-10. Pick a design language from
// the AESTHETICS registry; on pick, applyAesthetic re-rolls hull/modules/texture
// from the aesthetic's parameter ranges using a seeded rng, then patches the
// working config so the preview regenerates live. The selected id is pinned
// onto config.aesthetic so the config round-trips. "Save as custom preset"
// persists the tuned config (including the aesthetic) via api.saveConfig.

registerHarness({
  id: 'aesthetics',
  title: 'Aesthetics',
  description: 'Pick a design language and preview its re-rolled hull, modules, and textures.',
  build(controlsEl, api) {
    const list = listAesthetics()
    const currentId = api.getConfig().aesthetic

    // Select: one option per aesthetic, labelled by its display name.
    controlsEl.appendChild(
      select({
        label: 'Design language',
        options: list.map((a) => ({ label: a.label, value: a.id })),
        value: currentId,
        onInput: (id) => apply(id),
      }),
    )

    // Blurb for the selected aesthetic, updated on each pick.
    const blurbEl = document.createElement('p')
    blurbEl.className = 'text-sm opacity-80 min-h-[3rem]'
    blurbEl.textContent = blurbText(currentId, list)
    controlsEl.appendChild(blurbEl)

    // A deterministic "re-roll" seed so the same aesthetic gives variety on each
    // pick while staying reproducible within the config's own seed.
    const reroll = (id) => {
      const base = api.getConfig()
      const rng = createRng(`${base.seed}:${id}`)
      return applyAesthetic(id, base, rng)
    }

    // Apply an aesthetic: resolve its ranges over the current config and patch
    // the working config (hull/modules/texture/aesthetic) so the preview
    // regenerates through the deterministic spine.
    function apply(id) {
      const next = reroll(id)
      api.patchConfig({
        hull: next.hull,
        modules: next.modules,
        texture: next.texture,
        aesthetic: id,
      })
      blurbEl.textContent = blurbText(id, list)
    }

    // Save the tuned config (config + aesthetic) as a named preset.
    const saveBtn = document.createElement('button')
    saveBtn.className = 'btn btn-primary btn-sm'
    saveBtn.textContent = 'Save as custom preset'
    const statusEl = document.createElement('p')
    statusEl.className = 'text-xs opacity-70 min-h-[1rem]'
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true
      try {
        const id = await api.saveConfig()
        statusEl.textContent = `Saved preset ${id}.`
      } catch (err) {
        statusEl.textContent = `Save failed: ${err.message}`
      } finally {
        saveBtn.disabled = false
      }
    })
    controlsEl.appendChild(saveBtn)
    controlsEl.appendChild(statusEl)
  },
})

function blurbText(id, list) {
  const a = list.find((x) => x.id === id)
  return a ? a.blurb : ''
}
