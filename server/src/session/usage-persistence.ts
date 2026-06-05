// Independent usage persistence — stores token usage in a separate file
// to avoid modifying original Claude Desktop session files.

import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export interface PersistedUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;        // model at the time of usage (for context window size)
  updatedAt: number;
}

const USAGE_FILE = path.join(
  process.env.LOCALAPPDATA!,
  'Claude-3p', 'claude-code-sessions',
  config.claudeDesktopUserId,
  config.claudeDesktopAppId,
  'usage.json'
);

let memoryCache = new Map<string, PersistedUsage>();
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;
  try {
    if (fs.existsSync(USAGE_FILE)) {
      const raw = fs.readFileSync(USAGE_FILE, 'utf-8');
      const data = JSON.parse(raw) as Record<string, PersistedUsage>;
      for (const [threadId, usage] of Object.entries(data)) {
        memoryCache.set(threadId, usage);
      }
    }
  } catch (err: any) {
    console.log(`[UsagePersistence] Failed to load: ${err.message}`);
  }
  loaded = true;
}

function save(): void {
  try {
    const data: Record<string, PersistedUsage> = {};
    for (const [threadId, usage] of memoryCache) {
      data[threadId] = usage;
    }
    fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err: any) {
    console.log(`[UsagePersistence] Failed to save: ${err.message}`);
  }
}

/** Get context window size for a given model */
export function getContextWindow(model: string): number {
  const m = model.toLowerCase();
  // 1M variants
  if (m.includes('[1m]') || m.includes('1m')) return 1_000_000;
  return 200_000;
}

export function persistUsage(
  threadId: string,
  usage: { inputTokens: number; outputTokens: number },
  model: string,
): void {
  ensureLoaded();
  memoryCache.set(threadId, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    model,
    updatedAt: Date.now(),
  });
  save();
}

export function getUsage(threadId: string): PersistedUsage | undefined {
  ensureLoaded();
  return memoryCache.get(threadId);
}

export function getAllUsage(): Map<string, PersistedUsage> {
  ensureLoaded();
  return new Map(memoryCache);
}

export function deleteUsage(threadId: string): void {
  ensureLoaded();
  if (memoryCache.delete(threadId)) {
    save();
  }
}
