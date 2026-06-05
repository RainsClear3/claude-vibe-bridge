import { store, THEMES } from '../state/store.js';
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
  const usage = store.state.activeThreadId ? store.state.usageByThread.get(store.state.activeThreadId) || null : null;

  let statusInfo = el.querySelector('.status-info') as HTMLElement | null;
  if (!statusInfo) {
    statusInfo = document.createElement('div');
    statusInfo.className = 'status-info';
    statusInfo.style.cssText = 'display:flex;align-items:center;gap:var(--spacing-sm);font-size:12px;color:var(--text-secondary);flex:1;';
    el.appendChild(statusInfo);
  }

  // Permission mode display
  const permMode = activeThread?.permissionMode;
  const permLabel = permMode === 'bypassPermissions' ? 'Bypass' :
    permMode === 'acceptEdits' ? 'Accept' :
    permMode === 'plan' ? 'Plan' :
    permMode === 'default' ? 'Ask' : '';

  // Calculate usage — show always, show estimate if no data yet
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const totalTokens = inputTokens + outputTokens;
  // Determine context window size from model (supports 1M variants)
  const modelForUsage = usage?.model || activeThread?.model || '';
  const maxContext = getContextWindow(modelForUsage);
  const percent = totalTokens > 0 ? Math.round((totalTokens / maxContext) * 100) : 0;
  const usageLabel = totalTokens > 0 ? `${formatTokens(totalTokens)} (${percent}%)` : '无用量数据';

  statusInfo.innerHTML = `
    <span class="status-dot ${connected ? 'connected' : ''}"></span>
    <span>${connected ? '已连接' : '连接中...'}</span>
    ${isRunning ? '<span class="running-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span> 运行中</span>' : ''}
    ${permLabel ? `<span class="perm-badge" title="权限模式: ${permMode}">${permLabel}</span>` : ''}
    <button class="usage-btn" id="usage-toggle" title="上下文用量">⚡ ${usageLabel}</button>
  `;

  // Usage toggle click
  const usageBtn = statusInfo.querySelector('#usage-toggle');
  if (usageBtn) {
    usageBtn.addEventListener('click', () => {
      if (totalTokens > 0) {
        showUsagePopup(usage!);
      }
    });
  }

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

      if (wsClient) {
        wsClient.send({ type: 'reload_sessions' });
      }

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

      window.location.reload();
    });
  }
}

function showUsagePopup(usage: { inputTokens: number; outputTokens: number; model?: string }): void {
  const existing = document.getElementById('usage-popup');
  if (existing) { existing.remove(); return; }

  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const total = input + output;
  const maxContext = getContextWindow(usage.model || '');
  const percent = Math.round((total / maxContext) * 100);
  const freeSpace = Math.max(0, maxContext - total);
  const freePercent = Math.round((freeSpace / maxContext) * 100);

  const popup = document.createElement('div');
  popup.id = 'usage-popup';
  popup.className = 'usage-popup';
  popup.innerHTML = `
    <div class="usage-popup-header">
      <span class="usage-popup-title">Context window</span>
      <span class="usage-popup-summary">${formatTokens(total)} / ${formatTokens(maxContext)} (${percent}%)</span>
    </div>
    <div class="usage-bar-wrap">
      <div class="usage-bar" style="width: ${Math.min(percent, 100)}%"></div>
    </div>
    <div class="usage-rows">
      <div class="usage-row">
        <span class="usage-row-dot" style="background:var(--accent)"></span>
        <span class="usage-row-label">Input</span>
        <span class="usage-row-tokens">${formatTokens(input)}</span>
        <span class="usage-row-pct">${Math.round((input / maxContext) * 100)}%</span>
      </div>
      <div class="usage-row">
        <span class="usage-row-dot" style="background:var(--success,#4caf50)"></span>
        <span class="usage-row-label">Output</span>
        <span class="usage-row-tokens">${formatTokens(output)}</span>
        <span class="usage-row-pct">${Math.round((output / maxContext) * 100)}%</span>
      </div>
      <div class="usage-row">
        <span class="usage-row-dot" style="background:transparent;border:1px solid var(--text-muted)"></span>
        <span class="usage-row-label">Free space</span>
        <span class="usage-row-tokens">${formatTokens(freeSpace)}</span>
        <span class="usage-row-pct">${freePercent}%</span>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  setTimeout(() => {
    document.addEventListener('click', function closeUsage(e) {
      if (!popup.contains(e.target as Node)) {
        popup.remove();
        document.removeEventListener('click', closeUsage);
      }
    });
  }, 100);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// 显示用的模型名映射（服务端已归一化 model，这里只做 opus/sonnet/haiku → 显示名）
function displayModel(model: string): string {
  const m = model.toLowerCase();
  const has1m = m.includes('[1m]') || m.includes(' 1m');
  let name = 'Unknown';
  if (m.includes('opus')) name = 'Opus 4.7';
  else if (m.includes('sonnet')) name = 'Sonnet 4.6';
  else if (m.includes('haiku')) name = 'Haiku 4.5';
  else name = model.slice(0, 12);
  return has1m ? `${name} 1M` : name;
}

/** Get context window size for a given model string */
function getContextWindow(model: string): number {
  const m = model.toLowerCase();
  if (m.includes('[1m]') || m.includes('1m')) return 1_000_000;
  return 200_000;
}
