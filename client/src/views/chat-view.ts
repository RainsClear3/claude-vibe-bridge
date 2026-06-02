import { store } from '../state/store.js';

let chatContainer: HTMLElement;
let messagesDiv: HTMLElement;
let isScrolledToBottom = true;
let subscribed = false;

export function renderChatView(): void {
  chatContainer = document.getElementById('chat-container')!;
  messagesDiv = document.getElementById('messages')!;

  if (!subscribed) {
    subscribed = true;
    chatContainer.addEventListener('scroll', () => {
      const threshold = 50;
      isScrolledToBottom =
        chatContainer.scrollTop + chatContainer.clientHeight >=
        chatContainer.scrollHeight - threshold;
    });
    store.subscribe(updateMessages);
  }

  updateMessages();
}

function updateMessages(): void {
  const thread = store.getActiveThread();

  if (!thread || thread.turns.length === 0) {
    messagesDiv.innerHTML = `
      <div class="empty-state">
        <p>Claude Vibe Bridge</p>
        <p style="margin-top:8px;font-size:13px">在下方输入 coding 任务，Claude 会在电脑上执行</p>
      </div>
    `;
    return;
  }

  let html = '';

  for (const turn of thread.turns) {
    html += `<div class="message-bubble user">${escapeHtml(turn.userMessage)}</div>`;

    for (const item of turn.items) {
      html += renderItem(item);
    }

    if (turn.status === 'running') {
      html += `<div class="running-indicator" style="padding:8px"><span class="dot"></span><span class="dot"></span><span class="dot"></span> Agent 运行中...</div>`;
    }
  }

  messagesDiv.innerHTML = html;

  if (isScrolledToBottom) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function renderItem(item: any): string {
  if (item.type === 'text') {
    return `<div class="message-bubble assistant">${formatMarkdown(item.content || '')}</div>`;
  }
  if (item.type === 'thinking') {
    return `<div class="tool-card">
      <div class="tool-card-header" onclick="this.nextElementSibling.classList.toggle('open');this.querySelector('.toggle').classList.toggle('open')">
        <span class="tool-icon">🧠</span>
        <span class="tool-name">Thinking</span>
        <span class="toggle">▶</span>
      </div>
      <div class="tool-card-body">${escapeHtml(item.content || '')}</div>
    </div>`;
  }
  if (item.type === 'tool_use') {
    const summary = getToolSummary(item.toolName!, item.toolInput);
    const isRunning = !item.completedAt;
    return `<div class="tool-card">
      <div class="tool-card-header" onclick="this.nextElementSibling.classList.toggle('open');this.querySelector('.toggle').classList.toggle('open')">
        <span class="tool-icon">${getToolIcon(item.toolName!)}</span>
        <span class="tool-name">${item.toolName}</span>
        <span class="tool-summary">${escapeHtml(summary)}</span>
        ${isRunning ? '<span class="running-indicator"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>' : ''}
        <span class="toggle">▶</span>
      </div>
      <div class="tool-card-body">${formatToolInput(item.toolName!, item.toolInput)}</div>
    </div>`;
  }
  if (item.type === 'tool_result') {
    const isError = item.toolResultIsError;
    return `<div class="tool-card">
      <div class="tool-card-header" onclick="this.nextElementSibling.classList.toggle('open');this.querySelector('.toggle').classList.toggle('open')">
        <span class="tool-icon">${isError ? '❌' : '✅'}</span>
        <span class="tool-name">${isError ? 'Error' : 'Result'}</span>
        <span class="toggle">▶</span>
      </div>
      <div class="tool-card-body${isError ? ' result-error' : ''}">${escapeHtml(item.toolResultContent || '')}</div>
    </div>`;
  }
  if (item.type === 'error') {
    return `<div class="message-bubble error">${escapeHtml(item.content || '')}</div>`;
  }
  return '';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre style="background:var(--bg-primary);padding:8px;border-radius:6px;margin:8px 0;font-family:var(--font-mono);font-size:13px;overflow-x:auto">$2</pre>');
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg-primary);padding:2px 4px;border-radius:3px;font-family:var(--font-mono);font-size:13px">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return html;
}

function getToolSummary(name: string, input: any): string {
  if (!input) return '';
  switch (name) {
    case 'read_file': return input.path || '';
    case 'write_file': return input.path || '';
    case 'edit_file': return input.path || '';
    case 'execute_command': return input.command?.slice(0, 80) || '';
    case 'list_directory': return input.path || '';
    case 'search_files': return `${input.pattern} in ${input.path || ''}`;
    default: return JSON.stringify(input).slice(0, 80);
  }
}

function getToolIcon(name: string): string {
  switch (name) {
    case 'read_file': return '📖';
    case 'write_file': return '✏️';
    case 'edit_file': return '🔧';
    case 'execute_command': return '⚡';
    case 'list_directory': return '📁';
    case 'search_files': return '🔍';
    default: return '🔨';
  }
}

function formatToolInput(name: string, input: any): string {
  if (!input) return '';
  switch (name) {
    case 'read_file': return `Path: ${input.path}`;
    case 'write_file': return `Path: ${input.path}\nContent:\n${(input.content || '').slice(0, 500)}`;
    case 'edit_file': return `Path: ${input.path}\n\n- ${input.old_string}\n+ ${input.new_string}`;
    case 'execute_command': return `$ ${input.command}`;
    case 'list_directory': return `Path: ${input.path}`;
    case 'search_files': return `Pattern: ${input.pattern}\nPath: ${input.path}`;
    default: return JSON.stringify(input, null, 2);
  }
}
