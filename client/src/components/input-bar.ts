import { store } from '../state/store.js';
import type { AttachedImage } from '../state/store.js';
import type { WsClient } from '../services/ws-client.js';

// Icons for different select types
const ICONS = {
  model: '🤖',
  effort: '⚡'
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
const MAX_IMAGES = 8;                    // hard cap to keep payload reasonable
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function renderInputBar(wsClient: WsClient): void {
  const el = document.getElementById('input-bar')!;
  const models = store.state.models;
  const efforts = store.state.efforts;
  const skills = store.state.skills;
  const selectedModel = store.state.selectedModel;
  const selectedEffort = store.state.selectedEffort;
  const attachedImages = store.state.attachedImages;

  // Helper: get label by id
  const getModelLabel = (id: string) => models.find(m => m.id === id)?.label || '选择模型...';
  const getEffortLabel = (id: string) => efforts.find(e => e.id === id)?.label || '推理强度';

  el.innerHTML = `
    <div class="input-bar-wrapper">
      <!-- Settings Row (Model & Effort) -->
      <div class="settings-row">
        <!-- Model Select -->
        <div class="custom-select-wrapper model" data-type="model">
          <div class="custom-select-trigger">
            <span class="icon">${ICONS.model}</span>
            <span class="label">${models.length ? getModelLabel(selectedModel || '') : '加载中...'}</span>
            <span class="arrow">▼</span>
          </div>
          <div class="custom-dropdown">
            ${(models.length ? models : [{id: '', label: '加载中...'}]).map(m => `
              <div class="custom-dropdown-item ${selectedModel === m.id ? 'selected' : ''}" data-value="${m.id}">
                <span class="item-icon">•</span>
                <span>${m.label}</span>
              </div>
            `).join('')}
          </div>
          <select id="model-select" class="model-select" style="display:none;">
            ${models.map(m => `<option value="${m.id}" ${m.id === selectedModel ? 'selected' : ''}>${m.label}</option>`).join('') || '<option>加载中...</option>'}
          </select>
        </div>

        <!-- Effort Select -->
        <div class="custom-select-wrapper effort" data-type="effort">
          <div class="custom-select-trigger">
            <span class="icon">${ICONS.effort}</span>
            <span class="label">${getEffortLabel(selectedEffort || '')}</span>
            <span class="arrow">▼</span>
          </div>
          <div class="custom-dropdown">
            ${efforts.map(e => `
              <div class="custom-dropdown-item ${selectedEffort === e.id ? 'selected' : ''}" data-value="${e.id}">
                <span class="item-icon">•</span>
                <span>${e.label}</span>
              </div>
            `).join('')}
          </div>
          <select id="effort-select" class="effort-select" style="display:none;">
            ${efforts.map(e => `<option value="${e.id}" ${e.id === selectedEffort ? 'selected' : ''}>${e.label}</option>`).join('') || '<option>max</option>'}
          </select>
        </div>
      </div>

      <!-- Image Previews (only when there are attached images) -->
      ${attachedImages.length > 0 ? `
        <div class="attached-images-row" id="attached-images-row">
          ${attachedImages.map(img => `
            <div class="attached-image" data-image-id="${img.id}" title="${escapeAttr(img.filename)}">
              <img src="${img.preview}" alt="${escapeAttr(img.filename)}" />
              <button class="attached-image-remove" data-remove-id="${img.id}" title="移除">✕</button>
            </div>
          `).join('')}
          <span class="attached-images-count">${attachedImages.length} 张图片</span>
        </div>
      ` : ''}

      <!-- Input Row -->
      <div class="input-row">
        <div class="input-wrapper">
          <button id="attach-image-btn" title="附加图片" aria-label="附加图片">📎</button>
          <input type="file" id="image-file-input" accept="image/jpeg,image/png,image/gif,image/webp" multiple style="display:none" />
          <textarea id="prompt-input" placeholder="输入 coding 任务... (输入 '/' 选择 Skill)" rows="1"></textarea>
          <div id="skill-autocomplete" class="skill-autocomplete hidden"></div>
          <button id="send-btn" title="发送">↑</button>
        </div>
      </div>
    </div>
  `;

  // Initialize custom selects and skill autocomplete
  initCustomSelects();
  initSkillAutocomplete(skills);
  initImageAttach();
  initAttachedImageRemovers();

  // Get DOM elements
  const textarea = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;

  // Auto-resize textarea
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });

  // Send on button click
  sendBtn.addEventListener('click', () => submit(wsClient, textarea));

  // Send on Enter (without Shift)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const autocomplete = document.getElementById('skill-autocomplete') as HTMLElement;
      if (!autocomplete.classList.contains('hidden')) {
        return;
      }
      e.preventDefault();
      submit(wsClient, textarea);
    }
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function initCustomSelects(): void {
  const wrappers = document.querySelectorAll('.custom-select-wrapper');

  wrappers.forEach(wrapper => {
    const trigger = wrapper.querySelector('.custom-select-trigger') as HTMLElement;
    const dropdown = wrapper.querySelector('.custom-dropdown') as HTMLElement;
    const hiddenSelect = wrapper.querySelector('select') as HTMLSelectElement;
    const type = wrapper.getAttribute('data-type') || '';

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
        if (w !== wrapper) w.classList.remove('open');
      });
      wrapper.classList.toggle('open');
    });

    const items = dropdown.querySelectorAll('.custom-dropdown-item');
    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = item.getAttribute('data-value') || '';
        const label = item.querySelector('span:nth-child(2)')?.textContent || '';

        const triggerLabel = trigger.querySelector('.label') as HTMLElement;
        triggerLabel.textContent = label;

        items.forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');

        hiddenSelect.value = value;

        if (type === 'model') {
          store.setSelectedModel(value);
        } else if (type === 'effort') {
          store.setSelectedEffort(value);
        }

        wrapper.classList.remove('open');
      });
    });
  });

  document.addEventListener('click', () => {
    wrappers.forEach(w => w.classList.remove('open'));
  });
}

