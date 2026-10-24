import { useEffect, useState } from 'react';
import { addDays, layingRate, taipeiDate, type DailyRecord, type House, type User } from '../../../shared/src';
import type { Route } from '../App';
import { loadMyHouses, loadRecord, type WithId } from '../data';

interface Row {
  house: WithId<House>;
  today: DailyRecord | null;
  yesterday: DailyRecord | null;
}

export function Today({ me, go }: { me: WithId<User>; go: (r: Route) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = taipeiDate();
  const yesterday = addDays(today, -1);

  useEffect(() => {
    (async () => {
      const houses = await loadMyHouses(me);
      const loaded = await Promise.all(
        houses.map(async (house) => ({
          house,
          today: await loadRecord(house.id, today),
          yesterday: await loadRecord(house.id, yesterday),
        })),
      );
      setRows(loaded);
    })().catch((e: Error) => setError(e.message));
  }, [me, today, yesterday]);

  const done = rows?.filter((r) => r.today).length ?? 0;

  return (
    <main>
      <header className="page-header">
        <h1>今日總覽</h1>
        <p className="muted">
          {today}・{me.name}
        </p>
      </header>

      {error && <p className="error">{error}</p>}
      {!rows && !error && <p className="muted">載入中…</p>}
      {rows?.length === 0 && <p className="card muted">目前沒有指派給您的雞舍，請聯絡場長。</p>}

      {rows && rows.length > 0 && (
        <p className="progress">
          已填寫 <strong>{done}</strong> / {rows.length} 棟
        </p>
      )}

      <ul className="house-list">
        {rows?.map(({ house, today: rec, yesterday: prev }) => {
          const rate = rec ? layingRate(rec) : null;
          return (
            <li key={house.id} className="card">
              <button className="house-main" onClick={() => go({ page: 'form', house, date: today })}>
                <span className="house-name">{house.name}</span>
                {rec ? (
                  <span className="badge ok">已填{rate !== null && `・產蛋率 ${rate.toFixed(1)}%`}</span>
                ) : (
                  <span className="badge todo">未填寫</span>
                )}
              </button>
              <div className="house-actions">
                {!prev && (
                  <button className="link" onClick={() => go({ page: 'form', house, date: yesterday })}>
                    補填昨天
                  </button>
                )}
                <button className="link" onClick={() => go({ page: 'history', house })}>
                  歷史紀錄
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
