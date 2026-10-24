import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyLineIdToken } from '../lib/auth';
import { auth, db } from '../lib/firebase';
import { badRequest } from '../lib/http';

export const authRouter = Router();

/**
 * LIFF ID Token → Firebase Custom Token。
 * 前端拿到 token 後呼叫 signInWithCustomToken，之後就能直接讀 Firestore。
 */
authRouter.post('/line', async (req, res) => {
  const idToken = req.body?.idToken;
  if (typeof idToken !== 'string' || !idToken) throw badRequest('缺少 idToken');

  const profile = await verifyLineIdToken(idToken);
  const ref = db.doc(`users/${profile.sub}`);
  const snap = await ref.get();
  if (snap.exists && profile.name && snap.get('lineDisplayName') !== profile.name) {
    await ref.update({ lineDisplayName: profile.name, updatedAt: FieldValue.serverTimestamp() });
  }

  const token = await auth.createCustomToken(profile.sub);
  res.json({
    token,
    status: snap.exists ? snap.get('status') : 'new',
    role: snap.exists ? snap.get('role') : null,
  });
});
