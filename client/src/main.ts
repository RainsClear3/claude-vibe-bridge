// Claude Vibe Bridge PWA - Entry Point

import { WsClient } from './services/ws-client.js';
import { store } from './state/store.js';
import { initStatusBar, renderStatusBar } from './components/status-bar.js';
import { renderChatView } from './views/chat-view.js';
import { renderInputBar } from './components/input-bar.js';
import { renderThreadList } from './views/thread-list.js';
import type { ServerMessage } from '@vibe-bridge/shared';

const wsClient = new WsClient();

// Handle server messages
wsClient.onMessage((msg: ServerMessage) => {
  switch (msg.type) {
    case 'connected':
      store.setConnected(true);
      wsClient.send({ type: 'list_threads' });
      wsClient.send({ type: 'list_models' });
      wsClient.send({ type: 'list_skills' });
      break;

    case 'thread_created':
      store.upsertThread(msg.thread);
      wsClient.send({ type: 'list_threads' });
      break;

    case 'turn_started':
      store.addTurn(msg.threadId, msg.turnId, msg.userMessage);
      break;

    case 'item_created':
      store.addItem(msg.threadId, msg.turnId, msg.item);
      break;

    case 'item_delta':
      store.appendItemDelta(msg.threadId, msg.turnId, msg.itemId, msg.delta);
      break;

    case 'item_completed':
      store.completeItem(msg.threadId, msg.turnId, msg.itemId);
      break;

    case 'turn_completed':
      store.completeTurn(msg.threadId, msg.turnId, msg.stopReason);
      wsClient.send({ type: 'list_threads' });
      break;

    case 'threads_list':
      store.setThreadSummaries(msg.threads);
      renderThreadList(wsClient);
      break;

    case 'thread_detail':
      store.upsertThread(msg.thread);
      renderChatView();
      break;

    case 'tool_approval_required':
      store.addPendingApproval({
        threadId: msg.threadId,
        turnId: msg.turnId,
        itemId: msg.itemId,
        toolName: msg.toolName,
        input: msg.input,
      });
      break;

    case 'models_list':
      store.setModelsList(msg.models, msg.efforts);
      renderInputBar(wsClient);
      break;

    case 'skills_list':
      store.setSkillsList(msg.skills);
      renderInputBar(wsClient);
      break;

    case 'error':
      console.error('[Server Error]', msg.message);
      break;
  }
});

// Re-render status on state changes
store.subscribe(() => {
  renderStatusBar();
});

// Sidebar toggle
function setupSidebar(): void {
  const sidebar = document.getElementById('sidebar')!;
  const toggle = document.getElementById('sidebar-toggle')!;
  const newBtn = document.getElementById('new-session-btn')!;
  let backdrop: HTMLElement | null = null;

  function openSidebar() {
    sidebar.classList.add('open');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'sidebar-backdrop';
      document.body.appendChild(backdrop);
      backdrop.addEventListener('click', closeSidebar);
    }
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
  }

  toggle.addEventListener('click', () => {
    if (sidebar.classList.contains('open')) closeSidebar();
    else openSidebar();
  });

  newBtn.addEventListener('click', () => {
    store.setActiveThread(null);
    renderChatView();
    closeSidebar();
  });
}

// Apply saved theme on startup
const savedTheme = localStorage.getItem('vb-theme') || 'default';
store.setTheme(savedTheme as any);

// Initial render
initStatusBar(wsClient);
renderChatView();
renderInputBar(wsClient);
setupSidebar();

// Connect
wsClient.connect();

// Service worker with auto-update
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    // Check for SW updates every 30 seconds
    const checkUpdate = () => reg.update().catch(() => {});
    setInterval(checkUpdate, 30_000);
    // If a new SW is waiting, activate it immediately
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'skipWaiting' });
    }
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // New SW installed but not yet active — force activate
          newWorker.postMessage({ type: 'skipWaiting' });
          window.location.reload();
        }
      });
    });
  }).catch(() => {});
}

// Reconnect on visibility change
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !wsClient.connected) {
    wsClient.connect();
  }
});

// Expose for components
(window as any).__wsClient = wsClient;
(window as any).__store = store;
