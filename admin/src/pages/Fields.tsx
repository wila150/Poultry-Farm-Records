import { useEffect, useState } from 'react';
import { FIELD_GROUPS, type CustomField, type CustomFieldType, type Farm, type User } from '../../../shared/src';
import { loadFarms, type WithId } from '../data';
import { api } from '../session';

type Draft = Omit<CustomField, 'key'> & { key?: string };

const TYPE_LABEL: Record<CustomFieldType, string> = { number: '數字（可小數）', integer: '整數', text: '文字' };

// 內建項目只列出來讓使用者知道，不可修改
const BUILT_IN = [
  ['雞隻', '在養隻數、死亡數、淘汰數'],
  ['產蛋', '總蛋數、破蛋／軟殼、平均蛋重'],
  ['飼養', '飼料量、飲水量'],
  ['環境', '最高溫、最低溫、濕度'],
] as const;

const blank = (): Draft => ({ label: '', unit: '', type: 'number', group: '其他', required: false, active: true });

export function Fields({ me }: { me: WithId<User> }) {
  const [farms, setFarms] = useState<WithId<Farm>[] | null>(null);
  const [farmId, setFarmId] = useState('');
  const [fields, setFields] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function reload(selected?: string) {
    const fs = await loadFarms(me);
    setFarms(fs);
    const id = selected || farmId || fs[0]?.id || '';
    setFarmId(id);
    setFields(fs.find((f) => f.id === id)?.customFields ?? []);
    setDirty(false);
  }
  useEffect(() => {
    reload().catch((e: Error) => setMsg({ ok: false, text: e.message }));
  }, [me]);

  function update(i: number, patch: Partial<Draft>) {
    setFields(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
    setDirty(true);
    setMsg(null);
  }
  function move(i: number, d: -1 | 1) {
    const next = [...fields];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setFields(next);
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      // 還沒存過的新項目若被停用，直接丟掉
      const payload = fields.filter((f) => f.key || f.active);
      await api('PUT', `/farms/${farmId}/custom-fields`, { fields: payload });
      await reload(farmId);
      setMsg({ ok: true, text: '已儲存，LINE 填寫表單會立即套用' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!farms) return <p className="muted">載入中…</p>;

  return (
    <>
      <header className="page-header row">
        <h1>填寫項目</h1>
        <div className="row-actions">
          {farms.length > 1 && (
            <select value={farmId} onChange={(e) => reload(e.target.value)} disabled={dirty}>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          <button className="primary small" disabled={!dirty || busy} onClick={save}>
            {busy ? '儲存中…' : '儲存變更'}
          </button>
        </div>
      </header>
      {msg && <p className={msg.ok ? 'notice ok' : 'error'}>{msg.text}</p>}

      <section className="card">
        <h2>自訂項目</h2>
        <p className="muted small">
          新增的項目會出現在 LINE 填寫表單對應的分組裡。停用只是不再顯示，已填的資料會保留；改名稱不影響舊資料。
        </p>
        {fields.length === 0 && <p className="muted">還沒有自訂項目</p>}
        {fields.length > 0 && (
          <div className="table-wrap">
            <table className="items">
              <thead>
                <tr>
                  <th>順序</th>
                  <th>名稱</th>
                  <th>單位</th>
                  <th>類型</th>
                  <th>分組</th>
                  <th>必填</th>
                  <th>啟用</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={f.key ?? `new-${i}`} className={f.active ? '' : 'inactive'}>
                    <td className="order">
                      <button className="link" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上移">
                        ▲
                      </button>
                      <button className="link" disabled={i === fields.length - 1} onClick={() => move(i, 1)} aria-label="下移">
                        ▼
                      </button>
                    </td>
                    <td>
                      <input value={f.label} maxLength={20} placeholder="例如：光照時數" onChange={(e) => update(i, { label: e.target.value })} />
                    </td>
                    <td>
                      <input value={f.unit} maxLength={10} placeholder="小時" onChange={(e) => update(i, { unit: e.target.value })} />
                    </td>
                    <td>
                      <select value={f.type} onChange={(e) => update(i, { type: e.target.value as CustomFieldType })}>
                        {Object.entries(TYPE_LABEL).map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={f.group} onChange={(e) => update(i, { group: e.target.value as Draft['group'] })}>
                        {FIELD_GROUPS.map((g) => (
                          <option key={g}>{g}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} />
                    </td>
                    <td>
                      <input type="checkbox" checked={f.active} onChange={(e) => update(i, { active: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          className="link"
          onClick={() => {
            setFields([...fields, blank()]);
            setDirty(true);
          }}
        >
          ＋ 新增項目
        </button>
      </section>

      <section className="card">
        <h2>內建項目</h2>
        <p className="muted small">以下項目是產蛋率、死淘率、出貨單蛋重換算和異常警報的依據，固定顯示。</p>
        <table>
          <tbody>
            {BUILT_IN.map(([g, list]) => (
              <tr key={g}>
                <td>{g}</td>
                <td className="muted">{list}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
