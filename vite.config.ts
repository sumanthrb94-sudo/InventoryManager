import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
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
            'vendor-react':    ['react', 'react-dom', 'motion/react'],
            'vendor-charts':   ['recharts'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            'vendor-icons':    ['lucide-react'],
          },
        },
      },
    },
    // Strip console.* and debugger from production bundles — there are ~140
    // console calls across the app that would otherwise leak row data.
    esbuild: {
      drop: mode === 'production' ? ['console', 'debugger'] : [],
    },
    test: {
      globals: true,
      environment: 'jsdom',
      // .test.tsx was missing from the previous glob, so component tests
      // were silently skipped. Include both extensions.
      include: ['src/__tests__/**/*.test.{ts,tsx}', 'src/lib/__tests__/**/*.test.{ts,tsx}'],
      setupFiles: ['./src/__tests__/setup.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/lib/**/*.ts'],
        exclude: ['src/lib/firebase.ts', 'src/lib/clientSeedData.json'],
      },
    },
  };
});
