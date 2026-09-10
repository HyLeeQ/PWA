import { v4 as uuidv4 } from 'uuid';
import {
  addRecord,
  getPendingRecords,
  markSynced,
  markSyncError,
  updateRecord,
  clearDraftState,
} from './db';
import { getNetworkStatus, addNetworkListener } from './capacitor-plugins';
import type {
  InspectionRecord,
  NewInspectionRecord,
  SyncPayload,
  SyncResult,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const SYNC_ENDPOINT = 'https://httpbin.org/post';
const BACKGROUND_SYNC_TAG = 'sync-inspections';
const MAX_RETRIES = 3;

// ─────────────────────────────────────────────────────────────────────────────
// Event emitter (pub/sub for UI updates)
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
 * 1. Assign a UUID localId and timestamps.
 * 2. Save to IndexedDB with status 'pending_sync'.
 * 3. Clear the active in-progress draft from IndexedDB.
 * 4. If online → attempt sync immediately; if offline → queue for background sync.
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

  // 1. Persist locally to IndexedDB — offline-safe
  await addRecord(record);

  // 2. Clear current in-progress draft
  await clearDraftState().catch(console.warn);

  // 3. Check connectivity via Capacitor Network / navigator
  const net = await getNetworkStatus();
  if (net.connected) {
    attemptSync().catch(console.error);
  } else {
    await registerBackgroundSync();
  }

  return record;
}

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

export async function retryRecord(localId: string): Promise<void> {
  await updateRecord(localId, { status: 'pending_sync' });
  const net = await getNetworkStatus();
  if (net.connected) {
    await attemptSync();
  } else {
    await registerBackgroundSync();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sequential Sync Engine
// ─────────────────────────────────────────────────────────────────────────────

let _syncInProgress = false;

/**
 * Drain the pending_sync queue sequentially.
 */
export async function attemptSync(): Promise<SyncResult> {
  if (_syncInProgress) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const pending = await getPendingRecords();
  if (pending.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  _syncInProgress = true;
  emit('sync-start', undefined);

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
    emit('sync-error', `${result.failed} báo cáo chưa thể đồng bộ`);
  }
  emit('sync-complete', result);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP transport
// ─────────────────────────────────────────────────────────────────────────────

async function postRecord(record: InspectionRecord): Promise<string> {
  const payload: SyncPayload = {
    localId: record.localId,
    building: record.building,
    floor: record.floor,
    room: record.room,
    buildingRoom: record.buildingRoom,
    category: record.category,
    rating: record.rating,
    issueType: record.issueType,
    priority: record.priority,
    notes: record.notes,
    latitude: record.latitude,
    longitude: record.longitude,
    accuracy: record.accuracy,
    createdAt: record.createdAt,
  };

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

  const body = (await response.json()) as { json?: { localId?: string } };
  return body.json?.localId ?? `server-${Date.now()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Background Sync & Network monitoring listeners
// ─────────────────────────────────────────────────────────────────────────────

async function registerBackgroundSync(): Promise<void> {
  const swReg = await getServiceWorkerRegistration();

  if (swReg && 'sync' in swReg) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (swReg as any).sync.register(BACKGROUND_SYNC_TAG);
      console.log('[Sync] Background Sync registered:', BACKGROUND_SYNC_TAG);
    } catch (err) {
      console.warn('[Sync] Background Sync failed, using network fallback:', err);
    }
  }
}

/**
 * Initialize network monitoring using @capacitor/network and SW messages.
 */
export function initSyncMessageListener(): void {
  // 1. Listen for SW Background Sync messages
  navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'SW_SYNC_TRIGGER') {
      console.log('[Sync] SW_SYNC_TRIGGER received — attempting sync');
      attemptSync().catch(console.error);
    }
  });

  // 2. Real-time Capacitor Network monitoring (native & web)
  addNetworkListener((status) => {
    if (status.connected) {
      console.log('[Sync] Network connected (type: ' + status.connectionType + ') — draining queue');
      attemptSync().catch(console.error);
    }
  });

  // 3. Fallback window online event
  window.addEventListener('online', () => {
    console.log('[Sync] window.online event — draining queue');
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
