// Thin IndexedDB wrapper. All persistence lives in browser storage as required.
// Ships and user presets each get their own object store, keyed by id.
//
// Versioning: DB_VERSION is the IndexedDB schema version. onupgradeneeded runs
// every MIGRATIONS step between (oldVersion, DB_VERSION] in order, so bumping
// DB_VERSION migrates existing databases without loss. The record-level schema
// version lives in record.js (RECORD_VERSION, stored as each record's `v`).

import { RECORD_VERSION, defaultShipName, shipStats } from './record.js'

const DB_NAME = 'ship-foundry'
const DB_VERSION = 2
export const SHIPS_STORE = 'ships'
export const PRESETS_STORE = 'presets'

let dbPromise = null

// Versioned upgrade path. Keyed by the DB version the step introduces; each
// runs at most once per database. Every step runs inside the active
// versionchange transaction (passed as `tx`), which is readwrite and is the
// only transaction that may restructure the DB — opening a separate one here
// would deadlock behind it.
const MIGRATIONS = {
  // v1: initial schema — one object store per record kind, keyed by id.
  1: (db) => {
    if (!db.objectStoreNames.contains(SHIPS_STORE)) {
      db.createObjectStore(SHIPS_STORE, { keyPath: 'id' })
    }
    if (!db.objectStoreNames.contains(PRESETS_STORE)) {
      db.createObjectStore(PRESETS_STORE, { keyPath: 'id' })
    }
  },
  // v2: stamp the record schema version. Old scaffold records ({ id, savedAt,
  // config }) gain `v`, and ships gain a default `name` + derived `stats`.
  // Existing fields are preserved, never dropped.
  2: (_db, tx) => {
    for (const storeName of [SHIPS_STORE, PRESETS_STORE]) {
      if (!tx.objectStoreNames.contains(storeName)) continue
      const store = tx.objectStore(storeName)
      const req = store.getAll()
      req.onsuccess = () => {
        for (const record of req.result ?? []) {
          if (record.v === undefined) record.v = RECORD_VERSION
          if (storeName === SHIPS_STORE) {
            if (!record.name) record.name = defaultShipName(record.id)
            if (record.stats === undefined && record.config) {
              record.stats = shipStats(record.config)
            }
          }
          store.put(record)
        }
      }
    }
  },
}

function onUpgradeNeeded(event) {
  const db = event.target.result
  const tx = event.target.transaction
  const oldVersion = event.oldVersion ?? 0
  for (let v = oldVersion + 1; v <= DB_VERSION; v++) {
    const step = MIGRATIONS[v]
    if (!step) throw new Error(`no DB migration defined for version ${v}`)
    step(db, tx)
  }
}

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = onUpgradeNeeded
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

// Run a single request inside a transaction and resolve with the request result
// once the transaction completes.
async function tx(store, mode, run) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const s = t.objectStore(store)
    const req = run(s)
    let result
    req.onsuccess = () => {
      result = req.result
    }
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'))
  })
}

export const db = {
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)),
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  delete: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
}
