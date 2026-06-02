import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { Thread, Turn, Item } from '@vibe-bridge/shared';
import { broadcast } from '../ws/broadcast.js';

const CLI_PATH = path.join(
  process.env.LOCALAPPDATA!,
  'Claude-3p', 'claude-code', '2.1.149', 'claude.exe'
);

// Skill resolution: /skill-name → read SKILL.md → inject via --append-system-prompt
const SKILLS_BASE_DIR = path.join(
  process.env.LOCALAPPDATA!,
  'Claude-3p', 'local-agent-mode-sessions', 'skills-plugin',
  '00000000-0000-4000-8000-000000000001',
  '57cbd131-529f-47ce-92e3-ff7e091ef616', 'skills'
);

/** List all available skills from the skills directory */
export function listSkills(): Array<{ id: string; label: string; description: string }> {
  try {
    const dirs = fs.readdirSync(SKILLS_BASE_DIR);
    return dirs
      .filter(d => {
        const skillFile = path.join(SKILLS_BASE_DIR, d, 'SKILL.md');
        return fs.existsSync(skillFile);
      })
      .map(d => {
        const content = fs.readFileSync(path.join(SKILLS_BASE_DIR, d, 'SKILL.md'), 'utf-8');
        // Parse YAML-like frontmatter for name/description
        const nameMatch = content.match(/^name:\s*"?(.+?)"?\s*$/m);
        const descMatch = content.match(/^description:\s*"?(.+?)"?\s*$/m);
        return {
          id: d,
          label: nameMatch?.[1] || d,
          description: (descMatch?.[1] || '').slice(0, 120),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Parse /skill-name from input, resolve SKILL.md content.
 * Supports: /skill-name, /anthropic-skills:skill-name
 */
function resolveSkill(input: string): { skillContent: string; cleanContent: string } | null {
  const match = input.trim().match(/^\/(?:anthropic-skills:)?([\w-]+)\s*(.*)/s);
  if (!match) return null;

  const skillName = match[1];
  const cleanContent = match[2].trim();
  const skillFile = path.join(SKILLS_BASE_DIR, skillName, 'SKILL.md');

  if (!fs.existsSync(skillFile)) {
    console.log(`[CLI] Skill not found: ${skillName}`);
    return null;
  }

  try {
    const skillContent = fs.readFileSync(skillFile, 'utf-8');
    console.log(`[CLI] Resolved skill: ${skillName} (${skillContent.length} bytes)`);
    return { skillContent, cleanContent: cleanContent || '使用此 skill 完成任务' };
  } catch {
    return null;
  }
}

function findCliCwd(targetCwd: string): string {
  if (targetCwd && fs.existsSync(targetCwd)) {
    return path.resolve(targetCwd);
  }
  return process.env.USERPROFILE || 'E:\\claude';
}

export interface CliRunnerParams {
  thread: Thread;
  turn: Turn;
  content: string;
  cwd: string;
  sessionId?: string;
  model?: string;
  effort?: string;
  abortSignal: AbortSignal;
}

const SESSIONS_DIR = path.join(
  process.env.LOCALAPPDATA!,
  'Claude-3p', 'claude-code-sessions',
  '57cbd131-529f-47ce-92e3-ff7e091ef616',
  '00000000-0000-4000-8000-000000000001'
);

function ensureSessionMetaFile(
  cliSessionId: string,
  thread: Thread,
  model: string,
  turnCount: number,
): void {
  const localSessionId = thread.id.startsWith('local_') ? thread.id : `local_${thread.id}`;
  const metaPath = path.join(SESSIONS_DIR, `${localSessionId}.json`);
  const normalizedCwd = path.normalize(thread.cwd);
  const meta = {
    sessionId: localSessionId,
    cliSessionId,
    cwd: normalizedCwd,
    originCwd: normalizedCwd,
    lastFocusedAt: Date.now(),
    createdAt: thread.createdAt,
    lastActivityAt: Date.now(),
    model: model || 'unknown',
    effort: 'max',
    isArchived: false,
    title: thread.title,
    titleSource: 'auto',
    permissionMode: 'bypassPermissions',
    remoteMcpServersConfig: [],
    chromePermissionMode: 'skip_all_permission_checks',
    completedTurns: turnCount,
    alwaysAllowedReasons: [],
    sessionPermissionUpdates: [],
    classifierSummaryEnabled: false,
  };
  try {
    const json = JSON.stringify(meta);
    fs.writeFileSync(metaPath, json, 'utf-8');
    console.log(`[CLI] Created session meta: ${localSessionId}`);
  } catch (err: any) {
    console.log(`[CLI] Failed to create session meta: ${err.message}`);
  }
}

function updateSessionMetaFile(
  cliSessionId: string,
  thread: Thread,
  model: string,
  turnCount: number,
): void {
  const localSessionId = thread.id.startsWith('local_') ? thread.id : `local_${thread.id}`;
  const metaPath = path.join(SESSIONS_DIR, `${localSessionId}.json`);
  if (!fs.existsSync(metaPath)) {
    ensureSessionMetaFile(cliSessionId, thread, model, turnCount);
    return;
  }
  try {
    const existing = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    existing.lastActivityAt = Date.now();
    existing.lastFocusedAt = Date.now();
    existing.completedTurns = turnCount;
    if (model) existing.model = model;
    fs.writeFileSync(metaPath, JSON.stringify(existing), 'utf-8');
    console.log(`[CLI] Updated session meta: ${localSessionId}`);
  } catch (err: any) {
    console.log(`[CLI] Failed to update session meta: ${err.message}`);
  }
}

export async function runCliAgent(params: CliRunnerParams): Promise<void> {
  const { thread, turn, content: rawContent, cwd, abortSignal } = params;
  const isNewSession = !params.sessionId;

  // Resolve /skill-name prefix → inject skill as system prompt
  const skill = resolveSkill(rawContent);
  const content = skill ? skill.cleanContent : rawContent;

  const args = [
    '-p', content,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ];

  if (skill) {
    args.push('--append-system-prompt', skill.skillContent);
  }

  if (params.sessionId) {
    args.push('--resume', params.sessionId);
  }

  if (params.model) {
    args.push('--model', params.model);
  }

  if (params.effort) {
    args.push('--effort', params.effort);
  }

  broadcast({ type: 'turn_started', threadId: thread.id, turnId: turn.id, userMessage: content });

  const cliCwd = findCliCwd(cwd);

  console.log(`[CLI] Running: ${CLI_PATH} ${args.join(' ')}`);
  console.log(`[CLI] CWD: ${cliCwd}`);

  const proc = spawn(CLI_PATH, args, {
    cwd: cliCwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: process.env,
  });

  abortSignal.addEventListener('abort', () => {
    proc.kill('SIGTERM');
  });

  let buffer = '';
  let sessionId: string | undefined;

  proc.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line);
        handleCliEvent(event, thread, turn);
        if (event.session_id) sessionId = event.session_id;
      } catch {
        // non-JSON output, ignore
      }
    }
  });

  proc.stderr!.on('data', (chunk: Buffer) => {
    console.log('[CLI stderr]', chunk.toString().trim());
  });

  return new Promise<void>((resolve) => {
    proc.on('close', (code) => {
      console.log(`[CLI] Process closed with code ${code}`);
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          handleCliEvent(event, thread, turn);
        } catch {}
      }

      if (turn.status === 'running') {
        turn.status = code === 0 ? 'completed' : 'error';
        turn.completedAt = Date.now();
        broadcast({
          type: 'turn_completed',
          threadId: thread.id,
          turnId: turn.id,
          stopReason: turn.status === 'completed' ? 'end_turn' : 'error',
        });
      }

      if (sessionId) {
        (thread as any)._cliSessionId = sessionId;
      }

      if (sessionId && code === 0) {
        if (isNewSession) {
          ensureSessionMetaFile(sessionId, thread, (thread as any)._cliModel || '', thread.turns.length);
        } else {
          updateSessionMetaFile(sessionId, thread, (thread as any)._cliModel || '', thread.turns.length);
        }
      }

      resolve();
    });

    proc.on('error', (err) => {
      turn.status = 'error';
      turn.completedAt = Date.now();
      const errorItem: Item = {
        id: uuid(),
        turnId: turn.id,
        type: 'error',
        content: `CLI error: ${err.message}`,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      turn.items.push(errorItem);
      broadcast({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: errorItem });
      broadcast({ type: 'item_completed', threadId: thread.id, turnId: turn.id, itemId: errorItem.id });
      broadcast({ type: 'turn_completed', threadId: thread.id, turnId: turn.id, stopReason: 'error' });
      resolve();
    });
  });
}

