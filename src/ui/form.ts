import { submitRecord } from '../sync';
import {
  saveDraftState,
  getDraftState,
  clearDraftState,
} from '../db';
import {
  capturePhoto,
  getCurrentLocation,
  formatCoords,
  mapsUrl,
} from '../capacitor-plugins';
import type { CaptureResult } from '../capacitor-plugins';
import type {
  FacilityCategory,
  PriorityLevel,
  NewInspectionRecord,
  SurveyDraft,
} from '../types';
import {
  CATEGORY_META,
  PRIORITY_LABELS,
  RATING_LABELS,
} from '../types';
import { toast } from './toast';

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Step Inspection Form Wizard
// ─────────────────────────────────────────────────────────────────────────────

interface FormState {
  step: number; // 1, 2, or 3
  building: string;
  floor: string;
  room: string;
  category: FacilityCategory | null;
  rating: number; // 1 to 5
  priority: PriorityLevel;
  notes: string;
  photo: CaptureResult | null;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
}

let state: FormState = {
  step: 1,
  building: 'Tòa V',
  floor: 'Tầng 2',
  room: '',
  category: 'hardware',
  rating: 3,
  priority: 'medium',
  notes: '',
  photo: null,
};

let _container: HTMLElement | null = null;
let _navigate: ((path: string) => void) | null = null;
let _saveTimer: number | null = null;

const QUICK_BUILDINGS = ['Tòa V', 'Tòa K', 'Tòa A', 'Tòa B', 'Khu Thể thao', 'Tầng hầm'];
const QUICK_FLOORS = ['Tầng 1', 'Tầng 2', 'Tầng 3', 'Tầng 4', 'Tầng 5', 'Tầng hầm'];

export async function renderForm(
  container: HTMLElement,
  navigate: (path: string) => void,
): Promise<void> {
  _container = container;
  _navigate = navigate;

  // 1. Try to restore draft from IndexedDB
  const draft = await getDraftState();
  if (draft) {
    state = {
      step: draft.step || 1,
      building: draft.building || 'Tòa V',
      floor: draft.floor || 'Tầng 2',
      room: draft.room || '',
      category: draft.category || 'hardware',
      rating: draft.rating || 3,
      priority: draft.priority || 'medium',
      notes: draft.notes || '',
      photo: draft.photoBlob
        ? {
            blob: draft.photoBlob,
            mimeType: draft.photoMimeType || 'image/jpeg',
            previewUrl: URL.createObjectURL(draft.photoBlob),
          }
        : null,
      latitude: draft.latitude,
      longitude: draft.longitude,
      accuracy: draft.accuracy,
    };
  } else {
    state = {
      step: 1,
      building: 'Tòa V',
      floor: 'Tầng 2',
      room: '',
      category: 'hardware',
      rating: 3,
      priority: 'medium',
      notes: '',
      photo: null,
    };
  }

  renderWizard(draft !== undefined);
}

function persistDraft(): void {
  if (_saveTimer) window.clearTimeout(_saveTimer);
  _saveTimer = window.setTimeout(async () => {
    try {
      const draftData: Omit<SurveyDraft, 'id'> = {
        step: state.step,
        building: state.building,
        floor: state.floor,
        room: state.room,
        category: state.category || undefined,
        rating: state.rating,
        priority: state.priority,
        notes: state.notes,
        photoBlob: state.photo?.blob,
        photoMimeType: state.photo?.mimeType,
        latitude: state.latitude,
        longitude: state.longitude,
        accuracy: state.accuracy,
        updatedAt: Date.now(),
      };
      await saveDraftState(draftData);
    } catch (err) {
      console.warn('[Draft] Failed to auto-save to IndexedDB:', err);
    }
  }, 300);
}

