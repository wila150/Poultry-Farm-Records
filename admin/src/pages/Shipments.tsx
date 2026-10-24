import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  addDays,
  calcShipment,
  shipmentHasErrors,
  shipmentSettingsOf,
  taipeiDate,
  validateShipment,
  type Customer,
  type Farm,
  type Shipment,
  type ShipmentInput,
  type ShipmentItemInput,
  type ShipmentSettings,
  type User,
} from '../../../shared/src';
import { loadCustomers, loadFarms, loadShipments, type WithId } from '../data';
import { api } from '../session';

type View =
  | { name: 'list' }
  | { name: 'form'; shipment?: WithId<Shipment> }
  | { name: 'print'; shipment: WithId<Shipment> }
  | { name: 'customers' }
  | { name: 'settings' };

const KIND_LABEL = { box: '原料箱', cart: '蛋盤車' } as const;
const QTY_UNIT = { box: '箱', cart: '車' } as const;
const fmt = (n: number) => n.toLocaleString('zh-TW');

export function Shipments({ me }: { me: WithId<User> }) {
  const [farms, setFarms] = useState<WithId<Farm>[] | null>(null);
  const [farmId, setFarmId] = useState('');
  const [view, setView] = useState<View>({ name: 'list' });
  const [error, setError] = useState<string | null>(null);

  async function reloadFarms() {
    const fs = await loadFarms(me);
    setFarms(fs);
    setFarmId((cur) => cur || fs[0]?.id || '');
  }
  useEffect(() => {
    reloadFarms().catch((e: Error) => setError(e.message));
  }, [me]);

  const farm = farms?.find((f) => f.id === farmId);
  if (error) return <p className="error">{error}</p>;
  if (!farms) return <p className="muted">載入中…</p>;
  if (!farm) return <p className="card muted">還沒有雞場。</p>;
  const settings = shipmentSettingsOf(farm);

  if (view.name === 'print') return <PrintView farm={farm} shipment={view.shipment} back={() => setView({ name: 'list' })} />;

  return (
    <>
      <header className="page-header row no-print">
        <h1>出貨單</h1>
        <div className="row-actions">
          {farms.length > 1 && (
            <select value={farmId} onChange={(e) => setFarmId(e.target.value)}>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          <button className={`tab ${view.name === 'list' ? 'on' : ''}`} onClick={() => setView({ name: 'list' })}>
            列表
          </button>
          <button className={`tab ${view.name === 'customers' ? 'on' : ''}`} onClick={() => setView({ name: 'customers' })}>
            客戶
          </button>
          <button className={`tab ${view.name === 'settings' ? 'on' : ''}`} onClick={() => setView({ name: 'settings' })}>
            設定
          </button>
          <button className="primary small" onClick={() => setView({ name: 'form' })}>
            ＋ 開出貨單
          </button>
        </div>
      </header>

      {view.name === 'list' && <ShipmentList farm={farm} setView={setView} />}
      {view.name === 'form' && (
        <ShipmentForm
          farm={farm}
          settings={settings}
          shipment={view.shipment}
          onSaved={(s) => setView({ name: 'print', shipment: s })}
          onCancel={() => setView({ name: 'list' })}
        />
      )}
      {view.name === 'customers' && <Customers farm={farm} />}
      {view.name === 'settings' && <Settings farm={farm} settings={settings} onSaved={reloadFarms} />}
    </>
  );
}

function ShipmentList({ farm, setView }: { farm: WithId<Farm>; setView: (v: View) => void }) {
  const today = taipeiDate();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [list, setList] = useState<WithId<Shipment>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setList(await loadShipments(farm.id, from, to));
  }
  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
  }, [farm.id, from, to]);

  async function voidIt(s: WithId<Shipment>) {
    if (!confirm(`確定作廢出貨單 ${s.no}？`)) return;
    try {
      await api('POST', `/shipments/${s.id}/void`);
      await reload();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const valid = list?.filter((s) => !s.voided) ?? [];
  const sum = (k: 'totalEggs' | 'totalCatty') => valid.reduce((t, s) => t + s[k], 0);

  return (
    <section className="card">
      <div className="filters">
        <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span className="muted">至</span>
        <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} />
        <button className="link" onClick={() => (setFrom(addDays(today, -6)), setTo(today))}>
          近 7 天
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!list && !error && <p className="muted">載入中…</p>}
      {list?.length === 0 && <p className="muted">這段期間沒有出貨單</p>}
      {list && list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>單號</th>
                <th>日期</th>
                <th>客戶</th>
                <th>品項</th>
                <th>顆數</th>
                <th>淨重（台斤）</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={s.voided ? 'inactive' : ''}>
                  <td>
                    {s.no}
                    {s.voided && <span className="badge todo">作廢</span>}
                  </td>
                  <td>{s.date}</td>
                  <td>{s.customerName}</td>
                  <td className="muted">
                    {s.items.map((i) => `${i.grade} ${i.quantity}${QTY_UNIT[i.kind]}`).join('、')}
                  </td>
                  <td>{fmt(s.totalEggs)}</td>
                  <td>{fmt(s.totalCatty)}</td>
                  <td className="actions">
                    <button className="link" onClick={() => setView({ name: 'print', shipment: s })}>
                      列印
                    </button>
                    {!s.voided && (
                      <>
                        <button className="link" onClick={() => setView({ name: 'form', shipment: s })}>
                          修改
                        </button>
                        <button className="link danger" onClick={() => voidIt(s)}>
                          作廢
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>合計（{valid.length} 張，不含作廢）</td>
                <td>{fmt(sum('totalEggs'))}</td>
                <td>{fmt(Math.round(sum('totalCatty') * 10) / 10)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}

type ItemDraft = Record<'quantity' | 'weightCatty', string> & Pick<ShipmentItemInput, 'kind' | 'grade'>;

const newItem = (s: ShipmentSettings, prev?: ItemDraft): ItemDraft => ({
  kind: prev?.kind ?? 'box',
  grade: prev?.grade ?? s.grades[0] ?? '',
  quantity: '',
  weightCatty: '',
});

interface FormProps {
  farm: WithId<Farm>;
  settings: ShipmentSettings;
  shipment?: WithId<Shipment>;
  onSaved: (s: WithId<Shipment>) => void;
  onCancel: () => void;
}

function ShipmentForm({ farm, settings, shipment, onSaved, onCancel }: FormProps) {
  const [customers, setCustomers] = useState<WithId<Customer>[]>([]);
  const [date, setDate] = useState(shipment?.date ?? taipeiDate());
  const [customerId, setCustomerId] = useState(shipment?.customerId ?? '');
  const [eggWeight, setEggWeight] = useState(shipment ? String(shipment.avgEggWeight) : '');
  const [eggWeightFrom, setEggWeightFrom] = useState<string | null>(null);
  const [items, setItems] = useState<ItemDraft[]>(
    shipment?.items.map((i) => ({
      kind: i.kind,
      grade: i.grade,
      quantity: String(i.quantity),
      weightCatty: String(i.weightCatty),
    })) ?? [newItem(settings)],
  );
  const [note, setNote] = useState(shipment?.note ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCustomers(farm.id)
      .then((cs) => setCustomers(cs.filter((c) => c.active || c.id === shipment?.customerId)))
      .catch((e: Error) => setError(e.message));
  }, [farm.id]);

  // 新單：依日期帶入當天平均蛋重
  useEffect(() => {
    if (shipment) return;
    api<{ avgEggWeight: number | null; from: string | null }>('GET', `/shipments/egg-weight?farmId=${farm.id}&date=${date}`)
      .then((r) => {
        setEggWeight(r.avgEggWeight === null ? '' : String(r.avgEggWeight));
        setEggWeightFrom(r.from);
      })
      .catch(() => setEggWeightFrom(null));
  }, [farm.id, date]);

  const input: ShipmentInput = useMemo(
    () => ({
      date,
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
    [date, customerId, eggWeight, note, items],
  );
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
      let id = shipment?.id;
      if (id) await api('PUT', `/shipments/${id}`, input);
      else id = (await api<{ id: string }>('POST', '/shipments', { ...input, farmId: farm.id })).id;
      const saved = (await loadShipments(farm.id, date, date)).find((s) => s.id === id);
      if (saved) onSaved(saved);
      else onCancel();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>{shipment ? `修改出貨單 ${shipment.no}` : '開出貨單'}</h2>
      <div className="inline-form">
        <label className="field">
          <span>出貨日期</span>
          <input type="date" value={date} max={taipeiDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
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
          {customers.length === 0 && <small className="muted">請先到「客戶」新增</small>}
        </label>
        <label className="field">
          <span>平均蛋重（g）</span>
          <input inputMode="decimal" value={eggWeight} onChange={(e) => setEggWeight(e.target.value)} />
          <small className="muted">
            {eggWeightFrom ? `帶入 ${eggWeightFrom} 紀錄，可修改` : shipment ? '' : '查無蛋重紀錄，請手動填寫'}
          </small>
        </label>
      </div>

      <div className="table-wrap">
        <table className="items">
          <thead>
            <tr>
              <th>類型</th>
              <th>規格</th>
              <th>數量</th>
              <th>重量（台斤）</th>
              <th>淨重</th>
              <th>顆數</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const c = calc.items[idx];
              const err = submitted ? v.itemErrors[idx] : '';
              const warn = v.itemWarnings[idx];
              return (
                <Fragment key={idx}>
                <tr>
                  <td>
                    <select value={it.kind} onChange={(e) => setItem(idx, { kind: e.target.value as ItemDraft['kind'] })}>
                      <option value="box">原料箱</option>
                      <option value="cart">蛋盤車</option>
                    </select>
                  </td>
                  <td>
                    <select value={it.grade} onChange={(e) => setItem(idx, { grade: e.target.value })}>
                      {settings.grades.map((g) => (
                        <option key={g}>{g}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div className="input-unit">
                      <input inputMode="numeric" value={it.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })} />
                      <em>{QTY_UNIT[it.kind]}</em>
                    </div>
                  </td>
                  <td>
                    {it.kind === 'cart' ? (
                      <>
                        <input inputMode="decimal" value={it.weightCatty} onChange={(e) => setItem(idx, { weightCatty: e.target.value })} />
                        <small className="muted">含車總重，每車扣 {settings.cartTareKg} kg</small>
                      </>
                    ) : (
                      <span className="muted">每箱 {settings.boxCatty} 台斤</span>
                    )}
                  </td>
                  <td>{c && c.netCatty > 0 ? fmt(c.netCatty) : '–'}</td>
                  <td>{c && c.eggs > 0 ? fmt(c.eggs) : '–'}</td>
                  <td>
                    {items.length > 1 && (
                      <button type="button" className="link danger" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                        刪除
                      </button>
                    )}
                  </td>
                </tr>
                {(err || warn) && (
                  <tr className="row-msg">
                    <td colSpan={7}>{err ? <span className="error">{err}</span> : <span className="warn">{warn}</span>}</td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>
                <button type="button" className="link" onClick={() => setItems([...items, newItem(settings, items.at(-1))])}>
                  ＋ 新增品項
                </button>
              </td>
              <td>{fmt(calc.totalCatty)}</td>
              <td>
                <strong>{fmt(calc.totalEggs)}</strong>
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <label className="field">
        <span>備註</span>
        <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {submitted && v.errors.map((m) => <p key={m} className="error">{m}</p>)}
      {error && <p className="error">{error}</p>}
      <div className="assign-actions">
        <button className="primary small" disabled={busy}>
          {busy ? '儲存中…' : '儲存並預覽'}
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

function PrintView({ farm, shipment: s, back }: { farm: WithId<Farm>; shipment: WithId<Shipment>; back: () => void }) {
  return (
    <>
      <div className="no-print row-actions" style={{ marginBottom: 16 }}>
        <button className="secondary small" onClick={back}>
          ‹ 回列表
        </button>
        <button className="primary small" onClick={() => window.print()}>
          列印／存成 PDF
        </button>
      </div>
      <article className="invoice">
        <header>
          <img src="/favicon.svg" alt="" width="56" height="56" />
          <div>
            <h1>{farm.name}　出貨單</h1>
            {farm.location && <p className="muted">{farm.location}</p>}
          </div>
          <dl>
            <dt>單號</dt>
            <dd>{s.no}</dd>
            <dt>日期</dt>
            <dd>{s.date}</dd>
          </dl>
        </header>
        {s.voided && <p className="void-stamp">作廢</p>}
        <p className="to">
          客戶：<strong>{s.customerName}</strong>
        </p>
        <table>
          <thead>
            <tr>
              <th>品項</th>
              <th>規格</th>
              <th>數量</th>
              <th>重量（台斤）</th>
              <th>淨重（台斤）</th>
              <th>顆數</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((i, idx) => (
              <tr key={idx}>
                <td>{KIND_LABEL[i.kind]}</td>
                <td>{i.grade}</td>
                <td>
                  {i.quantity} {QTY_UNIT[i.kind]}
                </td>
                <td>{fmt(i.weightCatty)}</td>
                <td>{fmt(i.netCatty)}</td>
                <td>{fmt(i.eggs)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4}>合計</td>
              <td>{fmt(s.totalCatty)}</td>
              <td>{fmt(s.totalEggs)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="muted small">
          原料箱顆數以平均蛋重 {s.avgEggWeight} g 換算；蛋盤車以整車盤數計算。
        </p>
        {s.note && <p>備註：{s.note}</p>}
        <footer>
          <span>出貨人：</span>
          <span>司機：</span>
          <span>客戶簽收：</span>
        </footer>
      </article>
    </>
  );
}

function Customers({ farm }: { farm: WithId<Farm> }) {
  const [list, setList] = useState<WithId<Customer>[] | null>(null);
  const [draft, setDraft] = useState<(Omit<Customer, 'farmId'> & { id?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setList(await loadCustomers(farm.id));
    setDraft(null);
  }
  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
  }, [farm.id]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setError(null);
    try {
      if (draft.id) await api('PUT', `/customers/${draft.id}`, draft);
      else await api('POST', '/customers', { ...draft, farmId: farm.id });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const form = draft && (
    <form className="inline-form" onSubmit={save}>
      <label className="field">
        <span>名稱</span>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
      </label>
      <label className="field">
        <span>電話</span>
        <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
      </label>
      <label className="field">
        <span>地址</span>
        <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
      </label>
      <label className="field">
        <span>備註</span>
        <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
      </label>
      <label className="field checkbox">
        <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
        <span>往來中</span>
      </label>
      <div className="assign-actions full">
        <button className="primary small">{draft.id ? '儲存' : '新增'}</button>
        <button type="button" className="secondary small" onClick={() => setDraft(null)}>
          取消
        </button>
      </div>
    </form>
  );

  return (
    <section className="card">
      <h2>
        客戶
        <button className="link" onClick={() => setDraft({ name: '', phone: '', address: '', note: '', active: true })}>
          ＋ 新增客戶
        </button>
      </h2>
      {error && <p className="error">{error}</p>}
      {draft && !draft.id && form}
      {list?.length === 0 && !draft && <p className="muted">還沒有客戶</p>}
      {list && list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名稱</th>
                <th>電話</th>
                <th>地址</th>
                <th>備註</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) =>
                draft?.id === c.id ? (
                  <tr key={c.id}>
                    <td colSpan={5}>{form}</td>
                  </tr>
                ) : (
                  <tr key={c.id} className={c.active ? '' : 'inactive'}>
                    <td>{c.name}</td>
                    <td>{c.phone || '–'}</td>
                    <td>{c.address || '–'}</td>
                    <td>{c.note || '–'}</td>
                    <td className="actions">
                      <button className="link" onClick={() => setDraft({ ...c })}>
                        編輯
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Settings({ farm, settings, onSaved }: { farm: WithId<Farm>; settings: ShipmentSettings; onSaved: () => Promise<void> }) {
  const [v, setV] = useState({
    grades: settings.grades.join('、'),
    traysPerCart: String(settings.traysPerCart),
    eggsPerTray: String(settings.eggsPerTray),
    cartTareKg: String(settings.cartTareKg),
    boxCatty: String(settings.boxCatty),
    boxEggsMin: String(settings.boxEggsMin),
    boxEggsMax: String(settings.boxEggsMax),
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api('PUT', `/farms/${farm.id}/shipment-settings`, {
        grades: v.grades.split(/[、,，\s]+/),
        traysPerCart: Number(v.traysPerCart),
        eggsPerTray: Number(v.eggsPerTray),
        cartTareKg: Number(v.cartTareKg),
        boxCatty: Number(v.boxCatty),
        boxEggsMin: Number(v.boxEggsMin),
        boxEggsMax: Number(v.boxEggsMax),
      });
      await onSaved();
      setMsg('已儲存');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  const num = (k: keyof typeof v, label: string, unit: string) => (
    <label className="field">
      <span>{label}</span>
      <div className="input-unit">
        <input inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
        <em>{unit}</em>
      </div>
    </label>
  );

  return (
    <form className="card" onSubmit={save}>
      <h2>出貨設定・{farm.name}</h2>
      <div className="inline-form">
        <label className="field full">
          <span>蛋的規格（用頓號分隔）</span>
          <input value={v.grades} onChange={(e) => setV({ ...v, grades: e.target.value })} />
        </label>
        {num('traysPerCart', '每車盤數', '盤')}
        {num('eggsPerTray', '每盤顆數', '顆')}
        {num('cartTareKg', '每車扣重', 'kg')}
        {num('boxCatty', '原料箱每箱重量', '台斤')}
        {num('boxEggsMin', '原料箱每箱最少', '顆')}
        {num('boxEggsMax', '原料箱每箱最多', '顆')}
      </div>
      {msg && <p className={msg === '已儲存' ? 'muted' : 'error'}>{msg}</p>}
      <button className="primary small">儲存設定</button>
    </form>
  );
}