function handleCliEvent(event: any, thread: Thread, turn: Turn): void {
  switch (event.type) {
    case 'system': {
      if (event.subtype === 'init') {
        (thread as any)._cliModel = event.model || '';
        console.log(`[CLI] Session ${event.session_id}, model: ${event.model}, tools: ${event.tools?.length || 0}`);
      }
      break;
    }

    case 'assistant': {
      const msg = event.message;
      if (!msg?.content) break;

      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          let textItem = turn.items.find(i => i.type === 'text' && !i.completedAt);
          if (!textItem) {
            textItem = { id: uuid(), turnId: turn.id, type: 'text', content: '', createdAt: Date.now() };
            turn.items.push(textItem);
            broadcast({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: textItem });
          }
          textItem.content = (textItem.content || '') + block.text;
          broadcast({
            type: 'item_delta',
            threadId: thread.id,
            turnId: turn.id,
            itemId: textItem.id,
            delta: { subtype: 'text_delta', text: block.text },
          });
        } else if (block.type === 'thinking' && block.thinking) {
          let thinkItem = turn.items.find(i => i.type === 'thinking' && !i.completedAt);
          if (!thinkItem) {
            thinkItem = { id: uuid(), turnId: turn.id, type: 'thinking', content: '', createdAt: Date.now() };
            turn.items.push(thinkItem);
            broadcast({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: thinkItem });
          }
          thinkItem.content = (thinkItem.content || '') + block.thinking;
          broadcast({
            type: 'item_delta',
            threadId: thread.id,
            turnId: turn.id,
            itemId: thinkItem.id,
            delta: { subtype: 'thinking_delta', thinking: block.thinking },
          });
        } else if (block.type === 'tool_use') {
          const toolItem: Item = {
            id: block.id || uuid(),
            turnId: turn.id,
            type: 'tool_use',
            toolName: block.name,
            toolInput: block.input,
            content: '',
            createdAt: Date.now(),
          };
          turn.items.push(toolItem);
          broadcast({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: toolItem });
        }
      }
      break;
    }

    case 'user': {
      const msg = event.message;
      if (!msg?.content) break;

      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const resultItem: Item = {
            id: uuid(),
            turnId: turn.id,
            type: 'tool_result',
            toolResultContent: typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content),
            toolResultIsError: block.is_error || false,
            createdAt: Date.now(),
            completedAt: Date.now(),
          };
          turn.items.push(resultItem);
          broadcast({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: resultItem });
          broadcast({ type: 'item_completed', threadId: thread.id, turnId: turn.id, itemId: resultItem.id });

          if (block.tool_use_id) {
            const toolItem = turn.items.find(i => i.id === block.tool_use_id);
            if (toolItem && !toolItem.completedAt) {
              toolItem.completedAt = Date.now();
              broadcast({ type: 'item_completed', threadId: thread.id, turnId: turn.id, itemId: toolItem.id });
            }
          }
        }
      }
      break;
    }

    case 'result': {
      turn.status = event.is_error ? 'error' : 'completed';
      turn.stopReason = event.stop_reason || 'end_turn';
      turn.completedAt = Date.now();
      turn.usage = {
        inputTokens: event.usage?.input_tokens || 0,
        outputTokens: event.usage?.output_tokens || 0,
      };

      for (const item of turn.items) {
        if (!item.completedAt) {
          item.completedAt = Date.now();
          broadcast({ type: 'item_completed', threadId: thread.id, turnId: turn.id, itemId: item.id });
        }
      }

      broadcast({
        type: 'turn_completed',
        threadId: thread.id,
        turnId: turn.id,
        stopReason: turn.stopReason,
        usage: turn.usage,
      });

      if (event.session_id) {
        (thread as any)._cliSessionId = event.session_id;
      }
      break;
    }
  }
}
