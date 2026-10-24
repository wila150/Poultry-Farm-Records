import { useEffect, useState } from 'react';
import { addDays, layingRate, mortalityRate, taipeiDate, type DailyRecord, type House, type User } from '../../../shared/src';
import type { Route } from '../App';
import { loadHistory, type WithId } from '../data';

const pct = (v: number | null, digits = 1) => (v === null ? '–' : `${v.toFixed(digits)}%`);

export function History({ me, house, go }: { me: WithId<User>; house: WithId<House>; go: (r: Route) => void }) {
  const [records, setRecords] = useState<DailyRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editableFrom = me.role === 'staff' ? addDays(taipeiDate(), -1) : '';

  useEffect(() => {
    loadHistory(house)
      .then(setRecords)
      .catch((e: Error) => setError(e.message));
  }, [house]);

  return (
    <main>
      <header className="page-header">
        <button className="back" onClick={() => go({ page: 'today' })}>
          ‹ 返回
        </button>
        <h1>{house.name}・近 30 筆</h1>
      </header>

      {error && <p className="error">{error}</p>}
      {!records && !error && <p className="muted">載入中…</p>}
      {records?.length === 0 && <p className="card muted">還沒有紀錄</p>}

      {records && records.length > 0 && (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>產蛋率</th>
                <th>蛋重</th>
                <th>死淘</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.date}>
                  <td>{r.date.slice(5)}</td>
                  <td>{pct(layingRate(r))}</td>
                  <td>{r.avgEggWeight ?? '–'}</td>
                  <td>
                    {r.deaths + r.culls}
                    <span className="muted small"> ({pct(mortalityRate(r), 2)})</span>
                  </td>
                  <td>
                    <button className="link" onClick={() => go({ page: 'form', house, date: r.date })}>
                      {r.date >= editableFrom ? '修改' : '查看'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
