import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sessionToken = process.env.HARNESS_SESSION_TOKEN;
// The service's port, so HARNESS_PORT moves both ends together.
const servicePort = process.env.HARNESS_PORT ?? '4317';
const sessionHeaders = sessionToken
  ? { 'x-harness-session': sessionToken }
  : {};

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${servicePort}`,
        headers: sessionHeaders,
      },
    },
  },
});
