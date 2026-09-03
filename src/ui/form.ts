import { submitRecord } from '../sync';
import { capturePhoto, getCurrentLocation, formatCoords, mapsUrl } from '../capacitor-plugins';
import type { CaptureResult } from '../capacitor-plugins';
import type { IssueType, NewInspectionRecord, PriorityLevel } from '../types';
import { ISSUE_TYPE_LABELS, PRIORITY_LABELS } from '../types';
import { toast } from './toast';
import { createDropdown } from './dropdown';

// ─────────────────────────────────────────────────────────────────────────────
// New Inspection Form page
// ─────────────────────────────────────────────────────────────────────────────

let _navigate: ((path: string) => void) | null = null;

/** Captured photo state */
let capturedPhoto: CaptureResult | null = null;

/** GPS state */
let capturedLat: number | undefined;
let capturedLng: number | undefined;
let capturedAccuracy: number | undefined;

// Custom dropdown instances (stored so handleSubmit can read values)
let issueDropdown: ReturnType<typeof createDropdown> | null = null;
let priorityDropdown: ReturnType<typeof createDropdown> | null = null;

export function renderForm(container: HTMLElement, navigate: (path: string) => void): void {
  _navigate = navigate;
  capturedPhoto = null;
  capturedLat = undefined;
  capturedLng = undefined;
  capturedAccuracy = undefined;
  issueDropdown = null;
  priorityDropdown = null;

  container.innerHTML = /* html */ `
    <div class="page">
      <button class="back-btn" id="back-btn">← Quay lại</button>

      <h1 style="margin-bottom: var(--space-1)">Báo cáo mới</h1>
      <p class="text-sm text-muted" style="margin-bottom: var(--space-6)">
        Điền thông tin khảo sát cơ sở vật chất
      </p>

      <form id="inspection-form" novalidate>

        <!-- Building / Room -->
        <div class="form-group" id="group-buildingRoom">
          <label class="form-label" for="buildingRoom">
            Tòa nhà / Phòng <span class="required">*</span>
          </label>
          <input
            type="text"
            id="buildingRoom"
            name="buildingRoom"
            class="form-control"
            placeholder="Ví dụ: Tòa A - Phòng 201"
            autocomplete="off"
            required
          />
          <span class="form-error">Vui lòng nhập tên tòa nhà / phòng</span>
        </div>

        <!-- Issue Type — custom dropdown injected below -->
        <div class="form-group" id="group-issueType">
          <label class="form-label">
            Loại sự cố <span class="required">*</span>
          </label>
          <div id="issue-dropdown-mount"></div>
          <span class="form-error">Vui lòng chọn loại sự cố</span>
        </div>

        <!-- Priority — custom dropdown injected below -->
        <div class="form-group" id="group-priority">
          <label class="form-label">
            Mức độ ưu tiên <span class="required">*</span>
          </label>
          <div id="priority-dropdown-mount"></div>
          <span class="form-error">Vui lòng chọn mức độ ưu tiên</span>
        </div>

        <!-- Photo Capture -->
        <div class="form-group">
          <label class="form-label">Ảnh chụp</label>
          <div id="photo-area">
            <div class="photo-capture" id="photo-trigger" role="button" tabindex="0"
                 aria-label="Chụp ảnh hoặc chọn từ thư viện">
              <div class="photo-capture__icon">📷</div>
              <div class="photo-capture__label">Chụp ảnh / Chọn ảnh</div>
              <div class="photo-capture__hint">Tối đa 5MB · JPG, PNG, WebP</div>
            </div>
          </div>
        </div>

        <!-- GPS Coordinates -->
        <div class="form-group">
          <label class="form-label">Vị trí GPS</label>
          <div class="gps-widget">
            <span id="gps-display" class="gps-widget__placeholder">Chưa có vị trí</span>
            <button type="button" id="gps-btn" class="btn btn--secondary btn--sm">
              📍 Lấy vị trí
            </button>
          </div>
        </div>

        <!-- Notes -->
        <div class="form-group">
          <label class="form-label" for="notes">Ghi chú</label>
          <textarea
            id="notes"
            name="notes"
            class="form-control"
            placeholder="Mô tả chi tiết sự cố..."
            rows="4"
          ></textarea>
        </div>

        <!-- Submit -->
        <div class="flex gap-3 mt-4">
          <button type="submit" class="btn btn--primary btn--full" id="submit-btn">
            💾 Lưu báo cáo
          </button>
        </div>

        <p class="text-xs text-muted text-center mt-2">
          Báo cáo sẽ được lưu ngay cả khi không có mạng
        </p>

      </form>
    </div>
  `;

  // ── Mount custom dropdowns ──────────────────────────────────────────────────
  issueDropdown = createDropdown({
    id: 'issueType',
    placeholder: '-- Chọn loại sự cố --',
    options: Object.entries(ISSUE_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  });
  document.getElementById('issue-dropdown-mount')!.appendChild(issueDropdown.element);

  priorityDropdown = createDropdown({
    id: 'priority',
    placeholder: '-- Chọn mức độ ưu tiên --',
    options: Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label })),
  });
  document.getElementById('priority-dropdown-mount')!.appendChild(priorityDropdown.element);

  // ── Wire events ─────────────────────────────────────────────────────────────
  document.getElementById('back-btn')!.addEventListener('click', () => navigate('/'));

  const photoTrigger = document.getElementById('photo-trigger')!;
  photoTrigger.addEventListener('click', handlePhotoCapture);
  photoTrigger.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
      handlePhotoCapture();
    }
  });

  document.getElementById('gps-btn')!.addEventListener('click', handleGpsCapture);
  document.getElementById('inspection-form')!.addEventListener('submit', handleSubmit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handlePhotoCapture(): Promise<void> {
  const btn = document.getElementById('photo-trigger') as HTMLElement;
  btn.style.opacity = '0.5';
  btn.style.pointerEvents = 'none';

  try {
    const result = await capturePhoto();
    if (!result) {
      toast.info('Không có ảnh được chọn');
      return;
    }
    if (capturedPhoto?.previewUrl) URL.revokeObjectURL(capturedPhoto.previewUrl);
    capturedPhoto = result;
    renderPhotoPreview(result.previewUrl);
  } finally {
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
  }
}

function renderPhotoPreview(previewUrl: string): void {
  const area = document.getElementById('photo-area')!;
  area.innerHTML = /* html */ `
    <div class="photo-preview">
      <img src="${previewUrl}" alt="Ảnh khảo sát" />
      <button type="button" class="photo-preview__remove" id="photo-remove" aria-label="Xóa ảnh">✕</button>
    </div>
  `;
  document.getElementById('photo-remove')!.addEventListener('click', () => {
    if (capturedPhoto?.previewUrl) URL.revokeObjectURL(capturedPhoto.previewUrl);
    capturedPhoto = null;
    const area2 = document.getElementById('photo-area')!;
    area2.innerHTML = /* html */ `
      <div class="photo-capture" id="photo-trigger" role="button" tabindex="0">
        <div class="photo-capture__icon">📷</div>
        <div class="photo-capture__label">Chụp ảnh / Chọn ảnh</div>
        <div class="photo-capture__hint">Tối đa 5MB · JPG, PNG, WebP</div>
      </div>
    `;
    document.getElementById('photo-trigger')!.addEventListener('click', handlePhotoCapture);
  });
}

async function handleGpsCapture(): Promise<void> {
  const btn = document.getElementById('gps-btn') as HTMLButtonElement;
  const display = document.getElementById('gps-display')!;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  display.className = 'gps-widget__placeholder';
  display.textContent = 'Đang lấy vị trí...';

  try {
    const coords = await getCurrentLocation();
    if (!coords) {
      toast.error('Không thể lấy vị trí. Kiểm tra quyền truy cập GPS.');
      display.textContent = 'Không thể lấy vị trí';
      return;
    }

    capturedLat = coords.latitude;
    capturedLng = coords.longitude;
    capturedAccuracy = coords.accuracy;

    const mapLink = mapsUrl(coords.latitude, coords.longitude);
    display.className = 'gps-widget__coords';
    display.innerHTML = /* html */ `
      ${formatCoords(coords.latitude, coords.longitude)}
      <br/>
      <a href="${mapLink}" target="_blank" rel="noopener" class="detail-map-link" style="font-size:0.75rem">
        🗺️ Xem bản đồ
      </a>
    `;
    toast.success('Đã lấy vị trí GPS');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📍 Cập nhật';
  }
}

async function handleSubmit(e: Event): Promise<void> {
  e.preventDefault();

  const buildingRoomEl = document.getElementById('buildingRoom') as HTMLInputElement;
  const notesEl = document.getElementById('notes') as HTMLTextAreaElement;
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;

  const issueValue = issueDropdown?.getValue() ?? '';
  const priorityValue = priorityDropdown?.getValue() ?? '';

  let valid = true;

  const validate = (groupId: string, condition: boolean) => {
    const group = document.getElementById(groupId)!;
    group.classList.toggle('has-error', !condition);
    if (!condition) valid = false;
  };

  validate('group-buildingRoom', buildingRoomEl.value.trim().length > 0);
  validate('group-issueType', issueValue !== '');
  validate('group-priority', priorityValue !== '');

  if (!valid) {
    toast.warning('Vui lòng điền đầy đủ thông tin bắt buộc');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Đang lưu...';

  const data: NewInspectionRecord = {
    buildingRoom: buildingRoomEl.value.trim(),
    issueType: issueValue as IssueType,
    priority: priorityValue as PriorityLevel,
    notes: notesEl.value.trim(),
    photoBlob: capturedPhoto?.blob,
    photoMimeType: capturedPhoto?.mimeType,
    latitude: capturedLat,
    longitude: capturedLng,
    accuracy: capturedAccuracy,
  };

  try {
    await submitRecord(data);
    if (capturedPhoto?.previewUrl) URL.revokeObjectURL(capturedPhoto.previewUrl);

    if (navigator.onLine) {
      toast.success('Đã lưu và đang đồng bộ...');
    } else {
      toast.info('Đã lưu ngoại tuyến. Sẽ đồng bộ khi có mạng.');
    }
    _navigate?.('/');
  } catch (err) {
    console.error('[Form] Submit failed:', err);
    toast.error('Lỗi khi lưu báo cáo. Vui lòng thử lại.');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '💾 Lưu báo cáo';
  }
}
