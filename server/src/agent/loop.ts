// Core Agent Loop: streaming API call → tool dispatch → loop
// This is the heart of Claude Vibe Bridge

import { v4 as uuid } from 'uuid';
import type { Thread, Turn, Item, ServerMessage, MessageParam, ContentBlock, ToolUseBlock } from '@vibe-bridge/shared';
import { AnthropicClient } from '../api/anthropic-client.js';
import { codingTools } from './tools.js';
import { executeTool } from './executor.js';
import { config } from '../config.js';

type Sender = (msg: ServerMessage) => void;

export interface AgentLoopParams {
  thread: Thread;
  turn: Turn;
  send: Sender;
  abortSignal: AbortSignal;
  waitForApproval: (threadId: string, itemId: string) => Promise<boolean>;
}

const SYSTEM_PROMPT = `You are a coding assistant with access to the user's local filesystem. You can read, write, and edit files, execute shell commands, search code, and browse directories.

When given a coding task:
1. First explore the codebase (list directories, read relevant files, search for patterns)
2. Plan your approach
3. Implement the changes (write/edit files, run commands)
4. Verify your work (run tests, check output)

Always show your reasoning. Explain what you're doing and why.
The platform is Windows. Use appropriate path separators and shell commands.
Be thorough but efficient. Don't read files unnecessarily.`;

