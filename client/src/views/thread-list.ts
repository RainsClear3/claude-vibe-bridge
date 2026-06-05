import { store } from '../state/store.js';
import type { WsClient } from '../services/ws-client.js';

let activeMenuThreadId: string | null = null;

export function renderThreadList(wsClient: WsClient): void {
  const el = document.getElementById('thread-list')!;
  const summaries = store.state.threadSummaries;
  const activeId = store.state.activeThreadId;
  const searchQuery = store.state.searchQuery.toLowerCase();
  const statusFilter = store.state.statusFilter;
  const runningIds = store.state.runningThreadIds;

  let html = '';

  // Search box
  html += `<div class="thread-search">
    <input type="text" id="search-input" class="search-input" placeholder="搜索会话... (Ctrl+K)" value="${escapeHtml(store.state.searchQuery)}">
  </div>`;

  // Status filter: Active / All / Archived
  html += `<div class="thread-toolbar">
    <div class="status-filter-group">
      <button class="status-filter-btn${statusFilter === 'active' ? ' active' : ''}" data-filter="active">活跃</button>
      <button class="status-filter-btn${statusFilter === 'all' ? ' active' : ''}" data-filter="all">全部</button>
      <button class="status-filter-btn${statusFilter === 'archived' ? ' active' : ''}" data-filter="archived">归档</button>
    </div>
  </div>`;

  if (summaries.length === 0) {
    html += `<div class="empty-state"><p>暂无会话</p><p style="font-size:13px;margin-top:4px">发送消息创建新会话</p></div>`;
    el.innerHTML = html;
    bindThreadEvents(wsClient, el);
    return;
  }

  // Filter by search and status
  const filtered = summaries.filter(s => {
    if (statusFilter === 'active' && s.isArchived) return false;
    if (statusFilter === 'archived' && !s.isArchived) return false;
    if (!searchQuery) return true;
    return s.title.toLowerCase().includes(searchQuery) ||
      s.cwd.toLowerCase().includes(searchQuery);
  });

  if (filtered.length === 0) {
    html += `<div class="empty-state"><p>无匹配会话</p></div>`;
    el.innerHTML = html;
    bindThreadEvents(wsClient, el);
    return;
  }

  for (const s of filtered) {
    const isActive = s.id === activeId;
    const isRunning = runningIds.has(s.id);
    const time = formatTime(s.lastActivityAt);
    const turns = s.turnCount ? `${s.turnCount} 轮` : '';
    const cwdShort = escapeHtml(s.cwd.split(/[/\\]/).pop() || s.cwd);

    html += `
      <div class="thread-item${isActive ? ' active' : ''}${s.isPinned ? ' pinned' : ''}" data-thread-id="${s.id}" data-title="${escapeHtml(s.title)}">
        <div class="thread-title">
          <span class="idle-dot${isRunning ? ' active' : ''}"></span>
          ${s.isPinned ? '<span class="pin-icon">📌</span>' : ''}
          ${escapeHtml(s.title)}
        </div>
        <div class="thread-meta">
          <span class="thread-cwd">${cwdShort}</span>
          <span class="thread-model">${escapeModel(s.model)}</span>
          ${turns ? `<span class="thread-turns">${turns}</span>` : ''}
          <span class="thread-time">${time}</span>
        </div>
      </div>
    `;
  }

  el.innerHTML = html;
  bindThreadEvents(wsClient, el);
}

