import type { Liff } from '@line/liff';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithCustomToken, type User as AuthUser } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';
import { firebaseConfig, LIFF_ID } from '../../shared/src/firebaseConfig';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export type BootStatus = 'new' | 'pending' | 'active' | 'disabled';

// Firebase 會把登入狀態存在瀏覽器裡；等它還原完成再判斷是否需要重新登入
const authReady = new Promise<AuthUser | null>((resolve) => {
  const off = onAuthStateChanged(auth, (u) => {
    off();
    resolve(u);
  });
});

// LINE SDK 用到才載入，減少第一次開啟要下載的檔案
let liffPromise: Promise<Liff> | null = null;
export function getLiff(): Promise<Liff> {
  liffPromise ??= import('@line/liff').then(async ({ default: liff }) => {
    await liff.init({ liffId: LIFF_ID });
    return liff;
  });
  return liffPromise;
}

/**
 * 已登入過：直接讀自己的帳號狀態，不經過後端也不等 LINE。
 * 第一次或登入失效：LIFF 登入 → 後端驗證 ID Token → Firebase 登入。
 * 後台在 /admin/，和手機版共用同一個 LIFF ID；在一般瀏覽器開啟時 liff.login() 會導向 LINE Login。
 */
export async function boot(): Promise<BootStatus | 'redirecting'> {
  // 先叫醒 Cloud Functions，送出表單時就不會遇到冷啟動
  fetch('/api/ping').catch(() => {});

  const current = await authReady;
  if (current) {
    const snap = await getDoc(doc(db, 'users', current.uid));
    return snap.exists() ? (snap.get('status') as BootStatus) : 'new';
  }

  const liff = await getLiff();
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    return 'redirecting';
  }
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error('無法取得 LINE 登入資訊，請關閉後重新開啟');

  const res = await fetch('/api/auth/line', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  // ID Token 過期時重新登入一次
  if (res.status === 401) {
    liff.logout();
    liff.login({ redirectUri: location.href });
    return 'redirecting';
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? '登入失敗');
  await signInWithCustomToken(auth, data.token);
  return data.status;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: Record<string, string>,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? '連線失敗，請稍後再試', res.status, data.details);
  return data as T;
}

export async function logout() {
  const liff = await getLiff();
  liff.logout();
  await auth.signOut();
  location.reload();
}
