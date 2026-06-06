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
    html += `<div class="message-group">`;

    // Split user-input items (images) from assistant items, so images can be
    // grouped visually with the user text bubble on the right side.
    const imageItems = turn.items.filter((i: any) => i.type === 'image');
    const otherItems = turn.items.filter((i: any) => i.type !== 'image');

    html += `<div class="user-input-group">`;
    for (const img of imageItems) {
      html += renderItem(img);
    }
    if (turn.userMessage || imageItems.length === 0) {
      html += `<div class="message-bubble user">${escapeHtml(turn.userMessage || '')}</div>`;
    }
    html += `</div>`;

    html += `<div class="message-timestamp user-ts"><span>${formatTimestamp(turn.startedAt)}</span><button class="copy-msg-btn">复制</button></div>`;

    for (const item of otherItems) {
      html += renderItem(item);
    }

    if (turn.status === 'running') {
      html += `<div class="running-indicator" style="padding:8px"><span class="dot"></span><span class="dot"></span><span class="dot"></span> Agent 运行中...</div>`;
    }
    html += `</div>`;
  }

  messagesDiv.innerHTML = html;

  // Add copy button listeners
  messagesDiv.querySelectorAll('.copy-msg-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Copy from the adjacent message bubble's text content
      const wrap = (btn as HTMLElement).closest('.message-group') || (btn as HTMLElement).closest('.msg-actions-wrap');
      const bubble = wrap?.querySelector('.message-bubble');
      if (bubble) {
        navigator.clipboard.writeText(bubble.textContent || '').then(() => {
          (btn as HTMLElement).textContent = '✓';
          setTimeout(() => { (btn as HTMLElement).textContent = '复制'; }, 1500);
        });
      }
    });
  });

  // Add image click listeners → open lightbox
  messagesDiv.querySelectorAll('.user-image-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const el = item as HTMLElement;
      const img = el.querySelector('img') as HTMLImageElement | null;
      if (img?.src) openImageLightbox(img.src);
    });
  });

  if (isScrolledToBottom) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

/**
 * Open a full-size image lightbox. Builds the element on demand and inserts
 * it into <body> so it overlays the entire viewport.
 */
