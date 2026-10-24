import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ADMIN_URL, LIFF_URL, LINE_CHANNEL_ACCESS_TOKEN } from '../lib/config';
import { db } from '../lib/firebase';
import { farmManagerIds, linkMessage, push } from '../lib/line';
import { taipeiDate, TIME_ZONE, type Assignment, type House } from '../shared';

/** 今天還沒有紀錄的啟用中雞舍 */
async function missingHouses(date: string) {
  const [houses, records] = await Promise.all([
    db.collection('houses').where('active', '==', true).get(),
    db.collection('dailyRecords').where('date', '==', date).select('houseId').get(),
  ]);
  const done = new Set(records.docs.map((d) => d.get('houseId') as string));
  return houses.docs.filter((h) => !done.has(h.id)).map((h) => ({ id: h.id, ...(h.data() as House) }));
}

async function activeUserIds(ids: string[]) {
  if (ids.length === 0) return new Set<string>();
  const snaps = await db.getAll(...ids.map((id) => db.doc(`users/${id}`)));
  // 工程師不收任何通知
  return new Set(snaps.filter((s) => s.get('status') === 'active' && s.get('role') !== 'engineer').map((s) => s.id));
}

/** 17:00 只推給負責未填雞舍的員工；全部填完就不推 */
export const remindStaff = onSchedule(
  { schedule: '0 17 * * *', timeZone: TIME_ZONE, secrets: [LINE_CHANNEL_ACCESS_TOKEN] },
  async () => {
    const missing = await missingHouses(taipeiDate());
    if (missing.length === 0) return;
    const names = new Map(missing.map((h) => [h.id, h.name]));

    const assignments = await db.collection('assignments').where('endDate', '==', null).get();
    const byUser = new Map<string, string[]>();
    for (const doc of assignments.docs) {
      const a = doc.data() as Assignment;
      const name = names.get(a.houseId);
      if (name) byUser.set(a.userId, [...(byUser.get(a.userId) ?? []), name]);
    }

    const active = await activeUserIds([...byUser.keys()]);
    await Promise.all(
      [...byUser]
        .filter(([uid]) => active.has(uid))
        .map(([uid, houses]) =>
          push(uid, [linkMessage(`提醒您！今天 ${houses.join('、')} 還沒填寫產蛋紀錄喔！`, '點此填寫', LIFF_URL.value())]),
        ),
    );
  },
);

/** 20:00 仍未填寫的雞舍，通知該雞場場長 */
export const remindManagers = onSchedule(
  { schedule: '0 20 * * *', timeZone: TIME_ZONE, secrets: [LINE_CHANNEL_ACCESS_TOKEN] },
  async () => {
    const missing = await missingHouses(taipeiDate());
    const byFarm = new Map<string, string[]>();
    for (const h of missing) byFarm.set(h.farmId, [...(byFarm.get(h.farmId) ?? []), h.name]);

    for (const [farmId, houses] of byFarm) {
      const managers = await farmManagerIds(farmId);
      const msg = linkMessage(`今天 ${houses.join('、')} 到 20:00 仍未填寫生產紀錄。`, '查看填寫進度', ADMIN_URL.value());
      await Promise.all(managers.map((uid) => push(uid, [msg])));
    }
  },
);
