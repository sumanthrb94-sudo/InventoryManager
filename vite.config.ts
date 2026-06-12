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
