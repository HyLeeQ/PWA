// ─────────────────────────────────────────────────────────────────────────────
// VKU Field Survey — Core Type Definitions (Project 1.2)
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
 * Hạng mục kiểm tra cơ sở vật chất (Project 1.2 requirements)
 */
export type FacilityCategory = 'hardware' | 'projector' | 'ac' | 'electrical' | 'furniture';

export interface CategoryInfo {
  label: string;
  icon: string;
  desc: string;
}

export const CATEGORY_META: Record<FacilityCategory, CategoryInfo> = {
  hardware: { label: 'Phần cứng', icon: '💻', desc: 'Máy tính, chuột, phím, màn hình' },
  projector: { label: 'Máy chiếu', icon: '📽️', desc: 'Máy chiếu, màn chiếu, cáp kết nối' },
  ac: { label: 'Điều hòa', icon: '❄️', desc: 'Máy lạnh, remote, thông gió' },
  electrical: { label: 'Điện', icon: '⚡', desc: 'Ổ cắm, bóng đèn, quạt, công tắc' },
  furniture: { label: 'Nội thất', icon: '🪑', desc: 'Bàn, ghế, bảng viết, cửa' },
};

/**
 * How urgently the issue needs to be addressed.
 */
export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Backward-compatible IssueType
 */
export type IssueType =
  | 'hardware'
  | 'projector'
  | 'ac'
  | 'electrical'
  | 'furniture'
  | 'structural'
  | 'cleanliness'
  | 'other';

/**
 * Star Rating (1 - 5 stars)
 */
export const RATING_LABELS: Record<number, string> = {
  1: 'Rất tệ (Hỏng nặng, không dùng được)',
  2: 'Kém (Cần sửa chữa / bảo trì gấp)',
  3: 'Bình thường (Có dấu hiệu hao mòn)',
  4: 'Tốt (Hoạt động ổn định)',
  5: 'Rất tốt (Thiết bị mới, hoàn hảo)',
};

/**
 * The primary data model — one facility inspection report.
 */
export interface InspectionRecord {
  // ── Identity ──────────────────────────────────────────────────────────────
  localId: string;       // UUID v4 – primary key in IndexedDB
  serverId?: string;     // Populated after successful POST to server

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  status: SyncStatus;
  retries: number;       // How many sync attempts have been made
  lastError?: string;    // Human-readable error from last failed attempt

  // ── Step 1: Location ──────────────────────────────────────────────────────
  building: string;      // Tòa nhà (e.g. "Tòa V", "Tòa K", "Tòa A")
  floor: string;         // Tầng (e.g. "Tầng 1", "Tầng 2", "Tầng hầm")
  room: string;          // Số phòng (e.g. "Phòng 201", "Lab 305")
  buildingRoom: string;  // Combined display string

  // ── Step 2: Category & Rating ─────────────────────────────────────────────
  category: FacilityCategory;
  rating: number;        // 1 to 5 stars
  priority: PriorityLevel;
  issueType: IssueType;

  // ── Step 3: Details & Evidence ────────────────────────────────────────────
  notes: string;         // Ghi chú về lỗi
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

/**
 * Form draft state stored in IndexedDB for real-time draft persistence
 */
export interface SurveyDraft {
  id: 'current_draft';
  step: number;
  building: string;
  floor: string;
  room: string;
  category?: FacilityCategory;
  rating: number;
  priority: PriorityLevel;
  notes: string;
  photoBlob?: Blob;
  photoMimeType?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  updatedAt: number;
}

export type NewInspectionRecord = Omit<
  InspectionRecord,
  'localId' | 'serverId' | 'status' | 'retries' | 'lastError' | 'createdAt' | 'updatedAt' | 'syncedAt'
>;

export interface GeoCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface SyncResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface SyncPayload {
  localId: string;
  building: string;
  floor: string;
  room: string;
  buildingRoom: string;
  category: FacilityCategory;
  rating: number;
  issueType: IssueType;
  priority: PriorityLevel;
  notes: string;
  photoBase64?: string;
  photoMimeType?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  createdAt: number;
}

export type Route = '/' | '/new' | `/record/${string}`;

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

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  hardware: '💻 Phần cứng',
  projector: '📽️ Máy chiếu',
  ac: '❄️ Điều hòa',
  electrical: '⚡ Điện',
  furniture: '🪑 Nội thất',
  structural: '🏗️ Kết cấu',
  cleanliness: '🧹 Vệ sinh',
  other: '🔧 Khác',
};
