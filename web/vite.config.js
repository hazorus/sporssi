import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// base './' -> käännetyt tiedostot toimivat missä tahansa Apachen hakemistossa.
export default defineConfig({
  base: './',
  plugins: [svelte()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:5000' },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
  },
});
