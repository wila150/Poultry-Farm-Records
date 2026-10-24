import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  addDays,
  customFieldName,
  DAILY_RECORD_FIELDS,
  hasErrors,
  layingRate,
  normalizeDailyRecordInput,
  taipeiDate,
  validateDailyRecord,
  type CustomField,
  type DailyRecordInput,
  type Farm,
  type House,
  type User,
} from '../../../shared/src';
import type { Route } from '../App';
import { loadRecord, type WithId } from '../data';
import { api, ApiError, closeLiff, db } from '../session';

type Field = (typeof DAILY_RECORD_FIELDS)[number];
// 自訂項目以 custom.<key> 存在同一份表單值裡
type Values = Record<string, string>;

interface FieldDef {
  key: Exclude<Field, 'note'>;
  label: string;
  unit?: string;
  decimal?: boolean;
}

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: '雞隻',
    fields: [
      { key: 'birdCount', label: '在養隻數', unit: '隻' },
      { key: 'deaths', label: '死亡數', unit: '隻' },
      { key: 'culls', label: '淘汰數', unit: '隻' },
    ],
  },
  {
    title: '產蛋',
    fields: [
      { key: 'eggsTotal', label: '總蛋數', unit: '顆' },
      { key: 'eggsBroken', label: '破蛋／軟殼', unit: '顆' },
      { key: 'avgEggWeight', label: '平均蛋重', unit: 'g', decimal: true },
    ],
  },
  {
    title: '飼養',
    fields: [
      { key: 'feedKg', label: '飼料量', unit: 'kg', decimal: true },
      { key: 'waterL', label: '飲水量', unit: 'L', decimal: true },
    ],
  },
  {
    title: '環境',
    fields: [
      { key: 'tempMax', label: '最高溫', unit: '°C', decimal: true },
      { key: 'tempMin', label: '最低溫', unit: '°C', decimal: true },
      { key: 'humidity', label: '濕度', unit: '%', decimal: true },
    ],
  },
];

GROUPS.push({ title: '其他', fields: [] });

const EMPTY: Values = Object.fromEntries(DAILY_RECORD_FIELDS.map((f) => [f, ''])) as Values;

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const toValues = (r: Partial<Record<Field, unknown>> & { custom?: Record<string, unknown> }): Values => ({
  ...Object.fromEntries(DAILY_RECORD_FIELDS.map((f) => [f, str(r[f])])),
  ...Object.fromEntries(Object.entries(r.custom ?? {}).map(([k, v]) => [customFieldName(k), str(v)])),
});

/** 表單值 → API 格式（custom.<key> 收進 custom） */
function toRaw(values: Values) {
  const raw: Record<string, unknown> = { custom: {} };
  for (const [k, v] of Object.entries(values)) {
    if (k.startsWith('custom.')) (raw.custom as Record<string, string>)[k.slice(7)] = v;
    else raw[k] = v;
  }
  return raw;
}

// 草稿存在手機瀏覽器，農場訊號差也不會遺失。讀寫失敗時當作沒有草稿。
const draftKey = (houseId: string, date: string) => `draft:${houseId}:${date}`;
function readDraft(key: string): Values | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}
function writeDraft(key: string, v: Values | null) {
  try {
    if (v) localStorage.setItem(key, JSON.stringify(v));
    else localStorage.removeItem(key);
  } catch {
    /* 無法儲存草稿時不影響填寫 */
  }
}

interface Props {
  me: WithId<User>;
  house: WithId<House>;
  date: string;
  go: (r: Route) => void;
}

