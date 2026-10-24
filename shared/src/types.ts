// 前端、後端共用的資料型別。時間戳記欄位在各端以各自的 Timestamp 型別表示，這裡不列出。

export type Role = 'owner' | 'manager' | 'staff';
export type UserStatus = 'pending' | 'active' | 'disabled';

export interface Farm {
  name: string;
  location: string;
  weatherStationId: string | null;
}

export interface House {
  farmId: string;
  name: string;
  breed: string;
  placementDate: string;
  initialCount: number;
  active: boolean;
}

export interface User {
  name: string;
  lineDisplayName: string;
  role: Role;
  status: UserStatus;
  farmIds: string[];
  houseIds: string[];
}

export interface Assignment {
  userId: string;
  farmId: string;
  houseId: string;
  startDate: string;
  endDate: string | null;
}

/** 表單送出的欄位（不含系統欄位） */
export interface DailyRecordInput {
  birdCount: number;
  deaths: number;
  culls: number;
  eggsTotal: number;
  eggsBroken: number;
  avgEggWeight: number | null;
  feedKg: number | null;
  waterL: number | null;
  tempMax: number | null;
  tempMin: number | null;
  humidity: number | null;
  note: string;
}

export interface DailyRecord extends DailyRecordInput {
  farmId: string;
  houseId: string;
  date: string;
  createdBy: string;
  updatedBy: string;
}

export const DAILY_RECORD_FIELDS = [
  'birdCount',
  'deaths',
  'culls',
  'eggsTotal',
  'eggsBroken',
  'avgEggWeight',
  'feedKg',
  'waterL',
  'tempMax',
  'tempMin',
  'humidity',
  'note',
] as const satisfies readonly (keyof DailyRecordInput)[];

export type MedicationType = 'vaccine' | 'medication';

export interface MedicationEvent {
  farmId: string;
  houseId: string;
  date: string;
  type: MedicationType;
  name: string;
  dose: string;
  by: string;
}

export interface Alert {
  farmId: string;
  houseId: string;
  rule: string;
  date: string;
  message: string;
  resolved: boolean;
  resolvedBy: string | null;
}

export const recordId = (houseId: string, date: string) => `${houseId}_${date}`;
export const alertId = (houseId: string, rule: string, date: string) => `${houseId}_${rule}_${date}`;
