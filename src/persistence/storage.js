import { db, SHIPS_STORE, PRESETS_STORE } from './db.js'
import { buildShipRecord, uid } from './record.js'

// High-level persistence API over the raw db wrapper. Ship records are plain
// JSON ShipRecords ({ id, v, name, savedAt, config, thumbnail?, stats }), so
// they round-trip straight from IndexedDB back into the generator: loading a
// saved ship = read record -> generateShip(record.config, record.config.seed).
// Thumbnails and stats are caches only; config + seed are the source of truth.

export const storage = {
  // --- ships ---
  // Backward-compatible: saveShip({ config }) still works — a default name is
  // assigned and stats are derived from the config. Stores a full ShipRecord.
  async saveShip(ship) {
    const record = buildShipRecord({
      id: ship?.id,
      name: ship?.name,
      config: ship?.config,
      thumbnail: ship?.thumbnail,
      stats: ship?.stats,
      savedAt: ship?.savedAt,
    })
    await db.put(SHIPS_STORE, record)
    return record.id
  },
  loadShip: (id) => db.get(SHIPS_STORE, id),
  // All saved ship records, newest first (savedAt descending).
  listShips: async () => {
    const records = await db.all(SHIPS_STORE)
    return records.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
  },
  deleteShip: (id) => db.delete(SHIPS_STORE, id),
  // Read the record and regenerate the ship from its canonical config + seed.
  // Returns { group, config }, or null if the record (or its config) is missing.
  async loadShipAndRegenerate(id, generateShip) {
    const record = await db.get(SHIPS_STORE, id)
    if (!record?.config) return null
    return generateShip(record.config, record.config.seed)
  },

  // --- user presets (named configs / aesthetic tweaks) ---
  async savePreset(preset) {
    const record = { id: preset.id ?? uid(), updatedAt: Date.now(), ...preset }
    await db.put(PRESETS_STORE, record)
    return record.id
  },
}
