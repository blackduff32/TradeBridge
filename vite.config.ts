import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Defaults match .env.example; set PORT and TRADEBRIDGE_WEB_PORT to run a second checkout.
const api = Number(process.env.PORT ?? 3100); const web = Number(process.env.TRADEBRIDGE_WEB_PORT ?? 5173);
export default defineConfig({
  root: 'web', plugins: [react()],
  build: { outDir: '../web-dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: web, strictPort: true, proxy: { '^/api/': { target: `http://127.0.0.1:${api}` } } },
});
