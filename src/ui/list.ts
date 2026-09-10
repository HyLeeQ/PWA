import { getAllRecords, deleteRecord, countPendingRecords } from '../db';
import { attemptSync, onSyncEvent } from '../sync';
import type { InspectionRecord } from '../types';
import { CATEGORY_META, PRIORITY_LABELS, ISSUE_TYPE_LABELS } from '../types';
import { createStatusChip, updateStatusChip } from './chip';
import { toast } from './toast';

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard / Record List page (Project 1.2)
// ─────────────────────────────────────────────────────────────────────────────

let _navigate: ((path: string) => void) | null = null;
const chipMap = new Map<string, HTMLElement>();

export function renderList(container: HTMLElement, navigate: (path: string) => void): void {
  _navigate = navigate;
  chipMap.clear();

  container.innerHTML = /* html */ `
    <div class="page">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h1 style="font-size: 1.5rem; margin-bottom: 2px">Khảo sát VKU</h1>
          <p class="text-sm text-muted">Kiểm tra cơ sở vật chất phòng học & thiết bị</p>
        </div>
        <button id="sync-btn" class="btn btn--secondary btn--sm" title="Đồng bộ ngay">
          🔄 Đồng bộ
        </button>
      </div>

      <!-- Sync status bar -->
      <div class="sync-bar" id="sync-bar">
        <span class="sync-bar__label" id="pending-label">
          <span class="spinner" id="sync-spinner" style="display:none"></span>
          Đang kiểm tra hàng đợi...
        </span>
        <span id="sync-count-badge"></span>
      </div>

      <!-- Record list -->
      <div id="record-list" class="record-list">
        <div class="empty-state">
          <div class="spinner"></div>
        </div>
      </div>
    </div>

    <!-- FAB: New report -->
    <button class="fab" id="fab-new" title="Tạo phiếu kiểm tra mới" aria-label="Tạo phiếu kiểm tra mới">＋</button>
  `;

  document.getElementById('fab-new')!.addEventListener('click', () => navigate('/new'));
  document.getElementById('sync-btn')!.addEventListener('click', handleManualSync);

  loadAndRender();

  const unsubRecordSynced = onSyncEvent('record-synced', (localId) => {
    const chip = chipMap.get(localId);
    if (chip) updateStatusChip(chip, 'synced');
    updateSyncBar();
  });

  const unsubSyncStart = onSyncEvent('sync-start', () => {
    const spinner = document.getElementById('sync-spinner');
    if (spinner) spinner.style.display = 'inline-block';
  });

  const unsubSyncComplete = onSyncEvent('sync-complete', (result) => {
    const spinner = document.getElementById('sync-spinner');
    if (spinner) spinner.style.display = 'none';
    if (result.succeeded > 0) {
      toast.success(`✅ Đã đồng bộ ${result.succeeded} báo cáo`);
    }
    updateSyncBar();
  });

  const unsubSyncError = onSyncEvent('sync-error', (msg) => {
    toast.error(msg);
    const spinner = document.getElementById('sync-spinner');
    if (spinner) spinner.style.display = 'none';
  });

  (container as HTMLElement & { _cleanup?: () => void })._cleanup = () => {
    unsubRecordSynced();
    unsubSyncStart();
    unsubSyncComplete();
    unsubSyncError();
    chipMap.clear();
  };
}

async function loadAndRender(): Promise<void> {
  const records = await getAllRecords();
  renderRecords(records);
  updateSyncBar();
}

async function updateSyncBar(): Promise<void> {
  const pending = await countPendingRecords();
  const label = document.getElementById('pending-label');
  if (!label) return;

  if (pending === 0) {
    label.innerHTML = `<span style="color: var(--color-success)">✅ Tất cả khảo sát đã đồng bộ</span>`;
  } else {
    label.innerHTML = `
      <span id="sync-spinner" class="spinner" style="display:none"></span>
      <span style="color: var(--color-warning)">⚠️ ${pending} báo cáo chờ đồng bộ (PENDING_SYNC)</span>
    `;
  }
}

