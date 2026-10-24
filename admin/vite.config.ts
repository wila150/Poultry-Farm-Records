import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 後台和 LIFF 放在同一個網站：後台在 /admin/，共用同一個 LIFF ID。
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: { outDir: '../liff/dist/admin', emptyOutDir: true },
  // 允許匯入專案根目錄的 shared/
  server: {
    fs: { allow: ['..'] },
    // 本機開發時 /api 轉到已部署的 Hosting（同一個 Functions）
    proxy: { '/api': { target: 'https://poultry-farm-records-5f4e6.web.app', changeOrigin: true } },
  },
});
