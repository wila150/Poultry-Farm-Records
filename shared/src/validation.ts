// 每日紀錄防呆。前端即時顯示、後端送出時再驗一次，兩邊用同一份規則。
// errors 會擋下送出；warnings 只提醒，使用者確認後可送出。

import { taipeiDate, isValidDate } from './dates';
import { DAILY_RECORD_FIELDS, type CustomField, type DailyRecordInput } from './types';

/** 鍵為欄位名稱；自訂項目為 custom.<key> */
export interface ValidationResult {
  errors: Record<string, string>;
  warnings: Record<string, string>;
}

export const customFieldName = (key: string) => `custom.${key}`;
const activeFields = (fields: CustomField[]) => fields.filter((f) => f.active);

const REQUIRED_INTS = ['birdCount', 'deaths', 'culls', 'eggsTotal', 'eggsBroken'] as const;
const OPTIONAL_NUMS = ['avgEggWeight', 'feedKg', 'waterL', 'tempMax', 'tempMin', 'humidity'] as const;

export const EGG_WEIGHT_RANGE = { min: 40, max: 75 };
export const TEMP_RANGE = { min: -5, max: 45 };

export function validateDailyRecord(
  input: DailyRecordInput,
  date: string,
  today: string = taipeiDate(),
  customFields: CustomField[] = [],
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

  for (const f of activeFields(customFields)) {
    const v = input.custom?.[f.key] ?? null;
    const name = customFieldName(f.key);
    if (v === null || v === '') {
      if (f.required) errors[name] = '必填';
    } else if (f.type === 'text') {
      if (typeof v !== 'string' || v.length > 200) errors[name] = '最多 200 字';
    } else if (typeof v !== 'number' || !Number.isFinite(v)) {
      errors[name] = '請填數字';
    } else if (f.type === 'integer' && !Number.isInteger(v)) {
      errors[name] = '請填整數';
    }
  }

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

const toNumberOrNull = (v: unknown) =>
  v === '' || v === undefined || v === null ? null : typeof v === 'string' ? Number(v) : v;

/** 把未知輸入整理成 DailyRecordInput；空字串、undefined 視為 null，多餘欄位與停用的自訂項目丟掉 */
export function normalizeDailyRecordInput(raw: Record<string, unknown>, customFields: CustomField[] = []): DailyRecordInput {
  const out: Record<string, unknown> = {};
  for (const k of DAILY_RECORD_FIELDS) {
    const v = raw[k];
    out[k] = k === 'note' ? (typeof v === 'string' ? v.trim() : '') : toNumberOrNull(v);
  }
  const rawCustom = (raw.custom ?? {}) as Record<string, unknown>;
  const custom: Record<string, unknown> = {};
  for (const f of activeFields(customFields)) {
    const v = rawCustom[f.key];
    if (f.type === 'text') custom[f.key] = typeof v === 'string' && v.trim() ? v.trim() : null;
    else custom[f.key] = toNumberOrNull(v);
  }
  out.custom = custom;
  return out as unknown as DailyRecordInput;
}

export const hasErrors = (r: ValidationResult) => Object.keys(r.errors).length > 0;
