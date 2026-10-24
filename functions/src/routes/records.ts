import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { managesFarm, requireActive, type AuthedUser } from '../lib/auth';
import { db } from '../lib/firebase';
import { badRequest, forbidden, notFound } from '../lib/http';
import {
  addDays,
  DAILY_RECORD_FIELDS,
  hasErrors,
  isValidDate,
  nextBirdCount,
  normalizeDailyRecordInput,
  recordId,
  taipeiDate,
  validateDailyRecord,
  type DailyRecord,
  type Farm,
  type House,
} from '../shared';

export const recordsRouter = Router();

async function loadHouse(houseId: string) {
  const snap = await db.doc(`houses/${houseId}`).get();
  if (!snap.exists) throw notFound('找不到雞舍');
  return { id: snap.id, ...(snap.data() as House) };
}

function canSeeHouse(user: AuthedUser, house: House & { id: string }) {
  return managesFarm(user, house.farmId) || user.houseIds.includes(house.id);
}

/** 員工只能改今天和昨天、目前指派給自己的雞舍；場長、老闆不限日期 */
function assertCanEdit(user: AuthedUser, house: House & { id: string }, date: string) {
  if (managesFarm(user, house.farmId)) return;
  if (!user.houseIds.includes(house.id)) throw forbidden('這棟雞舍沒有指派給您');
  if (date < addDays(taipeiDate(), -1)) throw forbidden('只能修改今天和昨天的紀錄，請聯絡場長');
}

/** 預填值：在養隻數從最近一筆紀錄推算，溫濕度從氣象資料帶入 */
recordsRouter.get('/records/:houseId/:date/prefill', async (req, res) => {
  const user = requireActive(req);
  const { date } = req.params;
  if (!isValidDate(date)) throw badRequest('日期格式錯誤');
  const house = await loadHouse(req.params.houseId);
  if (!canSeeHouse(user, house)) throw forbidden();

  const [prev, weather] = await Promise.all([
    db.collection('dailyRecords').where('houseId', '==', house.id).where('date', '<', date).orderBy('date', 'desc').limit(1).get(),
    db.doc(`weather/${house.farmId}_${date}`).get(),
  ]);
  const last = prev.docs[0]?.data() as DailyRecord | undefined;

  res.json({
    birdCount: last ? nextBirdCount(last) : house.initialCount,
    birdCountFrom: last?.date ?? null,
    tempMax: weather.get('tempMax') ?? null,
    tempMin: weather.get('tempMin') ?? null,
    humidity: weather.get('humidity') ?? null,
  });
});

/** 新增或修改一筆紀錄。修改時每個變動的欄位都寫入 logs。 */
recordsRouter.put('/records/:houseId/:date', async (req, res) => {
  const user = requireActive(req);
  const { date } = req.params;
  const house = await loadHouse(req.params.houseId);
  if (!house.active) throw badRequest('雞舍已停用');
  assertCanEdit(user, house, date);

  const farm = (await db.doc(`farms/${house.farmId}`).get()).data() as Farm | undefined;
  const customFields = farm?.customFields ?? [];
  const input = normalizeDailyRecordInput(req.body ?? {}, customFields);
  const result = validateDailyRecord(input, date, undefined, customFields);
  if (hasErrors(result)) throw badRequest('資料有誤', result.errors);

  const ref = db.doc(`dailyRecords/${recordId(house.id, date)}`);
  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = FieldValue.serverTimestamp();

    if (!snap.exists) {
      tx.set(ref, {
        ...input,
        farmId: house.farmId,
        houseId: house.id,
        date,
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    }

    const old = snap.data() as DailyRecord;
    const oldCustom = old.custom ?? {};
    const changes = [
      ...DAILY_RECORD_FIELDS.filter((f) => old[f] !== input[f]).map((f) => ({ field: f as string, oldValue: old[f], newValue: input[f] })),
      ...Object.keys(input.custom)
        .filter((k) => (oldCustom[k] ?? null) !== input.custom[k])
        .map((k) => ({ field: `custom.${k}`, oldValue: oldCustom[k] ?? null, newValue: input.custom[k] })),
    ];
    if (changes.length === 0) return false;
    // 停用項目的舊值保留
    tx.update(ref, { ...input, custom: { ...oldCustom, ...input.custom }, updatedBy: user.id, updatedAt: now });
    for (const c of changes) {
      tx.set(ref.collection('logs').doc(), { ...c, by: user.id, at: now });
    }
    return false;
  });

  // Phase 3：在這裡觸發異常檢查
  res.json({ ok: true, created, warnings: result.warnings });
});
