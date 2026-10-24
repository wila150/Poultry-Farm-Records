import { useEffect, useState } from 'react';
import { ROLE_LABEL, type User } from '../../shared/src';
import { loadMe, type WithId } from './data';
import { Export } from './pages/Export';
import { Fields } from './pages/Fields';
import { Houses } from './pages/Houses';
import { Progress } from './pages/Progress';
import { Setup } from './pages/Setup';
import { Shipments } from './pages/Shipments';
import { Users } from './pages/Users';
import { api, boot, logout, type BootStatus } from './session';

const PAGES = {
  progress: { label: '今日進度', Component: Progress },
  shipments: { label: '出貨單', Component: Shipments },
  users: { label: '人員管理', Component: Users },
  houses: { label: '雞場與雞舍', Component: Houses },
  fields: { label: '填寫項目', Component: Fields },
  export: { label: '匯出資料', Component: Export },
} as const;
type PageKey = keyof typeof PAGES;

const initialPage = (): PageKey => {
  const p = location.pathname.replace(/^\/admin\/?/, '');
  return p in PAGES ? (p as PageKey) : 'progress';
};

export function App() {
  const [status, setStatus] = useState<BootStatus | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [me, setMe] = useState<WithId<User> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<PageKey>(initialPage);

  async function start() {
    const s = await boot();
    if (s === 'redirecting') return;
    if (s === 'new') setSetupNeeded((await api<{ needed: boolean }>('GET', '/setup')).needed);
    if (s === 'active') setMe(await loadMe());
    setStatus(s);
  }

  useEffect(() => {
    start().catch((e: Error) => setError(e.message));
  }, []);

  function navigate(p: PageKey) {
    history.pushState(null, '', `/admin/${p}`);
    setPage(p);
  }
  useEffect(() => {
    const onPop = () => setPage(initialPage());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (error) return <Message title="無法開啟" body={error} />;
  if (!status) return <Message title="載入中…" />;
  if (status === 'new' && setupNeeded) {
    return <Setup onDone={() => start().catch((e: Error) => setError(e.message))} />;
  }
  if (status === 'new') return <Message title="尚未加入" body="請先在 LINE 官方帳號申請加入，場長核准後再登入後台。" />;
  if (status === 'pending') return <Message title="申請審核中" body="場長核准後即可使用。" />;
  if (status === 'disabled') return <Message title="帳號已停用" />;
  if (!me) return <Message title="載入中…" />;
  if (me.role === 'staff') return <Message title="後台僅限場長與老闆使用" body="填寫紀錄請使用 LINE 官方帳號的選單。" />;

  const { Component } = PAGES[page];
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">養雞場後台</div>
        {(Object.keys(PAGES) as PageKey[]).map((k) => (
          <button key={k} className={k === page ? 'active' : ''} onClick={() => navigate(k)}>
            {PAGES[k].label}
          </button>
        ))}
        <button onClick={() => location.assign('/')}>‹ 填寫紀錄</button>
        <div className="me">
          <span>
            {me.name}・{ROLE_LABEL[me.role]}
          </span>
          <button className="link" onClick={logout}>
            登出
          </button>
        </div>
      </nav>
      <main className="content">
        <Component me={me} />
      </main>
    </div>
  );
}

export function Message({ title, body }: { title: string; body?: string }) {
  return (
    <main className="center">
      <h1>{title}</h1>
      {body && <p className="muted">{body}</p>}
    </main>
  );
}
