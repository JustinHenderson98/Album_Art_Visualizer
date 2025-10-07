import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
   server: {
    proxy: {
      // Frontend calls /plexapi/... (same origin) → proxied to your PMS
      '/plexapi': {
        target: 'http://192.168.1.127:32400', // <-- your PMS LAN URL
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/plexapi/, ''),
      },
    },
  },
});
