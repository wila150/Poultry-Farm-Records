import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // 允許匯入專案根目錄的 shared/
  server: {
    fs: { allow: ['..'] },
    // 本機開發時 /api 轉到已部署的 Hosting（同一個 Functions）
    proxy: { '/api': { target: 'https://poultry-farm-records-5f4e6-admin.web.app', changeOrigin: true } },
  },
});
