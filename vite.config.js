import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    crx({ manifest }),
  ],
  build: {
    rollupOptions: {
      input: {
        popup: 'src/popup.jsx',
        options: 'src/options.jsx',
        background: 'src/background/background.js',
        content: 'src/content/content.jsx',
      },
    },
  },
});
