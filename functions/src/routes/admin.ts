import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { managesFarm, requireManager } from '../lib/auth';
import { db } from '../lib/firebase';
import { badRequest, conflict, forbidden, notFound } from '../lib/http';
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_ALERT_RULES,
  FIELD_GROUPS,
  isReminderSlot,
  isTopRole,
  isValidDate,
  type CustomField,
  type Farm,
  type House,
  type User,
} from '../shared';

export const adminRouter = Router();

const str = (v: unknown, max = 50) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * 初始設定：系統裡還沒有老闆時，第一個呼叫的人成為老闆並建立第一個雞場。
 * 有老闆之後這支 API 就永久失效。
 */
// 有老闆或工程師任一個就算完成設定
const topUsers = () => db.collection('users').where('role', 'in', ['owner', 'engineer']).limit(1);

adminRouter.get('/setup', async (_req, res) => {
  res.json({ needed: (await topUsers().get()).empty });
});

adminRouter.post('/setup', async (req, res) => {
  const name = str(req.body?.name, 30);
  const farmName = str(req.body?.farmName);
  if (!name || !farmName) throw badRequest('請填寫姓名和雞場名稱');

  await db.runTransaction(async (tx) => {
    const owners = await tx.get(topUsers());
    if (!owners.empty) throw conflict('系統已完成初始設定');
    const farmRef = db.collection('farms').doc();
    tx.set(farmRef, { name: farmName, location: str(req.body?.location), weatherStationId: null, createdAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`users/${req.uid}`), {
      name,
      lineDisplayName: req.user?.lineDisplayName ?? '',
      role: 'owner',
      status: 'active',
      farmIds: [farmRef.id],
      houseIds: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const [code, rule] of Object.entries(DEFAULT_ALERT_RULES)) {
      tx.set(db.doc(`alertRules/${code}`), rule);
    }
  });
  res.json({ ok: true });
});

/** 人員列表（場長看自己雞場的人，老闆看全部） */
adminRouter.get('/users', async (req, res) => {
  const me = requireManager(req);
  const q = isTopRole(me.role) ? db.collection('users') : db.collection('users').where('farmIds', 'array-contains-any', me.farmIds);
  const snap = await q.get();
  const users = snap.docs.map((d) => ({ id: d.id, ...(d.data() as User) }));
  // 工程師帳號只有工程師看得到
  res.json(me.role === 'engineer' ? users : users.filter((u) => u.role !== 'engineer'));
});

function farmInput(body: Record<string, unknown>): Farm {
  const name = str(body.name);
  if (!name) throw badRequest('請填寫雞場名稱');
  return { name, location: str(body.location, 100), weatherStationId: str(body.weatherStationId, 20) || null };
}

adminRouter.post('/farms', async (req, res) => {
  const me = requireManager(req);
  if (!isTopRole(me.role)) throw forbidden('只有老闆可以新增雞場');
  const ref = await db.collection('farms').add({ ...farmInput(req.body ?? {}), createdAt: FieldValue.serverTimestamp() });
  await db.doc(`users/${me.id}`).update({ farmIds: FieldValue.arrayUnion(ref.id) });
  res.json({ id: ref.id });
});

adminRouter.put('/farms/:id', async (req, res) => {
  const me = requireManager(req);
  if (!managesFarm(me, req.params.id)) throw forbidden();
  const ref = db.doc(`farms/${req.params.id}`);
  if (!(await ref.get()).exists) throw notFound();
  await ref.update({ ...farmInput(req.body ?? {}) });
  res.json({ ok: true });
});

function houseInput(body: Record<string, unknown>): Omit<House, 'farmId'> {
  const name = str(body.name, 20);
  const placementDate = str(body.placementDate, 10);
  const initialCount = Number(body.initialCount);
  if (!name) throw badRequest('請填寫雞舍名稱');
  if (placementDate && !isValidDate(placementDate)) throw badRequest('入雛日期格式錯誤');
  if (!Number.isInteger(initialCount) || initialCount < 0) throw badRequest('初始隻數請填 0 以上的整數');
  return { name, breed: str(body.breed, 30), placementDate, initialCount, active: body.active !== false };
}

adminRouter.post('/houses', async (req, res) => {
  const me = requireManager(req);
  const farmId = str(req.body?.farmId);
  if (!managesFarm(me, farmId)) throw forbidden();
  if (!(await db.doc(`farms/${farmId}`).get()).exists) throw badRequest('雞場不存在');
  const ref = await db.collection('houses').add({ ...houseInput(req.body ?? {}), farmId });
  res.json({ id: ref.id });
});

adminRouter.put('/houses/:id', async (req, res) => {
  const me = requireManager(req);
  const ref = db.doc(`houses/${req.params.id}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound();
  if (!managesFarm(me, snap.get('farmId'))) throw forbidden();
  await ref.update({ ...houseInput(req.body ?? {}) });
  res.json({ ok: true });
});

/**
 * 儲存自訂填寫項目（整份清單，依送來的順序）。
 * 新項目由系統產生 key；送來的清單裡少了的舊項目不會刪除，改為停用並排在最後，已填的資料保留。
 */
adminRouter.put('/farms/:id/custom-fields', async (req, res) => {
  const me = requireManager(req);
  if (!managesFarm(me, req.params.id)) throw forbidden();
  const ref = db.doc(`farms/${req.params.id}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound();
  const existing = ((snap.data() as Farm).customFields ?? []) as CustomField[];
  const known = new Set(existing.map((f) => f.key));

  const raw: Record<string, unknown>[] = Array.isArray(req.body?.fields) ? req.body.fields : [];
  if (raw.length > 50) throw badRequest('項目太多（最多 50 個）');
  const fields: CustomField[] = raw.map((f) => {
    const label = str(f.label, 20);
    if (!label) throw badRequest('請填寫項目名稱');
    const type = (['number', 'integer', 'text'] as const).find((t) => t === f.type) ?? 'number';
    const group = FIELD_GROUPS.find((g) => g === f.group) ?? '其他';
    const key = typeof f.key === 'string' && known.has(f.key) ? f.key : `f${randomBytes(4).toString('hex')}`;
    return { key, label, unit: str(f.unit, 10), type, group, required: f.required === true, active: f.active !== false };
  });

  const labels = fields.filter((f) => f.active).map((f) => f.label);
  if (new Set(labels).size !== labels.length) throw badRequest('啟用中的項目名稱不能重複');
  const sent = new Set(fields.map((f) => f.key));
  const kept = existing.filter((f) => !sent.has(f.key)).map((f) => ({ ...f, active: false }));

  await ref.update({ customFields: [...fields, ...kept] });
  res.json({ ok: true });
});

/** 未填提醒時間（台灣時間，30 分鐘為單位） */
adminRouter.put('/farms/:id/reminder-settings', async (req, res) => {
  const me = requireManager(req);
  if (!managesFarm(me, req.params.id)) throw forbidden();
  const raw = req.body?.staffTimes;
  if (!Array.isArray(raw) || !raw.every(isReminderSlot)) throw badRequest('提醒時間格式錯誤');
  const staffTimes = [...new Set(raw as string[])].sort();
  if (staffTimes.length > 4) throw badRequest('員工提醒最多設定 4 個時間');
  const managerTime = req.body?.managerTime ?? null;
  if (managerTime !== null && !isReminderSlot(managerTime)) throw badRequest('場長通知時間格式錯誤');
  const ref = db.doc(`farms/${req.params.id}`);
  if (!(await ref.get()).exists) throw notFound();
  await ref.update({ reminderSettings: { staffTimes, managerTime } });
  res.json({ ok: true });
});