function initSkillAutocomplete(skills: any[]): void {
  const textarea = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const autocomplete = document.getElementById('skill-autocomplete') as HTMLElement;

  let activeIndex = -1;

  const updateAutocomplete = () => {
    const value = textarea.value;
    const lines = value.split('\n');
    const currentLine = lines[lines.length - 1];

    if (currentLine.startsWith('/')) {
      const filterText = currentLine.substring(1).toLowerCase();
      activeIndex = -1;

      const filteredSkills = skills.filter(s =>
        s.id.toLowerCase().includes(filterText) ||
        s.label.toLowerCase().includes(filterText)
      );

      if (filteredSkills.length > 0) {
        autocomplete.innerHTML = `
          <div class="autocomplete-header">选择 Skill</div>
          ${filteredSkills.map((s, i) => `
            <div class="autocomplete-item ${i === activeIndex ? 'active' : ''}" data-skill="${s.id}">
              <span class="skill-name">/${s.id}</span>
              <span class="skill-desc">${s.description || ''}</span>
            </div>
          `).join('')}
        `;
        autocomplete.classList.remove('hidden');

        autocomplete.querySelectorAll('.autocomplete-item').forEach((item, i) => {
          item.addEventListener('click', () => selectSkill(item as HTMLElement));
        });
      } else {
        autocomplete.classList.add('hidden');
      }
    } else {
      autocomplete.classList.add('hidden');
    }
  };

  const selectSkill = (item: HTMLElement) => {
    const skillId = item.getAttribute('data-skill') || '';
    const value = textarea.value;
    const lines = value.split('\n');

    lines[lines.length - 1] = `/${skillId} `;

    textarea.value = lines.join('\n');
    textarea.focus();

    setTimeout(() => {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }, 0);

    autocomplete.classList.add('hidden');
  };

  textarea.addEventListener('keydown', (e) => {
    if (autocomplete.classList.contains('hidden')) return;

    const items = autocomplete.querySelectorAll('.autocomplete-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      updateActiveItem(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = activeIndex <= 0 ? items.length - 1 : activeIndex - 1;
      updateActiveItem(items);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectSkill(items[activeIndex] as HTMLElement);
    } else if (e.key === 'Escape') {
      autocomplete.classList.add('hidden');
    }
  });

  const updateActiveItem = (items: NodeListOf<Element>) => {
    items.forEach((item, i) => {
      item.classList.toggle('active', i === activeIndex);
      if (i === activeIndex) {
        item.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  textarea.addEventListener('input', updateAutocomplete);
}

/**
 * Wire the "📎" button + hidden <input type="file"> to attach images.
 * When files are picked, read them as data URLs and push to the store,
 * which triggers a re-render to show thumbnails.
 */
function initImageAttach(): void {
  const attachBtn = document.getElementById('attach-image-btn') as HTMLButtonElement | null;
  const fileInput = document.getElementById('image-file-input') as HTMLInputElement | null;
  if (!attachBtn || !fileInput) return;

  attachBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) return;

    const remaining = MAX_IMAGES - store.state.attachedImages.length;
    if (remaining <= 0) {
      alert(`最多只能附加 ${MAX_IMAGES} 张图片`);
      fileInput.value = '';
      return;
    }

    const toProcess = files.slice(0, remaining);
    if (files.length > remaining) {
      alert(`已截取前 ${remaining} 张图片（最多 ${MAX_IMAGES} 张）`);
    }

    for (const file of toProcess) {
      if (!SUPPORTED_TYPES.includes(file.type)) {
        alert(`不支持的图片格式：${file.type || file.name}（仅支持 JPG/PNG/GIF/WebP）`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        alert(`图片 ${file.name} 超过 5MB 大小限制（实际 ${(file.size / 1024 / 1024).toFixed(1)} MB）`);
        continue;
      }
      try {
        const data = await readFileAsBase64(file);
        const preview = `data:${file.type};base64,${data}`;
        store.addAttachedImage({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          mediaType: file.type,
          data,
          preview,
          filename: file.name,
        });
      } catch (err: any) {
        alert(`读取 ${file.name} 失败：${err.message}`);
      }
    }

    // Reset the input so the same file can be selected again
    fileInput.value = '';
  });
}

function initAttachedImageRemovers(): void {
  document.querySelectorAll('.attached-image-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.removeId;
      if (id) store.removeAttachedImage(id);
    });
  });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result is "data:image/png;base64,XXXXX" — strip the prefix
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(file);
  });
}