function openImageLightbox(src: string): void {
  // Remove any existing lightbox
  const existing = document.getElementById('image-lightbox');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'image-lightbox';
  overlay.className = 'image-lightbox';
  overlay.innerHTML = `
    <button class="image-lightbox-close" title="关闭">✕</button>
    <img class="image-lightbox-img" src="${src}" alt="全屏图片" />
  `;
  document.body.appendChild(overlay);

  // Force reflow then add 'open' class for animation
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 180);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  overlay.addEventListener('click', (e) => {
    // Click outside the image (on backdrop) closes
    if (e.target === overlay || (e.target as HTMLElement).classList.contains('image-lightbox-close')) {
      close();
    }
  });
  document.addEventListener('keydown', onKey);
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function renderItem(item: any): string {
  if (item.type === 'text') {
    return `<div class="msg-actions-wrap">
      <div class="message-bubble assistant">${formatMarkdown(item.content || '')}</div>
      <div class="msg-actions">
        <button class="copy-msg-btn">复制</button>
      </div>
    </div>`;
  }
  if (item.type === 'image') {
    const mediaType = item.imageMediaType || 'image/jpeg';
    const data = item.imageData || '';
    return `<div class="user-image-item">
      <img class="user-image-thumb" src="data:${mediaType};base64,${data}" alt="用户上传的图片" loading="lazy" />
    </div>`;
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
  if (!text) return '';

  // Step 1: Extract fenced code blocks to prevent markdown processing inside them
  const codeBlocks: string[] = [];
  let processed = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="md-code-block"><code>${escapeHtml(code)}</code></pre>`);
    return `\x00CB${idx}\x00`;
  });

  // Step 2: Extract inline code
  const inlineCodes: string[] = [];
  processed = processed.replace(/`([^`\n]+)`/g, (_match, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`);
    return `\x00IC${idx}\x00`;
  });

  // Step 3: Escape HTML in the remaining text
  processed = escapeHtml(processed);

  // Step 4: Process block-level elements

  // Tables: detect table blocks (lines starting with |)
  processed = processed.replace(/((?:^\|.+\|$\n?)+)/gm, (tableBlock) => {
    return formatTable(tableBlock);
  });

  // Horizontal rules (---, ***, ___)
  processed = processed.replace(/^[\s]{0,3}([-*_])\s*\1\s*\1(?:[\s]|\1)*$/gm, '<hr class="md-hr">');

  // Headers: ####, ###, ##, #
  processed = processed.replace(/^######\s+(.+)$/gm, '<h6 class="md-h6">$1</h6>');
  processed = processed.replace(/^#####\s+(.+)$/gm, '<h5 class="md-h5">$1</h5>');
  processed = processed.replace(/^####\s+(.+)$/gm, '<h4 class="md-h4">$1</h4>');
  processed = processed.replace(/^###\s+(.+)$/gm, '<h3 class="md-h3">$1</h3>');
  processed = processed.replace(/^##\s+(.+)$/gm, '<h2 class="md-h2">$1</h2>');
  processed = processed.replace(/^#\s+(.+)$/gm, '<h1 class="md-h1">$1</h1>');

  // Blockquotes (lines starting with >)
  processed = processed.replace(/^(?:&gt;\s?(.*))+$/gm, (quoteBlock) => {
    const content = quoteBlock.replace(/^&gt;\s?/gm, '');
    return `<blockquote class="md-blockquote">${content}</blockquote>`;
  });

  // Unordered lists: - item or * item
  processed = processed.replace(/^(?:[-*]\s+.+\n?)+/gm, (listBlock) => {
    return formatUnorderedList(listBlock);
  });

  // Ordered lists: 1. item, 2. item
  processed = processed.replace(/^(?:\d+\.\s+.+\n?)+/gm, (listBlock) => {
    return formatOrderedList(listBlock);
  });

  // Step 5: Process inline elements

  // Bold + Italic: ***text*** or ___text___
  processed = processed.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  processed = processed.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');

  // Bold: **text** or __text__
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  processed = processed.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_ (but not inside words)
  processed = processed.replace(/(?<!\w)\*(?!\*)(.+?)(?<!\*)\*(?!\w)/g, '<em>$1</em>');
  processed = processed.replace(/(?<!\w)_(?!_)(.+?)(?<!_)_(?!\w)/g, '<em>$1</em>');

  // Strikethrough: ~~text~~
  processed = processed.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links: [text](url)
  processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>');

  // Images: ![alt](url)
  processed = processed.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="md-image" src="$2" alt="$1" loading="lazy">');

  // Step 6: Restore inline code
  processed = processed.replace(/\x00IC(\d+)\x00/g, (_match, idx) => inlineCodes[parseInt(idx)]);

  // Step 7: Handle paragraphs - double newlines become paragraph breaks
  // Single newlines within paragraphs become <br>
  // But only process newlines that aren't already inside block elements
  const lines = processed.split('\n');
  let result = '';
  let inParagraph = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines - they break paragraphs
    if (trimmed === '') {
      if (inParagraph) {
        result += '</p>';
        inParagraph = false;
      }
      continue;
    }

    // Don't wrap block elements in <p>
    if (/^<(?:h[1-6]|hr|pre|blockquote|ul|ol|table|div)/.test(trimmed)) {
      if (inParagraph) {
        result += '</p>';
        inParagraph = false;
      }
      result += line;
      continue;
    }

    if (!inParagraph) {
      result += '<p class="md-paragraph">';
      inParagraph = true;
    } else {
      result += '<br>';
    }
    result += line;
  }
  if (inParagraph) result += '</p>';

  // Step 8: Restore fenced code blocks
  result = result.replace(/\x00CB(\d+)\x00/g, (_match, idx) => codeBlocks[parseInt(idx)]);

  return result;
}

function formatTable(block: string): string {
  const rows = block.trim().split('\n').filter(r => r.trim());
  if (rows.length < 2) return block;

  // Parse each row into cells
  const parseCells = (row: string): string[] => {
    return row.split('|').map(c => c.trim()).filter((c, i, arr) => {
      // Remove first and last empty cells from leading/trailing |
      if (i === 0 && c === '') return false;
      if (i === arr.length - 1 && c === '') return false;
      return true;
    });
  };

  const headerCells = parseCells(rows[0]);

  // Check if second row is a separator (---|---|---)
  let startIdx = 1;
  if (rows.length > 1 && /^[\s|:-]+$/.test(rows[1]) && rows[1].includes('-')) {
    startIdx = 2;
  }

  let html = '<div class="md-table-wrap"><table class="md-table">';

  // Header
  html += '<thead><tr>';
  for (const cell of headerCells) {
    html += `<th>${cell}</th>`;
  }
  html += '</tr></thead>';

  // Body
  html += '<tbody>';
  for (let i = startIdx; i < rows.length; i++) {
    const cells = parseCells(rows[i]);
    html += '<tr>';
    for (const cell of cells) {
      html += `<td>${cell}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';

  return html;
}

function formatUnorderedList(block: string): string {
  const items = block.trim().split('\n').filter(r => r.trim());
  let html = '<ul class="md-list">';
  for (const item of items) {
    const content = item.replace(/^[-*]\s+/, '');
    html += `<li>${content}</li>`;
  }
  html += '</ul>';
  return html;
}

function formatOrderedList(block: string): string {
  const items = block.trim().split('\n').filter(r => r.trim());
  let html = '<ol class="md-list">';
  for (const item of items) {
    const content = item.replace(/^\d+\.\s+/, '');
    html += `<li>${content}</li>`;
  }
  html += '</ol>';
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
