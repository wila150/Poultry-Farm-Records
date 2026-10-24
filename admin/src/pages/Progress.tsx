import { useEffect, useState } from 'react';
import { layingRate, mortalityRate, taipeiDate, type DailyRecord, type Farm, type House, type User } from '../../../shared/src';
import { loadFarms, loadHouses, loadRecordsOn, type WithId } from '../data';

const pct = (v: number | null) => (v === null ? '–' : `${v.toFixed(1)}%`);

export function Progress({ me }: { me: WithId<User> }) {
  const [date, setDate] = useState(taipeiDate());
  const [farms, setFarms] = useState<WithId<Farm>[]>([]);
  const [houses, setHouses] = useState<WithId<House>[] | null>(null);
  const [records, setRecords] = useState<Map<string, DailyRecord>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const fs = await loadFarms(me);
      const ids = fs.map((f) => f.id);
      const [hs, rs] = await Promise.all([loadHouses(ids), loadRecordsOn(ids, date)]);
      setFarms(fs);
      setHouses(hs.filter((h) => h.active));
      setRecords(new Map(rs.map((r) => [r.houseId, r])));
    })().catch((e: Error) => setError(e.message));
  }, [me, date]);

  return (
    <>
      <header className="page-header row">
        <h1>填寫進度</h1>
        <input type="date" value={date} max={taipeiDate()} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </header>
      {error && <p className="error">{error}</p>}
      {!houses && !error && <p className="muted">載入中…</p>}
      {houses?.length === 0 && <p className="card muted">還沒有雞舍，請到「雞場與雞舍」新增。</p>}

      {farms.map((farm) => {
        const list = houses?.filter((h) => h.farmId === farm.id) ?? [];
        if (list.length === 0) return null;
        const done = list.filter((h) => records.has(h.id)).length;
        const custom = (farm.customFields ?? []).filter((f) => f.active);
        return (
          <section key={farm.id} className="card">
            <h2>
              {farm.name}
              <span className={`badge ${done === list.length ? 'ok' : 'todo'}`}>
                已填 {done} / {list.length}
              </span>
            </h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>雞舍</th>
                    <th>狀態</th>
                    <th>在養</th>
                    <th>產蛋數</th>
                    <th>產蛋率</th>
                    <th>蛋重</th>
                    <th>死淘</th>
                    <th>死淘率</th>
                    <th>最高溫</th>
                    {custom.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((h) => {
                    const r = records.get(h.id);
                    return (
                      <tr key={h.id}>
                        <td>{h.name}</td>
                        <td>{r ? <span className="badge ok">已填</span> : <span className="badge todo">未填</span>}</td>
                        <td>{r?.birdCount.toLocaleString() ?? '–'}</td>
                        <td>{r?.eggsTotal.toLocaleString() ?? '–'}</td>
                        <td>{r ? pct(layingRate(r)) : '–'}</td>
                        <td>{r?.avgEggWeight ?? '–'}</td>
                        <td>{r ? r.deaths + r.culls : '–'}</td>
                        <td>{r ? pct(mortalityRate(r)) : '–'}</td>
                        <td>{r?.tempMax ?? '–'}</td>
                        {custom.map((f) => (
                          <td key={f.key}>{r?.custom?.[f.key] ?? '–'}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="muted small">趨勢圖、週報等數據看板會在 Phase 2 加入。</p>
    </>
  );
}
