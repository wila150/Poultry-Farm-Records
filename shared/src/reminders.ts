// 未填提醒時間設定（台灣時間，以 30 分鐘為單位）。排程每 30 分鐘檢查一次。

export interface ReminderSettings {
  /** 推播給負責未填雞舍員工的時間，例如 ['10:30', '17:00'] */
  staffTimes: string[];
  /** 仍未填時通知場長的時間；null 表示不通知 */
  managerTime: string | null;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { staffTimes: ['17:00'], managerTime: '20:00' };

export const REMINDER_SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

export const isReminderSlot = (t: unknown): t is string => typeof t === 'string' && REMINDER_SLOTS.includes(t);

export const reminderSettingsOf = (farm: { reminderSettings?: Partial<ReminderSettings> }): ReminderSettings => ({
  ...DEFAULT_REMINDER_SETTINGS,
  ...farm.reminderSettings,
});

/** 目前時間所在的 30 分鐘時段（台灣時間），例如 10:44 → '10:30' */
export function currentSlot(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')!.value;
  const m = Number(parts.find((p) => p.type === 'minute')!.value);
  return `${h}:${m < 30 ? '00' : '30'}`;
}
