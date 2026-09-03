// ─────────────────────────────────────────────────────────────────────────────
// VKU Field Survey — Core Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronisation lifecycle of an inspection record.
 *  draft        → saved locally, not yet submitted for sync
 *  pending_sync → queued for upload; will be sent when online
 *  synced       → successfully POSTed to the server
 *  error        → last sync attempt failed; will be retried
 */
export type SyncStatus = 'draft' | 'pending_sync' | 'synced' | 'error';

/**
 * Category of facility issue found during inspection.
 */
export type IssueType =
  | 'electrical'
  | 'plumbing'
  | 'structural'
  | 'hvac'
  | 'cleanliness'
  | 'safety'
  | 'it_equipment'
  | 'other';

/**
 * How urgently the issue needs to be addressed.
 */
export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * The primary data model — one facility inspection report.
 *
 * Design notes
 * ─────────────
 * • `localId`   is the IndexedDB keyPath — always present, generated offline via UUID v4.
 * • `serverId`  is null until a successful POST; used to detect "already synced".
 * • `photoBlob` holds the raw binary from Camera / file input.
 *   We do NOT store it as base64 in IndexedDB to avoid doubling memory usage.
 * • `photoDataUrl` is derived on-demand for <img> previews (not persisted).
 */
export interface InspectionRecord {
  // ── Identity ──────────────────────────────────────────────────────────────
  localId: string;       // UUID v4 – primary key in IndexedDB
  serverId?: string;     // Populated after successful POST to server

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  status: SyncStatus;
  retries: number;       // How many sync attempts have been made
  lastError?: string;    // Human-readable error from last failed attempt

  // ── Inspection data ───────────────────────────────────────────────────────
  buildingRoom: string;  // e.g. "Tòa A - Phòng 201"
  issueType: IssueType;
  priority: PriorityLevel;
  notes: string;

  // ── Photo ─────────────────────────────────────────────────────────────────
  photoBlob?: Blob;      // Raw image bytes (stored in IndexedDB)
  photoMimeType?: string; // e.g. "image/jpeg"

  // ── Location ──────────────────────────────────────────────────────────────
  latitude?: number;
  longitude?: number;
  accuracy?: number;     // metres

  // ── Timestamps ────────────────────────────────────────────────────────────
  createdAt: number;     // Date.now() at first save
  updatedAt: number;     // Date.now() at last local update
  syncedAt?: number;     // Date.now() when server confirmed receipt
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper type for creating a new record (omits server-managed fields)
// ─────────────────────────────────────────────────────────────────────────────
export type NewInspectionRecord = Omit<
  InspectionRecord,
  'localId' | 'serverId' | 'status' | 'retries' | 'lastError' | 'createdAt' | 'updatedAt' | 'syncedAt'
>;

// ─────────────────────────────────────────────────────────────────────────────
// GPS coordinates returned by the native / browser wrapper
// ─────────────────────────────────────────────────────────────────────────────
export interface GeoCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync result reported back after a batch sync attempt
// ─────────────────────────────────────────────────────────────────────────────
export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Payload shape sent to the server (no raw Blob — must be serialised first)
// ─────────────────────────────────────────────────────────────────────────────
export interface SyncPayload {
  localId: string;
  buildingRoom: string;
  issueType: IssueType;
  priority: PriorityLevel;
  notes: string;
  photoBase64?: string;  // base64-encoded photo, or omitted if no photo
  photoMimeType?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────────────
export type Route = '/' | '/new' | `/record/${string}`;

// Display labels for UI rendering
export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  electrical: '⚡ Điện',
  plumbing: '🚰 Nước / Ống',
  structural: '🏗️ Kết cấu',
  hvac: '❄️ Điều hòa',
  cleanliness: '🧹 Vệ sinh',
  safety: '⚠️ An toàn',
  it_equipment: '💻 Thiết bị IT',
  other: '🔧 Khác',
};

export const PRIORITY_LABELS: Record<PriorityLevel, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  critical: '🚨 Khẩn cấp',
};

export const STATUS_LABELS: Record<SyncStatus, string> = {
  draft: '✏️ Nháp',
  pending_sync: '🔄 Chờ đồng bộ',
  synced: '✅ Đã đồng bộ',
  error: '❌ Lỗi đồng bộ',
};
