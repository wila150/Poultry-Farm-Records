import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// 只在冷啟動時初始化一次，之後的請求共用連線。
const app = initializeApp();

export const db = getFirestore(app);
export const auth = getAuth(app);
