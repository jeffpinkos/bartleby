import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  root: 'client',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${loadEnv(mode, process.cwd(), 'PORT').PORT ?? '3001'}` },
  },
  build: { outDir: '../dist/client', emptyOutDir: true },
}));