export async function executeAgentLoop(params: AgentLoopParams): Promise<void> {
  const { thread, turn, send, abortSignal, waitForApproval } = params;
  const anthropic = new AnthropicClient();

  // Build conversation messages from thread history
  const messages = buildMessages(thread, turn);

  // Tool use round counter
  let toolRounds = 0;

  while (toolRounds < config.maxTurns) {
    if (abortSignal.aborted) {
      turn.status = 'cancelled';
      turn.completedAt = Date.now();
      return;
    }

    // Stream the API call
    const responseContent: ContentBlock[] = [];
    let stopReason = '';
    let inputTokens = 0;
    let outputTokens = 0;

    // Track current items being streamed
    let currentTextItem: Item | null = null;
    let currentTextItemIndex = -1;
    let currentThinkingItem: Item | null = null;
    let currentThinkingItemIndex = -1;
    const toolUseItems = new Map<number, Item>(); // index -> Item
    const toolUseInputs = new Map<number, string>(); // index -> accumulated JSON

    try {
      for await (const event of anthropic.streamMessages({
        model: thread.model,
        max_tokens: config.maxTokens,
        system: SYSTEM_PROMPT,
        messages,
        tools: codingTools,
      })) {
        if (abortSignal.aborted) break;

        switch (event.type) {
          case 'message_start': {
            const msg = (event as any).message;
            inputTokens = msg?.usage?.input_tokens || 0;
            send({ type: 'turn_started', threadId: thread.id, turnId: turn.id });
            break;
          }

          case 'content_block_start': {
            const ev = event as any;
            const block = ev.content_block;

            if (block.type === 'text') {
              currentTextItem = {
                id: uuid(),
                turnId: turn.id,
                type: 'text',
                content: '',
                createdAt: Date.now(),
              };
              currentTextItemIndex = ev.index;
              turn.items.push(currentTextItem);
              send({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: currentTextItem });
            } else if (block.type === 'thinking') {
              currentThinkingItem = {
                id: uuid(),
                turnId: turn.id,
                type: 'thinking',
                content: '',
                createdAt: Date.now(),
              };
              turn.items.push(currentThinkingItem);
              currentThinkingItemIndex = ev.index;
              send({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: currentThinkingItem });
            } else if (block.type === 'tool_use') {
              const toolItem: Item = {
                id: uuid(),
                turnId: turn.id,
                type: 'tool_use',
                toolName: block.name,
                toolInput: {},
                content: '',
                createdAt: Date.now(),
              };
              toolUseItems.set(ev.index, toolItem);
              toolUseInputs.set(ev.index, '');
              turn.items.push(toolItem);
              send({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: toolItem });
            }
            break;
          }

          case 'content_block_delta': {
            const ev = event as any;
            const delta = ev.delta;

            if (delta.type === 'text_delta' && currentTextItem) {
              currentTextItem.content = (currentTextItem.content || '') + delta.text;
              send({
                type: 'item_delta',
                threadId: thread.id,
                turnId: turn.id,
                itemId: currentTextItem.id,
                delta: { subtype: 'text_delta', text: delta.text },
              });
            } else if (delta.type === 'thinking_delta' && currentThinkingItem) {
              currentThinkingItem.content = (currentThinkingItem.content || '') + delta.thinking;
              send({
                type: 'item_delta',
                threadId: thread.id,
                turnId: turn.id,
                itemId: currentThinkingItem.id,
                delta: { subtype: 'thinking_delta', thinking: delta.thinking },
              });
            } else if (delta.type === 'input_json_delta') {
              const toolItem = toolUseItems.get(ev.index);
              const accumulated = toolUseInputs.get(ev.index);
              if (toolItem && accumulated !== undefined) {
                const newAccumulated = accumulated + delta.partial_json;
                toolUseInputs.set(ev.index, newAccumulated);
                send({
                  type: 'item_delta',
                  threadId: thread.id,
                  turnId: turn.id,
                  itemId: toolItem.id,
                  delta: { subtype: 'input_json_delta', partialJson: delta.partial_json },
                });
              }
            }
            break;
          }

          case 'content_block_stop': {
            const ev = event as any;
            // Finalize text item by checking index match
            if (currentTextItem && currentTextItemIndex === ev.index) {
              send({ type: 'item_completed', threadId: thread.id, turnId: turn.id, itemId: currentTextItem.id });
              currentTextItem.completedAt = Date.now();
            }
            // Finalize thinking item by checking index match
            if (currentThinkingItem && currentThinkingItemIndex === ev.index) {
              send({ type: 'item_completed', threadId: thread.id, turnId: turn.id, itemId: currentThinkingItem.id });
              currentThinkingItem.completedAt = Date.now();
            }
            // Finalize tool_use items - parse the accumulated JSON
            const toolItem = toolUseItems.get(ev.index);
            if (toolItem) {
              const accumulated = toolUseInputs.get(ev.index) || '{}';
              try {
                toolItem.toolInput = JSON.parse(accumulated);
              } catch {
                toolItem.toolInput = { _parse_error: accumulated };
              }
              send({ type: 'item_completed', threadId: thread.id, turnId: turn.id, itemId: toolItem.id });
              toolItem.completedAt = Date.now();
            }
            break;
          }

          case 'message_delta': {
            const ev = event as any;
            stopReason = ev.delta?.stop_reason || '';
            outputTokens = ev.usage?.output_tokens || 0;
            break;
          }

          case 'message_stop': {
            // Message complete
            break;
          }

          case 'error': {
            const ev = event as any;
            throw new Error(`API stream error: ${ev.error?.message || 'unknown'}`);
          }
        }
      }
    } catch (err: any) {
      if (abortSignal.aborted) {
        turn.status = 'cancelled';
        turn.completedAt = Date.now();
        return;
      }
      throw err;
    }

    // Update usage
    turn.usage = {
      inputTokens,
      outputTokens,
      ...(turn.usage || {}),
    };

    // If not tool_use, we're done
    if (stopReason !== 'tool_use') {
      turn.status = 'completed';
      turn.stopReason = stopReason;
      turn.completedAt = Date.now();
      send({
        type: 'turn_completed',
        threadId: thread.id,
        turnId: turn.id,
        stopReason,
        usage: turn.usage,
      });
      return;
    }

    // --- Tool Execution Phase ---
    toolRounds++;

    // Build assistant message content for next API call
    const assistantContent: ContentBlock[] = [];
    if (currentTextItem?.content) {
      assistantContent.push({ type: 'text', text: currentTextItem.content });
    }
    if (currentThinkingItem?.content) {
      assistantContent.push({ type: 'thinking', thinking: currentThinkingItem.content } as any);
    }

    // Collect tool_use blocks and execute them
    const toolResults: ContentBlock[] = [];

    for (const [index, toolItem] of toolUseItems) {
      const toolName = toolItem.toolName!;
      const toolInput = toolItem.toolInput!;

      // Add tool_use to assistant content
      assistantContent.push({
        type: 'tool_use',
        id: toolItem.id,
        name: toolName,
        input: toolInput,
      });

      // Check approval for write operations in manual mode
      let approved = true;
      if (config.approvalMode === 'manual') {
        const needsApproval = ['write_file', 'edit_file', 'execute_command'].includes(toolName);
        if (needsApproval) {
          send({
            type: 'tool_approval_required',
            threadId: thread.id,
            turnId: turn.id,
            itemId: toolItem.id,
            toolName,
            input: toolInput,
          });
          approved = await waitForApproval(thread.id, toolItem.id);
        }
      }

      // Execute tool
      let resultContent: string;
      let isError = false;

      if (!approved) {
        resultContent = 'Tool execution denied by user.';
        isError = true;
      } else {
        try {
          resultContent = await executeTool(toolName, toolInput, thread.cwd);
        } catch (err: any) {
          resultContent = `Error: ${err.message}`;
          isError = true;
        }
      }

      // Truncate very large results
      if (resultContent.length > 100_000) {
        resultContent = resultContent.slice(0, 100_000) + '\n... (truncated)';
      }

      // Create tool_result item
      const resultItem: Item = {
        id: uuid(),
        turnId: turn.id,
        type: 'tool_result',
        toolResultContent: resultContent,
        toolResultIsError: isError,
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      turn.items.push(resultItem);
      send({ type: 'item_created', threadId: thread.id, turnId: turn.id, item: resultItem });
      send({ type: 'item_completed', threadId: thread.id, turnId: turn.id, itemId: resultItem.id });

      // Add to tool results for the API message
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolItem.id,
        content: resultContent,
        is_error: isError,
      } as ContentBlock);
    }

    // Append to conversation messages
    messages.push({ role: 'assistant', content: assistantContent });
    messages.push({ role: 'user', content: toolResults });

    // Reset tracking for next iteration
    currentTextItem = null;
    currentTextItemIndex = -1;
    currentThinkingItem = null;
    currentThinkingItemIndex = -1;
    toolUseItems.clear();
    toolUseInputs.clear();
  }

  // Safety valve: max turns exceeded
  turn.status = 'completed';
  turn.stopReason = 'max_tool_rounds';
  turn.completedAt = Date.now();
  send({
    type: 'turn_completed',
    threadId: thread.id,
    turnId: turn.id,
    stopReason: 'max_tool_rounds',
  });
}

