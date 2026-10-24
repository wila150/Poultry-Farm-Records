import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { managesFarm, requireActive, requireManager, type AuthedUser } from '../lib/auth';
import { db } from '../lib/firebase';
import { badRequest, forbidden, notFound } from '../lib/http';
import {
  addDays,
  calcShipment,
  DEFAULT_SHIPMENT_SETTINGS,
  isValidDate,
  shipmentHasErrors,
  shipmentSettingsOf,
  taipeiDate,
  validateShipment,
  weightedEggWeight,
  type Customer,
  type DailyRecord,
  type Farm,
  type Shipment,
  type ShipmentInput,
  type ShipmentSettings,
} from '../shared';

export const shipmentsRouter = Router();

const inFarm = (user: AuthedUser, farmId: string) => user.role === 'owner' || user.farmIds.includes(farmId);

async function loadFarm(farmId: string) {
  const snap = await db.doc(`farms/${farmId}`).get();
  if (!snap.exists) throw badRequest('雞場不存在');
  return snap.data() as Farm;
}

/** 當天平均蛋重（以產蛋數加權）；當天沒有就往前找 7 天 */
async function farmEggWeight(farmId: string, date: string) {
  const snap = await db
    .collection('dailyRecords')
    .where('farmId', '==', farmId)
    .where('date', '>=', addDays(date, -7))
    .where('date', '<=', date)
    .get();
  const byDate = new Map<string, DailyRecord[]>();
  for (const d of snap.docs) {
    const r = d.data() as DailyRecord;
    byDate.set(r.date, [...(byDate.get(r.date) ?? []), r]);
  }
  for (const day of [...byDate.keys()].sort().reverse()) {
    const w = weightedEggWeight(byDate.get(day)!);
    if (w !== null) return { avgEggWeight: w, from: day };
  }
  return { avgEggWeight: null, from: null };
}

shipmentsRouter.get('/shipments/egg-weight', async (req, res) => {
  const user = requireActive(req);
  const farmId = String(req.query.farmId ?? '');
  const date = String(req.query.date ?? '');
  if (!inFarm(user, farmId)) throw forbidden();
  if (!isValidDate(date)) throw badRequest('日期格式錯誤');
  res.json(await farmEggWeight(farmId, date));
});

function parseInput(body: Record<string, unknown>): ShipmentInput {
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length > 50) throw badRequest('品項太多');
  return {
    date: String(body.date ?? ''),
    customerId: String(body.customerId ?? ''),
    avgEggWeight: Number(body.avgEggWeight),
    note: typeof body.note === 'string' ? body.note.trim() : '',
    items: items.map((i: Record<string, unknown>) => ({
      kind: i.kind === 'cart' ? 'cart' : 'box',
      grade: String(i.grade ?? ''),
      quantity: Number(i.quantity),
      weightCatty: Number(i.weightCatty),
      pricePerCatty: Number(i.pricePerCatty),
    })),
  };
}

/** 驗證並計算，回傳要存進資料庫的欄位 */
async function build(farmId: string, input: ShipmentInput) {
  if (!isValidDate(input.date) || input.date > taipeiDate()) throw badRequest('日期錯誤');
  const settings = shipmentSettingsOf(await loadFarm(farmId));
  const v = validateShipment(input, settings);
  if (shipmentHasErrors(v)) throw badRequest(v.errors[0] ?? Object.values(v.itemErrors)[0], v);

  const customer = await db.doc(`customers/${input.customerId}`).get();
  if (!customer.exists || (customer.data() as Customer).farmId !== farmId) throw badRequest('客戶不存在');

  return { ...input, ...calcShipment(input, settings), customerName: customer.get('name') as string };
}

/** 出貨單號：YYYYMMDD-01，每個雞場每天重新編號 */
async function nextNo(farmId: string, date: string) {
  const ref = db.doc(`counters/shipments_${farmId}_${date}`);
  const n = await db.runTransaction(async (tx) => {
    const cur = ((await tx.get(ref)).get('n') as number | undefined) ?? 0;
    tx.set(ref, { n: cur + 1 });
    return cur + 1;
  });
  return `${date.replaceAll('-', '')}-${String(n).padStart(2, '0')}`;
}

