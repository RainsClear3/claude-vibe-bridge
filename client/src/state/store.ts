// Simple reactive state management

import type { Thread, Item, ItemDelta, ThreadSummary } from '@vibe-bridge/shared';

export interface PendingApproval {
  threadId: string;
  turnId: string;
  itemId: string;
  toolName: string;
  input: unknown;
}

export interface ModelInfo {
  id: string;
  label: string;
}

export interface EffortLevel {
  id: string;
  label: string;
}

export interface SkillInfo {
  id: string;
  label: string;
  description: string;
}

export type ThemeId = 'default' | 'light' | 'cyberpunk' | 'minimal' | 'forest';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  icon: string;
}

export const THEMES: ThemeInfo[] = [
  { id: 'default', label: '深海', icon: '🌊' },
  { id: 'light', label: '日光', icon: '☀️' },
  { id: 'cyberpunk', label: '赛博朋克', icon: '🤖' },
  { id: 'minimal', label: '极简', icon: '⬜' },
  { id: 'forest', label: '森林', icon: '🌿' },
];

export interface AppState {
  connected: boolean;
  threads: Map<string, Thread>;
  threadSummaries: ThreadSummary[];
  activeThreadId: string | null;
  pendingApprovals: Map<string, PendingApproval>;
  runningThreadIds: Set<string>;
  models: ModelInfo[];
  efforts: EffortLevel[];
  skills: SkillInfo[];
  selectedModel: string | null;
  selectedEffort: string | null;
  selectedSkill: string;
  currentTheme: ThemeId;
  statusFilter: 'active' | 'all' | 'archived';
  searchQuery: string;
  usageByThread: Map<string, { inputTokens: number; outputTokens: number; model?: string }>;
}

type Listener = () => void;

class Store {
  state: AppState = {
    connected: false,
    threads: new Map(),
    threadSummaries: [],
    activeThreadId: null,
    pendingApprovals: new Map(),
    runningThreadIds: new Set(),
    models: [],
    efforts: [],
    skills: [],
    selectedModel: null,
    selectedEffort: 'max',
    selectedSkill: '',
    currentTheme: (localStorage.getItem('vb-theme') as ThemeId) || 'default',
    statusFilter: 'all' as const,
    searchQuery: '',
    usageByThread: new Map(),
  };

  private listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  // --- State updates ---

  setConnected(connected: boolean): void {
    this.state.connected = connected;
    this.notify();
  }

  getActiveThread(): Thread | null {
    if (!this.state.activeThreadId) return null;
    return this.state.threads.get(this.state.activeThreadId) || null;
  }

  upsertThread(thread: Thread): void {
    this.state.threads.set(thread.id, thread);
    if (!this.state.activeThreadId) {
      this.state.activeThreadId = thread.id;
    }
    this.notify();
  }

  addTurn(threadId: string, turnId: string, userMessage: string): void {
    const thread = this.state.threads.get(threadId);
    if (!thread) return;
    thread.turns.push({
      id: turnId,
      threadId,
      userMessage,
      items: [],
      status: 'running',
      startedAt: Date.now(),
    });
    this.state.runningThreadIds.add(threadId);
    this.notify();
  }

  addItem(threadId: string, turnId: string, item: Item): void {
    const thread = this.state.threads.get(threadId);
    if (!thread) return;
    const turn = thread.turns.find(t => t.id === turnId);
    if (!turn) return;
    // Avoid duplicates
    if (turn.items.find(i => i.id === item.id)) return;
    turn.items.push(item);
    this.notify();
  }

  appendItemDelta(threadId: string, turnId: string, itemId: string, delta: ItemDelta): void {
    const thread = this.state.threads.get(threadId);
    if (!thread) return;
    const turn = thread.turns.find(t => t.id === turnId);
    if (!turn) return;
    const item = turn.items.find(i => i.id === itemId);
    if (!item) return;

    if (delta.subtype === 'text_delta') {
      item.content = (item.content || '') + delta.text;
    } else if (delta.subtype === 'thinking_delta') {
      item.content = (item.content || '') + delta.thinking;
    } else if (delta.subtype === 'input_json_delta') {
      item.content = (item.content || '') + delta.partialJson;
    }
    this.notify();
  }

  completeItem(threadId: string, turnId: string, itemId: string): void {
    const thread = this.state.threads.get(threadId);
    if (!thread) return;
    const turn = thread.turns.find(t => t.id === turnId);
    if (!turn) return;
    const item = turn.items.find(i => i.id === itemId);
    if (item) item.completedAt = Date.now();
    this.notify();
  }

  completeTurn(threadId: string, turnId: string, stopReason: string): void {
    const thread = this.state.threads.get(threadId);
    if (!thread) return;
    const turn = thread.turns.find(t => t.id === turnId);
    if (!turn) return;
    turn.status = 'completed';
    turn.stopReason = stopReason;
    turn.completedAt = Date.now();
    this.state.runningThreadIds.delete(threadId);
    this.notify();
  }

  setThreadSummaries(summaries: ThreadSummary[]): void {
    this.state.threadSummaries = summaries;
    this.notify();
  }

  setUsage(threadId: string, usage: { inputTokens: number; outputTokens: number; model?: string }): void {
    this.state.usageByThread.set(threadId, usage);
    this.notify();
  }

  setStatusFilter(filter: 'active' | 'all' | 'archived'): void {
    this.state.statusFilter = filter;
    this.notify();
  }

  setSearchQuery(query: string): void {
    this.state.searchQuery = query;
    this.notify();
  }

  addPendingApproval(approval: PendingApproval): void {
    const key = `${approval.threadId}:${approval.itemId}`;
    this.state.pendingApprovals.set(key, approval);
    this.notify();
  }

  removePendingApproval(threadId: string, itemId: string): void {
    const key = `${threadId}:${itemId}`;
    this.state.pendingApprovals.delete(key);
    this.notify();
  }

  setActiveThread(threadId: string | null): void {
    this.state.activeThreadId = threadId;
    this.notify();
  }

  setModelsList(models: ModelInfo[], efforts: EffortLevel[]): void {
    this.state.models = models;
    this.state.efforts = efforts;
    if (models.length > 0 && !this.state.selectedModel) {
      // Default to first model (usually opus/most capable)
      this.state.selectedModel = models[0].id;
    }
    this.notify();
  }

  setSelectedModel(modelId: string): void {
    this.state.selectedModel = modelId;
    this.notify();
  }

  setSelectedEffort(effortId: string): void {
    this.state.selectedEffort = effortId;
    this.notify();
  }

  setSelectedSkill(skillId: string): void {
    this.state.selectedSkill = skillId;
    this.notify();
  }

  setSkillsList(skills: SkillInfo[]): void {
    this.state.skills = skills;
    this.notify();
  }

  setTheme(themeId: ThemeId): void {
    this.state.currentTheme = themeId;
    localStorage.setItem('vb-theme', themeId);
    document.documentElement.setAttribute('data-theme', themeId === 'default' ? '' : themeId);
    // Update meta theme-color for mobile browsers
    const themeColors: Record<ThemeId, string> = {
      default: '#1a1a2e',
      light: '#ffffff',
      cyberpunk: '#0a0a0f',
      minimal: '#fafafa',
      forest: '#1a2318',
    };
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', themeColors[themeId] || themeColors.default);
    this.notify();
  }
}

export const store = new Store();
