// Tracks teardown functions for the currently-mounted view. The router flushes
// these before mounting the next view (e.g. to stop a render loop and dispose
// a three.js renderer, which owns a WebGL context we must not leak per-route).
const cleanups = new Set()

export function onCleanup(fn) {
  cleanups.add(fn)
}

export function flushCleanups() {
  for (const fn of cleanups) {
    try {
      fn()
    } catch (err) {
      console.error('view cleanup failed', err)
    }
  }
  cleanups.clear()
}
