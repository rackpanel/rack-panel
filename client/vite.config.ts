import { defineConfig, type Plugin } from 'vite';
import vue2 from '@vitejs/plugin-vue2';
import legacy from '@vitejs/plugin-legacy';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Ensures 100% Android 4.4 KitKat (Chromium 30) compatibility:
 *  1. Replaces BigInt literals (`1n`, `2n`) in @novnc/novnc with runtime-safe calls
 *     so V8 on Android 4.4 never aborts with `SyntaxError: Unexpected token ILLEGAL`.
 *  2. Allows the Vite dev server (:5173) to serve the compiled legacy ES5 bundle
 *     from `dist/` whenever an Android 4.4 / pre-ES6-module browser connects to :5173.
 */
function android44KitKatCompat(): Plugin {
  const distDir = path.resolve(__dirname, 'dist');
  const replaceBigIntLiterals = (src: string): string =>
    src.replace(/\b(\d+|0x[0-9a-fA-F]+)n\b/g, '(typeof BigInt==="function"?BigInt($1):$1)');

  return {
    name: 'android44-kitkat-compat',
    transform(code, id) {
      if ((id.includes('@novnc') || id.endsWith('.js') || id.endsWith('.ts')) && /\b(?:\d+|0x[0-9a-fA-F]+)n\b/.test(code)) {
        return {
          code: replaceBigIntLiterals(code),
          map: null,
        };
      }
      return null;
    },
    renderChunk(code, chunk) {
      if (chunk.fileName.includes('legacy') && /\b(?:\d+|0x[0-9a-fA-F]+)n\b/.test(code)) {
        return {
          code: replaceBigIntLiterals(code),
          map: null,
        };
      }
      return null;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Strip same-origin `crossorigin` attributes that can trip up older Android 4.4 WebViews
        return html.replace(/\s+crossorigin(?:="[^"]*")?/g, '');
      },
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url || '/';
        const pathname = rawUrl.split('?')[0];

        // Serve built legacy assets from client/dist/assets when requested on :5173
        if (pathname.startsWith('/assets/')) {
          const assetFile = path.join(distDir, pathname);
          if (fs.existsSync(assetFile) && fs.statSync(assetFile).isFile()) {
            if (assetFile.endsWith('.js')) {
              res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            } else if (assetFile.endsWith('.css')) {
              res.setHeader('Content-Type', 'text/css; charset=utf-8');
            }
            fs.createReadStream(assetFile).pipe(res);
            return;
          }
        }

        // If an Android 4.x / pre-Chrome-61 browser (or ?legacy=1) hits Vite dev server (:5173),
        // serve the compiled ES5 legacy index.html from client/dist/index.html.
        const ua = String(req.headers['user-agent'] || '');
        const isLegacyUa =
          /Android\s+[1-4]\./i.test(ua) ||
          /Chrome\/(?:[1-5]\d)\./i.test(ua) ||
          rawUrl.includes('legacy=1');

        if (
          isLegacyUa &&
          req.method === 'GET' &&
          !pathname.startsWith('/api') &&
          !pathname.startsWith('/ws') &&
          !pathname.startsWith('/assets/') &&
          !pathname.startsWith('/@') &&
          !pathname.startsWith('/src/')
        ) {
          const builtIndex = path.join(distDir, 'index.html');
          if (fs.existsSync(builtIndex)) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(fs.readFileSync(builtIndex, 'utf8'));
            return;
          }
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    android44KitKatCompat(),
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
