import { store } from '../state/store.js';
import type { WsClient } from '../services/ws-client.js';

export function renderThreadList(wsClient: WsClient): void {
  const el = document.getElementById('thread-list')!;
  const summaries = store.state.threadSummaries;
  const activeId = store.state.activeThreadId;

  if (summaries.length === 0) {
    el.innerHTML = `<div class="empty-state"><p>暂无会话</p><p style="font-size:13px;margin-top:4px">发送消息创建新会话</p></div>`;
    return;
  }

  let html = '';
  for (const s of summaries) {
    const isActive = s.id === activeId;
    const time = formatTime(s.lastActivityAt);
    const turns = s.turnCount ? `${s.turnCount} 轮` : '';

    html += `
      <div class="thread-item${isActive ? ' active' : ''}" data-thread-id="${s.id}">
        <div class="thread-title">${escapeHtml(s.title)}</div>
        <div class="thread-meta">
          <span class="thread-cwd">${escapeHtml(s.cwd.split(/[/\\]/).pop() || s.cwd)}</span>
          <span class="thread-model">${escapeModel(s.model)}</span>
          ${turns ? `<span class="thread-turns">${turns}</span>` : ''}
          <span class="thread-time">${time}</span>
        </div>
      </div>
    `;
  }

  el.innerHTML = html;

  // Click handlers
  el.querySelectorAll('.thread-item').forEach(item => {
    item.addEventListener('click', () => {
      const threadId = (item as HTMLElement).dataset.threadId!;
      store.setActiveThread(threadId);

      // Request full thread data
      wsClient.send({ type: 'get_thread', threadId });

      // Update UI
      el.querySelectorAll('.thread-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });
}

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function escapeModel(model: string): string {
  // Map both Claude surface names AND backend model names to display
  if (model.includes('opus') || model.includes('mimo-v2.5')) return 'Opus 4.7';
  if (model.includes('sonnet') || model.includes('mimo-v2.5-pro')) return 'Sonnet 4.6';
  if (model.includes('haiku') || model.includes('mimo-v2-pro')) return 'Haiku 4.5';
  if (model.includes('deepseek')) return 'DeepSeek';
  return model.slice(0, 15);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
