import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import thirdPartyLicenses from './third-party-licenses.js';

// base './' -> käännetyt tiedostot toimivat missä tahansa Apachen hakemistossa.
export default defineConfig({
  base: './',
  plugins: [svelte(), thirdPartyLicenses()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:5000' },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: { main: 'index.html', muutokset: 'muutokset.html' },
    },
    chunkSizeWarningLimit: 900,
  },
});
