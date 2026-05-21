import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2023',
    minify: 'esbuild',
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 3000,
    open: true,
  }
});
