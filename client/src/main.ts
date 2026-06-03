// Claude Vibe Bridge PWA - Entry Point

import { WsClient } from './services/ws-client.js';
import { store } from './state/store.js';
import { initStatusBar, renderStatusBar } from './components/status-bar.js';
import { renderChatView } from './views/chat-view.js';
import { renderInputBar } from './components/input-bar.js';
import { renderThreadList } from './views/thread-list.js';
import type { ServerMessage } from '@vibe-bridge/shared';

let wsClient: WsClient | null = null;

// Setup Configuration Screen
function setupConfigScreen(): void {
  const configScreen = document.getElementById('config-screen')!;
  const serverUrlInput = document.getElementById('server-url') as HTMLInputElement;
  const saveBtn = document.getElementById('save-config-btn')!;
  const settingsBtn = document.getElementById('settings-btn')!;
  const quickSettingsBtn = document.getElementById('quick-settings-btn')!;

  // Pre-fill existing URL
  const existingUrl = WsClient.getStoredServerUrl();
  if (existingUrl) {
    serverUrlInput.value = existingUrl;
  }

  function showConfigScreen() {
    configScreen.classList.remove('hidden');
    // Pre-fill current URL
    const currentUrl = WsClient.getStoredServerUrl();
    if (currentUrl) {
      serverUrlInput.value = currentUrl;
    }
  }

  function hideConfigScreen() {
    configScreen.classList.add('hidden');
  }

  function saveAndConnect() {
    const url = serverUrlInput.value.trim();
    if (!url) {
      alert('请输入服务器地址');
      return;
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      alert('请输入有效的 URL 地址');
      return;
    }

    // Save
    WsClient.setServerUrl(url);

    // Reconnect
    hideConfigScreen();
    initApp();
  }

  // Bind events
  saveBtn.addEventListener('click', saveAndConnect);
  settingsBtn.addEventListener('click', showConfigScreen);
  quickSettingsBtn.addEventListener('click', showConfigScreen);
}

// Setup Sidebar (modified to include settings)
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

// Initialize App
function initApp(): void {
  const hasConfig = !!WsClient.getStoredServerUrl();
  const configScreen = document.getElementById('config-screen')!;

  // Detect if running inside Android Capacitor (needs manual server URL)
  const isCapacitor = !!(window as any).Capacitor;

  // Auto-configure: browser users (any domain) use current origin directly
  if (!isCapacitor && !hasConfig) {
    WsClient.setServerUrl(location.origin);
  }

  // Only show config screen if no config AND in Capacitor (Android App)
  if (!WsClient.getStoredServerUrl() && isCapacitor) {
    configScreen.classList.remove('hidden');
    return;
  }

  // Hide config screen
  configScreen.classList.add('hidden');

  // Create new client with saved config
  if (wsClient) {
    wsClient.disconnect();
  }
  wsClient = new WsClient();

  // Setup message handlers
  wsClient.onMessage((msg: ServerMessage) => {
    switch (msg.type) {
      case 'connected':
        store.setConnected(true);
        wsClient!.send({ type: 'list_threads' });
        wsClient!.send({ type: 'list_models' });
        wsClient!.send({ type: 'list_skills' });
        break;

      case 'thread_created':
        store.upsertThread(msg.thread);
        wsClient!.send({ type: 'list_threads' });
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
        wsClient!.send({ type: 'list_threads' });
        break;

      case 'threads_list':
        store.setThreadSummaries(msg.threads);
        renderThreadList(wsClient!);
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
        renderInputBar(wsClient!);
        break;

      case 'skills_list':
        store.setSkillsList(msg.skills);
        renderInputBar(wsClient!);
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

  // Apply saved theme
  const savedTheme = localStorage.getItem('vb-theme') || 'default';
  store.setTheme(savedTheme as any);

  // Initial render
  initStatusBar(wsClient);
  renderChatView();
  renderInputBar(wsClient);
  setupSidebar();

  // Connect
  wsClient.connect();

  // Reconnect on visibility change
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && wsClient && !wsClient.connected) {
      wsClient.connect();
    }
  });

  // Expose for components
  (window as any).__wsClient = wsClient;
  (window as any).__store = store;
}

// Initialize everything
setupConfigScreen();
initApp();

// Service worker with auto-update
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const checkUpdate = () => reg.update().catch(() => {});
    setInterval(checkUpdate, 30_000);
    if (reg.waiting) {
      reg.waiting.postMessage({ type: 'skipWaiting' });
    }
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: 'skipWaiting' });
          window.location.reload();
        }
      });
    });
  }).catch(() => {});
}

