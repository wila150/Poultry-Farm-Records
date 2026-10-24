import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  calcShipment,
  shipmentHasErrors,
  shipmentSettingsOf,
  taipeiDate,
  validateShipment,
  type Customer,
  type Farm,
  type ShipmentInput,
  type ShipmentItemKind,
  type User,
} from '../../../shared/src';
import type { Route } from '../App';
import type { WithId } from '../data';
import { api, db, getLiff } from '../session';

const QTY_UNIT = { box: '箱', cart: '車' } as const;
const fmt = (n: number) => n.toLocaleString('zh-TW');

interface ItemDraft {
  kind: ShipmentItemKind;
  grade: string;
  quantity: string;
  weightCatty: string;
}

export function ShipmentForm({ me, go }: { me: WithId<User>; go: (r: Route) => void }) {
  const farmId = me.farmIds[0];
  const today = taipeiDate();
  const [farm, setFarm] = useState<Farm | null>(null);
  const [customers, setCustomers] = useState<WithId<Customer>[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [eggWeight, setEggWeight] = useState('');
  const [eggWeightFrom, setEggWeightFrom] = useState<string | null>(null);
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ customer: string; summary: string } | null>(null);

  useEffect(() => {
    if (!farmId) return;
    (async () => {
      const [f, cs, w] = await Promise.all([
        getDoc(doc(db, 'farms', farmId)),
        getDocs(query(collection(db, 'customers'), where('farmId', '==', farmId))),
        api<{ avgEggWeight: number | null; from: string | null }>('GET', `/shipments/egg-weight?farmId=${farmId}&date=${today}`),
      ]);
      const farmData = f.data() as Farm;
      const s = shipmentSettingsOf(farmData);
      setFarm(farmData);
      setCustomers(
        cs.docs
          .map((d) => ({ id: d.id, ...(d.data() as Customer) }))
          .filter((c) => c.active)
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
      );
      setEggWeight(w.avgEggWeight === null ? '' : String(w.avgEggWeight));
      setEggWeightFrom(w.from);
      setItems([{ kind: 'box', grade: s.grades[0] ?? '', quantity: '', weightCatty: '' }]);
    })().catch((e: Error) => setError(e.message));
  }, [farmId, today]);

  const settings = farm ? shipmentSettingsOf(farm) : null;
  const input: ShipmentInput = useMemo(
    () => ({
      date: today,
      customerId,
      avgEggWeight: Number(eggWeight),
      note: note.trim(),
      items: items.map((i) => ({
        kind: i.kind,
        grade: i.grade,
        quantity: Number(i.quantity),
        weightCatty: Number(i.weightCatty),
      })),
    }),
    [today, customerId, eggWeight, note, items],
  );

  const header = (
    <header className="page-header">
      <button className="back" onClick={() => go({ page: 'today' })}>
        ‹ 返回
      </button>
      <h1>開出貨單・{today.slice(5)}</h1>
    </header>
  );

  if (!farmId) return <main>{header}<p className="card muted">尚未加入雞場</p></main>;
  if (!settings) return <main>{header}{error ? <p className="error">{error}</p> : <p className="muted">載入中…</p>}</main>;

  const v = validateShipment(input, settings);
  const calc = calcShipment(input, settings);
  const setItem = (idx: number, patch: Partial<ItemDraft>) => setItems(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (shipmentHasErrors(v)) return;
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/shipments', { ...input, farmId });
      const customer = customers.find((c) => c.id === customerId)?.name ?? '';
      const lines = calc.items.map((i) => `${i.grade} ${i.quantity}${QTY_UNIT[i.kind]}｜${fmt(i.netCatty)} 台斤｜約 ${fmt(i.eggs)} 顆`);
      setSaved({
        customer,
        summary: [`【${farm!.name} 出貨單】${today}`, `客戶：${customer}`, ...lines, `合計：${fmt(calc.totalCatty)} 台斤，約 ${fmt(calc.totalEggs)} 顆`].join('\n'),
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!saved) return;
    try {
      const liff = await getLiff();
      if (liff.isApiAvailable('shareTargetPicker')) {
        await liff.shareTargetPicker([{ type: 'text', text: saved.summary }]);
      } else {
        await navigator.clipboard.writeText(saved.summary);
        alert('已複製出貨內容，可以貼到聊天室');
      }
    } catch {
      alert('無法分享，請稍後再試');
    }
  }

  if (saved) {
    return (
      <main>
        <h1>出貨單已儲存 ✓</h1>
        <pre className="card summary">{saved.summary}</pre>
        <div className="stack">
          <button className="primary" onClick={share}>
            傳給客戶
          </button>
          <button className="secondary" onClick={() => go({ page: 'today' })}>
            回到首頁
          </button>
        </div>
      </main>
    );
  }

  return (
    <main>
      {header}
      <form onSubmit={submit}>
        <section className="card stack">
          <label className="field">
            <span>客戶</span>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">請選擇</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {customers.length === 0 && <small className="muted">還沒有客戶，請場長在後台新增</small>}
          </label>
          <label className="field">
            <span>平均蛋重</span>
            <div className="input-unit">
              <input inputMode="decimal" value={eggWeight} onChange={(e) => setEggWeight(e.target.value)} />
              <em>g</em>
            </div>
            <small className="muted">{eggWeightFrom ? `帶入 ${eggWeightFrom.slice(5)} 紀錄，可修改` : '查無蛋重紀錄，請手動填寫'}</small>
          </label>
        </section>

        {items.map((it, idx) => {
          const c = calc.items[idx];
          const err = submitted ? v.itemErrors[idx] : '';
          const warn = v.itemWarnings[idx];
          return (
            <section key={idx} className="card">
              <h2>
                品項 {idx + 1}
                {items.length > 1 && (
                  <button type="button" className="link danger" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                    刪除
                  </button>
                )}
              </h2>
              <div className="segmented">
                {(['box', 'cart'] as const).map((k) => (
                  <button type="button" key={k} className={it.kind === k ? 'on' : ''} onClick={() => setItem(idx, { kind: k })}>
                    {k === 'box' ? '原料箱' : '蛋盤車'}
                  </button>
                ))}
              </div>
              <div className="grid">
                <label className="field">
                  <span>規格</span>
                  <select value={it.grade} onChange={(e) => setItem(idx, { grade: e.target.value })}>
                    {settings.grades.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{it.kind === 'box' ? '箱數' : '車數'}</span>
                  <div className="input-unit">
                    <input inputMode="numeric" value={it.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })} />
                    <em>{QTY_UNIT[it.kind]}</em>
                  </div>
                </label>
                {it.kind === 'cart' ? (
                  <label className="field">
                    <span>上車總重</span>
                    <div className="input-unit">
                      <input inputMode="decimal" value={it.weightCatty} onChange={(e) => setItem(idx, { weightCatty: e.target.value })} />
                      <em>台斤</em>
                    </div>
                    <small className="muted">每車扣 {settings.cartTareKg} kg</small>
                  </label>
                ) : (
                  <div className="field">
                    <span>重量</span>
                    <p className="fixed-value">每箱 {settings.boxCatty} 台斤</p>
                  </div>
                )}
              </div>
              {c && c.netCatty > 0 && (
                <p className="metric">
                  淨重 <strong>{fmt(c.netCatty)}</strong> 台斤・約 <strong>{fmt(c.eggs)}</strong> 顆
                </p>
              )}
              {err && <p className="error">{err}</p>}
              {!err && warn && <p className="warn">{warn}</p>}
            </section>
          );
        })}

        <button
          type="button"
          className="secondary"
          onClick={() => setItems([...items, { ...items.at(-1)!, quantity: '', weightCatty: '' }])}
        >
          ＋ 新增品項
        </button>

        <section className="card" style={{ marginTop: 12 }}>
          <h2>備註</h2>
          <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </section>

        <p className="metric total">
          合計 <strong>{fmt(calc.totalCatty)}</strong> 台斤・約 <strong>{fmt(calc.totalEggs)}</strong> 顆
        </p>
        {submitted && v.errors.map((m) => <p key={m} className="error">{m}</p>)}
        {error && <p className="error">{error}</p>}
        <button className="primary sticky" disabled={busy}>
          {busy ? '儲存中…' : '儲存出貨單'}
        </button>
      </form>
    </main>
  );
}
