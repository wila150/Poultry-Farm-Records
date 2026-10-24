import { useEffect, useState, type FormEvent } from 'react';
import { isTopRole, type Farm, type House, type User } from '../../../shared/src';
import { loadFarms, loadHouses, type WithId } from '../data';
import { api } from '../session';

type HouseDraft = Omit<House, 'initialCount'> & { initialCount: string; id?: string };

const emptyHouse = (farmId: string): HouseDraft => ({
  farmId,
  name: '',
  breed: '',
  placementDate: '',
  initialCount: '',
  active: true,
});

export function Houses({ me }: { me: WithId<User> }) {
  const [farms, setFarms] = useState<WithId<Farm>[] | null>(null);
  const [houses, setHouses] = useState<WithId<House>[]>([]);
  const [draft, setDraft] = useState<HouseDraft | null>(null);
  const [farmDraft, setFarmDraft] = useState<(Farm & { id?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const fs = await loadFarms(me);
    setHouses(await loadHouses(fs.map((f) => f.id)));
    setFarms(fs);
    setDraft(null);
    setFarmDraft(null);
  }

  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
  }, [me]);

  return (
    <>
      <header className="page-header row">
        <h1>雞場與雞舍</h1>
        {isTopRole(me.role) && (
          <button className="secondary small" onClick={() => setFarmDraft({ name: '', location: '', weatherStationId: null })}>
            ＋ 新增雞場
          </button>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {!farms && !error && <p className="muted">載入中…</p>}

      {farmDraft && !farmDraft.id && <FarmForm draft={farmDraft} onDone={reload} onCancel={() => setFarmDraft(null)} />}

      {farms?.map((farm) => (
        <section key={farm.id} className="card">
          {farmDraft?.id === farm.id ? (
            <FarmForm draft={farmDraft} onDone={reload} onCancel={() => setFarmDraft(null)} />
          ) : (
            <h2>
              {farm.name}
              {farm.location && <span className="muted small">{farm.location}</span>}
              <button className="link" onClick={() => setFarmDraft({ ...farm })}>
                編輯
              </button>
            </h2>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>雞舍</th>
                  <th>品種</th>
                  <th>入雛日期</th>
                  <th>初始隻數</th>
                  <th>狀態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {houses
                  .filter((h) => h.farmId === farm.id)
                  .map((h) =>
                    draft?.id === h.id ? (
                      <tr key={h.id}>
                        <td colSpan={6}>
                          <HouseForm draft={draft} onDone={reload} onCancel={() => setDraft(null)} />
                        </td>
                      </tr>
                    ) : (
                      <tr key={h.id} className={h.active ? '' : 'inactive'}>
                        <td>{h.name}</td>
                        <td>{h.breed || '–'}</td>
                        <td>{h.placementDate || '–'}</td>
                        <td>{h.initialCount.toLocaleString()}</td>
                        <td>{h.active ? '啟用' : '停用'}</td>
                        <td className="actions">
                          <button className="link" onClick={() => setDraft({ ...h, initialCount: String(h.initialCount) })}>
                            編輯
                          </button>
                        </td>
                      </tr>
                    ),
                  )}
              </tbody>
            </table>
          </div>

          {draft && !draft.id && draft.farmId === farm.id ? (
            <HouseForm draft={draft} onDone={reload} onCancel={() => setDraft(null)} />
          ) : (
            <button className="link" onClick={() => setDraft(emptyHouse(farm.id))}>
              ＋ 新增雞舍
            </button>
          )}
        </section>
      ))}
    </>
  );
}

function HouseForm({ draft, onDone, onCancel }: { draft: HouseDraft; onDone: () => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...v, initialCount: Number(v.initialCount) };
      if (v.id) await api('PUT', `/houses/${v.id}`, body);
      else await api('POST', '/houses', body);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <label className="field">
        <span>名稱</span>
        <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="A棟" required />
      </label>
      <label className="field">
        <span>品種</span>
        <input value={v.breed} onChange={(e) => setV({ ...v, breed: e.target.value })} />
      </label>
      <label className="field">
        <span>入雛日期</span>
        <input type="date" value={v.placementDate} onChange={(e) => setV({ ...v, placementDate: e.target.value })} />
      </label>
      <label className="field">
        <span>初始隻數</span>
        <input inputMode="numeric" value={v.initialCount} onChange={(e) => setV({ ...v, initialCount: e.target.value })} required />
      </label>
      <label className="field checkbox">
        <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
        <span>啟用</span>
      </label>
      {error && <p className="error full">{error}</p>}
      <div className="assign-actions full">
        <button className="primary small" disabled={busy}>
          {v.id ? '儲存' : '新增'}
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}

function FarmForm({ draft, onDone, onCancel }: { draft: Farm & { id?: string }; onDone: () => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (v.id) await api('PUT', `/farms/${v.id}`, v);
      else await api('POST', '/farms', v);
      await onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="inline-form card-inner" onSubmit={submit}>
      <label className="field">
        <span>雞場名稱</span>
        <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
      </label>
      <label className="field">
        <span>地點</span>
        <input value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
      </label>
      <label className="field">
        <span>氣象站代號</span>
        <input
          value={v.weatherStationId ?? ''}
          onChange={(e) => setV({ ...v, weatherStationId: e.target.value || null })}
          placeholder="Phase 3 使用"
        />
      </label>
      {error && <p className="error full">{error}</p>}
      <div className="assign-actions full">
        <button className="primary small" disabled={busy}>
          {v.id ? '儲存' : '新增'}
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
