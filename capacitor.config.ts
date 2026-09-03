import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'vn.edu.vku.fieldsurvey',
  appName: 'VKU Field Survey',
  webDir: 'dist',
  server: {
    // Required for HTTPS on Android WebView so Camera/GPS permissions work
    androidScheme: 'https',
  },
  plugins: {
    Camera: {
      // Don't save captured photos to the device gallery
      saveToGallery: false,
    },
    Geolocation: {
      // iOS: NSLocationWhenInUseUsageDescription is set in Info.plist via cap sync
    },
  },
};

export default config;
