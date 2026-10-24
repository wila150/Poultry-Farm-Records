import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { isTopRole, recordId, type DailyRecord, type House, type User } from '../../shared/src';
import { auth, db } from './session';

export type WithId<T> = T & { id: string };

export async function loadMe(): Promise<WithId<User>> {
  const uid = auth.currentUser!.uid;
  const snap = await getDoc(doc(db, 'users', uid));
  return { id: uid, ...(snap.data() as User) };
}

/** 登入者可以填寫的雞舍：員工＝指派給他的；場長、老闆＝雞場內所有啟用中的 */
export async function loadMyHouses(me: WithId<User>): Promise<WithId<House>[]> {
  const q =
    isTopRole(me.role)
      ? query(collection(db, 'houses'), where('active', '==', true))
      : query(collection(db, 'houses'), where('farmId', 'in', me.farmIds), where('active', '==', true));
  const snap = await getDocs(q);
  const houses = snap.docs.map((d) => ({ id: d.id, ...(d.data() as House) }));
  const mine = me.role === 'staff' ? houses.filter((h) => me.houseIds.includes(h.id)) : houses;
  return mine.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export async function loadRecord(houseId: string, date: string): Promise<DailyRecord | null> {
  const snap = await getDoc(doc(db, 'dailyRecords', recordId(houseId, date)));
  return snap.exists() ? (snap.data() as DailyRecord) : null;
}

export async function loadHistory(house: WithId<House>, n = 30): Promise<DailyRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, 'dailyRecords'),
      where('farmId', '==', house.farmId),
      where('houseId', '==', house.id),
      orderBy('date', 'desc'),
      limit(n),
    ),
  );
  return snap.docs.map((d) => d.data() as DailyRecord);
}