function renderWizard(showDraftBanner = false): void {
  if (!_container) return;

  _container.innerHTML = /* html */ `
    <div class="page">
      <div class="flex items-center justify-between mb-2">
        <button class="back-btn" id="btn-back-home">← Danh sách</button>
        <span class="text-xs text-muted" id="draft-sync-pill">💾 Tự động lưu IndexedDB</span>
      </div>

      <h1 style="margin-bottom: var(--space-1)">Phiếu kiểm tra cơ sở vật chất</h1>
      <p class="text-sm text-muted" style="margin-bottom: var(--space-4)">
        Thu thập dữ liệu ngoại tuyến khuôn viên VKU
      </p>

      ${
        showDraftBanner
          ? `
        <div class="draft-banner" id="draft-banner">
          <span>📋 Đã tự động khôi phục bản nháp chưa nộp</span>
          <button type="button" class="draft-banner__clear" id="btn-clear-draft">Xóa nháp</button>
        </div>
      `
          : ''
      }

      <!-- Stepper Indicator -->
      <div class="stepper">
        <button class="stepper__step ${state.step >= 1 ? (state.step === 1 ? 'stepper__step--active' : 'stepper__step--completed') : ''}" data-goto="1">
          <div class="stepper__step-num">${state.step > 1 ? '✓' : '1'}</div>
          <div class="stepper__step-title">Vị trí</div>
        </button>
        <div class="stepper__line ${state.step > 1 ? 'stepper__line--completed' : ''}"></div>

        <button class="stepper__step ${state.step >= 2 ? (state.step === 2 ? 'stepper__step--active' : 'stepper__step--completed') : ''}" data-goto="2">
          <div class="stepper__step-num">${state.step > 2 ? '✓' : '2'}</div>
          <div class="stepper__step-title">Đánh giá</div>
        </button>
        <div class="stepper__line ${state.step > 2 ? 'stepper__line--completed' : ''}"></div>

        <button class="stepper__step ${state.step === 3 ? 'stepper__step--active' : ''}" data-goto="3">
          <div class="stepper__step-num">3</div>
          <div class="stepper__step-title">Minh chứng</div>
        </button>
      </div>

      <!-- Step Contents -->
      <form id="wizard-form" novalidate>
        <div id="step-content-area"></div>
      </form>
    </div>
  `;

  // Bind top bar events
  document.getElementById('btn-back-home')?.addEventListener('click', () => {
    _navigate?.('/');
  });

  document.getElementById('btn-clear-draft')?.addEventListener('click', async () => {
    await clearDraftState();
    state = {
      step: 1,
      building: 'Tòa V',
      floor: 'Tầng 2',
      room: '',
      category: 'hardware',
      rating: 3,
      priority: 'medium',
      notes: '',
      photo: null,
    };
    toast.info('Đã xóa bản nháp');
    renderWizard(false);
  });

  // Step click navigation (can jump backwards)
  _container.querySelectorAll('.stepper__step').forEach((el) => {
    el.addEventListener('click', () => {
      const targetStep = parseInt(el.getAttribute('data-goto') || '1', 10);
      if (targetStep < state.step) {
        state.step = targetStep;
        renderCurrentStep();
      } else if (targetStep > state.step && validateCurrentStep()) {
        state.step = targetStep;
        renderCurrentStep();
      }
    });
  });

  renderCurrentStep();
}

