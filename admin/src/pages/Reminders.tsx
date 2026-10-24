import { useEffect, useState } from 'react';
import { REMINDER_SLOTS, reminderSettingsOf, type Farm, type User } from '../../../shared/src';
import { loadFarms, type WithId } from '../data';
import { api } from '../session';

export function Reminders({ me }: { me: WithId<User> }) {
  const [farms, setFarms] = useState<WithId<Farm>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setFarms(await loadFarms(me));
  }
  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
  }, [me]);

  return (
    <>
      <header className="page-header">
        <h1>提醒設定</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!farms && !error && <p className="muted">載入中…</p>}
      {farms?.map((f) => (
        <FarmReminders key={f.id} farm={f} onSaved={reload} />
      ))}
      <section className="card">
        <h2>推播額度</h2>
        <p className="muted small">
          LINE 免費方案每月 200 則，按「人數 × 則數」計算。提醒只會發給還有雞舍沒填的人，全部填完就不會發。
          提醒時間設得越多、越早，用掉的則數越多。
        </p>
      </section>
    </>
  );
}

function FarmReminders({ farm, onSaved }: { farm: WithId<Farm>; onSaved: () => Promise<void> }) {
  const initial = reminderSettingsOf(farm);
  const [staffTimes, setStaffTimes] = useState<string[]>(initial.staffTimes);
  const [managerTime, setManagerTime] = useState<string | null>(initial.managerTime);
  const [adding, setAdding] = useState('10:30');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = staffTimes.join() !== initial.staffTimes.join() || managerTime !== initial.managerTime;

  function add() {
    if (staffTimes.includes(adding)) return;
    setStaffTimes([...staffTimes, adding].sort());
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api('PUT', `/farms/${farm.id}/reminder-settings`, { staffTimes, managerTime });
      await onSaved();
      setMsg({ ok: true, text: '已儲存，下一個時段開始生效' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>{farm.name}</h2>

      <div className="reminder-row">
        <div>
          <strong>提醒員工填寫</strong>
          <p className="muted small">時間到時，推播給負責「還沒填」雞舍的員工。</p>
        </div>
        <div className="chips">
          {staffTimes.length === 0 && <span className="muted">不提醒</span>}
          {staffTimes.map((t) => (
            <span key={t} className="chip on">
              {t}
              <button className="chip-x" aria-label={`移除 ${t}`} onClick={() => setStaffTimes(staffTimes.filter((x) => x !== t))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="row-actions">
          <select value={adding} onChange={(e) => setAdding(e.target.value)}>
            {REMINDER_SLOTS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <button className="secondary small" disabled={staffTimes.length >= 4 || staffTimes.includes(adding)} onClick={add}>
            ＋ 加入
          </button>
        </div>
      </div>

      <div className="reminder-row">
        <div>
          <strong>通知場長</strong>
          <p className="muted small">時間到時如果還有雞舍沒填，通知場長（沒有場長時通知老闆）。</p>
        </div>
        <select value={managerTime ?? ''} onChange={(e) => setManagerTime(e.target.value || null)}>
          <option value="">不通知</option>
          {REMINDER_SLOTS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      {msg && <p className={msg.ok ? 'notice ok' : 'error'}>{msg.text}</p>}
      <button className="primary small" disabled={!dirty || busy} onClick={save}>
        {busy ? '儲存中…' : '儲存'}
      </button>
    </section>
  );
}
