import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: '.',
  base: './',
  server: {
    port: 3456,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3457',
        changeOrigin: true,
      },
      '/covers': {
        target: 'http://localhost:3457',
        changeOrigin: true,
      },
      '/thumbs': {
        target: 'http://localhost:3457',
        changeOrigin: true,
      },
      '/banners': {
        target: 'http://localhost:3457',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssMinify: false,
    // 桌面 SPA 本地加载无网络延迟，不做代码分割；主 bundle ~788kB (gzip 255kB)
    // 超过 Vite 默认 500kB 阈值只是噪音警告，这里调高消除
    chunkSizeWarningLimit: 800,
  },
  plugins: [tailwindcss(), svelte()],
});
