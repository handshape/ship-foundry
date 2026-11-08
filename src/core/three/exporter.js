import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

// Wraps three.js GLTFExporter and adds a browser-download helper so the main
// app and the export harness can share one code path.

/**
 * Export a THREE.Object3D to GLTF.
 *   binary=true  -> resolves with an ArrayBuffer (a .glb)
 *   binary=false -> resolves with a JSON object (a .gltf)
 */
export function exportGLTF(object, { binary = true } = {}) {
  const exporter = new GLTFExporter()
  return new Promise((resolve, reject) => {
    exporter.parse(
      object,
      (result) => resolve(result),
      (error) => reject(error),
      { binary },
    )
  })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Export and trigger a browser download.
 *   binary=true  -> filename should be e.g. 'ship.glb'
 *   binary=false -> filename should be e.g. 'ship.gltf'
 * Resolves with the exported byte size.
 */
export async function exportAndDownload(object, filename, { binary = true } = {}) {
  const result = await exportGLTF(object, { binary })
  const type = binary ? 'model/gltf-binary' : 'model/gltf+json'
  const data = binary ? result : JSON.stringify(result, null, 2)
  const blob = new Blob([data], { type })
  downloadBlob(blob, filename)
  return blob.size
}
