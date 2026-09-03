/**
 * capacitor-plugins.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Unified camera and GPS interface that works in two contexts:
 *
 *  1. Native Android/iOS (via Capacitor)  → uses @capacitor/camera and
 *     @capacitor/geolocation for hardware access.
 *
 *  2. Browser / web dev  (fallback)        → uses <input type="file" capture>
 *     for photos and navigator.geolocation for GPS.
 *
 * Consumers only ever call capturePhoto() and getCurrentLocation() — the
 * platform detection is fully encapsulated here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import type { GeoCoords } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Camera
// ─────────────────────────────────────────────────────────────────────────────

export interface CaptureResult {
  blob: Blob;
  mimeType: string;
  /** Object URL for preview — revoke after use to avoid memory leaks */
  previewUrl: string;
}

/**
 * Capture or select a photo.
 *
 * Native path  → Camera.getPhoto() — opens native camera UI.
 * Browser path → programmatically triggers a hidden <input type="file">.
 *
 * Returns null if the user cancels.
 */
export async function capturePhoto(): Promise<CaptureResult | null> {
  if (Capacitor.isNativePlatform()) {
    return capturePhotoNative();
  }
  return capturePhotoBrowser();
}

/** Capacitor Camera API — runs on Android / iOS */
async function capturePhotoNative(): Promise<CaptureResult | null> {
  try {
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.Base64,
      source: CameraSource.Prompt, // let user choose Camera vs Gallery
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
    // User cancelled
    console.log('[Camera] Capture cancelled or failed:', err);
    return null;
  }
}

/** Browser file input fallback — works on desktop and mobile browsers */
function capturePhotoBrowser(): Promise<CaptureResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // 'environment' requests the rear camera on mobile browsers
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

    // Programmatically open the file picker
    input.click();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Geolocation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the device's current GPS position.
 *
 * Native path  → @capacitor/geolocation (hardware GPS, no permission dialog quirks).
 * Browser path → navigator.geolocation Web API.
 *
 * Returns null if the user denies permission or GPS is unavailable.
 */
export async function getCurrentLocation(): Promise<GeoCoords | null> {
  if (Capacitor.isNativePlatform()) {
    return getLocationNative();
  }
  return getLocationBrowser();
}

/** Capacitor Geolocation API — Android / iOS */
async function getLocationNative(): Promise<GeoCoords | null> {
  try {
    // Request permissions on Android (no-op on iOS — handled by Info.plist)
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

/** Browser navigator.geolocation fallback */
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

/**
 * Format GPS coordinates for display.
 * e.g. "16.0732°N, 108.1521°E"
 */
export function formatCoords(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
}

/**
 * Generate a Google Maps link for given coordinates.
 */
export function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/**
 * Check if Capacitor native plugins are available (i.e. running on device).
 */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}