function submit(wsClient: WsClient, textarea: HTMLTextAreaElement): void {
  const rawContent = textarea.value.trim();
  const attachedImages = store.state.attachedImages;

  // Need at least a text message OR attached images to submit
  if (!rawContent && attachedImages.length === 0) return;

  const activeThread = store.getActiveThread();
  const isRunning = activeThread && store.state.runningThreadIds.has(activeThread.id);
  if (isRunning) return;

  // Handle built-in commands
  if (rawContent === '/clear') {
    store.setActiveThread(null);
    textarea.value = '';
    textarea.style.height = 'auto';
    return;
  }
  if (rawContent === '/export') {
    if (activeThread) {
      wsClient.send({ type: 'export_thread', threadId: activeThread.id });
    }
    textarea.value = '';
    textarea.style.height = 'auto';
    return;
  }

  // Build image attachments payload (drop the preview, only send {mediaType, data})
  const images = attachedImages.map(({ mediaType, data }) => ({ mediaType, data }));

  wsClient.send({
    type: 'submit_task',
    threadId: activeThread?.id,
    content: rawContent,
    images: images.length > 0 ? images : undefined,
    cwd: activeThread?.cwd,
    model: store.state.selectedModel || undefined,
    effort: store.state.selectedEffort || undefined,
  });

  // Clear the input + attached images
  textarea.value = '';
  textarea.style.height = 'auto';
  store.clearAttachedImages();
}
