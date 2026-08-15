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
  },
  plugins: [tailwindcss(), svelte()],
});
