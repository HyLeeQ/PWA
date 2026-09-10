import './style.css';
// @ts-expect-error — virtual:pwa-register is injected by vite-plugin-pwa at build time
import { registerSW } from 'virtual:pwa-register';
import { initSyncMessageListener } from './sync';
import { getNetworkStatus, addNetworkListener } from './capacitor-plugins';
import { renderList } from './ui/list';
import { renderForm } from './ui/form';
import { renderDetail } from './ui/detail';
import { toast } from './ui/toast';

// ─────────────────────────────────────────────────────────────────────────────
// Service Worker registration (PWA Cache-First)
// ─────────────────────────────────────────────────────────────────────────────

const updateSW = registerSW({
  onNeedRefresh() {
    const dismiss = toast.info(
      '🔄 Phiên bản mới có sẵn. <a href="#" id="update-link" style="color:var(--color-cyan);font-weight:600">Cập nhật ngay</a>',
      0,
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

// Bridge SW Background Sync + Capacitor Network → page sync queue
initSyncMessageListener();

// ─────────────────────────────────────────────────────────────────────────────
// Real-time Network Banner & Status Dot (@capacitor/network)
// ─────────────────────────────────────────────────────────────────────────────

const banner = document.getElementById('network-banner')!;
const statusDot = document.createElement('span');
statusDot.className = 'status-dot';

function updateNetworkUI(online: boolean, connectionType?: string): void {
  if (online) {
    banner.className = 'network-banner network-banner--online';
    const typeLabel = connectionType && connectionType !== 'unknown' ? ` (${connectionType})` : '';
    banner.textContent = `🌐 Đã kết nối mạng${typeLabel}`;
    banner.classList.remove('hidden');
    statusDot.classList.remove('status-dot--offline');
    statusDot.title = `Đang trực tuyến${typeLabel}`;
    setTimeout(() => banner.classList.add('hidden'), 2500);
  } else {
    banner.className = 'network-banner network-banner--offline';
    banner.textContent = '📵 Ngoại tuyến — Dữ liệu được lưu an toàn trong IndexedDB';
    banner.classList.remove('hidden');
    statusDot.classList.add('status-dot--offline');
    statusDot.title = 'Ngoại tuyến';
  }
}

// Check initial status via @capacitor/network
getNetworkStatus().then((net) => {
  if (!net.connected) {
    updateNetworkUI(false, net.connectionType);
  }
});

// Listen to real-time changes via @capacitor/network
addNetworkListener((status) => {
  updateNetworkUI(status.connected, status.connectionType);
});

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

  setTimeout(() => {
    document.getElementById('install-prompt')?.classList.remove('hidden');
  }, 2500);
});

document.getElementById('install-btn')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  document.getElementById('install-prompt')?.classList.add('hidden');
  await deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice.outcome === 'accepted') {
    toast.success('🎉 Đã cài đặt VKU Field Survey thành công!');
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
    <div class="header__logo" id="header-home-btn" role="button" style="cursor:pointer">
      <img src="/icons/icon-192.png" alt="Logo" class="header__logo-icon" />
      <div>
        <span class="header__logo-text">VKU Field Survey</span>
        <span class="header__badge">Capacitor v1.2</span>
      </div>
    </div>
    <div class="header__actions">
      <span id="header-status-dot" title="Trạng thái mạng"></span>
    </div>
  `;

  document.body.insertBefore(header, document.getElementById('app'));
  document.getElementById('header-status-dot')!.appendChild(statusDot);

  document.getElementById('header-home-btn')?.addEventListener('click', () => {
    navigate('/');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SPA Router
// ─────────────────────────────────────────────────────────────────────────────

const app = document.getElementById('app')!;

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
        <button class="btn btn--primary" id="fallback-home">← Về trang chủ</button>
      </div>
    </div>
  `;
  document.getElementById('fallback-home')?.addEventListener('click', () => navigate('/'));
}

window.addEventListener('popstate', renderCurrentRoute);

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

renderHeader();
renderCurrentRoute();
