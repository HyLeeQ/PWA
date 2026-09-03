import { getRecord, updateRecord } from '../db';
import { retryRecord, onSyncEvent } from '../sync';
import { formatCoords, mapsUrl } from '../capacitor-plugins';
import type { InspectionRecord } from '../types';
import { ISSUE_TYPE_LABELS, PRIORITY_LABELS, STATUS_LABELS } from '../types';
import { createStatusChip, updateStatusChip } from './chip';
import { toast } from './toast';

// ─────────────────────────────────────────────────────────────────────────────
// Record Detail page
// ─────────────────────────────────────────────────────────────────────────────

export async function renderDetail(
  container: HTMLElement,
  localId: string,
  navigate: (path: string) => void,
): Promise<void> {
  container.innerHTML = /* html */ `
    <div class="page">
      <button class="back-btn" id="back-btn">← Quay lại</button>
      <div class="empty-state"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('back-btn')!.addEventListener('click', () => navigate('/'));

  const record = await getRecord(localId);
  if (!record) {
    container.querySelector('.page')!.innerHTML = /* html */ `
      <button class="back-btn" id="back-btn2">← Quay lại</button>
      <div class="empty-state">
        <div class="empty-state__icon">🔍</div>
        <h2 class="empty-state__title">Không tìm thấy báo cáo</h2>
        <p class="empty-state__subtitle">Báo cáo này có thể đã bị xóa.</p>
      </div>
    `;
    document.getElementById('back-btn2')!.addEventListener('click', () => navigate('/'));
    return;
  }

  renderRecordDetail(container, record, navigate);
}

function renderRecordDetail(
  container: HTMLElement,
  record: InspectionRecord,
  navigate: (path: string) => void,
): void {
  const chip = createStatusChip(record.status);
  const priorityLabel = PRIORITY_LABELS[record.priority];
  const issueLabel = ISSUE_TYPE_LABELS[record.issueType];
  const createdDate = new Date(record.createdAt).toLocaleString('vi-VN');
  const syncedDate = record.syncedAt
    ? new Date(record.syncedAt).toLocaleString('vi-VN')
    : null;

  const photoHTML = record.photoBlob
    ? `<img class="detail-photo" src="${URL.createObjectURL(record.photoBlob)}" alt="Ảnh khảo sát" />`
    : '';

  const gpsHTML = record.latitude !== undefined
    ? /* html */ `
        <div class="detail-field">
          <div class="detail-field__label">Vị trí GPS</div>
          <div class="detail-field__value" style="font-family: var(--font-mono); color: var(--color-cyan)">
            ${formatCoords(record.latitude!, record.longitude!)}
          </div>
          ${record.accuracy !== undefined ? `<div class="text-xs text-muted">Độ chính xác: ±${Math.round(record.accuracy)}m</div>` : ''}
          <a href="${mapsUrl(record.latitude!, record.longitude!)}" target="_blank"
             rel="noopener" class="detail-map-link">
            🗺️ Mở Google Maps
          </a>
        </div>
      `
    : /* html */ `
        <div class="detail-field">
          <div class="detail-field__label">Vị trí GPS</div>
          <div class="detail-field__value text-muted">Không có dữ liệu GPS</div>
        </div>
      `;

  const retryHTML = (record.status === 'error' || record.status === 'pending_sync')
    ? /* html */ `
        <button id="retry-btn" class="btn btn--secondary btn--full mt-4">
          🔄 Thử đồng bộ lại
        </button>
        ${record.lastError ? `<p class="text-xs text-muted text-center mt-2">Lỗi: ${record.lastError}</p>` : ''}
      `
    : '';

  const editNoteHTML = record.status === 'draft'
    ? /* html */ `<button id="promote-btn" class="btn btn--primary btn--full mt-4">📤 Gửi báo cáo</button>`
    : '';

  container.innerHTML = /* html */ `
    <div class="page">
      <button class="back-btn" id="back-btn">← Quay lại</button>

      <div class="flex items-center justify-between mb-4">
        <h1 style="font-size:1.375rem">${escHtml(record.buildingRoom)}</h1>
        <span id="status-chip"></span>
      </div>

      ${photoHTML}

      <div class="card" style="margin-bottom: var(--space-4)">

        <div class="detail-field">
          <div class="detail-field__label">Loại sự cố</div>
          <div class="detail-field__value">${issueLabel}</div>
        </div>

        <div class="divider"></div>

        <div class="detail-field">
          <div class="detail-field__label">Mức độ ưu tiên</div>
          <div class="detail-field__value">
            <span class="chip chip--priority-${record.priority}">${priorityLabel}</span>
          </div>
        </div>

        <div class="divider"></div>

        ${gpsHTML}

        <div class="divider"></div>

        <div class="detail-field">
          <div class="detail-field__label">Ghi chú</div>
          <div class="detail-field__value">${record.notes ? escHtml(record.notes) : '<span class="text-muted">Không có ghi chú</span>'}</div>
        </div>

        <div class="divider"></div>

        <div class="detail-field">
          <div class="detail-field__label">Thời gian tạo</div>
          <div class="detail-field__value">${createdDate}</div>
        </div>

        ${syncedDate ? `
        <div class="divider"></div>
        <div class="detail-field">
          <div class="detail-field__label">Đã đồng bộ lúc</div>
          <div class="detail-field__value" style="color: var(--color-success)">${syncedDate}</div>
        </div>
        ` : ''}

        ${record.serverId ? `
        <div class="divider"></div>
        <div class="detail-field">
          <div class="detail-field__label">Server ID</div>
          <div class="detail-field__value" style="font-family: var(--font-mono); font-size: 0.8125rem; color: var(--color-text-muted); word-break: break-all">${record.serverId}</div>
        </div>
        ` : ''}

      </div>

      <div class="detail-field">
        <div class="detail-field__label">Trạng thái đồng bộ</div>
        <span id="status-chip-bottom"></span>
      </div>

      ${retryHTML}
      ${editNoteHTML}

      <div style="height: var(--space-12)"></div>
    </div>
  `;

  // Render chips
  const chipTop = document.getElementById('status-chip')!;
  const chipBottom = document.getElementById('status-chip-bottom')!;
  chipTop.appendChild(createStatusChip(record.status));
  chipBottom.appendChild(createStatusChip(record.status));

  document.getElementById('back-btn')!.addEventListener('click', () => navigate('/'));

  // Retry button
  const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement | null;
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      if (!navigator.onLine) {
        toast.warning('Không có kết nối mạng');
        return;
      }
      retryBtn.disabled = true;
      retryBtn.innerHTML = '<span class="spinner"></span> Đang đồng bộ...';

      const unsub = onSyncEvent('record-synced', (id) => {
        if (id === record.localId) {
          unsub();
          updateStatusChip(chipTop.firstElementChild as HTMLElement, 'synced');
          updateStatusChip(chipBottom.firstElementChild as HTMLElement, 'synced');
          retryBtn.remove();
          toast.success('Đã đồng bộ thành công!');
        }
      });

      await retryRecord(record.localId);

      // Re-enable in case sync failed
      setTimeout(() => {
        if (retryBtn.isConnected) {
          retryBtn.disabled = false;
          retryBtn.innerHTML = '🔄 Thử đồng bộ lại';
        }
      }, 5000);
    });
  }

  // Promote draft
  const promoteBtn = document.getElementById('promote-btn');
  if (promoteBtn) {
    promoteBtn.addEventListener('click', async () => {
      await updateRecord(record.localId, { status: 'pending_sync' });
      await retryRecord(record.localId);
      toast.info('Đã gửi báo cáo');
      navigate('/');
    });
  }
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
