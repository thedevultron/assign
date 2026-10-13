import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { host: '0.0.0.0', allowedHosts: true },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000, rollupOptions: { output: { manualChunks(id) {
    if (!id.includes('node_modules')) return undefined;
    if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor-react';
    if (id.includes('@google')) return 'genai';
    if (id.includes('motion')) return 'vendor-motion';
    if (id.includes('@visx') || id.includes('/d3-') || id.includes('d3-array')) return 'vendor-charts';
    if (id.includes('hugeicons')) return 'vendor-icons';
    return undefined;
  } } } },
});
