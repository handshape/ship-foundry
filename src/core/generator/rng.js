// SEEDED PRNG (SP-02 owns the full API).
//
// Contract:
//   createRng(seed) -> {
//     next(): number in (0, 1),
//     range(min, max): number in [min, max),
//     int(min, max): integer in [min, max] inclusive,
//     pick(arr): element of arr,
//     chance(p): boolean (true with probability p),
//     bool(): boolean,
//   }
//   hashSeed(str) -> uint32
//
// Determinism: the same seed always produces the same sequence, so a saved
// ship's config + seed can reproduce it exactly. All randomness in the
// generator must flow from a createRng instance — never Math.random().
//
// The core is xorshift32 over a uint32 state; a zero/absent seed is remapped
// to a fixed non-zero constant because 0 is a degenerate (all-zero) state.

// FNV-1a 32-bit string hash, returned as an unsigned 32-bit int.
export function hashSeed(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Mix a raw seed into a well-dispersed 32-bit state. xorshift32 has weak
// seed dispersion (sequential seeds -> near-identical first outputs), so we
// run a few mixing rounds (splitmix-style finalizer) to decorrelate nearby
// seeds. Deterministic: the same seed always yields the same state.
function mixSeed(x) {
  x = (x ^ (x >>> 16)) >>> 0
  x = Math.imul(x, 0x85ebca6b) >>> 0
  x = (x ^ (x >>> 13)) >>> 0
  x = Math.imul(x, 0xc2b2ae35) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return x
}

export function createRng(seed = 1) {
  let s = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0
  s = mixSeed(s)
  if (s === 0) s = 0x9e3779b9

  const next = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }

  const range = (min, max) => min + (max - min) * next()
  const int = (min, max) => Math.floor(min + (max - min + 1) * next())
  const pick = (arr) => arr[Math.floor(next() * arr.length)]
  const chance = (p) => next() < p
  const bool = () => next() < 0.5

  return { next, range, int, pick, chance, bool }
}
