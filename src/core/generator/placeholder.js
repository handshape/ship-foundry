import * as THREE from 'three'

// Placeholder ship used by the scaffold and harnesses before the real
// generator (sub-plans 3/4/5) lands. Forward is +Z, origin at center.
// It exists so the render/export/persistence pipeline can be exercised today.
export function makePlaceholderShip() {
  const group = new THREE.Group()
  group.name = 'ship'

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.6,
    roughness: 0.4,
  })
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 10), hullMat)
  group.add(hull)

  const noseMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.7,
    roughness: 0.3,
  })
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2.5, 24), noseMat)
  nose.rotation.x = -Math.PI / 2 // point cone tip toward +Z (forward)
  nose.position.z = 6.25
  group.add(nose)

  const engineMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 0.6,
    metalness: 0.3,
    roughness: 0.4,
  })
  for (const x of [-0.8, 0.8]) {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 16), engineMat)
    engine.rotation.x = Math.PI / 2 // align cylinder axis with Z
    engine.position.set(x, 0, -5.75)
    group.add(engine)
  }

  return group
}