/**
 * Build the Anthropic messages array from thread conversation history.
 */
function buildMessages(thread: Thread, currentTurn: Turn): MessageParam[] {
  const messages: MessageParam[] = [];

  // Add all prior turns
  for (const turn of thread.turns) {
    if (turn.id === currentTurn.id) break;

    // User message
    messages.push({ role: 'user', content: turn.userMessage });

    // Assistant content blocks from this turn
    if (turn.items.length > 0) {
      const assistantContent: ContentBlock[] = [];
      for (const item of turn.items) {
        if (item.type === 'text' && item.content) {
          assistantContent.push({ type: 'text', text: item.content });
        } else if (item.type === 'tool_use' && item.toolName) {
          assistantContent.push({
            type: 'tool_use',
            id: item.id,
            name: item.toolName,
            input: item.toolInput || {},
          });
        } else if (item.type === 'tool_result') {
          assistantContent.push({
            type: 'tool_result',
            tool_use_id: item.id,
            content: item.toolResultContent || '',
            is_error: item.toolResultIsError,
          });
        }
      }
      if (assistantContent.length > 0) {
        messages.push({ role: 'assistant', content: assistantContent });
      }
    }
  }

  // Add current turn's user message
  messages.push({ role: 'user', content: currentTurn.userMessage });

  return messages;
}
