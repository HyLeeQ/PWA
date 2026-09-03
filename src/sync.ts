import { v4 as uuidv4 } from 'uuid';
import {
  addRecord,
  getPendingRecords,
  markSynced,
  markSyncError,
  updateRecord,
} from './db';
import type {
  InspectionRecord,
  NewInspectionRecord,
  SyncPayload,
  SyncResult,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mock sync endpoint — mirrors the POST body back in the response JSON.
 * In production, replace with your real API URL.
 * httpbin.org/post responds with { json: <your payload> }
 */
const SYNC_ENDPOINT = 'https://httpbin.org/post';

/** Background Sync API tag — must match sw.ts */
const BACKGROUND_SYNC_TAG = 'sync-inspections';

/** Maximum number of auto-retries before a record is marked 'error'. */
const MAX_RETRIES = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Event emitter (tiny pub/sub for UI updates)
// ─────────────────────────────────────────────────────────────────────────────

type SyncEventType = 'sync-start' | 'sync-complete' | 'sync-error' | 'record-synced';

interface SyncEventMap {
  'sync-start': void;
  'sync-complete': SyncResult;
  'sync-error': string;
  'record-synced': string; // localId
}

type SyncListener<T extends SyncEventType> = (payload: SyncEventMap[T]) => void;

const listeners = new Map<SyncEventType, Set<SyncListener<SyncEventType>>>();

export function onSyncEvent<T extends SyncEventType>(
  event: T,
  listener: SyncListener<T>,
): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(listener as SyncListener<SyncEventType>);
  // Return an unsubscribe function
  return () => listeners.get(event)?.delete(listener as SyncListener<SyncEventType>);
}

function emit<T extends SyncEventType>(event: T, payload: SyncEventMap[T]): void {
  listeners.get(event)?.forEach((fn) => fn(payload));
}

// ─────────────────────────────────────────────────────────────────────────────
// Core public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit a new inspection record.
 *
 * Flow:
 *  1. Assign a UUID localId and timestamps.
 *  2. Write to IndexedDB immediately (offline-safe).
 *  3. If online → attempt sync right away.
 *  4. If offline → register Background Sync (Chrome/Android) + attach a
 *     one-time 'online' event listener as universal fallback (iOS Safari).
 */
export async function submitRecord(data: NewInspectionRecord): Promise<InspectionRecord> {
  const now = Date.now();

  const record: InspectionRecord = {
    ...data,
    localId: uuidv4(),
    status: 'pending_sync',
    retries: 0,
    createdAt: now,
    updatedAt: now,
  };

  // 1. Persist locally — this NEVER fails due to network
  await addRecord(record);

  // 2. Attempt to sync
  if (navigator.onLine) {
    // Fire-and-forget; UI updates via onSyncEvent listeners
    attemptSync().catch(console.error);
  } else {
    await registerBackgroundSync();
  }

  return record;
}

/**
 * Save a record as a 'draft' (not yet submitted for sync).
 * Useful for auto-save while the user is filling out the form.
 */
export async function saveDraft(data: NewInspectionRecord): Promise<InspectionRecord> {
  const now = Date.now();
  const record: InspectionRecord = {
    ...data,
    localId: uuidv4(),
    status: 'draft',
    retries: 0,
    createdAt: now,
    updatedAt: now,
  };
  await addRecord(record);
  return record;
}

/**
 * Promote a draft (or error) record to pending_sync and attempt sync.
 */
