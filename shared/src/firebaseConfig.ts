// Firebase 網頁設定（公開資訊，不是密鑰；存取權限由 firestore.rules 控制）。
// 只給前端用，不從 index.ts 匯出。
export const firebaseConfig = {
  apiKey: 'AIzaSyD1U7r5B0EDk4koKCf660qbjKa6fhcVNHU',
  authDomain: 'poultry-farm-records-5f4e6.firebaseapp.com',
  projectId: 'poultry-farm-records-5f4e6',
  storageBucket: 'poultry-farm-records-5f4e6.firebasestorage.app',
  messagingSenderId: '422012377332',
  appId: '1:422012377332:web:cc3980642eabb5519866a1',
};

// 手機版（/）和後台（/admin/）共用
export const LIFF_ID = '2012188460-sKNHrih8';

