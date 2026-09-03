import { openDB, type IDBPDatabase } from 'idb';
import type { InspectionRecord } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Database constants
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'vku-field-survey';
const DB_VERSION = 1;

/** Store for inspection records (the primary data store). */
const RECORDS_STORE = 'records';

// ─────────────────────────────────────────────────────────────────────────────
// DB schema type (required by idb for full type safety)
// ─────────────────────────────────────────────────────────────────────────────

interface FieldSurveyDB {
  [RECORDS_STORE]: {
    key: string; // localId (UUID)
    value: InspectionRecord;
    indexes: {
      'by-status': string;     // SyncStatus
      'by-createdAt': number;  // timestamp
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton DB promise — only one openDB call per page lifetime
// ─────────────────────────────────────────────────────────────────────────────

let _dbPromise: Promise<IDBPDatabase<FieldSurveyDB>> | null = null;

function getDB(): Promise<IDBPDatabase<FieldSurveyDB>> {
  if (!_dbPromise) {
    _dbPromise = openDB<FieldSurveyDB>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        // ── Version 1: initial schema ────────────────────────────────────────
        if (oldVersion < 1) {
          const recordsStore = database.createObjectStore(RECORDS_STORE, {
            keyPath: 'localId',
          });

          // Index by sync status so getPendingRecords() is O(log n)
          recordsStore.createIndex('by-status', 'status', { unique: false });

          // Index by creation time for chronological list rendering
          recordsStore.createIndex('by-createdAt', 'createdAt', { unique: false });
        }
        // Future migrations go here as `if (oldVersion < 2) { ... }`
      },

      blocked() {
        console.warn('[DB] Upgrade blocked — please close other tabs of this app.');
      },

      blocking() {
        // A newer version of the SW opened a new DB version; let it through.
        _dbPromise = null;
      },

      terminated() {
        console.error('[DB] Connection terminated unexpectedly; resetting.');
        _dbPromise = null;
      },
    });
  }
  return _dbPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a new inspection record. Throws if the localId already exists.
 * Always call this with status === 'pending_sync' or 'draft'.
 */
export async function addRecord(record: InspectionRecord): Promise<void> {
  const db = await getDB();
  await db.add(RECORDS_STORE, record);
}

/**
 * Partially update an existing record by its localId.
 * Only the supplied fields are changed; all others are preserved.
 *
 * @throws {Error} if no record with the given localId exists
 */
export async function updateRecord(
  localId: string,
  patch: Partial<Omit<InspectionRecord, 'localId'>>,
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(RECORDS_STORE, 'readwrite');
  const store = tx.objectStore(RECORDS_STORE);

  const existing = await store.get(localId);
  if (!existing) {
    throw new Error(`[DB] Record not found: ${localId}`);
  }

  const updated: InspectionRecord = {
    ...existing,
    ...patch,
    localId, // never overwrite the key
    updatedAt: Date.now(),
  };

  await store.put(updated);
  await tx.done;
}

/**
 * Retrieve a single record by localId. Returns undefined if not found.
 */
export async function getRecord(localId: string): Promise<InspectionRecord | undefined> {
  const db = await getDB();
  return db.get(RECORDS_STORE, localId);
}

/**
 * Retrieve all records, ordered by createdAt descending (newest first).
 */
export async function getAllRecords(): Promise<InspectionRecord[]> {
  const db = await getDB();
  // IDB cursor on index in 'prev' direction = descending
  const records = await db.getAllFromIndex(RECORDS_STORE, 'by-createdAt');
  return records.reverse();
}

/**
 * Retrieve only records that are waiting to be uploaded to the server.
 * Used by the sync queue to know what to POST.
 */
export async function getPendingRecords(): Promise<InspectionRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex(RECORDS_STORE, 'by-status', 'pending_sync');
}

/**
 * Mark a record as successfully synced.
 * Sets status → 'synced', populates serverId, and stamps syncedAt.
 */
export async function markSynced(localId: string, serverId: string): Promise<void> {
  await updateRecord(localId, {
    status: 'synced',
    serverId,
    syncedAt: Date.now(),
    lastError: undefined,
  });
}

/**
 * Mark a record sync attempt as failed.
 * Increments retries and records the error message.
 */
export async function markSyncError(localId: string, error: string): Promise<void> {
  const existing = await getRecord(localId);
  if (!existing) return;
  await updateRecord(localId, {
    status: 'error',
    retries: existing.retries + 1,
    lastError: error,
  });
}

/**
 * Permanently delete a record from IndexedDB.
 */
export async function deleteRecord(localId: string): Promise<void> {
  const db = await getDB();
  await db.delete(RECORDS_STORE, localId);
}

/**
 * Count all records (for the dashboard badge).
 */
export async function countAllRecords(): Promise<number> {
  const db = await getDB();
  return db.count(RECORDS_STORE);
}

/**
 * Count only pending records (for the sync badge).
 */
export async function countPendingRecords(): Promise<number> {
  const db = await getDB();
  return db.countFromIndex(RECORDS_STORE, 'by-status', 'pending_sync');
}
