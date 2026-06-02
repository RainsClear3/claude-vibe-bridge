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
        broadcast({ type: 'thread_detail', thread });
      } else {
        broadcast({ type: 'error', message: `Thread ${msg.threadId} not found` });
      }
      break;
    }

    case 'resume_session': {
      const thread = sessionManager.getThread(msg.threadId);
      if (thread) {
        broadcast({ type: 'thread_detail', thread });
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
