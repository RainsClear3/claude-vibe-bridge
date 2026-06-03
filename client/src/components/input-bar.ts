import { store } from '../state/store.js';
import type { WsClient } from '../services/ws-client.js';

// Icons for different select types
const ICONS = {
  model: '🤖',
  effort: '⚡'
};

export function renderInputBar(wsClient: WsClient): void {
  const el = document.getElementById('input-bar')!;
  const models = store.state.models;
  const efforts = store.state.efforts;
  const skills = store.state.skills;
  const selectedModel = store.state.selectedModel;
  const selectedEffort = store.state.selectedEffort;

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

      <!-- Input Row -->
      <div class="input-row">
        <div class="input-wrapper">
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

function submit(wsClient: WsClient, textarea: HTMLTextAreaElement): void {
  const rawContent = textarea.value.trim();
  if (!rawContent) return;

  const activeThread = store.getActiveThread();
  const isRunning = activeThread && store.state.runningThreadIds.has(activeThread.id);

  if (isRunning) return;

  wsClient.send({
    type: 'submit_task',
    threadId: activeThread?.id,
    content: rawContent,
    cwd: activeThread?.cwd,
    model: store.state.selectedModel || undefined,
    effort: store.state.selectedEffort || undefined,
  });

  textarea.value = '';
  textarea.style.height = 'auto';
}
