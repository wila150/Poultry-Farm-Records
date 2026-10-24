import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where, type DocumentSnapshot } from 'firebase/firestore';
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

export interface CloudDraft {
  values: Record<string, string>;
  updatedAt: number;
  updatedByName: string;
}

function toDraft(snap: DocumentSnapshot): CloudDraft | null {
  if (!snap.exists()) return null;
  return {
    values: snap.get('values') ?? {},
    updatedAt: snap.get('updatedAt')?.toMillis?.() ?? 0,
    updatedByName: snap.get('updatedByName') ?? '',
  };
}

export async function loadDraft(houseId: string, date: string): Promise<CloudDraft | null> {
  return toDraft(await getDoc(doc(db, 'drafts', recordId(houseId, date))));
}

// 即時同步：別人送出或正在填寫時，畫面自動更新。回傳取消監聽的函式。
export function watchRecord(houseId: string, date: string, cb: (r: DailyRecord | null) => void) {
  return onSnapshot(doc(db, 'dailyRecords', recordId(houseId, date)), (s) => cb(s.exists() ? (s.data() as DailyRecord) : null));
}

export function watchDraft(houseId: string, date: string, cb: (d: CloudDraft | null) => void) {
  return onSnapshot(doc(db, 'drafts', recordId(houseId, date)), (s) => cb(toDraft(s)));
}
