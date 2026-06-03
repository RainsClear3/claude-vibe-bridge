import { v4 as uuid } from 'uuid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import type { Thread, Turn, Item, ThreadSummary } from '@vibe-bridge/shared';
import { broadcast } from '../ws/broadcast.js';
import { config } from '../config.js';

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

interface ClaudeSessionMeta {
  sessionId: string;
  cliSessionId: string;
  cwd: string;
  originCwd?: string;
  createdAt: number;
  lastActivityAt: number;
  lastFocusedAt?: number;
  model: string;
  effort?: string;
  title: string;
  titleSource?: string;
  completedTurns?: number;
  isArchived?: boolean;
}

const CLAUDE_SESSIONS_DIR = path.join(
  process.env.LOCALAPPDATA!,
  'Claude-3p', 'claude-code-sessions',
  config.claudeDesktopUserId,
  config.claudeDesktopAppId
);

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

function extractTextFromContent(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text' && b.text)
      .map((b: any) => b.text)
      .join('\n');
  }
  return '';
}

function extractBlocksFromContent(content: any): any[] {
  if (!content || !Array.isArray(content)) return [];
  return content.filter((b: any) => {
    if (b.type === 'text' && b.text) return true;
    if (b.type === 'thinking' && b.thinking) return true;
    if (b.type === 'tool_use' && b.name) return true;
    if (b.type === 'tool_result') return true;
    return false;
  });
}

function hasTextContent(content: any): boolean {
  if (!content) return false;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    return content.some((b: any) => b.type === 'text' && b.text && b.text.trim().length > 0);
  }
  return false;
}

function encodeCwdToProjectDir(cwd: string): string {
  return cwd.replace(/[:\\\/\s]/g, '-').replace(/-+/g, '-');
}

function findJsonlForSession(meta: ClaudeSessionMeta): string | null {
  const encodedPath = encodeCwdToProjectDir(meta.cwd);
  const directPath = path.join(CLAUDE_PROJECTS_DIR, encodedPath, `${meta.cliSessionId}.jsonl`);
  if (fsSync.existsSync(directPath)) return directPath;

  try {
    const dirs = fsSync.readdirSync(CLAUDE_PROJECTS_DIR);
    for (const dir of dirs) {
      const candidate = path.join(CLAUDE_PROJECTS_DIR, dir, `${meta.cliSessionId}.jsonl`);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  } catch {}

  return null;
}

function parseJsonlToThread(meta: ClaudeSessionMeta, jsonlPath: string): Thread {
  const raw = fsSync.readFileSync(jsonlPath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());

  const thread: Thread = {
    id: meta.sessionId,
    title: meta.title || '(untitled)',
    cwd: meta.cwd || process.env.USERPROFILE || 'C:\\',
    model: meta.model || 'unknown',
    createdAt: meta.createdAt,
    lastActivityAt: meta.lastActivityAt || meta.createdAt,
    turns: [],
  };

  (thread as any)._cliSessionId = meta.cliSessionId;
  (thread as any)._completedTurns = meta.completedTurns || 0;

  let currentTurn: Turn | null = null;

  for (const line of lines) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }

    if (msg.type === 'user') {
      const content = msg.message?.content;
      const text = extractTextFromContent(content);
      if (text && /^<(summary|local-command|command-name|task-notification|task-updated)|^\[Request interrupted/.test(text.trim())) {
        continue;
      }
      const hasText = hasTextContent(content);

      if (hasText) {
        currentTurn = {
          id: uuid(),
          threadId: thread.id,
          userMessage: extractTextFromContent(content),
          items: [],
          status: 'completed',
          startedAt: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        };
        thread.turns.push(currentTurn);
      }

      if (currentTurn && Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const resultText = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
            currentTurn.items.push({
              id: uuid(),
              turnId: currentTurn.id,
              type: 'tool_result',
              toolResultContent: resultText,
              toolResultIsError: block.is_error || false,
              createdAt: currentTurn.startedAt,
              completedAt: currentTurn.startedAt,
            });
          }
        }
      }

    } else if (msg.type === 'assistant' && currentTurn) {
      const blocks = extractBlocksFromContent(msg.message?.content);
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          currentTurn.items.push({
            id: uuid(),
            turnId: currentTurn.id,
            type: 'text',
            content: block.text,
            createdAt: currentTurn.startedAt,
            completedAt: currentTurn.startedAt,
          });
        } else if (block.type === 'thinking' && block.thinking) {
          currentTurn.items.push({
            id: uuid(),
            turnId: currentTurn.id,
            type: 'thinking',
            content: block.thinking,
            createdAt: currentTurn.startedAt,
            completedAt: currentTurn.startedAt,
          });
        } else if (block.type === 'tool_use') {
          currentTurn.items.push({
            id: block.id || uuid(),
            turnId: currentTurn.id,
            type: 'tool_use',
            toolName: block.name,
            toolInput: block.input || {},
            content: '',
            createdAt: currentTurn.startedAt,
            completedAt: currentTurn.startedAt,
          });
        }
      }

    } else if (msg.type === 'result' && currentTurn) {
      if (msg.is_error) {
        currentTurn.status = 'error';
      }
      currentTurn.stopReason = msg.stop_reason || 'end_turn';
      currentTurn.completedAt = msg.timestamp
        ? new Date(msg.timestamp).getTime()
        : Date.now();
      if (msg.duration_ms) {
        currentTurn.completedAt = (currentTurn.startedAt || Date.now()) + msg.duration_ms;
      }
    }
  }

  return thread;
}