shipmentsRouter.post('/shipments', async (req, res) => {
  const user = requireActive(req);
  const farmId = String(req.body?.farmId ?? '');
  if (!inFarm(user, farmId)) throw forbidden();
  const data = await build(farmId, parseInput(req.body ?? {}));
  const now = FieldValue.serverTimestamp();
  const ref = db.collection('shipments').doc();
  await ref.set({
    ...data,
    farmId,
    no: await nextNo(farmId, data.date),
    voided: false,
    createdBy: user.id,
    updatedBy: user.id,
    createdAt: now,
    updatedAt: now,
  });
  res.json({ id: ref.id });
});

/** 員工只能改自己今天開的單；場長、老闆不限 */
async function loadEditable(user: AuthedUser, id: string) {
  const ref = db.doc(`shipments/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound('找不到出貨單');
  const s = snap.data() as Shipment;
  if (!inFarm(user, s.farmId)) throw forbidden();
  if (!managesFarm(user, s.farmId) && (s.createdBy !== user.id || s.date !== taipeiDate())) {
    throw forbidden('只能修改自己今天開的出貨單，請聯絡場長');
  }
  if (s.voided) throw badRequest('出貨單已作廢');
  return { ref, shipment: s };
}

shipmentsRouter.put('/shipments/:id', async (req, res) => {
  const user = requireActive(req);
  const { ref, shipment } = await loadEditable(user, req.params.id);
  const data = await build(shipment.farmId, parseInput(req.body ?? {}));
  await ref.update({ ...data, updatedBy: user.id, updatedAt: FieldValue.serverTimestamp() });
  res.json({ ok: true });
});

shipmentsRouter.post('/shipments/:id/void', async (req, res) => {
  const user = requireManager(req);
  const { ref, shipment } = await loadEditable(user, req.params.id);
  if (!managesFarm(user, shipment.farmId)) throw forbidden();
  await ref.update({ voided: true, updatedBy: user.id, updatedAt: FieldValue.serverTimestamp() });
  res.json({ ok: true });
});

function customerInput(body: Record<string, unknown>) {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const name = s(body.name, 50);
  if (!name) throw badRequest('請填寫客戶名稱');
  return { name, phone: s(body.phone, 30), address: s(body.address, 100), note: s(body.note, 200), active: body.active !== false };
}

shipmentsRouter.post('/customers', async (req, res) => {
  const user = requireManager(req);
  const farmId = String(req.body?.farmId ?? '');
  if (!managesFarm(user, farmId)) throw forbidden();
  const ref = await db.collection('customers').add({ ...customerInput(req.body ?? {}), farmId });
  res.json({ id: ref.id });
});

shipmentsRouter.put('/customers/:id', async (req, res) => {
  const user = requireManager(req);
  const ref = db.doc(`customers/${req.params.id}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound();
  if (!managesFarm(user, snap.get('farmId'))) throw forbidden();
  await ref.update(customerInput(req.body ?? {}));
  res.json({ ok: true });
});

shipmentsRouter.put('/farms/:id/shipment-settings', async (req, res) => {
  const user = requireManager(req);
  if (!managesFarm(user, req.params.id)) throw forbidden();
  const b = req.body ?? {};
  const grades = Array.isArray(b.grades) ? [...new Set(b.grades.map((g: unknown) => String(g).trim()).filter(Boolean))] : [];
  const settings: ShipmentSettings = {
    grades: grades.length > 0 ? (grades as string[]) : DEFAULT_SHIPMENT_SETTINGS.grades,
    traysPerCart: Number(b.traysPerCart),
    eggsPerTray: Number(b.eggsPerTray),
    cartTareKg: Number(b.cartTareKg),
    boxEggsMin: Number(b.boxEggsMin),
    boxEggsMax: Number(b.boxEggsMax),
  };
  const { grades: _, ...nums } = settings;
  if (Object.values(nums).some((n) => !Number.isFinite(n) || n <= 0)) throw badRequest('設定值請填正數');
  if (settings.boxEggsMin > settings.boxEggsMax) throw badRequest('每箱顆數下限不能大於上限');
  await db.doc(`farms/${req.params.id}`).update({ shipmentSettings: settings });
  res.json({ ok: true });
});
