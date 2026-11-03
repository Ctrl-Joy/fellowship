import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const target = process.env.API_TARGET ?? 'http://127.0.0.1:4000';
// `vite --mode https` (npm run dev:phone) serves over https with a local certificate:
// phones only allow the camera and microphone (huddles) on secure pages.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    port: 5173,
    strictPort: true,
    // Listen on the local network too, so phones on the same Wi-Fi can open the app.
    host: true,
    proxy: {
      '/api': { target, changeOrigin: false },
      '/files': { target, changeOrigin: false },
      '/ws': { target: target.replace('http', 'ws'), ws: true },
    },
  },
}));
