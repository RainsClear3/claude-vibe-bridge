import { store, THEMES, type ThemeId } from '../state/store.js';
import type { WsClient } from '../services/ws-client.js';

let wsClient: WsClient | null = null;

export function initStatusBar(client: WsClient): void {
  wsClient = client;
  renderStatusBar();
}

export function renderStatusBar(): void {
  const el = document.getElementById('status-bar')!;
  const connected = store.state.connected;
  const activeThread = store.getActiveThread();
  const isRunning = activeThread && store.state.runningThreadIds.has(activeThread.id);

  let statusInfo = el.querySelector('.status-info') as HTMLElement | null;
  if (!statusInfo) {
    statusInfo = document.createElement('div');
    statusInfo.className = 'status-info';
    statusInfo.style.cssText = 'display:flex;align-items:center;gap:var(--spacing-sm);font-size:12px;color:var(--text-secondary);flex:1;';
    el.appendChild(statusInfo);
  }

  statusInfo.innerHTML = `
    <span class="status-dot ${connected ? 'connected' : ''}"></span>
    <span>${connected ? '已连接' : '连接中...'}</span>
    ${isRunning ? '<span class="running-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span> 运行中</span>' : ''}
    ${activeThread ? `<span style="flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${activeThread.model}</span>` : ''}
  `;

  // Theme switcher button
  let themeBtn = el.querySelector('.theme-btn') as HTMLButtonElement | null;
  if (!themeBtn) {
    themeBtn = document.createElement('button');
    themeBtn.className = 'theme-btn';
    themeBtn.title = '切换主题';
    el.appendChild(themeBtn);

    themeBtn.addEventListener('click', () => {
      const currentIdx = THEMES.findIndex(t => t.id === store.state.currentTheme);
      const nextIdx = (currentIdx + 1) % THEMES.length;
      store.setTheme(THEMES[nextIdx].id);
    });
  }
  const currentTheme = THEMES.find(t => t.id === store.state.currentTheme) || THEMES[0];
  themeBtn.textContent = currentTheme.icon;
  themeBtn.title = `当前: ${currentTheme.label} - 点击切换`;

  // Hard refresh button
  let refreshBtn = el.querySelector('.hard-refresh-btn') as HTMLButtonElement | null;
  if (!refreshBtn) {
    refreshBtn = document.createElement('button');
    refreshBtn.className = 'hard-refresh-btn';
    refreshBtn.title = '从磁盘重新加载所有会话';
    refreshBtn.textContent = '⟳';
    el.appendChild(refreshBtn);

    refreshBtn.addEventListener('click', async () => {
      refreshBtn!.disabled = true;
      refreshBtn!.textContent = '…';

      // 1. Tell server to reload sessions from disk
      if (wsClient) {
        wsClient.send({ type: 'reload_sessions' });
      }

      // 2. Clear browser cache / SW
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) {
          await reg.unregister();
        }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        for (const key of keys) {
          await caches.delete(key);
        }
      }

      // 3. Reload page
      window.location.reload();
    });
  }
}
