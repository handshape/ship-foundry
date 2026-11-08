# SP-01: Reusable 3D viewport & scene rig

**Phase 1** · **Depends on:** — · **Primary files:** `src/core/three/scene.js`
(touched: `src/views/main.js`, `src/harness/framework.js`)

## Goal
Turn the scaffold's `createScene`/`startRenderLoop` into a single, reusable
**Viewport** used by the main app *and* every harness. Add automatic camera
framing to a ship's bounding box, a consistent lighting rig, and clean
mount/unmount semantics so WebGL contexts are never leaked.

## Context
`createScene(container)` and `startRenderLoop(handle)` already exist and enforce
the +Z-forward convention (grid + green +Z arrow). The main view and harness
framework each call these directly and manage their own render loop.

## Scope
- **In:** a `createViewport(container, opts)` factory; camera framing; a named
  lighting rig; `mount`/`setShip`/`unmount`; camera presets (front/side/top/3/4);
  quality knobs (pixelRatio cap, antialias); dispose that is idempotent.
- **Out:** the actual ship geometry (SP-04/05), export (exporter.js), persistence.

## Public contract
```js
import { createViewport } from '../core/three/scene.js'

const vp = createViewport(container, { preset: 'three-quarter' })
vp.setShip(threeGroup)        // replace ship + reframe camera to its bounds
vp.setShip(group)             // no-arg -> clears the ship
vp.setCameraPreset('front')   // 'front' | 'side' | 'top' | 'three-quarter'
vp.startLoop()                // begin rAF loop
vp.stopLoop()
vp.resize()
vp.dispose()                  // idempotent; removes canvas + context
// exposes: vp.scene, vp.camera, vp.controls
```
Also export `frameToObject(camera, controls, object)` (fits a bounding sphere
with a margin) and a `LIGHTING_RIG` builder.

## Acceptance criteria
- [ ] Main view and both example harnesses use `createViewport` (no direct
      `createScene` calls remain outside `scene.js`).
- [ ] After `setShip`, the camera frames the ship regardless of its scale.
- [ ] Navigating main → harness → main leaks zero WebGL contexts (verify in
      devtools: "WebGL" context count stays stable).
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Refactor `src/core/three/scene.js` to expose `createViewport` per the contract
> above. Keep the +Z-forward convention, grid, and axis arrow. Add `frameToObject`
> using a bounding sphere + margin. Replace the direct `createScene`/
> `startRenderLoop` usage in `views/main.js` and `harness/framework.js` with the
> viewport. Ensure dispose is idempotent and the render loop is stopped on
> dispose. Keep build and lint green.
