import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// COORDINATE CONVENTION (applies across the whole app):
//   - A ship's FORWARD direction is +Z.
//   - A ship's origin is its center.
//   - The default camera sits on the -Z side, so the ship's nose points away
//     from the camera into the scene.
//
// createViewport(container, { preset, antialias, pixelRatio } = {}) ->
//   { scene, camera, controls,
//     setShip(group|null), setCameraPreset(name),
//     startLoop, stopLoop, resize, dispose }
//
// The viewport owns one ship at a time. setShip() disposes the previous
// group's geometries/materials, adds the new one, and frames the camera to
// its bounding sphere (with a margin) so the ship is visible at any scale.
// dispose() is idempotent: it stops the render loop, disposes the scene
// contents, releases the WebGL context, and removes the canvas.

// Camera presets: unit direction from the framed center toward the camera.
// 'three-quarter' (the default) sits on the -Z side per the convention:
// behind, above, and to the starboard of the ship.
const CAMERA_PRESETS = {
  front: new THREE.Vector3(0, 0, 1),
  side: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 1e-4),
  'three-quarter': new THREE.Vector3(0.75, 0.5, -1).normalize(),
}

// Consistent three-light rig for every scene: a hemisphere ambient with a DARK
// ground colour (so the underside falls into shade, not a bright floor bounce),
// a warm key from high above (the shadow-casting light, the dominant term), and
// a dim cool fill from the front/side (NOT from below) so the top stays clearly
// brighter than the bottom.
// The key light casts soft shadows; the shadow camera is sized generously so a
// frigate-to-dreadnought ship stays inside it, and the map is high-res for clean
// edges.
export function LIGHTING_RIG(scene) {
  // Sky colour lights the top; ground colour (very dark) barely lights the
  // underside, giving the top/bottom contrast.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x0a0e16, 0.55)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  // Steep from above so the key hits the deck hard and the keel is in shadow.
  key.position.set(5, 14, -6)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.camera.near = 0.5
  key.shadow.camera.far = 200
  // Generous ortho shadow frustum (ships span up to ~150 units long).
  const s = 120
  key.shadow.camera.left = -s
  key.shadow.camera.right = s
  key.shadow.camera.top = s
  key.shadow.camera.bottom = -s
  // Slight bias to avoid shadow acne without peter-panning.
  key.shadow.bias = -0.0002
  key.shadow.normalBias = 0.02
  scene.add(key)

  // Fill from the front and to the side (roughly eye level), deliberately NOT
  // from below, so it doesn't wash out the underside.
  const fill = new THREE.DirectionalLight(0x88aaff, 0.35)
  fill.position.set(-8, 1, 8)
  scene.add(fill)

  return { hemi, key, fill }
}

// Mark every mesh in a group to cast and receive shadows (idempotent).
export function enableShadows(object) {
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })
}

const _box = new THREE.Box3()
const _sphere = new THREE.Sphere()
const _dir = new THREE.Vector3()
const _sz = new THREE.Vector3()

/**
 * Frame the camera on `object`'s bounding sphere, padded by `margin`.
 * The camera keeps its current viewing direction (so it composes with the
 * current preset or the user's orbit) and moves along it to a distance where
 * the padded sphere fills the view vertically and horizontally. Also moves
 * the OrbitControls target to the sphere's center.
 * Returns { center, distance }, or null if the object has no bounds.
 */
export function frameToObject(camera, controls, object, margin = 1.35) {
  _box.setFromObject(object)
  if (_box.isEmpty()) return null
  _box.getBoundingSphere(_sphere)
  if (_sphere.radius <= 0) return null

  const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2
  // Guard against a degenerate (unlaid-out) aspect ratio.
  const aspect = Number.isFinite(camera.aspect) && camera.aspect > 0.2 ? camera.aspect : 1
  const hHalf = Math.atan(Math.tan(vHalf) * aspect)
  const distance = Math.max(
    (_sphere.radius * margin) / Math.sin(vHalf),
    (_sphere.radius * margin) / Math.sin(hHalf),
  )

  _dir.subVectors(camera.position, controls.target)
  if (_dir.lengthSq() < 1e-12) _dir.set(0, 0.25, -1)
  _dir.normalize()

  controls.target.copy(_sphere.center)
  camera.position.copy(_sphere.center).addScaledVector(_dir, distance)
  controls.update()
  return { center: _sphere.center.clone(), distance }
}

