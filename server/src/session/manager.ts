import { v4 as uuid } from 'uuid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import type { Thread, Turn, Item, ThreadSummary, Usage } from '@vibe-bridge/shared';
import { broadcast } from '../ws/broadcast.js';
import { config, normalizeModel, resolveClaudeModelName } from '../config.js';
import * as UsagePersistence from './usage-persistence.js';

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

/**
 * Extract base64 image blocks from a user message content array.
 * Returns an array of { media_type, data } suitable for ImageBlock.
 */
function extractImagesFromContent(content: any): Array<{ media_type: string; data: string }> {
  if (!content || !Array.isArray(content)) return [];
  return content
    .filter((b: any) =>
      b.type === 'image' &&
      b.source?.type === 'base64' &&
      typeof b.source.data === 'string' &&
      b.source.data.length > 0
    )
    .map((b: any) => ({
      media_type: b.source.media_type || 'image/jpeg',
      data: b.source.data,
    }));
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
      const images = extractImagesFromContent(content);
      if (text && /^<(summary|local-command|command-name|task-notification|task-updated)|^\[Request interrupted/.test(text.trim())) {
        continue;
      }
      const hasText = hasTextContent(content);
      const hasImages = images.length > 0;

      if (hasText || hasImages) {
        currentTurn = {
          id: uuid(),
          threadId: thread.id,
          userMessage: text,
          items: [],
          status: 'completed',
          startedAt: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        };

        // Add image items (only for user messages — Claude doesn't send back base64 images in assistant turns)
        for (const img of images) {
          currentTurn.items.push({
            id: uuid(),
            turnId: currentTurn.id,
            type: 'image',
            imageMediaType: img.media_type,
            imageData: img.data,
            createdAt: currentTurn.startedAt,
            completedAt: currentTurn.startedAt,
          });
        }

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
      currentTurn.usage = {
        inputTokens: msg.usage?.input_tokens || 0,
        outputTokens: msg.usage?.output_tokens || 0,
      };
      if (currentTurn.usage.inputTokens > 0 || currentTurn.usage.outputTokens > 0) {
        UsagePersistence.persistUsage(currentTurn.threadId, currentTurn.usage, thread.model);
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

          const thread: Thread = {
            id: meta.sessionId,
            title: meta.title || '(untitled)',
            cwd: meta.cwd || process.env.USERPROFILE || 'C:\\',
            model: normalizeModel(meta.model || ''),
            createdAt: meta.createdAt,
            lastActivityAt: meta.lastActivityAt || meta.createdAt,
            turns: [],
            permissionMode: (meta as any).permissionMode,
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

  broadcastUsageForThread(threadId: string): void {
    const usage = UsagePersistence.getUsage(threadId);
    if (usage) {
      broadcast({
        type: 'usage_update',
        threadId,
        usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
      });
    }
  }

  getUsageForThread(threadId: string): Usage | undefined {
    const usage = UsagePersistence.getUsage(threadId);
    if (!usage) return undefined;
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
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
    const pinnedIds = this.loadPinnedIds();
    return Array.from(this.threads.values())
      .sort((a, b) => {
        const aPinned = pinnedIds.has(a.id) ? 1 : 0;
        const bPinned = pinnedIds.has(b.id) ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned; // pinned first
        return b.lastActivityAt - a.lastActivityAt;
      })
      .map(t => {
        const usage = UsagePersistence.getUsage(t.id);
        return {
          id: t.id,
          title: t.title,
          cwd: t.cwd,
          model: t.model,
          createdAt: t.createdAt,
          lastActivityAt: t.lastActivityAt,
          turnCount: t.turns.length || ((t as any)._completedTurns || 0),
          lastMessage: t.turns.at(-1)?.userMessage,
          isArchived: this.threadMeta.get(t.id)?.isArchived || false,
          isPinned: pinnedIds.has(t.id),
          usage: usage ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : undefined,
        };
      });
  }

  archiveThread(threadId: string, archived: boolean): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;
    const meta = this.threadMeta.get(threadId);
    if (!meta) return;

    meta.isArchived = archived;

    // Persist to JSON file
    const metaPath = path.join(CLAUDE_SESSIONS_DIR, `${threadId}.json`);
    try {
      if (fsSync.existsSync(metaPath)) {
        const existing = JSON.parse(fsSync.readFileSync(metaPath, 'utf-8'));
        existing.isArchived = archived;
        fsSync.writeFileSync(metaPath, JSON.stringify(existing), 'utf-8');
      }
    } catch (err: any) {
      console.log(`[Session] Failed to archive thread: ${err.message}`);
    }

    console.log(`[Session] ${archived ? 'Archived' : 'Unarchived'} thread: ${threadId}`);
  }

  renameThread(threadId: string, title: string): void {
    const thread = this.threads.get(threadId);
    if (!thread) return;

    thread.title = title;

    // Persist to JSON file
    const metaPath = path.join(CLAUDE_SESSIONS_DIR, `${threadId}.json`);
    try {
      if (fsSync.existsSync(metaPath)) {
        const existing = JSON.parse(fsSync.readFileSync(metaPath, 'utf-8'));
        existing.title = title;
        existing.titleSource = 'manual';
        fsSync.writeFileSync(metaPath, JSON.stringify(existing), 'utf-8');
      }
    } catch (err: any) {
      console.log(`[Session] Failed to rename thread: ${err.message}`);
    }
    console.log(`[Session] Renamed thread ${threadId} to "${title}"`);
  }

  exportThread(threadId: string): string | null {
    const meta = this.threadMeta.get(threadId);
    if (!meta) return null;
    const jsonlPath = findJsonlForSession(meta);
    if (!jsonlPath || !fsSync.existsSync(jsonlPath)) return null;
    return fsSync.readFileSync(jsonlPath, 'utf-8');
  }

  deleteThread(threadId: string): void {
    const meta = this.threadMeta.get(threadId);
    if (!meta) return;

    // 1. Delete JSONL transcript
    const jsonlPath = findJsonlForSession(meta);
    if (jsonlPath && fsSync.existsSync(jsonlPath)) {
      try {
        fsSync.unlinkSync(jsonlPath);
        console.log(`[Session] Deleted JSONL: ${jsonlPath}`);
      } catch (err: any) {
        console.log(`[Session] Failed to delete JSONL: ${err.message}`);
      }
    }

    // 2. Delete session metadata JSON
    const metaPath = path.join(CLAUDE_SESSIONS_DIR, `${threadId}.json`);
    if (fsSync.existsSync(metaPath)) {
      try {
        fsSync.unlinkSync(metaPath);
        console.log(`[Session] Deleted meta: ${metaPath}`);
      } catch (err: any) {
        console.log(`[Session] Failed to delete meta: ${err.message}`);
      }
    }

    // 3. Remove usage data for this thread (independent file)
    UsagePersistence.deleteUsage(threadId);

    // 4. Remove from memory
    this.threads.delete(threadId);
    this.threadMeta.delete(threadId);
    this.historyLoaded.delete(threadId);

    // 5. Remove from pinned list if pinned
    this.updatePinnedList(threadId, false);

    console.log(`[Session] Deleted thread: ${threadId}`);
  }

  pinThread(threadId: string, pinned: boolean): void {
    this.updatePinnedList(threadId, pinned);

    // Also update meta in memory for listThreads
    const meta = this.threadMeta.get(threadId);
    if (meta) {
      (meta as any).isPinned = pinned;
    }
    console.log(`[Session] ${pinned ? 'Pinned' : 'Unpinned'} thread: ${threadId}`);
  }

  private updatePinnedList(threadId: string, pinned: boolean): void {
    const configPath = path.join(
      process.env.LOCALAPPDATA!, 'Claude-3p', 'claude_desktop_config.json'
    );
    try {
      const raw = fsSync.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);

      // Ensure path exists
      if (!config.preferences) config.preferences = {};
      if (!config.preferences.epitaxyPrefs) config.preferences.epitaxyPrefs = {};

      let pinnedList: string[] = config.preferences.epitaxyPrefs['starred-local-code-sessions'] || [];

      if (pinned) {
        if (!pinnedList.includes(threadId)) {
          pinnedList.push(threadId);
        }
      } else {
        pinnedList = pinnedList.filter((id: string) => id !== threadId);
      }

      config.preferences.epitaxyPrefs['starred-local-code-sessions'] = pinnedList;
      fsSync.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err: any) {
      console.log(`[Session] Failed to update pinned list: ${err.message}`);
    }
  }

  private loadPinnedIds(): Set<string> {
    const configPath = path.join(
      process.env.LOCALAPPDATA!, 'Claude-3p', 'claude_desktop_config.json'
    );
    try {
      const raw = fsSync.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);
      const list: string[] = config.preferences?.epitaxyPrefs?.['starred-local-code-sessions'] || [];
      return new Set(list);
    } catch {
      return new Set();
    }
  }

  async submitTask(params: {
    threadId?: string;
    content: string;
    images?: Array<{ mediaType: string; data: string }>;
    cwd: string;
    model: string;
    effort?: string;
  }): Promise<void> {
    const { content, images, cwd, model, effort } = params;
    const now = Date.now();

    // Get or create thread
    let thread: Thread;
    let isResume = false;

    if (params.threadId && this.threads.has(params.threadId)) {
      // Resume existing session
      this.ensureHistory(params.threadId); // Ensure we have the context
      thread = this.threads.get(params.threadId)!;
      thread.lastActivityAt = now;
      // Update thread.model if user selected a different model
      if (model) thread.model = model;
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

    // Add image items to the turn (so they show up in the chat immediately)
    if (images && images.length > 0) {
      for (const img of images) {
        const imageItem: Item = {
          id: uuid(),
          turnId: turn.id,
          type: 'image',
          imageMediaType: img.mediaType,
          imageData: img.data,
          createdAt: Date.now(),
          completedAt: Date.now(),
        };
        turn.items.push(imageItem);
        broadcast({
          type: 'item_created',
          threadId: thread.id,
          turnId: turn.id,
          item: imageItem,
        });
        broadcast({
          type: 'item_completed',
          threadId: thread.id,
          turnId: turn.id,
          itemId: imageItem.id,
        });
      }
    }

    // Setup abort controller
    const abortController = new AbortController();
    this.abortControllers.set(thread.id, abortController);

    try {
      await this.runAgentLoop(thread, turn, abortController.signal, model, effort, images);
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
    images?: Array<{ mediaType: string; data: string }>,
  ): Promise<void> {
    const { runCliAgent } = await import('../agent/cli-runner.js');
    // Use explicit model first, then the thread's stored model (normalized alias),
    // as fallback rather than raw _cliModel which may contain proxy model names
    const effectiveModel = model || thread.model;

    // Sync the session meta file model before resume, so the CLI doesn't
    // see a mismatch between --model and what's stored in the session file.
    // This prevents the CLI from generating malformed model names
    // (e.g. double [1m] suffix when switching between 1M/non-1M variants).
    // Must write the FULL Claude model name (e.g. "claude-opus-4-7[1m]"),
    // NOT the CLI alias ("opus[1m]"), to stay consistent with Claude Desktop.
    if ((thread as any)._cliSessionId && effectiveModel) {
      this.syncSessionMetaModel(thread.id, effectiveModel);
    }

    await runCliAgent({
      thread,
      turn,
      content: turn.userMessage,
      images,
      cwd: thread.cwd,
      sessionId: (thread as any)._cliSessionId,
      model: effectiveModel,
      effort,
      abortSignal,
    });
  }

  private syncSessionMetaModel(threadId: string, modelAlias: string): void {
    const metaPath = path.join(CLAUDE_SESSIONS_DIR, `${threadId}.json`);
    try {
      if (!fsSync.existsSync(metaPath)) return;
      const existing = JSON.parse(fsSync.readFileSync(metaPath, 'utf-8'));
      const fullName = resolveClaudeModelName(modelAlias);
      if (existing.model === fullName) return; // already in sync
      existing.model = fullName;
      fsSync.writeFileSync(metaPath, JSON.stringify(existing), 'utf-8');
      console.log(`[Session] Synced model in meta: ${threadId} -> ${fullName}`);
    } catch (err: any) {
      console.log(`[Session] Failed to sync model in meta: ${err.message}`);
    }
  }
}
