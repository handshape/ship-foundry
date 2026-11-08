# Ship Foundry

A **purely client-side procedural starship generator**. Ships are generated
entirely in the browser — no backend, no network — and can be tuned per-aspect on
dedicated harness pages, saved to browser storage, and exported as GLTF/GLB.

> _Screenshot placeholder — drop a render of the main viewport here._

- Ships are **frigates and larger**, with their **forward axis on +Z** and origin
  at the ship's center.
- A variety of **design aesthetics** (original design languages inspired by
  popular sci-fi universes — not trademarked assets).
- **Procedurally generated textures** (canvas-based, baked into the export).
- **IndexedDB** persistence for ships and presets.
- Ships are **deterministic**: the same config + seed always reproduces the same
  ship (all randomness is seeded; no `Math.random` in the generator).
- **MIT** licensed.

## Stack

| Concern     | Choice                                             |
| ----------- | -------------------------------------------------- |
| Language    | JavaScript (ESM)                                   |
| Build       | Vite (SPA, `base: './'` for host-agnostic output)  |
| Styling     | Tailwind CSS v4 + DaisyUI v5                       |
| Icons       | Lucide (swapped in after each render)              |
| 3D          | three.js (+ `GLTFExporter` from `examples/jsm`)    |
| Persistence | IndexedDB (thin custom wrapper in `src/persistence`) |
| Routing     | Single-page app + hash routing (no router library) |

## Getting started

```bash
npm install
npm run dev        # start the dev server (http://localhost:5173)
```

Other scripts:

```bash
npm run build      # production build to dist/
npm run preview    # serve the production build
npm run lint       # eslint
```

## Routes

| Route             | View                                              |
| ----------------- | ------------------------------------------------- |
| `#/`              | main application (viewport, controls, save, export) |
| `#/harness`       | index of all tuning harnesses                     |
| `#/harness/:id`   | a single tuning harness (e.g. `#/harness/hull`)   |

### The 5 harnesses

Each harness isolates one aspect of the generator, with a live preview and a
save-to-config path:

| `:id`       | Harness    | What it tunes                                            |
| ----------- | ---------- | -------------------------------------------------------- |
| `hull`      | Hull       | hull geometry (archetype, length, beam, tapers, sections) |
| `modules`   | Modules    | the superstructure (density + per-module counts/sizes)   |
| `textures`  | Textures   | procedural surface (palette, panel lines, greebles, wear, stripes, emblem, size) |
| `aesthetics`| Aesthetics | pick a design language; re-rolls hull/modules/texture within its ranges |
| `export`    | Export     | export the live ship as GLB or GLTF, or copy the config JSON |

## Conventions & persistence

- **+Z is forward**; the ship's origin is its center. The default camera sits on
  the −Z side, so the nose points away from the camera.
- **IndexedDB** stores: `ships` (saved `ShipRecord`s) and `presets` (named config
  presets from the harnesses). A saved ship's `config` + `seed` are the source of
  truth — the ship is always regenerated from them on load; thumbnails and stats
  are caches only.
- **No WebGL leaks**: every view disposes its WebGL context on unmount, so
  navigating between the main app and the harnesses never accumulates contexts.

## Docs

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — data flow, the `ShipConfig`
  model, module map, +Z convention, persistence, the harness pattern, and how to
  add a new aspect or a new harness.
- **[PLAN.md](docs/PLAN.md)** — the meta-plan: invariants, sub-plans, and the
  locked stack.
- **[plans/](docs/plans/)** — per-sub-plan detail.

## License

[MIT](./LICENSE)
