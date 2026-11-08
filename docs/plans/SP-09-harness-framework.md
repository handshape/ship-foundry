# SP-09: Harness framework completion

**Phase 3** · **Depends on:** SP-01, SP-02 · **Primary files:**
`src/harness/framework.js`, new `src/harness/controls.js`, new `src/app/state.js`

## Goal
Finish the harness framework so per-aspect harnesses (SP-10) are thin: shared,
schema-driven controls, a working save-to-config path, and a compare mode.

## Context
`framework.js` has `registerHarness`/`getHarness`/`runHarness`/`harnessIndexView`.
`runHarness` gives each harness an `api` (`scene`, `shipRoot`, `setShip`,
`refresh`, `saveConfig` — the last is a `console.debug` stub). `hull.js` and
`textures.js` are example harnesses using hand-rolled controls.

## Scope
- **In:**
  - `src/harness/controls.js`: DaisyUI-styled, schema-driven controls —
    `slider`, `select`, `color`, `toggle`, `number`, and a generic
    `paramControls(schema, value, onPatch)` that builds a whole param group from
    a schema (`{ key, label, type, min, max, step, options }`).
  - Upgrade the `api` in `runHarness`:
    `getConfig()` (current working config, from `app/state`),
    `patchConfig(patch)` (deep-merge into the working config + regenerate the
    preview ship via the spine), `saveConfig()` (persist the working config as a
    **preset** via SP-03 storage and notify `app/state` so the main app can apply
    it), and a **compare** toggle (placeholder vs generated).
  - A tiny `app/state.js` shared by the main app and harnesses so a harness can
    tune the *live* ship's config and push results back.
- **Out:** the individual aspect harnesses (SP-10) — this only provides the
  framework + shared controls.

## Public contract
```js
// controls.js
paramControls(schema, value, { onPatch }) -> HTMLElement
slider/select/color/toggle/number(...) -> HTMLElement
// framework runHarness api
api.getConfig() -> ShipConfig
api.patchConfig({ hull:{...}, texture:{...}, ... }) -> void   // regenerates preview
api.saveConfig() -> Promise<void>                              // persists preset + notifies
api.setCompare(on: boolean)
```
- Harnesses should be able to be written in ~15 lines each (schema + build).

## Acceptance criteria
- [ ] `paramControls` renders a full group from a schema and calls `onPatch`.
- [ ] `patchConfig` updates the preview ship live via the spine.
- [ ] `saveConfig` persists a preset and the main app reflects it after reload.
- [ ] `hull.js`/`textures.js` rewritten to use `paramControls` (demonstrating the
      thin pattern).
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Complete the harness framework. Add `src/harness/controls.js` with
> `paramControls` plus slider/select/color/toggle/number. Upgrade `runHarness`'s
> `api` with `getConfig`, `patchConfig` (regenerates the preview via the spine),
> `saveConfig` (persists a preset via storage and notifies a new shared
> `src/app/state.js`), and `setCompare`. Rewrite the hull and textures example
> harnesses to use `paramControls` so each harness is ~15 lines. Keep build and
> lint green.
