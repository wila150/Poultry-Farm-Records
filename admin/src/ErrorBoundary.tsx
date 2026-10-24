import { Component, type ReactNode } from 'react';

/** 畫面出錯時顯示錯誤內容，而不是一片空白 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="center">
        <h1>畫面發生錯誤</h1>
        <p className="muted">請截圖給系統管理員，再按重新載入。</p>
        <pre className="card error-detail">{`${error.message}\n${error.stack?.split('\n').slice(0, 4).join('\n') ?? ''}`}</pre>
        <button className="primary" onClick={() => location.reload()}>
          重新載入
        </button>
      </main>
    );
  }
}
