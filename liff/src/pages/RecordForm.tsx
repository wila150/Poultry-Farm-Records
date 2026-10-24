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
import { loadDraft, loadRecord, watchRecord, type WithId } from '../data';
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

// 草稿：先存在手機（訊號差也不會遺失），停頓後同步到雲端，換手機、換瀏覽器或換人都能接著填。
interface LocalDraft {
  values: Values;
  savedAt: number;
  synced: boolean;
}
const draftKey = (houseId: string, date: string) => `draft:${houseId}:${date}`;
function readLocal(key: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    // 舊版只存表單值
    return 'values' in d ? d : { values: d, savedAt: 0, synced: false };
  } catch {
    return null;
  }
}
function writeLocal(key: string, d: LocalDraft | null) {
  try {
    if (d) localStorage.setItem(key, JSON.stringify(d));
    else localStorage.removeItem(key);
  } catch {
    /* 無法儲存草稿時不影響填寫 */
  }
}

const SYNC_DELAY = 1500;
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });

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
  const [resumed, setResumed] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sync, setSync] = useState<{ state: 'saving' | 'saved' | 'offline'; at?: number } | null>(null);
  const [retry, setRetry] = useState(0);
  const [changedByOther, setChangedByOther] = useState(false);
  const loadedAt = useRef<number | null>(null);
  const saving = useRef<Promise<unknown> | null>(null);
  const finished = useRef(false);
  const latest = useRef<{ values: Values | null; dirty: boolean }>({ values: null, dirty: false });
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
      const [rec, farm, cloud] = await Promise.all([
        loadRecord(house.id, date),
        getDoc(doc(db, 'farms', house.farmId)),
        readOnly ? null : loadDraft(house.id, date),
      ]);
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
      loadedAt.current = (rec as { updatedAt?: { toMillis(): number } } | null)?.updatedAt?.toMillis() ?? 0;

      // 取最新的草稿（手機或雲端），而且要比已送出的紀錄新
      const recAt = (rec as { updatedAt?: { toMillis(): number } } | null)?.updatedAt?.toMillis() ?? 0;
      const local = readOnly ? null : readLocal(key);
      const useLocal = local && local.savedAt > (cloud?.updatedAt ?? 0) && local.savedAt > recAt;
      const useCloud = !useLocal && cloud && cloud.updatedAt > recAt;
      if (useLocal) {
        setValues({ ...base, ...local.values });
        setResumed(`已還原這支手機 ${hhmm(local.savedAt)} 的草稿`);
        if (!local.synced) setDirty(true);
      } else if (useCloud) {
        setValues({ ...base, ...cloud.values });
        setResumed(`已接續 ${cloud.updatedByName || '上次'} ${hhmm(cloud.updatedAt)} 的草稿`);
        setSync({ state: 'saved', at: cloud.updatedAt });
      } else {
        setValues(base);
      }
    })().catch((e: Error) => setError(e.message));
  }, [house.id, date, key, readOnly]);

  // 填寫中如果這一棟被別人送出或修改，提醒一下，避免互相覆蓋
  useEffect(
    () =>
      watchRecord(house.id, date, (r) => {
        const at = (r as { updatedAt?: { toMillis(): number } } | null)?.updatedAt?.toMillis();
        if (r && at && loadedAt.current !== null && at > loadedAt.current && r.updatedBy !== me.id && !finished.current) {
          setChangedByOther(true);
        }
      }),
    [house.id, date, me.id],
  );

  async function pushDraft(v: Values) {
    setSync({ state: 'saving' });
    const p = api('PUT', `/drafts/${house.id}/${date}`, { values: v });
    saving.current = p;
    try {
      await p;
      if (finished.current) return;
      writeLocal(key, { values: v, savedAt: Date.now(), synced: true });
      setSync({ state: 'saved', at: Date.now() });
      setDirty(false);
    } catch {
      if (!finished.current) setSync({ state: 'offline' });
    } finally {
      if (saving.current === p) saving.current = null;
    }
  }

  // 停頓 1.5 秒後同步到雲端；離線時等恢復連線再試
  useEffect(() => {
    latest.current = { values, dirty };
    if (!dirty || !values || finished.current) return;
    const t = setTimeout(() => pushDraft(values), SYNC_DELAY);
    return () => clearTimeout(t);
  }, [values, dirty, retry]);

  useEffect(() => {
    const onOnline = () => setRetry((n) => n + 1);
    window.addEventListener('online', onOnline);
    // 離開頁面時把還沒同步的內容送出去
    return () => {
      window.removeEventListener('online', onOnline);
      const { values: v, dirty: d } = latest.current;
      if (d && v && !finished.current) api('PUT', `/drafts/${house.id}/${date}`, { values: v }).catch(() => {});
    };
  }, [house.id, date]);

  const input = useMemo(() => (values ? normalizeDailyRecordInput(toRaw(values), customFields) : null), [values, customFields]);
  const result = useMemo(
    () => (input ? validateDailyRecord(input, date, undefined, customFields) : null),
    [input, date, customFields],
  );
  const rate = input && input.birdCount > 0 ? layingRate(input) : null;

  function set(field: string, v: string) {
    setValues((prev) => {
      const next = { ...prev!, [field]: v };
      writeLocal(key, { values: next, savedAt: Date.now(), synced: false });
      return next;
    });
    setDirty(true);
    setConfirmWarnings(false);
    setServerErrors((e) => ({ ...e, [field]: '' }));
  }

  function discardDraft() {
    if (!confirm('確定捨棄草稿？手機和雲端的草稿都會刪除。')) return;
    writeLocal(key, null);
    api('DELETE', `/drafts/${house.id}/${date}`).catch(() => {});
    setResumed(null);
    setDirty(false);
    setSync(null);
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
      // 等正在同步的草稿完成，避免送出後草稿又被寫回去
      await saving.current?.catch(() => {});
      finished.current = true;
      await api('PUT', `/records/${house.id}/${date}`, input);
      writeLocal(key, null);
      setDone(true);
    } catch (err) {
      finished.current = false;
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
      {changedByOther && (
        <p className="notice">
          這一棟剛剛被其他人送出或修改了。
          <button type="button" className="link" onClick={() => go({ page: 'today' })}>
            回首頁查看最新內容
          </button>
        </p>
      )}
      {resumed && (
        <p className="notice">
          {resumed}，可以接著填。
          <button type="button" className="link" onClick={discardDraft}>
            捨棄草稿
          </button>
        </p>
      )}
      {!readOnly && sync && (
        <p className={`sync ${sync.state}`}>
          {sync.state === 'saving' && '同步中…'}
          {sync.state === 'saved' && `草稿已同步 ${hhmm(sync.at!)}，換手機也能接著填`}
          {sync.state === 'offline' && '目前離線，草稿已先存在這支手機，恢復連線後會自動同步'}
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
