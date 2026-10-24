import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../session';

export function Apply({ onDone }: { onDone: () => void }) {
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('');
  const [farmId, setFarmId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ id: string; name: string }[]>('GET', '/farms/public')
      .then((list) => {
        setFarms(list);
        if (list.length === 1) setFarmId(list[0].id);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/applications', { name, farmId });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>申請加入</h1>
      <p className="muted">第一次使用請填寫資料，場長核准後就能開始填寫生產紀錄。</p>
      <form onSubmit={submit} className="card stack">
        <label className="field">
          <span>姓名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required />
        </label>
        <label className="field">
          <span>雞場</span>
          <select value={farmId} onChange={(e) => setFarmId(e.target.value)} required>
            <option value="">請選擇</option>
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || !name.trim() || !farmId}>
          {busy ? '送出中…' : '送出申請'}
        </button>
      </form>
    </main>
  );
}
