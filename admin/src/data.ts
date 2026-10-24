import { collection, doc, getDoc, getDocs, orderBy, query, where } from 'firebase/firestore';
import { isTopRole, type Customer, type DailyRecord, type Farm, type House, type Shipment, type User } from '../../shared/src';
import { api, auth, db } from './session';

export type WithId<T> = T & { id: string };

export async function loadMe(): Promise<WithId<User>> {
  const uid = auth.currentUser!.uid;
  const snap = await getDoc(doc(db, 'users', uid));
  return { id: uid, ...(snap.data() as User) };
}

export async function loadFarms(me: WithId<User>): Promise<WithId<Farm>[]> {
  if (isTopRole(me.role)) {
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

export async function loadCustomers(farmId: string): Promise<WithId<Customer>[]> {
  const snap = await getDocs(query(collection(db, 'customers'), where('farmId', '==', farmId)));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Customer) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

export async function loadShipments(farmId: string, from: string, to: string): Promise<WithId<Shipment>[]> {
  const snap = await getDocs(
    query(
      collection(db, 'shipments'),
      where('farmId', '==', farmId),
      where('date', '>=', from),
      where('date', '<=', to),
      orderBy('date', 'desc'),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Shipment) })).sort((a, b) => b.no.localeCompare(a.no));
}

export async function loadRecordsBetween(farmId: string, from: string, to: string): Promise<DailyRecord[]> {
  const snap = await getDocs(
    query(
      collection(db, 'dailyRecords'),
      where('farmId', '==', farmId),
      where('date', '>=', from),
      where('date', '<=', to),
      orderBy('date', 'desc'),
    ),
  );
  return snap.docs.map((d) => d.data() as DailyRecord);
}
