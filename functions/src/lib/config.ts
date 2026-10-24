import { defineSecret, defineString } from 'firebase-functions/params';

// 密鑰：firebase functions:secrets:set LINE_CHANNEL_ACCESS_TOKEN
export const LINE_CHANNEL_ACCESS_TOKEN = defineSecret('LINE_CHANNEL_ACCESS_TOKEN');
export const LINE_CHANNEL_SECRET = defineSecret('LINE_CHANNEL_SECRET');

// 一般設定：寫在 functions/.env
export const LINE_LOGIN_CHANNEL_ID = defineString('LINE_LOGIN_CHANNEL_ID', {
  description: 'LINE Login Channel ID（LIFF 所屬的 Channel），用來驗證 ID Token',
});
export const LIFF_URL = defineString('LIFF_URL', {
  description: '員工填寫頁網址（連結會自動加上外部瀏覽器開啟參數）',
});
export const ADMIN_URL = defineString('ADMIN_URL', {
  description: '後台網址，例如 https://poultry-farm-admin.web.app',
});
