import { useEffect, useState } from 'react';
import type { House, User } from '../../shared/src';
import { loadMe, type WithId } from './data';
import { Apply } from './pages/Apply';
import { History } from './pages/History';
import { RecordForm } from './pages/RecordForm';
import { ShipmentForm } from './pages/ShipmentForm';
import { Today } from './pages/Today';
import { api, boot, type BootStatus } from './session';

export type Route =
  | { page: 'today' }
  | { page: 'form'; house: WithId<House>; date: string }
  | { page: 'history'; house: WithId<House> }
  | { page: 'shipment' };

export function App() {
  const [status, setStatus] = useState<BootStatus | null>(null);
  const [me, setMe] = useState<WithId<User> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<Route>({ page: 'today' });

  useEffect(() => {
    boot()
      .then(async (s) => {
        if (s === 'redirecting') return;
        // 系統還沒有老闆帳號時，第一個使用者到後台做初始設定
        if (s === 'new' && (await api<{ needed: boolean }>('GET', '/setup')).needed) {
          location.assign('/admin/');
          return;
        }
        setStatus(s);
        if (s === 'active') {
          setMe(await loadMe());
          // 圖文選單可直接開到出貨單：https://liff.line.me/{LIFF_ID}/shipment
          if (location.pathname.startsWith('/shipment')) setRoute({ page: 'shipment' });
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // 新版瀏覽器的 scrollTo 會回傳 Promise，不能直接當成 effect 的回傳值
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  if (error) return <Message title="無法開啟" body={error} />;
  if (!status) return <Message title="載入中…" />;
  if (status === 'new') return <Apply onDone={() => setStatus('pending')} />;
  if (status === 'pending') return <Message title="申請審核中" body="場長核准後會用 LINE 通知您，就可以開始填寫了。" />;
  if (status === 'disabled') return <Message title="帳號已停用" body="如需恢復，請聯絡場長。" />;
  if (!me) return <Message title="載入中…" />;

  const go = setRoute;
  switch (route.page) {
    case 'today':
      return <Today me={me} go={go} />;
    case 'form':
      return <RecordForm me={me} house={route.house} date={route.date} go={go} />;
    case 'history':
      return <History me={me} house={route.house} go={go} />;
    case 'shipment':
      return <ShipmentForm me={me} go={go} />;
  }
}

export function Message({ title, body }: { title: string; body?: string }) {
  return (
    <main className="center">
      <h1>{title}</h1>
      {body && <p className="muted">{body}</p>}
    </main>
  );
}
