import { registerHarness } from './framework.js'
import { select } from './controls.js'
import { exportAndDownload } from '../core/three/exporter.js'

// Export harness — the thin pattern for SP-10. It reads (never mutates) the
// working config: a format select (GLB/GLTF), a filename input, and a note of
// the current texture resolution. "Download" exports the live preview group via
// exportAndDownload and reports the resulting byte size. "Copy config JSON"
// puts the current config on the clipboard (with a textarea fallback for
// browsers without async clipboard access).

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

registerHarness({
  id: 'export',
  title: 'Export',
  description: 'Export the current ship as GLB or GLTF. The preview shows the live ship.',
  build(controlsEl, api) {
    const cfg = api.getConfig()

    // Format: GLB (binary) vs GLTF (JSON). Drives the file extension and the
    // binary flag passed to exportAndDownload.
    const formatState = { value: 'glb' }
    controlsEl.appendChild(
      select({
        label: 'Format',
        options: [
          { label: 'GLB (binary)', value: 'glb' },
          { label: 'GLTF (JSON)', value: 'gltf' },
        ],
        value: formatState.value,
        onInput: (v) => {
          formatState.value = v
        },
      }),
    )

    // Filename (without extension; the extension is appended from the format).
    const filenameState = { value: 'ship-foundry' }
    const filenameInput = document.createElement('input')
    filenameInput.type = 'text'
    filenameInput.className = 'input input-bordered input-sm w-full'
    filenameInput.value = filenameState.value
    filenameInput.placeholder = 'ship-foundry'
    filenameInput.addEventListener('input', () => {
      filenameState.value = filenameInput.value.trim() || 'ship-foundry'
    })
    const filenameWrap = document.createElement('div')
    filenameWrap.className = 'form-control'
    const filenameHead = document.createElement('div')
    filenameHead.className = 'label pb-1'
    filenameHead.append(
      Object.assign(document.createElement('span'), { className: 'label-text', textContent: 'Filename' }),
    )
    filenameWrap.append(filenameHead, filenameInput)
    controlsEl.appendChild(filenameWrap)

    // Texture resolution note (read from config.texture.size; not editable here).
    const sizeNote = document.createElement('p')
    sizeNote.className = 'text-xs opacity-70'
    sizeNote.textContent = `Texture resolution: ${cfg.texture?.size ?? '—'}px`
    controlsEl.appendChild(sizeNote)

    // Status line for the last export (or copy) result.
    const statusEl = document.createElement('p')
    statusEl.className = 'text-sm opacity-80 min-h-[1.5rem]'
    controlsEl.appendChild(statusEl)

    // Download: export the live preview group and trigger a browser download.
    const downloadBtn = document.createElement('button')
    downloadBtn.className = 'btn btn-primary btn-sm'
    downloadBtn.textContent = 'Download'
    downloadBtn.addEventListener('click', async () => {
      const format = formatState.value
      const filename = `${filenameState.value}.${format}`
      downloadBtn.disabled = true
      statusEl.textContent = 'Exporting…'
      try {
        const size = await exportAndDownload(api.shipRoot, filename, { binary: format === 'glb' })
        statusEl.textContent = `Exported ${filename} (${formatBytes(size)}).`
      } catch (err) {
        statusEl.textContent = `Export failed: ${err.message}`
      } finally {
        downloadBtn.disabled = false
      }
    })
    controlsEl.appendChild(downloadBtn)

    // Copy config JSON (optional). Uses the async clipboard API with a
    // textarea/execCommand fallback for environments without clipboard access.
    const copyBtn = document.createElement('button')
    copyBtn.className = 'btn btn-outline btn-sm'
    copyBtn.textContent = 'Copy config JSON'
    copyBtn.addEventListener('click', async () => {
      const json = JSON.stringify(api.getConfig(), null, 2)
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(json)
          statusEl.textContent = 'Config JSON copied to clipboard.'
          return
        }
        throw new Error('clipboard unavailable')
      } catch {
        const ta = document.createElement('textarea')
        ta.value = json
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        statusEl.textContent = ok ? 'Config JSON copied to clipboard.' : 'Copy failed — select the JSON manually.'
      }
    })
    controlsEl.appendChild(copyBtn)
  },
})