function renderCurrentStep(): void {
  const mount = document.getElementById('step-content-area');
  if (!mount) return;

  persistDraft();

  // Update Stepper visually
  document.querySelectorAll('.stepper__step').forEach((el) => {
    const s = parseInt(el.getAttribute('data-goto') || '1', 10);
    el.className = `stepper__step ${
      s === state.step
        ? 'stepper__step--active'
        : s < state.step
          ? 'stepper__step--completed'
          : ''
    }`;
    const numEl = el.querySelector('.stepper__step-num');
    if (numEl) numEl.textContent = s < state.step ? '✓' : String(s);
  });

  document.querySelectorAll('.stepper__line').forEach((line, idx) => {
    line.className = `stepper__line ${idx + 1 < state.step ? 'stepper__line--completed' : ''}`;
  });

  if (state.step === 1) {
    mount.innerHTML = renderStep1();
    bindStep1();
  } else if (state.step === 2) {
    mount.innerHTML = renderStep2();
    bindStep2();
  } else {
    mount.innerHTML = renderStep3();
    bindStep3();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Vị trí kiểm tra
// ─────────────────────────────────────────────────────────────────────────────

function renderStep1(): string {
  return /* html */ `
    <div class="card" style="margin-bottom: var(--space-4)">
      <h2 style="font-size: 1.125rem; margin-bottom: var(--space-1); color: var(--color-cyan)">
        Bước 1: Vị trí kiểm tra
      </h2>
      <p class="text-xs text-muted" style="margin-bottom: var(--space-4)">
        Chọn hoặc nhập chính xác khu vực cần kiểm tra
      </p>

      <!-- Tòa nhà -->
      <div class="form-group" id="group-building">
        <label class="form-label" for="input-building">
          Tòa nhà <span class="required">*</span>
        </label>
        <input
          type="text"
          id="input-building"
          class="form-control"
          placeholder="Ví dụ: Tòa V, Tòa K, Tòa A..."
          value="${esc(state.building)}"
          required
        />
        <div class="quick-chips" id="building-chips">
          ${QUICK_BUILDINGS.map(
            (b) => `
            <button type="button" class="quick-chip ${state.building === b ? 'quick-chip--active' : ''}" data-val="${b}">
              ${b}
            </button>
          `,
          ).join('')}
        </div>
      </div>

      <!-- Tầng -->
      <div class="form-group" id="group-floor">
        <label class="form-label" for="input-floor">
          Tầng <span class="required">*</span>
        </label>
        <input
          type="text"
          id="input-floor"
          class="form-control"
          placeholder="Ví dụ: Tầng 1, Tầng 2, Tầng hầm..."
          value="${esc(state.floor)}"
          required
        />
        <div class="quick-chips" id="floor-chips">
          ${QUICK_FLOORS.map(
            (f) => `
            <button type="button" class="quick-chip ${state.floor === f ? 'quick-chip--active' : ''}" data-val="${f}">
              ${f}
            </button>
          `,
          ).join('')}
        </div>
      </div>

      <!-- Số phòng -->
      <div class="form-group" id="group-room">
        <label class="form-label" for="input-room">
          Số phòng / Khu vực <span class="required">*</span>
        </label>
        <input
          type="text"
          id="input-room"
          class="form-control"
          placeholder="Ví dụ: Phòng 201, Lab AI, Hội trường B..."
          value="${esc(state.room)}"
          required
        />
        <span class="form-error" id="error-room">Vui lòng nhập số phòng hoặc tên khu vực</span>
      </div>
    </div>

    <div class="step-actions">
      <button type="button" class="btn btn--secondary" id="btn-step1-cancel">Hủy</button>
      <button type="button" class="btn btn--primary" id="btn-step1-next">Tiếp tục: Hạng mục & Đánh giá →</button>
    </div>
  `;
}

function bindStep1(): void {
  const buildingInput = document.getElementById('input-building') as HTMLInputElement;
  const floorInput = document.getElementById('input-floor') as HTMLInputElement;
  const roomInput = document.getElementById('input-room') as HTMLInputElement;

  buildingInput.addEventListener('input', () => {
    state.building = buildingInput.value.trim();
    persistDraft();
  });

  floorInput.addEventListener('input', () => {
    state.floor = floorInput.value.trim();
    persistDraft();
  });

  roomInput.addEventListener('input', () => {
    state.room = roomInput.value.trim();
    document.getElementById('group-room')?.classList.remove('has-error');
    persistDraft();
  });

  document.querySelectorAll('#building-chips .quick-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#building-chips .quick-chip').forEach((b) => b.classList.remove('quick-chip--active'));
      btn.classList.add('quick-chip--active');
      state.building = btn.getAttribute('data-val') || '';
      buildingInput.value = state.building;
      persistDraft();
    });
  });

  document.querySelectorAll('#floor-chips .quick-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#floor-chips .quick-chip').forEach((b) => b.classList.remove('quick-chip--active'));
      btn.classList.add('quick-chip--active');
      state.floor = btn.getAttribute('data-val') || '';
      floorInput.value = state.floor;
      persistDraft();
    });
  });

  document.getElementById('btn-step1-cancel')?.addEventListener('click', () => {
    _navigate?.('/');
  });

  document.getElementById('btn-step1-next')?.addEventListener('click', () => {
    if (!state.room) {
      document.getElementById('group-room')?.classList.add('has-error');
      roomInput.focus();
      return;
    }
    state.step = 2;
    renderCurrentStep();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Hạng mục kiểm tra & Đánh giá 1-5 sao
// ─────────────────────────────────────────────────────────────────────────────

function renderStep2(): string {
  const categories: FacilityCategory[] = ['hardware', 'projector', 'ac', 'electrical', 'furniture'];

  return /* html */ `
    <div class="card" style="margin-bottom: var(--space-4)">
      <h2 style="font-size: 1.125rem; margin-bottom: var(--space-1); color: var(--color-cyan)">
        Bước 2: Hạng mục & Đánh giá
      </h2>
      <p class="text-xs text-muted" style="margin-bottom: var(--space-4)">
        Chọn thiết bị cần kiểm tra và đánh giá hiện trạng (1-5 sao)
      </p>

      <!-- Category selection -->
      <div class="form-group">
        <label class="form-label">
          Hạng mục thiết bị <span class="required">*</span>
        </label>
        <div class="category-grid">
          ${categories
            .map((cat) => {
              const meta = CATEGORY_META[cat];
              const isActive = state.category === cat;
              return `
              <div class="category-card ${isActive ? 'category-card--active' : ''}" data-cat="${cat}">
                <div class="category-card__icon">${meta.icon}</div>
                <div class="category-card__label">${meta.label}</div>
                <div class="category-card__desc">${meta.desc}</div>
              </div>
            `;
            })
            .join('')}
        </div>
      </div>

      <!-- 1-5 Star rating -->
      <div class="form-group">
        <label class="form-label">
          Đánh giá tình trạng (1 - 5 sao) <span class="required">*</span>
        </label>
        <div class="rating-widget">
          <div class="rating-stars" id="star-container">
            ${[1, 2, 3, 4, 5]
              .map(
                (star) => `
              <button type="button" class="star-btn ${star <= state.rating ? 'star-btn--filled' : ''}" data-star="${star}">
                ★
              </button>
            `,
              )
              .join('')}
          </div>
          <div class="rating-status" id="rating-text">
            ${state.rating} sao: ${RATING_LABELS[state.rating]}
          </div>
        </div>
      </div>

      <!-- Priority level -->
      <div class="form-group">
        <label class="form-label">
          Mức độ ưu tiên xử lý <span class="required">*</span>
        </label>
        <div class="quick-chips" id="priority-chips">
          ${(['low', 'medium', 'high', 'critical'] as PriorityLevel[])
            .map(
              (p) => `
            <button type="button" class="quick-chip ${state.priority === p ? 'quick-chip--active' : ''}" data-priority="${p}">
              ${PRIORITY_LABELS[p]}
            </button>
          `,
            )
            .join('')}
        </div>
      </div>
    </div>

    <div class="step-actions">
      <button type="button" class="btn btn--secondary" id="btn-step2-prev">← Quay lại Vị trí</button>
      <button type="button" class="btn btn--primary" id="btn-step2-next">Tiếp tục: Minh chứng & Ghi chú →</button>
    </div>
  `;
}

function bindStep2(): void {
  // Category cards
  document.querySelectorAll('.category-card').forEach((card) => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.category-card').forEach((c) => c.classList.remove('category-card--active'));
      card.classList.add('category-card--active');
      state.category = card.getAttribute('data-cat') as FacilityCategory;
      persistDraft();
    });
  });

  // Star ratings
  const updateStars = (val: number) => {
    state.rating = val;
    document.querySelectorAll('.star-btn').forEach((btn) => {
      const s = parseInt(btn.getAttribute('data-star') || '1', 10);
      btn.classList.toggle('star-btn--filled', s <= val);
    });
    const labelEl = document.getElementById('rating-text');
    if (labelEl) {
      labelEl.textContent = `${val} sao: ${RATING_LABELS[val]}`;
    }
    // Automatically suggest priority if rating is 1 or 2
    if (val === 1 && state.priority === 'low') {
      state.priority = 'critical';
      updatePriorityChips();
    } else if (val === 2 && state.priority === 'low') {
      state.priority = 'high';
      updatePriorityChips();
    }
    persistDraft();
  };

  document.querySelectorAll('.star-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const star = parseInt(btn.getAttribute('data-star') || '1', 10);
      updateStars(star);
    });
  });

  // Priority chips
  const updatePriorityChips = () => {
    document.querySelectorAll('#priority-chips .quick-chip').forEach((btn) => {
      const p = btn.getAttribute('data-priority');
      btn.classList.toggle('quick-chip--active', p === state.priority);
    });
  };

  document.querySelectorAll('#priority-chips .quick-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.priority = btn.getAttribute('data-priority') as PriorityLevel;
      updatePriorityChips();
      persistDraft();
    });
  });

  document.getElementById('btn-step2-prev')?.addEventListener('click', () => {
    state.step = 1;
    renderCurrentStep();
  });

  document.getElementById('btn-step2-next')?.addEventListener('click', () => {
    state.step = 3;
    renderCurrentStep();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Ghi chú lỗi, Ảnh chụp native, GPS & Tóm tắt nộp bài
// ─────────────────────────────────────────────────────────────────────────────

function renderStep3(): string {
  const catMeta = state.category ? CATEGORY_META[state.category] : null;

  return /* html */ `
    <div class="card" style="margin-bottom: var(--space-4)">
      <h2 style="font-size: 1.125rem; margin-bottom: var(--space-1); color: var(--color-cyan)">
        Bước 3: Chi tiết lỗi & Minh chứng
      </h2>
      <p class="text-xs text-muted" style="margin-bottom: var(--space-4)">
        Ghi chú mô tả lỗi, chụp ảnh hiện trường và tọa độ GPS
      </p>

      <!-- Review summary card -->
      <div class="review-card">
        <div class="review-card__header">📋 Tóm tắt thông tin khảo sát</div>
        <div class="review-row">
          <span class="review-row__label">Vị trí:</span>
          <span class="review-row__value">${esc(state.building)} - ${esc(state.floor)} - ${esc(state.room)}</span>
        </div>
        <div class="review-row">
          <span class="review-row__label">Hạng mục:</span>
          <span class="review-row__value">${catMeta ? `${catMeta.icon} ${catMeta.label}` : '—'}</span>
        </div>
        <div class="review-row">
          <span class="review-row__label">Đánh giá:</span>
          <span class="review-row__value">${state.rating} ★ (${RATING_LABELS[state.rating]})</span>
        </div>
        <div class="review-row">
          <span class="review-row__label">Mức ưu tiên:</span>
          <span class="review-row__value">${PRIORITY_LABELS[state.priority]}</span>
        </div>
      </div>

      <!-- Notes / Error Description -->
      <div class="form-group">
        <label class="form-label" for="notes-input">
          Ghi chú về lỗi / Mô tả hư hỏng
        </label>
        <textarea
          id="notes-input"
          class="form-control"
          rows="3"
          placeholder="Mô tả cụ thể triệu chứng, hỏng hóc, thiết bị cần thay thế..."
        >${esc(state.notes)}</textarea>
      </div>

      <!-- Native Camera / Photo Area -->
      <div class="form-group">
        <label class="form-label">Ảnh chụp hiện trường (@capacitor/camera)</label>
        <div id="photo-area">
          ${
            state.photo
              ? `
            <div class="photo-preview-card">
              <img src="${state.photo.previewUrl}" alt="Ảnh hiện trường" style="width:100%;max-height:220px;object-fit:cover;border-radius:var(--radius-md)" />
              <button type="button" class="btn btn--secondary btn--sm mt-2" id="btn-remove-photo">🗑️ Xóa ảnh này</button>
            </div>
          `
              : `
            <div class="photo-capture" id="photo-trigger" role="button" tabindex="0">
              <div class="photo-capture__icon">📷</div>
              <div class="photo-capture__label">Chụp ảnh / Chọn từ máy</div>
              <div class="photo-capture__hint">Tích hợp @capacitor/camera · Tự động nén</div>
            </div>
          `
          }
        </div>
      </div>

      <!-- GPS Coordinates -->
      <div class="form-group">
        <label class="form-label">Tọa độ GPS (@capacitor/geolocation)</label>
        <div class="gps-widget">
          <span id="gps-display" class="gps-widget__placeholder">
            ${
              state.latitude !== undefined
                ? `<span style="color:var(--color-cyan);font-family:var(--font-mono)">${formatCoords(state.latitude, state.longitude!)}</span>`
                : 'Chưa lấy tọa độ'
            }
          </span>
          <button type="button" id="gps-btn" class="btn btn--secondary btn--sm">
            📍 Lấy vị trí
          </button>
        </div>
        ${
          state.latitude !== undefined
            ? `
          <div style="margin-top:var(--space-2)">
            <a href="${mapsUrl(state.latitude, state.longitude!)}" target="_blank" rel="noopener" class="detail-map-link">
              🗺️ Mở Google Maps
            </a>
          </div>
        `
            : ''
        }
      </div>
    </div>

    <div class="step-actions">
      <button type="button" class="btn btn--secondary" id="btn-step3-prev">← Quay lại Đánh giá</button>
      <button type="button" class="btn btn--primary" id="btn-submit-all" style="background:var(--color-accent)">
        🚀 Hoàn thành & Nộp báo cáo
      </button>
    </div>
  `;
}

function bindStep3(): void {
  const notesInput = document.getElementById('notes-input') as HTMLTextAreaElement;
  notesInput?.addEventListener('input', () => {
    state.notes = notesInput.value;
    persistDraft();
  });

  // Photo capture trigger
  document.getElementById('photo-trigger')?.addEventListener('click', async () => {
    const result = await capturePhoto();
    if (result) {
      state.photo = result;
      persistDraft();
      renderCurrentStep();
    }
  });

  document.getElementById('btn-remove-photo')?.addEventListener('click', () => {
    if (state.photo?.previewUrl) {
      URL.revokeObjectURL(state.photo.previewUrl);
    }
    state.photo = null;
    persistDraft();
    renderCurrentStep();
  });

  // GPS trigger
  const gpsBtn = document.getElementById('gps-btn') as HTMLButtonElement | null;
  gpsBtn?.addEventListener('click', async () => {
    if (gpsBtn) {
      gpsBtn.disabled = true;
      gpsBtn.innerHTML = '<span class="spinner"></span> Đang định vị...';
    }
    const coords = await getCurrentLocation();
    if (coords) {
      state.latitude = coords.latitude;
      state.longitude = coords.longitude;
      state.accuracy = coords.accuracy;
      toast.success(`Đã lấy vị trí (±${Math.round(coords.accuracy)}m)`);
      persistDraft();
      renderCurrentStep();
    } else {
      toast.warning('Không thể lấy GPS. Vui lòng cấp quyền vị trí.');
      if (gpsBtn) {
        gpsBtn.disabled = false;
        gpsBtn.innerHTML = '📍 Lấy vị trí';
      }
    }
  });

  document.getElementById('btn-step3-prev')?.addEventListener('click', () => {
    state.step = 2;
    renderCurrentStep();
  });

  // Submit report
  document.getElementById('btn-submit-all')?.addEventListener('click', async () => {
    await handleSubmit();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Form Submission
// ─────────────────────────────────────────────────────────────────────────────

async function handleSubmit(): Promise<void> {
  const submitBtn = document.getElementById('btn-submit-all') as HTMLButtonElement | null;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Đang lưu vào IndexedDB...';
  }

  const category = state.category || 'hardware';
  const buildingRoom = `${state.building} - ${state.floor} - ${state.room}`;

  const recordData: NewInspectionRecord = {
    building: state.building,
    floor: state.floor,
    room: state.room,
    buildingRoom,
    category,
    rating: state.rating,
    priority: state.priority,
    issueType: category,
    notes: state.notes.trim(),
    photoBlob: state.photo?.blob,
    photoMimeType: state.photo?.mimeType,
    latitude: state.latitude,
    longitude: state.longitude,
    accuracy: state.accuracy,
  };

  try {
    const record = await submitRecord(recordData);

    // Clear active draft in IndexedDB
    await clearDraftState().catch(console.warn);

    toast.success('🎉 Báo cáo đã được lưu vào IndexedDB thành công!');

    if (!navigator.onLine) {
      toast.info('📵 Đã xếp vào hàng đợi PENDING_SYNC. Sẽ tự động tải lên khi có mạng.');
    }

    _navigate?.(`/record/${record.localId}`);
  } catch (err) {
    console.error('[Form] Submit failed:', err);
    toast.error('Lỗi khi lưu báo cáo: ' + (err instanceof Error ? err.message : String(err)));
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '🚀 Hoàn thành & Nộp báo cáo';
    }
  }
}

function validateCurrentStep(): boolean {
  if (state.step === 1) {
    return Boolean(state.room && state.room.trim().length > 0);
  }
  return true;
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
