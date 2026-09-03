import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    VitePWA({
      // Use injectManifest so we write our own sw.ts with full control
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // We manage manifest.json manually in /public
      manifest: false,
      injectManifest: {
        // Workbox will inject the precache manifest into self.__WB_MANIFEST
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webp}'],
        // Don't precache source maps
        globIgnores: ['**/*.map'],
      },
      devOptions: {
        // Enable SW in dev mode so we can test offline behavior
        enabled: true,
        type: 'module',
      },
    }),
  ],
  build: {
    // Generate source maps for debugging
    sourcemap: true,
  },
});
