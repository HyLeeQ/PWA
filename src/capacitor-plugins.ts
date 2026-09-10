/**
 * capacitor-plugins.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified interface for Capacitor native plugins:
 *  1. @capacitor/camera     → hardware camera access with web fallback
 *  2. @capacitor/network    → real-time network monitoring with web fallback
 *  3. @capacitor/geolocation→ high accuracy GPS coordinates with web fallback
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { Network, type ConnectionStatus } from '@capacitor/network';
import type { GeoCoords } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureResult {
  blob: Blob;
  mimeType: string;
  previewUrl: string;
}

/**
 * Capture or select a photo.
 * Native path  → Camera.getPhoto() — native Android camera dialog
 * Browser path → <input type="file" capture="environment">
 */
export async function capturePhoto(): Promise<CaptureResult | null> {
  if (Capacitor.isNativePlatform()) {
    return capturePhotoNative();
  }
  return capturePhotoBrowser();
}

async function capturePhotoNative(): Promise<CaptureResult | null> {
  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt,
      saveToGallery: false,
    });

    if (!photo.base64String) return null;

    const mimeType = photo.format === 'png' ? 'image/png' : 'image/jpeg';
    const byteChars = atob(photo.base64String);
    const byteArray = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i);
    }
    const blob = new Blob([byteArray], { type: mimeType });

    return {
      blob,
      mimeType,
      previewUrl: URL.createObjectURL(blob),
    };
  } catch (err) {
    console.log('[Camera] Capture cancelled or failed:', err);
    return null;
  }
}

function capturePhotoBrowser(): Promise<CaptureResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);

      if (!file) {
        resolve(null);
        return;
      }

      resolve({
        blob: file,
        mimeType: file.type || 'image/jpeg',
        previewUrl: URL.createObjectURL(file),
      });
    };

    input.oncancel = () => {
      document.body.removeChild(input);
      resolve(null);
    };

    input.click();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Network (@capacitor/network)
// ─────────────────────────────────────────────────────────────────────────────

export interface AppNetworkStatus {
  connected: boolean;
  connectionType: string;
}

/**
 * Get current real-time network status using Capacitor Network.
 */
export async function getNetworkStatus(): Promise<AppNetworkStatus> {
  try {
    const status: ConnectionStatus = await Network.getStatus();
    return {
      connected: status.connected,
      connectionType: status.connectionType,
    };
  } catch {
    return {
      connected: navigator.onLine,
      connectionType: navigator.onLine ? 'unknown' : 'none',
    };
  }
}

/**
 * Listen for real-time network status changes using Capacitor Network.
 * Returns an unregister function.
 */
export function addNetworkListener(
  callback: (status: AppNetworkStatus) => void,
): () => void {
  let removeHandle: (() => void) | null = null;

  Network.addListener('networkStatusChange', (status: ConnectionStatus) => {
    callback({
      connected: status.connected,
      connectionType: status.connectionType,
    });
  }).then((handle) => {
    removeHandle = () => handle.remove();
  }).catch(() => {
    // Web fallback if plugin listener fails
    const onlineHandler = () => callback({ connected: true, connectionType: 'online' });
    const offlineHandler = () => callback({ connected: false, connectionType: 'none' });
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    removeHandle = () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  });

  return () => {
    if (removeHandle) removeHandle();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Geolocation (@capacitor/geolocation)
// ─────────────────────────────────────────────────────────────────────────────

export async function getCurrentLocation(): Promise<GeoCoords | null> {
  if (Capacitor.isNativePlatform()) {
    return getLocationNative();
  }
  return getLocationBrowser();
}

async function getLocationNative(): Promise<GeoCoords | null> {
  try {
    const permission = await Geolocation.requestPermissions();
    if (permission.location !== 'granted') {
      console.warn('[GPS] Permission denied');
      return null;
    }

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10_000,
    });

    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
  } catch (err) {
    console.warn('[GPS] Native geolocation failed:', err);
    return null;
  }
}

function getLocationBrowser(): Promise<GeoCoords | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn('[GPS] navigator.geolocation not supported');
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (err) => {
        console.warn('[GPS] Browser geolocation error:', err.message);
        resolve(null);
      },
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 30_000,
      },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

export function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}

export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}