export async function retryRecord(localId: string): Promise<void> {
  await updateRecord(localId, { status: 'pending_sync' });
  if (navigator.onLine) {
    await attemptSync();
  } else {
    await registerBackgroundSync();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync engine
// ─────────────────────────────────────────────────────────────────────────────

/** Prevent multiple concurrent sync runs */
let _syncInProgress = false;

/**
 * Drain the pending_sync queue.
 * Sends one record at a time to avoid overwhelming the server.
 * On failure, marks the record 'error' if max retries exceeded.
 */
export async function attemptSync(): Promise<SyncResult> {
  if (_syncInProgress) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  _syncInProgress = true;
  emit('sync-start', undefined);

  const pending = await getPendingRecords();
  const result: SyncResult = { attempted: pending.length, succeeded: 0, failed: 0 };

  for (const record of pending) {
    try {
      const serverId = await postRecord(record);
      await markSynced(record.localId, serverId);
      emit('record-synced', record.localId);
      result.succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Sync] Failed to sync ${record.localId}:`, message);

      if (record.retries >= MAX_RETRIES) {
        await markSyncError(record.localId, `Max retries exceeded: ${message}`);
      } else {
        await markSyncError(record.localId, message);
      }
      result.failed++;
    }
  }

  _syncInProgress = false;

  if (result.failed > 0) {
    emit('sync-error', `${result.failed} record(s) failed to sync`);
  }
  emit('sync-complete', result);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP transport
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize one InspectionRecord and POST it to the sync endpoint.
 * Returns the serverId assigned by the server (or a generated one for mock).
 */
async function postRecord(record: InspectionRecord): Promise<string> {
  const payload: SyncPayload = {
    localId: record.localId,
    buildingRoom: record.buildingRoom,
    issueType: record.issueType,
    priority: record.priority,
    notes: record.notes,
    latitude: record.latitude,
    longitude: record.longitude,
    accuracy: record.accuracy,
    createdAt: record.createdAt,
  };

  // Convert Blob → base64 if a photo is attached
  if (record.photoBlob) {
    payload.photoBase64 = await blobToBase64(record.photoBlob);
    payload.photoMimeType = record.photoMimeType;
  }

  const response = await fetch(SYNC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  // httpbin.org mirrors the payload; extract a mock serverId from the response
  // In production: const { id } = await response.json(); return id;
  const body = await response.json() as { json?: { localId?: string } };
  return body.json?.localId ?? `server-${Date.now()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Background Sync registration + online event fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a Background Sync tag if the API is supported.
 * Falls back to a one-time 'online' listener for iOS Safari / Firefox.
 */
async function registerBackgroundSync(): Promise<void> {
  const swReg = await getServiceWorkerRegistration();

  if (swReg && 'sync' in swReg) {
    try {
      // Cast to any to access Background Sync API which is not in standard TS lib
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (swReg as any).sync.register(BACKGROUND_SYNC_TAG);
      console.log('[Sync] Background Sync registered:', BACKGROUND_SYNC_TAG);
    } catch (err) {
      console.warn('[Sync] Background Sync registration failed, using online fallback:', err);
      attachOnlineFallback();
    }
  } else {
    // Browser does not support Background Sync API (e.g. iOS Safari, Firefox)
    console.log('[Sync] Background Sync not supported, using online event fallback');
    attachOnlineFallback();
  }
}

/** Ensure we only attach one online listener at a time */
let _onlineFallbackAttached = false;

function attachOnlineFallback(): void {
  if (_onlineFallbackAttached) return;
  _onlineFallbackAttached = true;

  const handler = () => {
    _onlineFallbackAttached = false;
    window.removeEventListener('online', handler);
    console.log('[Sync] Online event fired — draining sync queue');
    attemptSync().catch(console.error);
  };

  window.addEventListener('online', handler);
}

// ─────────────────────────────────────────────────────────────────────────────
// SW message listener (receives SW_SYNC_TRIGGER from sw.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Listen for the SW's postMessage broadcast when a Background Sync fires.
 * This bridges the SW context → page context for the actual DB operations.
 */
export function initSyncMessageListener(): void {
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'SW_SYNC_TRIGGER') {
      console.log('[Sync] SW_SYNC_TRIGGER received — attempting sync');
      attemptSync().catch(console.error);
    }
  });

  // Also handle the online event at the module level so any pending records
  // are synced whenever the browser reports connectivity (belt-and-suspenders).
  window.addEventListener('online', () => {
    console.log('[Sync] online event — draining queue');
    attemptSync().catch(console.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return (await navigator.serviceWorker.ready) ?? null;
  } catch {
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