function bindThreadEvents(wsClient: WsClient, el: HTMLElement): void {
  // Search input
  const searchInput = el.querySelector('#search-input') as HTMLInputElement | null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      store.setSearchQuery(searchInput.value);
    });
  }

  // Status filter buttons
  el.querySelectorAll('.status-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = (btn as HTMLElement).dataset.filter as 'active' | 'all' | 'archived';
      store.setStatusFilter(filter);
      renderThreadList(wsClient);
    });
  });

  // Click handlers
  el.querySelectorAll('.thread-item').forEach(item => {
    item.addEventListener('click', () => {
      const threadId = (item as HTMLElement).dataset.threadId!;
      store.setActiveThread(threadId);
      wsClient.send({ type: 'get_thread', threadId });
      el.querySelectorAll('.thread-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });

    // Long press / right click for context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const threadId = (item as HTMLElement).dataset.threadId!;
      showContextMenu(threadId, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
    });

    // Mobile long press
    let longPressTimer: any;
    item.addEventListener('touchstart', () => {
      const threadId = (item as HTMLElement).dataset.threadId!;
      longPressTimer = setTimeout(() => {
        showContextMenu(threadId, -1, -1);
      }, 500);
    });
    item.addEventListener('touchend', () => clearTimeout(longPressTimer));
    item.addEventListener('touchmove', () => clearTimeout(longPressTimer));
  });

  // Close menu on outside click
  document.addEventListener('click', closeContextMenu);
}

function showContextMenu(threadId: string, x: number, y: number): void {
  closeContextMenu();
  activeMenuThreadId = threadId;

  const thread = store.state.threadSummaries.find(t => t.id === threadId);
  const isPinned = thread?.isPinned || false;

  const menu = document.createElement('div');
  menu.id = 'thread-context-menu';
  menu.className = 'thread-context-menu';
  menu.innerHTML = `
    <div class="ctx-menu-item" data-action="pin">${isPinned ? '取消收藏' : '📌 收藏'}</div>
    <div class="ctx-menu-item" data-action="rename">重命名</div>
    <div class="ctx-menu-item" data-action="archive">归档</div>
    <div class="ctx-menu-item" data-action="export">导出 JSONL</div>
    <div class="ctx-menu-item ctx-menu-danger" data-action="delete">删除</div>
  `;

  if (x >= 0 && y >= 0) {
    menu.style.position = 'fixed';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);
  } else {
    // Mobile: show as bottom sheet
    menu.style.position = 'fixed';
    menu.style.left = '16px';
    menu.style.right = '16px';
    menu.style.bottom = '80px';
    const backdrop = document.createElement('div');
    backdrop.className = 'ctx-backdrop';
    backdrop.addEventListener('click', closeContextMenu);
    document.body.appendChild(backdrop);
    document.body.appendChild(menu);
  }

  menu.querySelectorAll('.ctx-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      const action = (item as HTMLElement).dataset.action;
      handleContextAction(action!, threadId);
      closeContextMenu();
    });
  });
}

function handleContextAction(action: string, threadId: string): void {
  const ws: WsClient = (window as any).__wsClient;

  switch (action) {
    case 'pin': {
      const thread = store.state.threadSummaries.find(t => t.id === threadId);
      const isPinned = thread?.isPinned || false;
      ws.send({ type: 'pin_thread', threadId, pinned: !isPinned });
      break;
    }
    case 'rename': {
      const thread = store.state.threadSummaries.find(t => t.id === threadId);
      const currentTitle = thread?.title || '';
      const newTitle = prompt('重命名会话:', currentTitle);
      if (newTitle && newTitle !== currentTitle) {
        ws.send({ type: 'rename_thread', threadId, title: newTitle });
        const active = store.getActiveThread();
        if (active && active.id === threadId) {
          active.title = newTitle;
        }
      }
      break;
    }
    case 'archive': {
      ws.send({ type: 'archive_thread', threadId, archived: true });
      break;
    }
    case 'export': {
      ws.send({ type: 'export_thread', threadId });
      break;
    }
    case 'delete': {
      if (confirm('确定删除此会话？不可恢复。')) {
        ws.send({ type: 'delete_thread', threadId });
        // If active thread was deleted, clear it
        const active = store.getActiveThread();
        if (active && active.id === threadId) {
          store.setActiveThread(null);
        }
      }
      break;
    }
  }
}

function closeContextMenu(): void {
  const menu = document.getElementById('thread-context-menu');
  if (menu) menu.remove();
  const backdrop = document.querySelector('.ctx-backdrop');
  if (backdrop) backdrop.remove();
  activeMenuThreadId = null;
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
  const m = model.toLowerCase();
  const has1m = m.includes('[1m]') || m.includes(' 1m');
  let name: string;
  if (m.includes('opus')) name = 'Opus 4.7';
  else if (m.includes('sonnet')) name = 'Sonnet 4.6';
  else if (m.includes('haiku')) name = 'Haiku 4.5';
  else if (m.includes('deepseek')) name = 'DeepSeek';
  else name = model.slice(0, 15);
  return has1m ? `${name} 1M` : name;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
