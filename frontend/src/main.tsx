import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useContextStore } from './store/context'
import { useUIStore } from './store/ui'
import { useDraftStore } from './store/draft'

// E2Eテスト用のグローバルフックを公開
if (import.meta.env.MODE === 'development') {
  (window as any).__E2E_SET_CONTEXT__ = (targetId: string, dbName: string, branchName: string) => {
    useContextStore.setState({ targetId, dbName, branchName, branchRefreshKey: 0 });
    useContextStore.getState().triggerBranchRefresh();
    useUIStore.getState().setBaseState('Idle');
    useDraftStore.getState().clearDraft();
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
