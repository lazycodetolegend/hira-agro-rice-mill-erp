import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Generates dist/sw-precache.json after each Vite build so the service worker
 * precaches every compiled JS/CSS bundle and static icon immediately for 100% offline launch.
 */
function pwaPrecachePlugin(): Plugin {
  return {
    name: 'hira-agro-pwa-precache',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      if (!fs.existsSync(distDir)) return;
      const urls: string[] = ['/'];
      const walk = (dir: string, prefix = '') => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const rel = `${prefix}/${entry.name}`;
          if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), rel);
          } else if (!entry.name.endsWith('.map') && entry.name !== 'sw.js' && entry.name !== 'sw-precache.json') {
            urls.push(rel);
          }
        }
      };
      walk(distDir);
      fs.writeFileSync(path.join(distDir, 'sw-precache.json'), JSON.stringify({ files: urls }, null, 2));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), pwaPrecachePlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
