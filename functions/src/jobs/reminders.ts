import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ADMIN_URL, LIFF_URL, LINE_CHANNEL_ACCESS_TOKEN } from '../lib/config';
import { db } from '../lib/firebase';
import { farmManagerIds, linkMessage, push } from '../lib/line';
import { currentSlot, reminderSettingsOf, taipeiDate, TIME_ZONE, type Assignment, type Farm, type House } from '../shared';

type HouseRow = House & { id: string };

/** 今天還沒有紀錄的啟用中雞舍 */
async function missingHouses(date: string): Promise<HouseRow[]> {
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

/** 只推給負責未填雞舍的員工；全部填完就不推 */
async function remindStaff(missing: HouseRow[]) {
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
}

async function remindManagers(farmId: string, missing: HouseRow[], slot: string) {
  const managers = await farmManagerIds(farmId);
  const msg = linkMessage(`今天 ${missing.map((h) => h.name).join('、')} 到 ${slot} 仍未填寫生產紀錄。`, '查看填寫進度', ADMIN_URL.value());
  await Promise.all(managers.map((uid) => push(uid, [msg])));
}

/**
 * 每 30 分鐘檢查一次，依各雞場在後台設定的時間發送未填提醒。
 * 推播按「人數 × 則數」計費，所以只推給還沒填的人。
 */
export const reminders = onSchedule(
  { schedule: '0,30 * * * *', timeZone: TIME_ZONE, secrets: [LINE_CHANNEL_ACCESS_TOKEN] },
  async () => {
    const slot = currentSlot();
    const farms = await db.collection('farms').get();
    const due = farms.docs
      .map((d) => ({ id: d.id, settings: reminderSettingsOf(d.data() as Farm) }))
      .filter((f) => f.settings.staffTimes.includes(slot) || f.settings.managerTime === slot);
    if (due.length === 0) return;

    const missing = await missingHouses(taipeiDate());
    for (const farm of due) {
      const farmMissing = missing.filter((h) => h.farmId === farm.id);
      if (farmMissing.length === 0) continue;
      if (farm.settings.staffTimes.includes(slot)) await remindStaff(farmMissing);
      if (farm.settings.managerTime === slot) await remindManagers(farm.id, farmMissing, slot);
    }
  },
);
