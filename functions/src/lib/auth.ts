import type { Request, RequestHandler } from 'express';
import { isTopRole, type User } from '../shared';
import { LINE_LOGIN_CHANNEL_ID } from './config';
import { auth, db } from './firebase';
import { forbidden, unauthorized } from './http';

export interface AuthedUser extends User {
  id: string;
}

export interface LineProfile {
  sub: string;
  name: string;
}

/** 向 LINE 驗證 LIFF ID Token。不信任前端傳來的 userId，一律以這裡驗出的 sub 為準。 */
export async function verifyLineIdToken(idToken: string): Promise<LineProfile> {
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: LINE_LOGIN_CHANNEL_ID.value() }),
  });
  if (!res.ok) throw unauthorized('LINE 登入已失效，請重新開啟');
  const data = (await res.json()) as { sub: string; name?: string };
  return { sub: data.sub, name: data.name ?? '' };
}

declare module 'express-serve-static-core' {
  interface Request {
    uid?: string;
    user?: AuthedUser | null;
  }
}

/** 驗證 Firebase ID Token，並載入 users/{uid}（可能不存在） */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw unauthorized();
  try {
    const decoded = await auth.verifyIdToken(token);
    req.uid = decoded.uid;
  } catch {
    throw unauthorized();
  }
  const snap = await db.doc(`users/${req.uid}`).get();
  req.user = snap.exists ? { id: snap.id, ...(snap.data() as User) } : null;
  next();
};

export function requireActive(req: Request): AuthedUser {
  if (!req.user || req.user.status !== 'active') throw forbidden('帳號尚未啟用');
  return req.user;
}

export function requireManager(req: Request): AuthedUser {
  const user = requireActive(req);
  if (user.role === 'staff') throw forbidden();
  return user;
}

export const managesFarm = (user: AuthedUser, farmId: string) =>
  isTopRole(user.role) || (user.role === 'manager' && user.farmIds.includes(farmId));
