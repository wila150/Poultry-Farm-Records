import { useState, type FormEvent } from 'react';
import { api } from '../session';

export function Setup({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [farmName, setFarmName] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/setup', { name, farmName, location });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="center narrow">
      <h1>初始設定</h1>
      <p className="muted">系統還沒有任何帳號。完成設定後，您會成為老闆帳號，並建立第一個雞場。</p>
      <form onSubmit={submit} className="card stack left">
        <label className="field">
          <span>您的姓名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} required />
        </label>
        <label className="field">
          <span>雞場名稱</span>
          <input value={farmName} onChange={(e) => setFarmName(e.target.value)} placeholder="例如：瑞冠蛋場" required />
        </label>
        <label className="field">
          <span>地點（選填）</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? '設定中…' : '完成設定'}
        </button>
      </form>
    </main>
  );
}
