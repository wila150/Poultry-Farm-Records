import { useEffect, useState } from 'react';
import { addDays, layingRate, mortalityRate, taipeiDate, type Farm, type User } from '../../../shared/src';
import { downloadCsv } from '../csv';
import { loadFarms, loadHouses, loadRecordsBetween, loadShipments, loadUsers, type WithId } from '../data';

const KIND_LABEL = { box: '原料箱', cart: '蛋盤車' } as const;
const QTY_UNIT = { box: '箱', cart: '車' } as const;
const round = (v: number | null, d = 2) => (v === null ? null : Number(v.toFixed(d)));

export function Export({ me }: { me: WithId<User> }) {
  const today = taipeiDate();
  const [farms, setFarms] = useState<WithId<Farm>[] | null>(null);
  const [farmId, setFarmId] = useState('');
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadFarms(me)
      .then((fs) => {
        setFarms(fs);
        setFarmId(fs[0]?.id ?? '');
      })
      .catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, [me]);

  const farm = farms?.find((f) => f.id === farmId);

  async function run(kind: string, fn: () => Promise<number>) {
    setBusy(kind);
    setMsg(null);
    try {
      const n = await fn();
      setMsg(n > 0 ? { ok: true, text: `已匯出 ${n} 筆` } : { ok: false, text: '這段期間沒有資料' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  const exportRecords = () =>
    run('records', async () => {
      const [records, houses, users] = await Promise.all([loadRecordsBetween(farmId, from, to), loadHouses([farmId]), loadUsers()]);
      const houseName = new Map(houses.map((h) => [h.id, h.name]));
      const userName = new Map(users.map((u) => [u.id, u.name]));
      // 停用的自訂項目若期間內有資料也一併匯出
      const custom = (farm?.customFields ?? []).filter((f) => f.active || records.some((r) => r.custom?.[f.key] != null));
      records.sort((a, b) => a.date.localeCompare(b.date) || (houseName.get(a.houseId) ?? '').localeCompare(houseName.get(b.houseId) ?? '', 'zh-Hant'));
      if (records.length === 0) return 0;
      downloadCsv(
        `每日紀錄_${farm?.name}_${from}_${to}.csv`,
        [
          '日期', '雞舍', '在養隻數', '死亡數', '淘汰數', '總蛋數', '破蛋／軟殼', '產蛋率(%)', '死淘率(%)',
          '平均蛋重(g)', '飼料量(kg)', '飲水量(L)', '最高溫(°C)', '最低溫(°C)', '濕度(%)',
          ...custom.map((f) => (f.unit ? `${f.label}(${f.unit})` : f.label)),
          '備註', '填寫人', '最後修改人',
        ],
        records.map((r) => [
          r.date, houseName.get(r.houseId) ?? r.houseId, r.birdCount, r.deaths, r.culls, r.eggsTotal, r.eggsBroken,
          round(layingRate(r)), round(mortalityRate(r), 3), r.avgEggWeight, r.feedKg, r.waterL, r.tempMax, r.tempMin, r.humidity,
          ...custom.map((f) => r.custom?.[f.key] ?? null),
          r.note, userName.get(r.createdBy) ?? '', userName.get(r.updatedBy) ?? '',
        ]),
      );
      return records.length;
    });

  const exportShipments = () =>
    run('shipments', async () => {
      const list = (await loadShipments(farmId, from, to)).sort((a, b) => a.no.localeCompare(b.no));
      if (list.length === 0) return 0;
      downloadCsv(
        `出貨單_${farm?.name}_${from}_${to}.csv`,
        ['單號', '日期', '客戶', '狀態', '類型', '規格', '數量', '單位', '重量(台斤)', '淨重(台斤)', '顆數', '單價(元/台斤)', '金額', '平均蛋重(g)', '備註'],
        list.flatMap((s) =>
          s.items.map((i) => [
            s.no, s.date, s.customerName, s.voided ? '作廢' : '有效', KIND_LABEL[i.kind], i.grade, i.quantity, QTY_UNIT[i.kind],
            i.weightCatty, i.netCatty, i.eggs, i.pricePerCatty, i.amount, s.avgEggWeight, s.note,
          ]),
        ),
      );
      return list.length;
    });

  if (!farms) return <p className="muted">載入中…</p>;

  return (
    <>
      <header className="page-header">
        <h1>匯出資料</h1>
      </header>
      <section className="card">
        <div className="filters">
          {farms.length > 1 && (
            <select value={farmId} onChange={(e) => setFarmId(e.target.value)}>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <span className="muted">至</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => e.target.value && setTo(e.target.value)} />
          <button className="link" onClick={() => (setFrom(`${today.slice(0, 8)}01`), setTo(today))}>
            本月
          </button>
          <button
            className="link"
            onClick={() => {
              const last = addDays(`${today.slice(0, 8)}01`, -1);
              setFrom(`${last.slice(0, 8)}01`);
              setTo(last);
            }}
          >
            上個月
          </button>
          <button className="link" onClick={() => (setFrom(`${today.slice(0, 4)}-01-01`), setTo(today))}>
            今年
          </button>
        </div>

        <div className="export-grid">
          <div className="export-item">
            <h3>每日生產紀錄</h3>
            <p className="muted small">每棟每天一列，含產蛋率、死淘率、自訂項目、填寫人。</p>
            <button className="primary small" disabled={!!busy || !farmId} onClick={exportRecords}>
              {busy === 'records' ? '匯出中…' : '下載 Excel（CSV）'}
            </button>
          </div>
          <div className="export-item">
            <h3>出貨單明細</h3>
            <p className="muted small">每個品項一列，含作廢單（標示狀態），方便對帳。</p>
            <button className="primary small" disabled={!!busy || !farmId} onClick={exportShipments}>
              {busy === 'shipments' ? '匯出中…' : '下載 Excel（CSV）'}
            </button>
          </div>
        </div>
        {msg && <p className={msg.ok ? 'notice ok' : 'error'}>{msg.text}</p>}
      </section>
    </>
  );
}
