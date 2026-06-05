import type { ClientMessage } from '@vibe-bridge/shared';
import { SessionManager } from '../session/manager.js';
import { config, loadModelsFromConfigLibrary, EFFORT_LEVELS } from '../config.js';
import { listSkills } from '../agent/cli-runner.js';
import { broadcast } from './broadcast.js';

export function handleMessage(
  msg: ClientMessage,
  sessionManager: SessionManager,
): void {
  switch (msg.type) {
    case 'submit_task': {
      console.log(`[Handler] submit_task: "${msg.content.slice(0, 80)}..."`);
      handleSubmitTask(msg, sessionManager);
      break;
    }

    case 'approve_tool': {
      console.log(`[Handler] approve_tool: ${msg.approved}`);
      sessionManager.resolveApproval(msg.threadId, msg.itemId, msg.approved);
      break;
    }

    case 'cancel_task': {
      console.log(`[Handler] cancel_task: ${msg.threadId}`);
      sessionManager.cancelTask(msg.threadId);
      break;
    }

    case 'list_threads': {
      const threads = sessionManager.listThreads();
      broadcast({ type: 'threads_list', threads });
      break;
    }

    case 'get_thread': {
      const thread = sessionManager.getThread(msg.threadId);
      if (thread) {
        const usage = sessionManager.getUsageForThread(msg.threadId);
        broadcast({ type: 'thread_detail', thread, usage });
      } else {
        broadcast({ type: 'error', message: `Thread ${msg.threadId} not found` });
      }
      break;
    }

    case 'resume_session': {
      const thread = sessionManager.getThread(msg.threadId);
      if (thread) {
        const usage = sessionManager.getUsageForThread(msg.threadId);
        broadcast({ type: 'thread_detail', thread, usage });
      } else {
        broadcast({ type: 'error', message: `Thread ${msg.threadId} not found` });
      }
      break;
    }

    case 'list_models': {
      const modelConfigs = loadModelsFromConfigLibrary();
      const models = modelConfigs.map(m => ({ id: m.cliAlias, label: m.label }));
      broadcast({
        type: 'models_list',
        models,
        efforts: EFFORT_LEVELS,
      });
      break;
    }

    case 'reload_sessions': {
      console.log('[Handler] reload_sessions');
      sessionManager.reloadSessions().then(() => {
        const threads = sessionManager.listThreads();
        broadcast({ type: 'threads_list', threads });
      });
      break;
    }

    case 'list_skills': {
      const skills = listSkills();
      broadcast({ type: 'skills_list', skills });
      break;
    }

    case 'archive_thread': {
      console.log(`[Handler] archive_thread: ${msg.threadId} -> archived=${msg.archived}`);
      sessionManager.archiveThread(msg.threadId, msg.archived);
      const threads = sessionManager.listThreads();
      broadcast({ type: 'threads_list', threads });
      break;
    }

    case 'rename_thread': {
      console.log(`[Handler] rename_thread: ${msg.threadId} -> "${msg.title}"`);
      sessionManager.renameThread(msg.threadId, msg.title);
      const threads = sessionManager.listThreads();
      broadcast({ type: 'threads_list', threads });
      break;
    }

    case 'export_thread': {
      console.log(`[Handler] export_thread: ${msg.threadId}`);
      const jsonl = sessionManager.exportThread(msg.threadId);
      if (jsonl) {
        broadcast({ type: 'export_response', threadId: msg.threadId, jsonl });
      } else {
        broadcast({ type: 'error', message: `Export failed for thread ${msg.threadId}` });
      }
      break;
    }

    case 'delete_thread': {
      console.log(`[Handler] delete_thread: ${msg.threadId}`);
      sessionManager.deleteThread(msg.threadId);
      const threads = sessionManager.listThreads();
      broadcast({ type: 'threads_list', threads });
      break;
    }

    case 'pin_thread': {
      console.log(`[Handler] pin_thread: ${msg.threadId} -> pinned=${msg.pinned}`);
      sessionManager.pinThread(msg.threadId, msg.pinned);
      const threads = sessionManager.listThreads();
      broadcast({ type: 'threads_list', threads });
      break;
    }

    default: {
      broadcast({ type: 'error', message: `Unknown message type` });
    }
  }
}

async function handleSubmitTask(
  msg: { type: 'submit_task'; threadId?: string; content: string; cwd?: string; model?: string; effort?: string },
  sessionManager: SessionManager,
): Promise<void> {
  try {
    await sessionManager.submitTask({
      threadId: msg.threadId,
      content: msg.content,
      cwd: msg.cwd || config.allowedDirs[0],
      model: msg.model || config.defaultModel,
      effort: msg.effort,
    });
  } catch (err) {
    broadcast({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}
