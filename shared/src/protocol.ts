// === WebSocket Message Protocol ===
// Client ↔ Server communication types

import type { Thread, Turn, Item, ItemDelta, Usage, ThreadSummary } from './session.js';

// === Client → Server ---

/** Attached image for user message */
export interface ImageAttachment {
  /** MIME type, e.g. "image/jpeg", "image/png", "image/gif", "image/webp" */
  mediaType: string;
  /** Base64-encoded data (without the `data:` prefix) */
  data: string;
}

export interface SubmitTaskMessage {
  type: 'submit_task';
  threadId?: string;    // If omitted, create new thread
  content: string;
  /** Optional images to attach to the user message */
  images?: ImageAttachment[];
  cwd?: string;         // Working directory (for new threads)
  model?: string;       // Override model (for new threads)
  effort?: string;      // Override effort level (for new threads): low|medium|high|xhigh|max
}

export interface ListModelsMessage {
  type: 'list_models';
}

export interface ListSkillsMessage {
  type: 'list_skills';
}

export interface ReloadSessionsMessage {
  type: 'reload_sessions';
}

export interface ArchiveThreadMessage {
  type: 'archive_thread';
  threadId: string;
  archived: boolean;
}

export interface RenameThreadMessage {
  type: 'rename_thread';
  threadId: string;
  title: string;
}

export interface ExportThreadMessage {
  type: 'export_thread';
  threadId: string;
}

export interface DeleteThreadMessage {
  type: 'delete_thread';
  threadId: string;
}

export interface PinThreadMessage {
  type: 'pin_thread';
  threadId: string;
  pinned: boolean;
}

export interface ApproveToolMessage {
  type: 'approve_tool';
  threadId: string;
  turnId: string;
  itemId: string;
  approved: boolean;
}

export interface CancelTaskMessage {
  type: 'cancel_task';
  threadId: string;
}

export interface ResumeSessionMessage {
  type: 'resume_session';
  threadId: string;
}

export interface ListThreadsMessage {
  type: 'list_threads';
}

export interface GetThreadMessage {
  type: 'get_thread';
  threadId: string;
}

export type ClientMessage =
  | SubmitTaskMessage
  | ApproveToolMessage
  | CancelTaskMessage
  | ResumeSessionMessage
  | ListThreadsMessage
  | GetThreadMessage
  | ListModelsMessage
  | ListSkillsMessage
  | ReloadSessionsMessage
  | ArchiveThreadMessage
  | RenameThreadMessage
  | ExportThreadMessage
  | DeleteThreadMessage
  | PinThreadMessage;

// --- Server → Client ---

export interface ConnectedMessage {
  type: 'connected';
  serverVersion: string;
}

export interface ThreadCreatedMessage {
  type: 'thread_created';
  thread: Thread;
}

export interface TurnStartedMessage {
  type: 'turn_started';
  threadId: string;
  turnId: string;
  userMessage: string;
}

export interface ItemCreatedMessage {
  type: 'item_created';
  threadId: string;
  turnId: string;
  item: Item;
}

export interface ItemDeltaMessage {
  type: 'item_delta';
  threadId: string;
  turnId: string;
  itemId: string;
  delta: ItemDelta;
}

export interface ItemCompletedMessage {
  type: 'item_completed';
  threadId: string;
  turnId: string;
  itemId: string;
}

export interface TurnCompletedMessage {
  type: 'turn_completed';
  threadId: string;
  turnId: string;
  stopReason: string;
  usage?: Usage;
}

export interface ToolApprovalRequiredMessage {
  type: 'tool_approval_required';
  threadId: string;
  turnId: string;
  itemId: string;
  toolName: string;
  input: unknown;
}

export interface ThreadsListMessage {
  type: 'threads_list';
  threads: ThreadSummary[];
}

export interface SkillInfo {
  id: string;
  label: string;
  description: string;
}

export interface SkillsListMessage {
  type: 'skills_list';
  skills: SkillInfo[];
}

export interface ModelInfo {
  id: string;         // e.g. "opus" - CLI alias, used in --model arg
  label: string;      // e.g. "Opus 4.7" - display name
}

export interface EffortLevel {
  id: string;         // e.g. "max"
  label: string;      // e.g. "Max"
}

export interface ModelsListMessage {
  type: 'models_list';
  models: ModelInfo[];
  efforts: EffortLevel[];
}

export interface ThreadDetailMessage {
  type: 'thread_detail';
  thread: Thread;
  usage?: Usage;
}

export interface ExportResponseMessage {
  type: 'export_response';
  threadId: string;
  jsonl: string;
}

export interface UsageUpdateMessage {
  type: 'usage_update';
  threadId: string;
  usage: Usage;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  code?: string;
}

export type ServerMessage =
  | ConnectedMessage
  | ThreadCreatedMessage
  | TurnStartedMessage
  | ItemCreatedMessage
  | ItemDeltaMessage
  | ItemCompletedMessage
  | TurnCompletedMessage
  | ToolApprovalRequiredMessage
  | ThreadsListMessage
  | ThreadDetailMessage
  | ExportResponseMessage
  | ModelsListMessage
  | SkillsListMessage
  | UsageUpdateMessage
  | ErrorMessage;