function disposeObject(object) {
  object.traverse((o) => {
    o.geometry?.dispose?.()
    const m = o.material
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose())
    else m?.dispose?.()
  })
}

export function createViewport(container, { preset = 'three-quarter', antialias = true, pixelRatio } = {}) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b1020)

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000)

  const renderer = new THREE.WebGLRenderer({ antialias })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatio ?? 2))
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1)
  // PCF shadow mapping so the key light's shadows read as visible, soft-edged
  // rather than hard aliasing. (PCFSoftShadowMap was removed from three.js;
  // PCFShadowMap is the current equivalent.)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  container.appendChild(renderer.domElement)

  LIGHTING_RIG(scene)

  // A large, mostly-invisible ground plane that receives the ship's shadow.
  // It sits just below the ship's origin (the ship floats above it) and is a
  // ShadowMaterial so only the shadow is drawn — the grid + background show
  // through elsewhere.
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(800, 800),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  )
  shadowPlane.rotation.x = -Math.PI / 2
  shadowPlane.position.y = -60
  shadowPlane.receiveShadow = true
  scene.add(shadowPlane)

  const grid = new THREE.GridHelper(40, 40, 0x2dd4bf, 0x334155)
  scene.add(grid)

  // Explicit +Z "forward" arrow so the convention is visible at a glance.
  const zAxis = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, 0),
    6,
    0x22c55e,
    1,
    0.5,
  )
  scene.add(zAxis)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0, 0)

  let ship = null
  let frameCenter = new THREE.Vector3()
  let frameDistance = 12
  let framePending = false
  let raf = 0
  let running = false
  let disposed = false

  const doFrame = () => {
    if (!ship) return
    // The container may not be laid out yet (views are built before they are
    // mounted); defer framing until the ResizeObserver reports a real size.
    if (container.clientWidth < 2 || container.clientHeight < 2) {
      framePending = true
      return
    }
    framePending = false
    const result = frameToObject(camera, controls, ship)
    if (result) {
      frameCenter.copy(result.center)
      frameDistance = result.distance
      // Seat the shadow-catcher just below the ship's lowest point and size it
      // to cover the ship's footprint, so the key light's shadow always lands
      // on it regardless of ship scale.
      _box.setFromObject(ship)
      const drop = Math.max(4, _box.getSize(_sz).y * 0.1 + 2)
      shadowPlane.position.set(frameCenter.x, _box.min.y - drop, frameCenter.z)
      const footprint = Math.max(20, _box.getSize(_sz).x, _box.getSize(_sz).z) * 2
      shadowPlane.scale.set(footprint / 800, footprint / 800, 1)
    }
  }

  const setShip = (group) => {
    if (disposed) return
    if (ship) {
      scene.remove(ship)
      disposeObject(ship)
    }
    ship = group ?? null
    if (ship) {
      enableShadows(ship)
      scene.add(ship)
      framePending = true
      doFrame()
    } else {
      frameCenter.set(0, 0, 0)
    }
  }

  const setCameraPreset = (name) => {
    const dir = CAMERA_PRESETS[name] ?? CAMERA_PRESETS['three-quarter']
    camera.position.copy(frameCenter).addScaledVector(dir, frameDistance)
    controls.target.copy(frameCenter)
    controls.update()
  }

  // Apply the initial preset direction (framing replaces the distance once
  // a ship is set and the container is laid out).
  setCameraPreset(preset)

  const loop = () => {
    controls.update()
    renderer.render(scene, camera)
    raf = requestAnimationFrame(loop)
  }
  const startLoop = () => {
    if (running || disposed) return
    running = true
    raf = requestAnimationFrame(loop)
  }
  const stopLoop = () => {
    if (!running) return
    running = false
    cancelAnimationFrame(raf)
  }

  const resize = () => {
    const w = container.clientWidth || 1
    const h = container.clientHeight || 1
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    if (framePending) doFrame()
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(container)

  const dispose = () => {
    if (disposed) return
    disposed = true
    stopLoop()
    ro.disconnect()
    controls.dispose()
    if (ship) {
      scene.remove(ship)
      disposeObject(ship)
      ship = null
    }
    scene.traverse((o) => {
      o.geometry?.dispose?.()
      const m = o.material
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose())
      else m?.dispose?.()
    })
    renderer.dispose()
    renderer.forceContextLoss()
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement)
    }
  }

  return {
    scene,
    camera,
    controls,
    setShip,
    setCameraPreset,
    startLoop,
    stopLoop,
    resize,
    dispose,
  }
}
