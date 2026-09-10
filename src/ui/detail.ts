import { getRecord, updateRecord } from '../db';
import { retryRecord, onSyncEvent } from '../sync';
import { formatCoords, mapsUrl } from '../capacitor-plugins';
import type { InspectionRecord } from '../types';
import {
  CATEGORY_META,
  PRIORITY_LABELS,
  RATING_LABELS,
  ISSUE_TYPE_LABELS,
} from '../types';
import { createStatusChip, updateStatusChip } from './chip';
import { toast } from './toast';

// ─────────────────────────────────────────────────────────────────────────────
// Record Detail page (Project 1.2)
// ─────────────────────────────────────────────────────────────────────────────

export async function renderDetail(
  container: HTMLElement,
  localId: string,
  navigate: (path: string) => void,
): Promise<void> {
  container.innerHTML = /* html */ `
    <div class="page">
      <button class="back-btn" id="back-btn">← Quay lại danh sách</button>
      <div class="empty-state"><div class="spinner"></div></div>
    </div>
  `;

  document.getElementById('back-btn')!.addEventListener('click', () => navigate('/'));

  const record = await getRecord(localId);
  if (!record) {
    container.querySelector('.page')!.innerHTML = /* html */ `
      <button class="back-btn" id="back-btn2">← Quay lại danh sách</button>
      <div class="empty-state">
        <div class="empty-state__icon">🔍</div>
        <h2 class="empty-state__title">Không tìm thấy báo cáo</h2>
        <p class="empty-state__subtitle">Báo cáo này có thể đã bị xóa hoặc ID không hợp lệ.</p>
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
  const priorityLabel = PRIORITY_LABELS[record.priority];
  const catMeta = record.category ? CATEGORY_META[record.category] : null;
  const categoryLabel = catMeta ? `${catMeta.icon} ${catMeta.label}` : ISSUE_TYPE_LABELS[record.issueType];
  const ratingNum = record.rating || 3;
  const ratingDesc = RATING_LABELS[ratingNum] || '';
  const starsStr = '★'.repeat(ratingNum) + '☆'.repeat(5 - ratingNum);
  const createdDate = new Date(record.createdAt).toLocaleString('vi-VN');
  const syncedDate = record.syncedAt
    ? new Date(record.syncedAt).toLocaleString('vi-VN')
    : null;

  const photoHTML = record.photoBlob
    ? `<img class="detail-photo" src="${URL.createObjectURL(record.photoBlob)}" alt="Ảnh khảo sát" />`
    : '';

  const gpsHTML =
    record.latitude !== undefined
      ? /* html */ `
        <div class="detail-field">
          <div class="detail-field__label">Vị trí GPS (@capacitor/geolocation)</div>
          <div class="detail-field__value" style="font-family: var(--font-mono); color: var(--color-cyan)">
            ${formatCoords(record.latitude!, record.longitude!)}
          </div>
          ${
            record.accuracy !== undefined
              ? `<div class="text-xs text-muted" style="margin-top:2px">Độ chính xác: ±${Math.round(record.accuracy)}m</div>`
              : ''
          }
          <a href="${mapsUrl(record.latitude!, record.longitude!)}" target="_blank" rel="noopener" class="detail-map-link">
            🗺️ Mở trên Google Maps
          </a>
        </div>
      `
      : /* html */ `
        <div class="detail-field">
          <div class="detail-field__label">Vị trí GPS</div>
          <div class="detail-field__value text-muted">Không có dữ liệu GPS</div>
        </div>
      `;

  const retryHTML =
    record.status === 'error' || record.status === 'pending_sync'
      ? /* html */ `
        <button id="retry-btn" class="btn btn--secondary btn--full mt-4">
          🔄 Thử đồng bộ ngay
        </button>
        ${
          record.lastError
            ? `<p class="text-xs text-muted text-center mt-2">Lỗi trước đó: ${escHtml(record.lastError)}</p>`
            : ''
        }
      `
      : '';

  const editNoteHTML =
    record.status === 'draft'
      ? /* html */ `<button id="promote-btn" class="btn btn--primary btn--full mt-4">📤 Nộp báo cáo này</button>`
      : '';

  container.innerHTML = /* html */ `
    <div class="page">
      <button class="back-btn" id="back-btn">← Quay lại danh sách</button>

      <div class="flex items-center justify-between mb-4">
        <div>
          <h1 style="font-size:1.375rem; margin-bottom: 2px">${escHtml(record.buildingRoom || `${record.building} - ${record.room}`)}</h1>
          <p class="text-xs text-muted">${record.building || 'Tòa nhà'} · ${record.floor || 'Tầng'} · ${record.room || 'Phòng'}</p>
        </div>
        <span id="status-chip"></span>
      </div>

      ${photoHTML}

      <div class="card" style="margin-bottom: var(--space-4)">
        <div class="detail-field">
          <div class="detail-field__label">Hạng mục kiểm tra</div>
          <div class="detail-field__value" style="font-size: 1rem; font-weight: 700; color: var(--color-cyan)">
            ${categoryLabel}
          </div>
        </div>

        <div class="divider"></div>

        <div class="detail-field">
          <div class="detail-field__label">Đánh giá hiện trạng</div>
          <div class="detail-field__value">
            <span style="color: #fbbf24; font-size: 1.125rem; font-weight: bold; margin-right: 6px">${starsStr}</span>
            <span class="text-xs text-muted">(${ratingNum}/5 - ${ratingDesc})</span>
          </div>
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
          <div class="detail-field__label">Ghi chú về lỗi / Hiện trạng</div>
          <div class="detail-field__value">
            ${record.notes ? escHtml(record.notes) : '<span class="text-muted">Không có ghi chú</span>'}
          </div>
        </div>

        <div class="divider"></div>

        <div class="detail-field">
          <div class="detail-field__label">Mã định danh cục bộ (UUID)</div>
          <div class="detail-field__value" style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--color-text-muted); word-break: break-all">
            ${record.localId}
          </div>
        </div>

        <div class="divider"></div>

        <div class="detail-field">
          <div class="detail-field__label">Thời gian tạo</div>
          <div class="detail-field__value">${createdDate}</div>
        </div>

        ${
          syncedDate
            ? `
        <div class="divider"></div>
        <div class="detail-field">
          <div class="detail-field__label">Đã đồng bộ lên máy chủ lúc</div>
          <div class="detail-field__value" style="color: var(--color-success)">${syncedDate}</div>
        </div>
        `
            : ''
        }

        ${
          record.serverId
            ? `
        <div class="divider"></div>
        <div class="detail-field">
          <div class="detail-field__label">Server ID xác nhận</div>
          <div class="detail-field__value" style="font-family: var(--font-mono); font-size: 0.8125rem; color: var(--color-text-muted); word-break: break-all">${record.serverId}</div>
        </div>
        `
            : ''
        }
      </div>

      <div class="detail-field">
        <div class="detail-field__label">Trạng thái đồng bộ hàng đợi</div>
        <span id="status-chip-bottom"></span>
      </div>

      ${retryHTML}
      ${editNoteHTML}

      <div style="height: var(--space-12)"></div>
    </div>
  `;

  const chipTop = document.getElementById('status-chip')!;
  const chipBottom = document.getElementById('status-chip-bottom')!;
  chipTop.appendChild(createStatusChip(record.status));
  chipBottom.appendChild(createStatusChip(record.status));

  document.getElementById('back-btn')!.addEventListener('click', () => navigate('/'));

  const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement | null;
  if (retryBtn) {
    retryBtn.addEventListener('click', async () => {
      if (!navigator.onLine) {
        toast.warning('Không có kết nối mạng để đồng bộ');
        return;
      }
      retryBtn.disabled = true;
      retryBtn.innerHTML = '<span class="spinner"></span> Đang gửi lên máy chủ...';

      const unsub = onSyncEvent('record-synced', (id) => {
        if (id === record.localId) {
          unsub();
          updateStatusChip(chipTop.firstElementChild as HTMLElement, 'synced');
          updateStatusChip(chipBottom.firstElementChild as HTMLElement, 'synced');
          retryBtn.remove();
          toast.success('Đã đồng bộ thành công lên máy chủ!');
        }
      });

      await retryRecord(record.localId);

      setTimeout(() => {
        if (retryBtn.isConnected) {
          retryBtn.disabled = false;
          retryBtn.innerHTML = '🔄 Thử đồng bộ ngay';
        }
      }, 5000);
    });
  }

  const promoteBtn = document.getElementById('promote-btn');
  if (promoteBtn) {
    promoteBtn.addEventListener('click', async () => {
      await updateRecord(record.localId, { status: 'pending_sync' });
      await retryRecord(record.localId);
      toast.info('Đã gửi báo cáo vào hàng đợi đồng bộ');
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
