// 每日紀錄防呆。前端即時顯示、後端送出時再驗一次，兩邊用同一份規則。
// errors 會擋下送出；warnings 只提醒，使用者確認後可送出。

import { taipeiDate, isValidDate } from './dates';
import { DAILY_RECORD_FIELDS, type DailyRecordInput } from './types';

export interface ValidationResult {
  errors: Partial<Record<keyof DailyRecordInput | 'date', string>>;
  warnings: Partial<Record<keyof DailyRecordInput, string>>;
}

const REQUIRED_INTS = ['birdCount', 'deaths', 'culls', 'eggsTotal', 'eggsBroken'] as const;
const OPTIONAL_NUMS = ['avgEggWeight', 'feedKg', 'waterL', 'tempMax', 'tempMin', 'humidity'] as const;

export const EGG_WEIGHT_RANGE = { min: 40, max: 75 };
export const TEMP_RANGE = { min: -5, max: 45 };

export function validateDailyRecord(
  input: DailyRecordInput,
  date: string,
  today: string = taipeiDate(),
): ValidationResult {
  const errors: ValidationResult['errors'] = {};
  const warnings: ValidationResult['warnings'] = {};

  if (!isValidDate(date)) errors.date = '日期格式錯誤';
  else if (date > today) errors.date = '日期不能是未來';

  for (const k of REQUIRED_INTS) {
    const v = input[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) errors[k] = '請填 0 以上的整數';
  }
  for (const k of OPTIONAL_NUMS) {
    const v = input[k];
    if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) errors[k] = '請填數字或留空';
    else if (v !== null && k !== 'tempMax' && k !== 'tempMin' && v < 0) errors[k] = '不能是負數';
  }
  if (typeof input.note !== 'string') errors.note = '備註格式錯誤';
  else if (input.note.length > 500) errors.note = '備註最多 500 字';

  if (Object.keys(errors).length > 0) return { errors, warnings };

  const { birdCount, deaths, culls, eggsTotal, eggsBroken, avgEggWeight, tempMax, tempMin, humidity } = input;

  if (eggsTotal > birdCount) errors.eggsTotal = '產蛋數不能大於在養隻數';
  if (eggsBroken > eggsTotal) errors.eggsBroken = '破蛋數不能大於總蛋數';
  if (deaths + culls > birdCount) errors.deaths = '死亡加淘汰不能大於在養隻數';
  if (humidity !== null && humidity > 100) errors.humidity = '濕度不能超過 100%';
  if (tempMax !== null && tempMin !== null && tempMin > tempMax) errors.tempMin = '最低溫不能高於最高溫';

  if (avgEggWeight !== null && (avgEggWeight < EGG_WEIGHT_RANGE.min || avgEggWeight > EGG_WEIGHT_RANGE.max)) {
    warnings.avgEggWeight = `蛋重通常在 ${EGG_WEIGHT_RANGE.min}–${EGG_WEIGHT_RANGE.max} g，請確認`;
  }
  for (const k of ['tempMax', 'tempMin'] as const) {
    const v = input[k];
    if (v !== null && (v < TEMP_RANGE.min || v > TEMP_RANGE.max)) warnings[k] = '溫度不太尋常，請確認';
  }

  return { errors, warnings };
}

/** 把未知輸入整理成 DailyRecordInput；空字串、undefined 視為 null，多餘欄位丟掉 */
export function normalizeDailyRecordInput(raw: Record<string, unknown>): DailyRecordInput {
  const out: Record<string, unknown> = {};
  for (const k of DAILY_RECORD_FIELDS) {
    const v = raw[k];
    if (k === 'note') out[k] = typeof v === 'string' ? v.trim() : '';
    else if (v === '' || v === undefined || v === null) out[k] = null;
    else out[k] = typeof v === 'string' ? Number(v) : v;
  }
  return out as unknown as DailyRecordInput;
}

export const hasErrors = (r: ValidationResult) => Object.keys(r.errors).length > 0;