export class SessionManager {
  private threads = new Map<string, Thread>();
  private threadMeta = new Map<string, ClaudeSessionMeta>();
  private historyLoaded = new Set<string>();
  private abortControllers = new Map<string, AbortController>();
  private pendingApprovals = new Map<string, PendingApproval>();
  constructor() {}

  async load(): Promise<void> {
    try {
      const files = await fs.readdir(CLAUDE_SESSIONS_DIR);
      const sessionFiles = files.filter(f => f.startsWith('local_') && f.endsWith('.json'));

      let loaded = 0;
      for (const file of sessionFiles) {
        try {
          const content = await fs.readFile(path.join(CLAUDE_SESSIONS_DIR, file), 'utf-8');
          const meta: ClaudeSessionMeta = JSON.parse(content);

          if (meta.isArchived) continue;

          const thread: Thread = {
            id: meta.sessionId,
            title: meta.title || '(untitled)',
            cwd: meta.cwd || process.env.USERPROFILE || 'C:\\',
            model: meta.model || 'unknown',
            createdAt: meta.createdAt,
            lastActivityAt: meta.lastActivityAt || meta.createdAt,
            turns: [],
          };

          (thread as any)._cliSessionId = meta.cliSessionId;
          (thread as any)._completedTurns = meta.completedTurns || 0;

          this.threads.set(thread.id, thread);
          this.threadMeta.set(thread.id, meta);
          loaded++;
        } catch {}
      }

      console.log(`[Session] Loaded ${loaded} existing Claude Desktop sessions (${sessionFiles.length} total files)`);
    } catch (err: any) {
      console.log(`[Session] No existing sessions found (${err.message})`);
    }
  }

  async reloadSessions(): Promise<number> {
    // Preserve threads that have in-memory data (turns loaded, running tasks)
    const hadTurns = new Set<string>();
    for (const [id, thread] of this.threads) {
      if (thread.turns.length > 0 || (this as any).runningThreadIds?.has?.(id)) {
        hadTurns.add(id);
      }
    }

    // Clear all in-memory session data
    this.threads.clear();
    this.threadMeta.clear();
    this.historyLoaded.clear();

    // Reload from disk
    await this.load();

    // Restore turn data for threads we had loaded before
    for (const id of hadTurns) {
      if (this.threads.has(id) && !this.historyLoaded.has(id)) {
        this.ensureHistory(id);
      }
    }

    console.log(`[Session] Reloaded ${this.threads.size} sessions from disk`);
    return this.threads.size;
  }

  private ensureHistory(threadId: string): void {
    if (this.historyLoaded.has(threadId)) return;
    this.historyLoaded.add(threadId);

    const thread = this.threads.get(threadId);
    const meta = this.threadMeta.get(threadId);
    if (!thread || !meta) return;

    const jsonlPath = findJsonlForSession(meta);
    if (!jsonlPath) return;

    try {
      const fullThread = parseJsonlToThread(meta, jsonlPath);
      thread.turns = fullThread.turns;
      thread.lastActivityAt = fullThread.lastActivityAt || thread.lastActivityAt;
      console.log(`[Session] Loaded history for "${thread.title}": ${thread.turns.length} turns from ${path.basename(jsonlPath)}`);
    } catch (err: any) {
      console.log(`[Session] Failed to load history for "${thread.title}": ${err.message}`);
    }
  }

