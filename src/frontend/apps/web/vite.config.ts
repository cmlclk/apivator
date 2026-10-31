import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Geliştirmede /api istekleri .NET API'ye yönlendirilir; böylece tarayıcı açısından aynı origin olur
// ve refresh token cookie'si sorunsuz çalışır.
const apiTarget = process.env.APIVATOR_API_URL ?? 'http://localhost:5080';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/hubs': { target: apiTarget, changeOrigin: true, ws: true },
      '/mock': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    // Kod editörü (CodeMirror + dil paketleri) tek parçada ~600 KB, sıkıştırılmış ~200 KB.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Kod editörü ve React ayrı dosyalarda: uygulama kodu değişince tarayıcı bunları önbellekten kullanır.
        manualChunks(id) {
          // GraphQL (şema, otomatik tamamlama) yalnızca GraphQL gövdesi açılınca yüklenir.
          if (
            /node_modules\/(graphql|graphql-language-service|cm6-graphql|vscode-languageserver-types|nullthrows|debounce-promise)\//.test(
              id,
            )
          )
            return 'graphql';
          if (/node_modules\/(@codemirror|@lezer|@uiw|codemirror)/.test(id)) return 'editor';
          if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Tek başına ~0,5 sn süren user-event yazma testleri tüm paket paralel koşarken 5-10 kat yavaşlıyor;
    // varsayılan 5 sn sınırı aşılınca da yarım kalan yazma bir sonraki testin alanına taşıyordu.
    testTimeout: 15_000,
    // Yerel ESLint kurallarının testi de buradan koşar (eslint-rules/ bir workspace paketi değil).
    include: ['src/**/*.test.{ts,tsx}', '../../eslint-rules/**/*.test.js'],
  },
});
