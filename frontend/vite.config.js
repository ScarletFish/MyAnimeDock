import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import tailwindcss from '@tailwindcss/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Source files in load order (mirrors src/main.js)
const JS_FILES = [
  'i18n-zh.js', 'i18n.js', 'tag-data.js', 'state.js', 'debug.js', 'ui.js', 'api.js',
  'utils.js', 'detail-pagination.js', 'detail-stats.js',
  'detail.js', 'metamatch.js',
  'titlebar.js', 'toast.js', 'theme.js', 'dashboard-layout.js',
  'settings.js', 'app.js', 'search.js', 'onboarding.js', 'keyboard.js',
].map(f => resolve(__dirname, 'src/js', f));

function concatJsPlugin() {
  return {
    name: 'concat-js',
    enforce: 'pre', // run before Vite's internal HTML processing

    transformIndexHtml(html, ctx) {
      // Dev mode: leave HTML as-is, Vite serves the files
      if (ctx?.server) return;

      // Build mode: strip all <script src="/src/js/..."> tags
      // to prevent Vite from creating separate Rollup entries
      return html.replace(
        /<!-- Scripts loaded in dependency order[\s\S]*?-->\s*(?:<script src="\/src\/js\/[^"]+"><\/script>\s*)+/,
        ''
      );
    },

    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      if (!existsSync(distDir)) return;

      // Concatenate all source files into one bundle (preserves global scope)
      let code = '';
      for (const file of JS_FILES) {
        code += readFileSync(file, 'utf-8') + '\n';
      }

      const assetsDir = resolve(distDir, 'assets');
      mkdirSync(assetsDir, { recursive: true });
      writeFileSync(resolve(assetsDir, 'app.js'), code);

      // Restore script tag in built HTML
      const htmlPath = resolve(distDir, 'index.html');
      const html = readFileSync(htmlPath, 'utf-8');
      const updated = html.replace('</body>', '  <script src="./assets/app.js"></script>\n</body>');
      if (updated !== html) {
        writeFileSync(htmlPath, updated);
      }
    },
  };
}

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
  plugins: [tailwindcss(), svelte(), concatJsPlugin()],
});
