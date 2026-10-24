import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { managesFarm, requireManager, type AuthedUser } from '../lib/auth';
import { ADMIN_URL, LIFF_URL } from '../lib/config';
import { db } from '../lib/firebase';
import { badRequest, conflict, forbidden, notFound } from '../lib/http';
import { farmManagerIds, linkMessage, push } from '../lib/line';
import { taipeiDate, type Assignment, type House, type Role, type User } from '../shared';

export const usersRouter = Router();

usersRouter.get('/me', (req, res) => {
  res.json({ uid: req.uid, user: req.user });
});

/** 申請加入時給新用戶選雞場（此時還讀不到 Firestore，所以走 API） */
usersRouter.get('/farms/public', async (_req, res) => {
  const snap = await db.collection('farms').orderBy('name').get();
  res.json(snap.docs.map((d) => ({ id: d.id, name: d.get('name') })));
});

usersRouter.post('/applications', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const farmId = String(req.body?.farmId ?? '');
  if (!name || name.length > 30) throw badRequest('請填寫姓名（30 字以內）');
  if (req.user?.status === 'active') throw conflict('帳號已經啟用');
  if (req.user?.status === 'disabled') throw forbidden('帳號已停用，請聯絡場長');

  const farm = await db.doc(`farms/${farmId}`).get();
  if (!farm.exists) throw badRequest('雞場不存在');

  const data: Partial<User> & Record<string, unknown> = {
    name,
    lineDisplayName: req.user?.lineDisplayName ?? '',
    role: 'staff',
    status: 'pending',
    farmIds: [farmId],
    houseIds: [],
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!req.user) data.createdAt = FieldValue.serverTimestamp();
  await db.doc(`users/${req.uid}`).set(data, { merge: true });

  const managers = await farmManagerIds(farmId);
  const msg = linkMessage(`${name} 申請加入「${farm.get('name')}」，請核准並指派雞舍。`, '前往審核', `${ADMIN_URL.value()}/users`);
  await Promise.all(managers.map((id) => push(id, [msg])));

  res.json({ ok: true });
});

async function loadTarget(manager: AuthedUser, uid: string) {
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('找不到使用者');
  const target = snap.data() as User;
  if (!target.farmIds.some((f) => managesFarm(manager, f))) throw forbidden();
  if (target.role === 'owner' && manager.role !== 'owner') throw forbidden();
  return { ref, target };
}

/**
 * 把使用者目前負責的雞舍同步成 houseIds：
 * 不在清單中的指派填上結束日，新增的建立新指派，users.houseIds 一併更新（供 Security Rules 使用）。
 */
async function syncAssignments(uid: string, farmIds: string[], houseIds: string[]) {
  const houses = await Promise.all(houseIds.map((id) => db.doc(`houses/${id}`).get()));
  for (const h of houses) {
    if (!h.exists) throw badRequest(`雞舍 ${h.id} 不存在`);
    if (!farmIds.includes((h.data() as House).farmId)) throw badRequest(`雞舍 ${h.get('name')} 不屬於該雞場`);
  }

  const today = taipeiDate();
  const current = await db.collection('assignments').where('userId', '==', uid).where('endDate', '==', null).get();
  const batch = db.batch();
  const kept = new Set<string>();
  for (const doc of current.docs) {
    const a = doc.data() as Assignment;
    if (houseIds.includes(a.houseId)) kept.add(a.houseId);
    else batch.update(doc.ref, { endDate: today });
  }
  for (const h of houses) {
    if (kept.has(h.id)) continue;
    const a: Assignment = { userId: uid, farmId: (h.data() as House).farmId, houseId: h.id, startDate: today, endDate: null };
    batch.set(db.collection('assignments').doc(), a);
  }
  batch.update(db.doc(`users/${uid}`), { houseIds, updatedAt: FieldValue.serverTimestamp() });
  await batch.commit();
}

const parseHouseIds = (v: unknown): string[] => {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw badRequest('houseIds 格式錯誤');
  return [...new Set(v as string[])];
};

usersRouter.post('/users/:uid/approve', async (req, res) => {
  const manager = requireManager(req);
  const { ref, target } = await loadTarget(manager, req.params.uid);
  const role: Role = req.body?.role ?? 'staff';
  if (!['staff', 'manager'].includes(role)) throw badRequest('角色錯誤');
  if (role === 'manager' && manager.role !== 'owner') throw forbidden('只有老闆可以設定場長');
  const houseIds = parseHouseIds(req.body?.houseIds ?? []);

  await ref.update({ status: 'active', role, updatedAt: FieldValue.serverTimestamp() });
  await syncAssignments(ref.id, target.farmIds, houseIds);

  if (target.status === 'pending') {
    await push(ref.id, [linkMessage('您的帳號已核准，可以開始填寫每日生產紀錄了！', '開始填寫', LIFF_URL.value())]);
  }
  res.json({ ok: true });
});

usersRouter.put('/users/:uid/assignments', async (req, res) => {
  const manager = requireManager(req);
  const { ref, target } = await loadTarget(manager, req.params.uid);
  if (target.status !== 'active') throw badRequest('請先核准帳號');
  await syncAssignments(ref.id, target.farmIds, parseHouseIds(req.body?.houseIds));
  res.json({ ok: true });
});

usersRouter.post('/users/:uid/disable', async (req, res) => {
  const manager = requireManager(req);
  if (req.params.uid === manager.id) throw badRequest('不能停用自己');
  const { ref, target } = await loadTarget(manager, req.params.uid);
  await ref.update({ status: 'disabled', updatedAt: FieldValue.serverTimestamp() });
  await syncAssignments(ref.id, target.farmIds, []);
  res.json({ ok: true });
});
