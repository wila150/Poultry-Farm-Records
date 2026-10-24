import { useEffect, useState } from 'react';
import type { House, Role, User } from '../../../shared/src';
import { loadHouses, loadUsers, type WithId } from '../data';
import { api } from '../session';

const ROLE_LABEL: Record<Role, string> = { owner: '老闆', manager: '場長', staff: '員工' };

export function Users({ me }: { me: WithId<User> }) {
  const [users, setUsers] = useState<WithId<User>[] | null>(null);
  const [houses, setHouses] = useState<WithId<House>[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const list = await loadUsers();
    const farmIds = [...new Set(list.flatMap((u) => u.farmIds))];
    setHouses((await loadHouses(farmIds)).filter((h) => h.active));
    setUsers(list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')));
    setEditing(null);
  }

  useEffect(() => {
    reload().catch((e: Error) => setError(e.message));
  }, []);

  const pending = users?.filter((u) => u.status === 'pending') ?? [];
  const active = users?.filter((u) => u.status === 'active') ?? [];
  const disabled = users?.filter((u) => u.status === 'disabled') ?? [];
  const houseName = (id: string) => houses.find((h) => h.id === id)?.name ?? '（已停用）';

  return (
    <>
      <header className="page-header">
        <h1>人員管理</h1>
      </header>
      {error && <p className="error">{error}</p>}
      {!users && !error && <p className="muted">載入中…</p>}

      {pending.length > 0 && (
        <section className="card highlight">
          <h2>待審核（{pending.length}）</h2>
          {pending.map((u) => (
            <AssignForm key={u.id} me={me} user={u} houses={houses} mode="approve" onDone={reload} />
          ))}
        </section>
      )}

      <section className="card">
        <h2>啟用中（{active.length}）</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>姓名</th>
                <th>LINE 名稱</th>
                <th>角色</th>
                <th>負責雞舍</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map((u) =>
                editing === u.id ? (
                  <tr key={u.id}>
                    <td colSpan={5}>
                      <AssignForm me={me} user={u} houses={houses} mode="edit" onDone={reload} onCancel={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td className="muted">{u.lineDisplayName}</td>
                    <td>{ROLE_LABEL[u.role]}</td>
                    <td>{u.role === 'staff' ? u.houseIds.map(houseName).join('、') || '–' : '全部'}</td>
                    <td className="actions">
                      {u.role === 'staff' && (
                        <button className="link" onClick={() => setEditing(u.id)}>
                          指派雞舍
                        </button>
                      )}
                      {u.id !== me.id && u.role !== 'owner' && <DisableButton user={u} onDone={reload} />}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>

      {disabled.length > 0 && (
        <section className="card">
          <h2>已停用（{disabled.length}）</h2>
          {disabled.map((u) => (
            <AssignForm key={u.id} me={me} user={u} houses={houses} mode="approve" onDone={reload} />
          ))}
        </section>
      )}
    </>
  );
}

function DisableButton({ user, onDone }: { user: WithId<User>; onDone: () => Promise<void> }) {
  async function disable() {
    if (!confirm(`確定停用 ${user.name}？停用後無法填寫，負責的雞舍也會取消指派。`)) return;
    try {
      await api('POST', `/users/${user.id}/disable`);
      await onDone();
    } catch (e) {
      alert((e as Error).message);
    }
  }
  return (
    <button className="link danger" onClick={disable}>
      停用
    </button>
  );
}

interface AssignProps {
  me: WithId<User>;
  user: WithId<User>;
  houses: WithId<House>[];
  mode: 'approve' | 'edit';
  onDone: () => Promise<void>;
  onCancel?: () => void;
}

function AssignForm({ me, user, houses, mode, onDone, onCancel }: AssignProps) {
  const [role, setRole] = useState<Role>(user.role === 'owner' ? 'manager' : user.role);
  const [selected, setSelected] = useState<Set<string>>(new Set(user.houseIds));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const farmHouses = houses.filter((h) => user.farmIds.includes(h.farmId));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const houseIds = role === 'staff' ? [...selected] : [];
      if (mode === 'approve') await api('POST', `/users/${user.id}/approve`, { role, houseIds });
      else await api('PUT', `/users/${user.id}/assignments`, { houseIds });
      await onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="assign">
      <div className="assign-head">
        <strong>{user.name}</strong>
        <span className="muted">{user.lineDisplayName}</span>
        {mode === 'approve' && (
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="staff">員工</option>
            {me.role === 'owner' && <option value="manager">場長</option>}
          </select>
        )}
      </div>
      {role === 'staff' && (
        <div className="chips">
          {farmHouses.length === 0 && <span className="muted">此雞場還沒有雞舍</span>}
          {farmHouses.map((h) => (
            <label key={h.id} className={`chip ${selected.has(h.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={selected.has(h.id)} onChange={() => toggle(h.id)} />
              {h.name}
            </label>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="assign-actions">
        <button className="primary small" disabled={busy} onClick={save}>
          {mode === 'approve' ? (user.status === 'disabled' ? '重新啟用' : '核准') : '儲存'}
        </button>
        {onCancel && (
          <button className="secondary small" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </div>
  );
}