  getThread(threadId: string): Thread | undefined {
    this.ensureHistory(threadId);
    const thread = this.threads.get(threadId);
    if (!thread) return undefined;
    return this.trimThread(thread);
  }

  private trimThread(thread: Thread): Thread {
    const MAX_TURNS = 30;
    const MAX_ITEMS_PER_TURN = 50;

    const rawTurns = thread.turns.length > MAX_TURNS
      ? thread.turns.slice(-MAX_TURNS)
      : thread.turns;

    const trimmedTurns = rawTurns.map(turn => {
      if (turn.items.length <= MAX_ITEMS_PER_TURN) {
        return { ...turn, items: [...turn.items] };
      }
      return {
        ...turn,
        items: turn.items.slice(-MAX_ITEMS_PER_TURN),
      };
    });

    return { ...thread, turns: trimmedTurns };
  }

  listThreads(): ThreadSummary[] {
    return Array.from(this.threads.values())
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
      .map(t => ({
        id: t.id,
        title: t.title,
        cwd: t.cwd,
        model: t.model,
        createdAt: t.createdAt,
        lastActivityAt: t.lastActivityAt,
        turnCount: t.turns.length || ((t as any)._completedTurns || 0),
        lastMessage: t.turns.at(-1)?.userMessage,
      }));
  }

  async submitTask(params: {
    threadId?: string;
    content: string;
    cwd: string;
    model: string;
    effort?: string;
  }): Promise<void> {
    const { content, cwd, model, effort } = params;
    const now = Date.now();

    // Get or create thread
    let thread: Thread;
    let isResume = false;

    if (params.threadId && this.threads.has(params.threadId)) {
      // Resume existing session
      this.ensureHistory(params.threadId); // Ensure we have the context
      thread = this.threads.get(params.threadId)!;
      thread.lastActivityAt = now;
      isResume = true;
    } else {
      // Create new thread
      thread = {
        id: `local_${uuid()}`,
        title: content.slice(0, 60) + (content.length > 60 ? '...' : ''),
        cwd,
        model,
        createdAt: now,
        lastActivityAt: now,
        turns: [],
      };
      this.threads.set(thread.id, thread);
      broadcast({ type: 'thread_created', thread });
    }

    // Create turn
    const turn: Turn = {
      id: uuid(),
      threadId: thread.id,
      userMessage: content,
      items: [],
      status: 'running',
      startedAt: Date.now(),
    };
    thread.turns.push(turn);

    // Setup abort controller
    const abortController = new AbortController();
    this.abortControllers.set(thread.id, abortController);

    try {
      await this.runAgentLoop(thread, turn, abortController.signal, model, effort);
    } catch (err) {
      turn.status = 'error';
      turn.completedAt = Date.now();
      const errorItem: Item = {
        id: uuid(),
        turnId: turn.id,
        type: 'error',
        content: err instanceof Error ? err.message : 'Unknown error',
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      turn.items.push(errorItem);
      broadcast({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: errorItem });
      broadcast({ type: 'item_completed', threadId: thread.id, turnId: turn.id, itemId: errorItem.id });
      broadcast({ type: 'turn_completed', threadId: thread.id, turnId: turn.id, stopReason: 'error' });
    } finally {
      this.abortControllers.delete(thread.id);
    }
  }

  cancelTask(threadId: string): void {
    const controller = this.abortControllers.get(threadId);
    if (controller) {
      controller.abort();
    }
  }

  resolveApproval(threadId: string, itemId: string, approved: boolean): void {
    const key = `${threadId}:${itemId}`;
    const pending = this.pendingApprovals.get(key);
    if (pending) {
      pending.resolve(approved);
      this.pendingApprovals.delete(key);
    }
  }

  waitForApproval(threadId: string, itemId: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const key = `${threadId}:${itemId}`;
      this.pendingApprovals.set(key, { resolve });
      setTimeout(() => {
        if (this.pendingApprovals.has(key)) {
          this.pendingApprovals.delete(key);
          resolve(false);
        }
      }, 5 * 60 * 1000);
    });
  }

  private async runAgentLoop(
    thread: Thread,
    turn: Turn,
    abortSignal: AbortSignal,
    model?: string,
    effort?: string,
  ): Promise<void> {
    const { runCliAgent } = await import('../agent/cli-runner.js');
    await runCliAgent({
      thread,
      turn,
      content: turn.userMessage,
      cwd: thread.cwd,
      sessionId: (thread as any)._cliSessionId,
      model: model || (thread as any)._cliModel,
      effort,
      abortSignal,
    });
  }
}