export function RecordForm({ me, house, date, go }: Props) {
  const key = draftKey(house.id, date);
  const readOnly = me.role === 'staff' && date < addDays(taipeiDate(), -1);

  const [values, setValues] = useState<Values | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [exists, setExists] = useState(false);
  const [fromDraft, setFromDraft] = useState(false);
  const [birdCountFrom, setBirdCountFrom] = useState<string | null>(null);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const original = useRef<Values | null>(null);

  useEffect(() => {
    (async () => {
      const [rec, farm] = await Promise.all([loadRecord(house.id, date), getDoc(doc(db, 'farms', house.farmId))]);
      setCustomFields(((farm.data() as Farm | undefined)?.customFields ?? []).filter((f) => f.active));
      setExists(!!rec);
      let base: Values;
      if (rec) {
        base = toValues(rec);
      } else {
        const pre = await api<Partial<DailyRecordInput> & { birdCountFrom: string | null }>(
          'GET',
          `/records/${house.id}/${date}/prefill`,
        );
        base = { ...EMPTY, ...toValues(pre) };
        setBirdCountFrom(pre.birdCountFrom);
      }
      original.current = base;
      const draft = readOnly ? null : readDraft(key);
      setFromDraft(!!draft);
      setValues(draft ?? base);
    })().catch((e: Error) => setError(e.message));
  }, [house.id, date, key, readOnly]);

  const input = useMemo(() => (values ? normalizeDailyRecordInput(toRaw(values), customFields) : null), [values, customFields]);
  const result = useMemo(
    () => (input ? validateDailyRecord(input, date, undefined, customFields) : null),
    [input, date, customFields],
  );
  const rate = input && input.birdCount > 0 ? layingRate(input) : null;

  function set(field: string, v: string) {
    setValues((prev) => {
      const next = { ...prev!, [field]: v };
      writeDraft(key, next);
      return next;
    });
    setConfirmWarnings(false);
    setServerErrors((e) => ({ ...e, [field]: '' }));
  }

  function discardDraft() {
    writeDraft(key, null);
    setFromDraft(false);
    setValues(original.current);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!input || !result || hasErrors(result)) return;
    if (Object.keys(result.warnings).length > 0 && !confirmWarnings) {
      setConfirmWarnings(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('PUT', `/records/${house.id}/${date}`, input);
      writeDraft(key, null);
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.details) setServerErrors(err.details);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <header className="page-header">
      <button className="back" onClick={() => go({ page: 'today' })}>
        ‹ 返回
      </button>
      <h1>
        {house.name}・{date === taipeiDate() ? '今天' : date}
      </h1>
    </header>
  );

  if (done) {
    return (
      <main className="center">
        <h1>已送出 ✓</h1>
        <p className="muted">
          {house.name} {date} 的紀錄已儲存。
        </p>
        <div className="stack">
          <button className="primary" onClick={() => go({ page: 'today' })}>
            回到今日總覽
          </button>
          <button className="secondary" onClick={closeLiff}>
            關閉
          </button>
        </div>
      </main>
    );
  }

  if (!values || !result) {
    return (
      <main>
        {header}
        {error ? <p className="error">{error}</p> : <p className="muted">載入中…</p>}
      </main>
    );
  }

  const errorFor = (f: string) =>
    serverErrors[f] || ((submitted || touched.has(f)) && (result.errors as Record<string, string>)[f]) || '';
  const warningFor = (f: string) => (result.warnings as Record<string, string>)[f] ?? '';

  return (
    <main>
      {header}
      {readOnly && <p className="notice">只能修改今天和昨天的紀錄，如需更正請聯絡場長。</p>}
      {fromDraft && (
        <p className="notice">
          已還原上次未送出的草稿。
          <button type="button" className="link" onClick={discardDraft}>
            捨棄草稿
          </button>
        </p>
      )}
      {result.errors.date && <p className="error">{result.errors.date}</p>}

      <form onSubmit={submit}>
        <fieldset disabled={readOnly || busy}>
          {GROUPS.map((g) => {
            const extra = customFields.filter((f) => f.group === g.title);
            if (g.fields.length === 0 && extra.length === 0) return null;
            return (
            <section key={g.title} className="card">
              <h2>{g.title}</h2>
              <div className="grid">
                {g.fields.map((f) => (
                  <label key={f.key} className="field">
                    <span>{f.label}</span>
                    <div className="input-unit">
                      <input
                        type="text"
                        inputMode={f.decimal ? 'decimal' : 'numeric'}
                        value={values[f.key]}
                        onChange={(e) => set(f.key, e.target.value)}
                        onBlur={() => setTouched((t) => new Set(t).add(f.key))}
                        aria-invalid={!!errorFor(f.key)}
                      />
                      {f.unit && <em>{f.unit}</em>}
                    </div>
                    {f.key === 'birdCount' && birdCountFrom && !exists && (
                      <small className="muted">由 {birdCountFrom.slice(5)} 的紀錄推算</small>
                    )}
                    {errorFor(f.key) && <small className="error">{errorFor(f.key)}</small>}
                    {!errorFor(f.key) && warningFor(f.key) && <small className="warn">{warningFor(f.key)}</small>}
                  </label>
                ))}
                {extra.map((f) => {
                  const name = customFieldName(f.key);
                  return (
                    <label key={name} className={`field ${f.type === 'text' ? 'wide' : ''}`}>
                      <span>
                        {f.label}
                        {f.required && <b className="req"> *</b>}
                      </span>
                      <div className="input-unit">
                        <input
                          type="text"
                          inputMode={f.type === 'text' ? 'text' : f.type === 'integer' ? 'numeric' : 'decimal'}
                          value={values[name] ?? ''}
                          onChange={(e) => set(name, e.target.value)}
                          onBlur={() => setTouched((t) => new Set(t).add(name))}
                          aria-invalid={!!errorFor(name)}
                        />
                        {f.unit && <em>{f.unit}</em>}
                      </div>
                      {errorFor(name) && <small className="error">{errorFor(name)}</small>}
                    </label>
                  );
                })}
              </div>
              {g.title === '產蛋' && (
                <p className="metric">
                  產蛋率 <strong>{rate === null ? '–' : `${rate.toFixed(1)}%`}</strong>
                </p>
              )}
            </section>
            );
          })}

          <section className="card">
            <h2>備註</h2>
            <textarea
              rows={3}
              maxLength={500}
              value={values.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="例如：B棟水簾故障已修復"
            />
          </section>
        </fieldset>

        {error && <p className="error">{error}</p>}
        {confirmWarnings && <p className="warn">有數值不太尋常（見上方黃字），確認無誤請再按一次送出。</p>}
        {submitted && hasErrors(result) && <p className="error">請修正紅字標示的欄位</p>}

        {!readOnly && (
          <button className="primary sticky" disabled={busy}>
            {busy ? '送出中…' : confirmWarnings ? '確認送出' : exists ? '儲存修改' : '送出'}
          </button>
        )}
      </form>
    </main>
  );
}
