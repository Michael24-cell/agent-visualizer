import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const sessionToken = process.env.HARNESS_SESSION_TOKEN;
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
        target: 'http://127.0.0.1:4317',
        headers: sessionHeaders,
      },
    },
  },
});
