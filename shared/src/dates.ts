// 所有「今天」都以台灣時間判斷，避免伺服器 UTC 造成日期差一天。

export const TIME_ZONE = 'Asia/Taipei';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 回傳台灣時間的 YYYY-MM-DD */
export function taipeiDate(d: Date = new Date()): string {
  return fmt.format(d);
}

/** 對 YYYY-MM-DD 加減天數 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return addDays(date, 0) === date;
}
