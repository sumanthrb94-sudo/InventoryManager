import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { execSync } from 'child_process';
import { defineConfig, loadEnv } from 'vite';

// Stable per-build identifier. Prefer the git SHA (cheap, deterministic,
// matches `git log`); fall back to a timestamp so builds outside a git
// worktree (Docker layers, CI artefacts) still produce something unique.
// Surfaced as:
//   - `__BUILD_ID__` constant inside the JS bundle (compile-time replace)
//   - `<meta name="build-id">` tag in index.html (HTML-time replace)
// useBuildVersionCheck compares the two and prompts a reload on mismatch.
function resolveBuildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return `t${Date.now().toString(36)}`;
  }
}
const BUILD_ID = resolveBuildId();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'inject-build-id-meta',
        transformIndexHtml() {
          return [{
            tag: 'meta',
            attrs: { name: 'build-id', content: BUILD_ID },
            injectTo: 'head',
          }];
        },
      },
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __BUILD_ID__: JSON.stringify(BUILD_ID),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // E2E harness: swap the Firebase SDK for an in-memory shim so the
        // real app can be driven headless (Playwright screenshots, UI
        // verification) with no credentials and no network. Everything
        // above the SDK — dbService, services, components — stays
        // production code. Only active with VITE_E2E=1.
        ...(env.VITE_E2E === '1' ? {
          'firebase/firestore': path.resolve(__dirname, 'src/lib/e2e/firestoreShim.ts'),
          'firebase/auth':      path.resolve(__dirname, 'src/lib/e2e/firestoreShim.ts'),
          'firebase/app':       path.resolve(__dirname, 'src/lib/e2e/firestoreShim.ts'),
          'firebase/storage':   path.resolve(__dirname, 'src/lib/e2e/firestoreShim.ts'),
        } : {}),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks: {
            // Core UI vendors — needed on every page, ship in the entry.
            'vendor-react':    ['react', 'react-dom', 'motion/react'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            'vendor-icons':    ['lucide-react'],
            // Heavy report/scanner libs — only used behind a click, so
            // splitting them keeps the entry small. The matching dynamic
            // imports live in: ReportRangeMenu (reportView/clientReport),
            // SellSheet/BuySheet/ReturnsPage (clientReport workbook
            // builders), pdfReport.ts users, and IMEIScanner.
            'vendor-charts':    ['recharts'],
            'vendor-exceljs':   ['exceljs'],
            'vendor-jspdf':     ['jspdf', 'jspdf-autotable'],
            'vendor-scanner':   ['html5-qrcode'],
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/__tests__/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/lib/**/*.ts'],
        exclude: ['src/lib/supabase.ts', 'src/lib/firebase.ts', 'src/lib/clientSeedData.json'],
      },
    },
  };
});
