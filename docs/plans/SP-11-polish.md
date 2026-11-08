# SP-11: Docs, performance, final integration pass

**Phase 5** · **Depends on:** all · **Primary files:** `README.md`,
`docs/ARCHITECTURE.md`, performance work across `src/core/**`

## Goal
Ship a polished, documented, performant app: prove the invariants hold end-to-end,
keep the renderer fast, and make the project easy to onboard.

## Scope
- **In:**
  - **Docs:** a real `README.md` (what it is, stack, run/build, MIT license,
    screenshot placeholders) and `docs/ARCHITECTURE.md` (the data flow, config
    model, module map, +Z convention, persistence, how to add an aspect + a
    harness).
  - **Performance:** a draw-call/geometry budget for frigate+ ships; **instancing**
    for repeated greebles/modules; texture-size scaling by viewport; a
    "performance mode"; verify `dispose` correctness (no leaks) via a quick
    navigation stress test.
  - **Integration pass:** confirm every §3 invariant (esp. determinism and no
    `Math.random()` in the generator path), every harness reachable and saving
    back to config, and the full flow generate → render → export → save → reload.
- **Out:** new features beyond the plan.

## Acceptance criteria
- [ ] `README.md` + `docs/ARCHITECTURE.md` exist and are accurate.
- [ ] A max-complexity ship holds a stable frame rate on a mid-range machine;
      instancing is used for repeated detail.
- [ ] Navigation stress test (main ↔ each harness ×20) keeps the WebGL context
      count stable.
- [ ] Grep the generator path: **no** `Math.random()` (only seeded `createRng`).
- [ ] Full flow verified: generate → render → export GLB → save → reload →
      identical ship.
- [ ] `build` + `lint` green.

## Sub-agent prompt (starting point)
> Polish Ship Foundry. Write `README.md` and `docs/ARCHITECTURE.md`. Add a
> performance pass: budget draw calls for frigate+ ships, instance repeated
> greebles/modules, scale texture resolution by viewport, and verify dispose
> correctness with a navigation stress test. Do a final integration pass
> confirming the §3 invariants (determinism, no Math.random in the generator
> path), all harnesses reachable and saving back to config, and the full
> generate → render → export → save → reload flow. Keep build and lint green.
