import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import type { DailyRecord, Farm, House, User } from '../../shared/src';
import { api, auth, db } from './session';

export type WithId<T> = T & { id: string };

export async function loadMe(): Promise<WithId<User>> {
  const uid = auth.currentUser!.uid;
  const snap = await getDoc(doc(db, 'users', uid));
  return { id: uid, ...(snap.data() as User) };
}

export async function loadFarms(me: WithId<User>): Promise<WithId<Farm>[]> {
  if (me.role === 'owner') {
    const snap = await getDocs(collection(db, 'farms'));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Farm) }));
  }
  const snaps = await Promise.all(me.farmIds.map((id) => getDoc(doc(db, 'farms', id))));
  return snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...(s.data() as Farm) }));
}

export async function loadHouses(farmIds: string[]): Promise<WithId<House>[]> {
  if (farmIds.length === 0) return [];
  const snap = await getDocs(query(collection(db, 'houses'), where('farmId', 'in', farmIds)));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as House) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export async function loadRecordsOn(farmIds: string[], date: string): Promise<DailyRecord[]> {
  if (farmIds.length === 0) return [];
  const snap = await getDocs(
    query(collection(db, 'dailyRecords'), where('farmId', 'in', farmIds), where('date', '==', date)),
  );
  return snap.docs.map((d) => d.data() as DailyRecord);
}

export const loadUsers = () => api<WithId<User>[]>('GET', '/users');
