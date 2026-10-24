import { useEffect, useMemo, useState } from 'react';
import { addDays, layingRate, taipeiDate, type DailyRecord, type House, type User } from '../../../shared/src';
import type { Route } from '../App';
import { loadMyHouses, watchDraft, watchRecord, type CloudDraft, type WithId } from '../data';
import { openAdmin } from '../session';

interface Row {
  house: WithId<House>;
  today: DailyRecord | null;
  yesterday: DailyRecord | null;
  draft: CloudDraft | null;
}

type Live<T> = Record<string, T | null>;

export function Today({ me, go }: { me: WithId<User>; go: (r: Route) => void }) {
  const [houses, setHouses] = useState<WithId<House>[] | null>(null);
  const [todays, setTodays] = useState<Live<DailyRecord>>({});
  const [yesterdays, setYesterdays] = useState<Live<DailyRecord>>({});
  const [drafts, setDrafts] = useState<Live<CloudDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const today = taipeiDate();
  const yesterday = addDays(today, -1);

  useEffect(() => {
    loadMyHouses(me)
      .then(setHouses)
      .catch((e: Error) => setError(e.message));
  }, [me]);

  // 每棟監聽今天、昨天的紀錄和今天的草稿，別人送出或正在填時自動更新
  useEffect(() => {
    if (!houses) return;
    const offs = houses.flatMap((h) => [
      watchRecord(h.id, today, (r) => setTodays((m) => ({ ...m, [h.id]: r }))),
      watchRecord(h.id, yesterday, (r) => setYesterdays((m) => ({ ...m, [h.id]: r }))),
      watchDraft(h.id, today, (d) => setDrafts((m) => ({ ...m, [h.id]: d }))),
    ]);
    return () => offs.forEach((off) => off());
  }, [houses, today, yesterday]);

  const rows = useMemo<Row[] | null>(() => {
    if (!houses) return null;
    // 等每棟的今天紀錄都回來再顯示，避免先閃「未填寫」
    if (houses.some((h) => !(h.id in todays))) return null;
    return houses.map((house) => ({
      house,
      today: todays[house.id] ?? null,
      yesterday: yesterdays[house.id] ?? null,
      draft: todays[house.id] ? null : (drafts[house.id] ?? null),
    }));
  }, [houses, todays, yesterdays, drafts]);

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
      {houses?.length === 0 && <p className="card muted">目前沒有指派給您的雞舍，請聯絡場長。</p>}

      {rows && rows.length > 0 && (
        <p className="progress">
          已填寫 <strong>{done}</strong> / {rows.length} 棟
        </p>
      )}

      <ul className="house-list">
        {rows?.map(({ house, today: rec, yesterday: prev, draft }) => {
          const rate = rec ? layingRate(rec) : null;
          return (
            <li key={house.id} className="card">
              <button className="house-main" onClick={() => go({ page: 'form', house, date: today })}>
                <span className="house-name">{house.name}</span>
                {rec ? (
                  <span className="badge ok">已填{rate !== null && `・產蛋率 ${rate.toFixed(1)}%`}</span>
                ) : draft ? (
                  <span className="badge draft">填寫中{draft.updatedByName && `・${draft.updatedByName}`}</span>
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

      <div className="stack">
        <button className="secondary" onClick={() => go({ page: 'shipment' })}>
          開出貨單
        </button>
        {me.role !== 'staff' && (
          <button className="secondary" onClick={openAdmin}>
            後台管理（進度・人員・出貨單）
          </button>
        )}
      </div>
    </main>
  );
}
