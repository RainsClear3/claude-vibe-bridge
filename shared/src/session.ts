// === Domain Model: Thread / Turn / Item ===
// Inspired by Codex's app-server-protocol (Thread → Turn → Item)

export interface Thread {
  id: string;
  title: string;
  cwd: string;            // Working directory on the PC
  model: string;
  systemPrompt?: string;
  createdAt: number;      // epoch ms
  lastActivityAt: number;
  turns: Turn[];
  permissionMode?: string;
}

export interface Turn {
  id: string;
  threadId: string;
  userMessage: string;
  items: Item[];
  status: 'running' | 'completed' | 'cancelled' | 'error';
  stopReason?: string;
  usage?: Usage;
  startedAt: number;
  completedAt?: number;
}

export interface Item {
  id: string;
  turnId: string;
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'error' | 'image';
  // For text/thinking: accumulated from deltas
  content?: string;
  // For tool_use:
  toolName?: string;
  toolInput?: Record<string, unknown>;
  // For tool_result:
  toolResultContent?: string;
  toolResultIsError?: boolean;
  // For image: base64-encoded image data from user message content
  imageMediaType?: string;   // e.g. "image/webp", "image/jpeg", "image/png", "image/gif"
  imageData?: string;        // base64 string (no data: prefix)
  // Metadata
  createdAt: number;
  completedAt?: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface ThreadSummary {
  id: string;
  title: string;
  cwd: string;
  model: string;
  createdAt: number;
  lastActivityAt: number;
  turnCount: number;
  lastMessage?: string;
  isArchived?: boolean;
  isPinned?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export type ItemDelta =
  | { subtype: 'text_delta'; text: string }
  | { subtype: 'thinking_delta'; thinking: string }
  | { subtype: 'input_json_delta'; partialJson: string };