function renderRecords(records: InspectionRecord[]): void {
  const list = document.getElementById('record-list');
  if (!list) return;

  if (records.length === 0) {
    list.innerHTML = /* html */ `
      <div class="empty-state">
        <div class="empty-state__icon">📋</div>
        <h2 class="empty-state__title">Chưa có phiếu kiểm tra</h2>
        <p class="empty-state__subtitle">Nhấn nút ＋ bên dưới để bắt đầu khảo sát thiết bị VKU</p>
      </div>
    `;
    return;
  }

  list.innerHTML = '';

  records.forEach((record, i) => {
    const card = createRecordCard(record, i);
    list.appendChild(card);
  });
}

function createRecordCard(record: InspectionRecord, index: number): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card card--interactive record-card';
  card.style.animationDelay = `${index * 40}ms`;
  card.setAttribute('data-id', record.localId);

  const chip = createStatusChip(record.status);
  chipMap.set(record.localId, chip);

  const priorityClass = `chip--priority-${record.priority}`;
  const priorityLabel = PRIORITY_LABELS[record.priority];
  const catMeta = record.category ? CATEGORY_META[record.category] : null;
  const categoryLabel = catMeta ? `${catMeta.icon} ${catMeta.label}` : ISSUE_TYPE_LABELS[record.issueType];
  const starsStr = '★'.repeat(record.rating || 3) + '☆'.repeat(5 - (record.rating || 3));
  const timeStr = formatRelativeTime(record.createdAt);

  const photoHTML = record.photoBlob
    ? `<img class="record-card__photo" src="${URL.createObjectURL(record.photoBlob)}" alt="Ảnh khảo sát" />`
    : '';

  card.innerHTML = /* html */ `
    <div class="record-card__body">
      <div class="record-card__info">
        <div class="record-card__header">
          <span class="record-card__title">${escHtml(record.buildingRoom || `${record.building} - ${record.room}`)}</span>
        </div>
        <div class="record-card__meta" style="flex-wrap: wrap; gap: 4px; margin-bottom: var(--space-2)">
          ${chip.outerHTML.replace(/^<span/, `<span data-chip="${record.localId}"`)}
          <span class="chip" style="background: rgba(2, 132, 199, 0.2); color: var(--color-cyan); border-color: rgba(56, 189, 248, 0.3)">${categoryLabel}</span>
          <span class="chip ${priorityClass}">${priorityLabel}</span>
          <span class="chip" style="color: #fbbf24; background: rgba(251, 191, 36, 0.1); border-color: rgba(251, 191, 36, 0.25)">${starsStr}</span>
        </div>
        ${record.notes ? `<p class="record-card__notes">${escHtml(record.notes)}</p>` : ''}
        <p class="record-card__time">${timeStr}</p>
      </div>
      ${photoHTML}
    </div>
  `;

  const chipEl = card.querySelector<HTMLElement>(`[data-chip="${record.localId}"]`);
  if (chipEl) chipMap.set(record.localId, chipEl);

  card.addEventListener('click', () => _navigate?.(`/record/${record.localId}`));

  let longPressTimer: ReturnType<typeof setTimeout>;
  card.addEventListener('pointerdown', () => {
    longPressTimer = setTimeout(async () => {
      if (confirm(`Xóa phiếu kiểm tra "${record.buildingRoom}"?`)) {
        await deleteRecord(record.localId);
        card.style.animation = 'toast-out 300ms ease both';
        card.addEventListener('animationend', () => {
          card.remove();
          chipMap.delete(record.localId);
        });
        toast.info('Đã xóa phiếu kiểm tra');
        updateSyncBar();
      }
    }, 800);
  });
  card.addEventListener('pointerup', () => clearTimeout(longPressTimer));
  card.addEventListener('pointerleave', () => clearTimeout(longPressTimer));

  return card;
}

async function handleManualSync(): Promise<void> {
  if (!navigator.onLine) {
    toast.warning('Không có kết nối mạng');
    return;
  }
  toast.info('Đang đồng bộ...', 2000);
  await attemptSync();
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
