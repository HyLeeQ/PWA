import './style.css';
// @ts-expect-error — virtual:pwa-register is injected by vite-plugin-pwa at build time
import { registerSW } from 'virtual:pwa-register';
import { initSyncMessageListener } from './sync';
import { renderList } from './ui/list';
import { renderForm } from './ui/form';
import { renderDetail } from './ui/detail';
import { toast } from './ui/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Service Worker registration
// ─────────────────────────────────────────────────────────────────────────────

const updateSW = registerSW({
  onNeedRefresh() {
    // New content available — show a dismissible toast
    const dismiss = toast.info(
      '🔄 Phiên bản mới có sẵn. <a href="#" id="update-link" style="color:var(--color-cyan)">Cập nhật ngay</a>',
      0, // persistent
    );
    setTimeout(() => {
      document.getElementById('update-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        dismiss();
        updateSW(true);
      });
    }, 50);
  },
  onOfflineReady() {
    toast.success('✅ Ứng dụng đã sẵn sàng hoạt động ngoại tuyến!', 4000);
  },
  onRegistered(registration: ServiceWorkerRegistration | undefined) {
    console.log('[SW] Registered:', registration);
  },
  onRegisterError(error: unknown) {
    console.error('[SW] Registration error:', error);
  },
});

// Bridge SW Background Sync → page sync queue
initSyncMessageListener();

// ─────────────────────────────────────────────────────────────────────────────
// Online / Offline banner
// ─────────────────────────────────────────────────────────────────────────────

const banner = document.getElementById('network-banner')!;
const statusDot = document.createElement('span');
statusDot.className = 'status-dot';

function updateNetworkUI(online: boolean): void {
  if (online) {
    banner.className = 'network-banner network-banner--online';
    banner.textContent = '🌐 Đã kết nối mạng';
    banner.classList.remove('hidden');
    statusDot.classList.remove('status-dot--offline');
    setTimeout(() => banner.classList.add('hidden'), 2500);
  } else {
    banner.className = 'network-banner network-banner--offline';
    banner.textContent = '📵 Ngoại tuyến — Dữ liệu sẽ được lưu cục bộ';
    banner.classList.remove('hidden');
    statusDot.classList.add('status-dot--offline');
  }
}

// Set initial state silently (don't flash the "online" banner on first load)
if (!navigator.onLine) updateNetworkUI(false);

window.addEventListener('online', () => updateNetworkUI(true));
window.addEventListener('offline', () => updateNetworkUI(false));

// ─────────────────────────────────────────────────────────────────────────────
// PWA Install prompt
// ─────────────────────────────────────────────────────────────────────────────

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e as BeforeInstallPromptEvent;

  // Show the install card after a short delay
  setTimeout(() => {
    document.getElementById('install-prompt')?.classList.remove('hidden');
  }, 3000);
});

document.getElementById('install-btn')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  document.getElementById('install-prompt')?.classList.add('hidden');
  await deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice.outcome === 'accepted') {
    toast.success('🎉 Đã cài đặt ứng dụng!');
  }
  deferredInstallPrompt = null;
});

document.getElementById('install-dismiss-btn')?.addEventListener('click', () => {
  document.getElementById('install-prompt')?.classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  document.getElementById('install-prompt')?.classList.add('hidden');
  toast.success('🎉 VKU Field Survey đã được cài đặt!');
});

// ─────────────────────────────────────────────────────────────────────────────
// Header rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderHeader(): void {
  const header = document.createElement('header');
  header.className = 'header';
  header.innerHTML = /* html */ `
    <div class="header__logo">
      <img src="/icons/icon-192.png" alt="Logo" class="header__logo-icon" />
      <span class="header__logo-text">VKU Field Survey</span>
    </div>
    <div class="header__actions">
      <span id="header-status-dot" title="Trạng thái mạng"></span>
    </div>
  `;

  // Insert before #app
  document.body.insertBefore(header, document.getElementById('app'));

  // Insert the live status dot
  document.getElementById('header-status-dot')!.appendChild(statusDot);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPA Router
// ─────────────────────────────────────────────────────────────────────────────

const app = document.getElementById('app')!;

/** Clean up previous page's event listener subscriptions if any */
function cleanupPage(): void {
  const el = app as HTMLElement & { _cleanup?: () => void };
  if (typeof el._cleanup === 'function') {
    el._cleanup();
    el._cleanup = undefined;
  }
}

function navigate(path: string): void {
  window.history.pushState({}, '', path);
  renderCurrentRoute();
}

function renderCurrentRoute(): void {
  cleanupPage();

  const path = window.location.pathname;

  if (path === '/' || path === '') {
    renderList(app, navigate);
    return;
  }

  if (path === '/new') {
    renderForm(app, navigate);
    return;
  }

  const detailMatch = path.match(/^\/record\/(.+)$/);
  if (detailMatch) {
    renderDetail(app, detailMatch[1], navigate);
    return;
  }

  // 404 fallback
  app.innerHTML = /* html */ `
    <div class="page">
      <div class="empty-state">
        <div class="empty-state__icon">🔍</div>
        <h1 class="empty-state__title">Trang không tồn tại</h1>
        <button class="btn btn--primary" onclick="history.back()">← Quay lại</button>
      </div>
    </div>
  `;
}

// Handle browser back/forward
window.addEventListener('popstate', renderCurrentRoute);

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

renderHeader();
renderCurrentRoute();
