import { openDB, type IDBPDatabase } from 'idb';
import type { InspectionRecord, SurveyDraft } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Database constants
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'vku-field-survey';
const DB_VERSION = 2;

/** Store for inspection records (the primary data store). */
const RECORDS_STORE = 'records';
const DRAFTS_STORE = 'drafts';

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
  [DRAFTS_STORE]: {
    key: string; // 'current_draft'
    value: SurveyDraft;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton DB promise
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
          recordsStore.createIndex('by-status', 'status', { unique: false });
          recordsStore.createIndex('by-createdAt', 'createdAt', { unique: false });
        }
        // ── Version 2: drafts store for real-time draft persistence ──────────
        if (oldVersion < 2) {
          if (!database.objectStoreNames.contains(DRAFTS_STORE)) {
            database.createObjectStore(DRAFTS_STORE, { keyPath: 'id' });
          }
        }
      },

      blocked() {
        console.warn('[DB] Upgrade blocked — please close other tabs of this app.');
      },

      blocking() {
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
// Public API: Records
// ─────────────────────────────────────────────────────────────────────────────

export async function addRecord(record: InspectionRecord): Promise<void> {
  const db = await getDB();
  await db.add(RECORDS_STORE, record);
}

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
    localId,
    updatedAt: Date.now(),
  };

  await store.put(updated);
  await tx.done;
}

export async function getRecord(localId: string): Promise<InspectionRecord | undefined> {
  const db = await getDB();
  return db.get(RECORDS_STORE, localId);
}

export async function getAllRecords(): Promise<InspectionRecord[]> {
  const db = await getDB();
  const records = await db.getAllFromIndex(RECORDS_STORE, 'by-createdAt');
  return records.reverse();
}

export async function getPendingRecords(): Promise<InspectionRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex(RECORDS_STORE, 'by-status', 'pending_sync');
}

export async function markSynced(localId: string, serverId: string): Promise<void> {
  await updateRecord(localId, {
    status: 'synced',
    serverId,
    syncedAt: Date.now(),
    lastError: undefined,
  });
}

export async function markSyncError(localId: string, error: string): Promise<void> {
  const existing = await getRecord(localId);
  if (!existing) return;
  await updateRecord(localId, {
    status: 'error',
    retries: existing.retries + 1,
    lastError: error,
  });
}

export async function deleteRecord(localId: string): Promise<void> {
  const db = await getDB();
  await db.delete(RECORDS_STORE, localId);
}

export async function countAllRecords(): Promise<number> {
  const db = await getDB();
  return db.count(RECORDS_STORE);
}

export async function countPendingRecords(): Promise<number> {
  const db = await getDB();
  return db.countFromIndex(RECORDS_STORE, 'by-status', 'pending_sync');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: Real-time Draft Persistence (IndexedDB)
// ─────────────────────────────────────────────────────────────────────────────

export async function saveDraftState(draft: Omit<SurveyDraft, 'id'>): Promise<void> {
  const db = await getDB();
  const record: SurveyDraft = {
    ...draft,
    id: 'current_draft',
    updatedAt: Date.now(),
  };
  await db.put(DRAFTS_STORE, record);
}

export async function getDraftState(): Promise<SurveyDraft | undefined> {
  try {
    const db = await getDB();
    return await db.get(DRAFTS_STORE, 'current_draft');
  } catch (err) {
    console.warn('[DB] Could not retrieve draft:', err);
    return undefined;
  }
}

export async function clearDraftState(): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(DRAFTS_STORE, 'current_draft');
  } catch (err) {
    console.warn('[DB] Could not clear draft:', err);
  }
}
