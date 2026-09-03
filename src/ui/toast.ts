// ─────────────────────────────────────────────────────────────────────────────
// Toast notification system
// ─────────────────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  type?: ToastType;
  duration?: number; // ms — 0 for persistent
}

const ICONS: Record<ToastType, string> = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️',
};

function getContainer(): HTMLElement {
  return document.getElementById('toast-container') as HTMLElement;
}

/**
 * Show a toast notification.
 * Returns a function that dismisses the toast immediately.
 */
export function showToast(message: string, options: ToastOptions = {}): () => void {
  const { type = 'info', duration = 3500 } = options;

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <span class="toast__icon">${ICONS[type]}</span>
    <span class="toast__message">${message}</span>
  `;

  const container = getContainer();
  container.appendChild(toast);

  const dismiss = () => {
    if (!toast.isConnected) return;
    toast.classList.add('toast--removing');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    // Fallback removal in case animation doesn't fire
    setTimeout(() => toast.remove(), 400);
  };

  if (duration > 0) {
    setTimeout(dismiss, duration);
  }

  return dismiss;
}

export const toast = {
  success: (msg: string, duration?: number) => showToast(msg, { type: 'success', duration }),
  error: (msg: string, duration?: number) => showToast(msg, { type: 'error', duration }),
  info: (msg: string, duration?: number) => showToast(msg, { type: 'info', duration }),
  warning: (msg: string, duration?: number) => showToast(msg, { type: 'warning', duration }),
};
