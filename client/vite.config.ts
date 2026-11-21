import { defineConfig } from 'vite';
import vue2 from '@vitejs/plugin-vue2';
import legacy from '@vitejs/plugin-legacy';
import path from 'node:path';

export default defineConfig({
  plugins: [
    vue2(),
    legacy({
      // Explicitly target Android 4.4 KitKat WebView (Chromium 30) & legacy browsers
      targets: ['android >= 4.4', 'chrome >= 30'],
      modernTargets: 'chrome >= 87, edge >= 88, firefox >= 78, safari >= 14',
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
      modernPolyfills: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.BACKEND_PORT || 3840}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `http://127.0.0.1:${process.env.BACKEND_PORT || 3840}`,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssTarget: 'chrome30',
  },
});
