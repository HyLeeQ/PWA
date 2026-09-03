/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkOnly } from 'workbox-strategies';

// Minimal type for Background Sync API (not in standard lib yet)
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
  readonly lastChance: boolean;
}

// Augment ServiceWorkerGlobalScope with sync event
declare global {
  interface ServiceWorkerGlobalScope {
    addEventListener(type: 'sync', listener: (event: SyncEvent) => void): void;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workbox setup
// ─────────────────────────────────────────────────────────────────────────────

declare let self: ServiceWorkerGlobalScope;

// Take control of all clients immediately when a new SW activates.
// Combined with autoUpdate in vite.config, users always get the latest version.
clientsClaim();

// Clean up old pre-cache entries from previous SW versions
cleanupOutdatedCaches();

// ─────────────────────────────────────────────────────────────────────────────
// Cache-First: App Shell (static assets)
// vite-plugin-pwa injects the manifest at build time via self.__WB_MANIFEST.
// All listed assets are pre-cached on SW install → the app shell loads with
// zero network requests.
// ─────────────────────────────────────────────────────────────────────────────
precacheAndRoute(self.__WB_MANIFEST);

// ─────────────────────────────────────────────────────────────────────────────
// Network-Only: API routes
// Survey data must NEVER be served from cache.
// All /api/* requests go directly to the network; if offline, they fail fast
// so the caller can catch the error and write to IndexedDB instead.
// ─────────────────────────────────────────────────────────────────────────────
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkOnly(),
);

registerRoute(
  ({ url }) => url.hostname === 'httpbin.org',
  new NetworkOnly(),
);

// ─────────────────────────────────────────────────────────────────────────────
// Background Sync: drain the pending queue when connectivity is restored.
// The sync.ts module registers the tag 'sync-inspections' when going offline.
// On Android Chrome / desktop Chrome this fires automatically.
// iOS Safari falls back to a window 'online' event listener in sync.ts.
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('sync', (event: SyncEvent) => {
  if (event.tag === 'sync-inspections') {
    event.waitUntil(notifyClientsToSync());
  }
});

/**
 * Ping all open clients (browser tabs / app windows) to trigger the sync
 * queue drain. The actual IndexedDB access and fetch happens in the page
 * context via sync.ts — the SW cannot directly use idb across origins.
 */
async function notifyClientsToSync(): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => {
    client.postMessage({ type: 'SW_SYNC_TRIGGER' });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Push Notifications (stub — for future extension)
// ─────────────────────────────────────────────────────────────────────────────
self.addEventListener('push', (event: PushEvent) => {
  const data = event.data?.json() ?? { title: 'VKU Field Survey', body: '' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  );
});
