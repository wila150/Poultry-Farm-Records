import liff from '@line/liff';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig, LIFF_ID } from '../../shared/src/firebaseConfig';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export type BootStatus = 'new' | 'pending' | 'active' | 'disabled';

/**
 * LIFF 登入 → 後端驗證 ID Token → Firebase 登入。
 * 呼叫 /api/auth/line 的同時也會叫醒 Cloud Functions，員工填完表單送出時就不會遇到冷啟動。
 */
export async function boot(): Promise<BootStatus | 'redirecting'> {
  await liff.init({ liffId: LIFF_ID });
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

export const closeLiff = () => (liff.isInClient() ? liff.closeWindow() : undefined);
