import { store } from '../state/store.js';
import type { WsClient } from '../services/ws-client.js';

// Icons for different select types
const ICONS = {
  skill: '🧩',
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
  const selectedSkill = store.state.selectedSkill || '';

  // Helper: get label by id
  const getModelLabel = (id: string) => models.find(m => m.id === id)?.label || '选择模型...';
  const getEffortLabel = (id: string) => efforts.find(e => e.id === id)?.label || '推理强度';
  const getSkillLabel = (id: string) => id ? (skills.find(s => s.id === id)?.label || 'Skill') : '无 Skill';

  el.innerHTML = `
    <div class="model-selector-row">
      <!-- Skill Select -->
      <div class="custom-select-wrapper skill" data-type="skill">
        <div class="custom-select-trigger">
          <span class="icon">${ICONS.skill}</span>
          <span class="label">${getSkillLabel(selectedSkill)}</span>
          <span class="arrow">▼</span>
        </div>
        <div class="custom-dropdown">
          <div class="custom-dropdown-item ${!selectedSkill ? 'selected' : ''}" data-value="">
            <span class="item-icon">—</span>
            <span>无 Skill</span>
          </div>
          ${skills.map(s => `
            <div class="custom-dropdown-item ${selectedSkill === s.id ? 'selected' : ''}" data-value="${s.id}">
              <span class="item-icon">•</span>
              <span>${s.label}</span>
              <span class="desc">${s.description || ''}</span>
            </div>
          `).join('')}
        </div>
        <select id="skill-select" class="skill-select">
          <option value="">无 Skill</option>
          ${skills.map(s => `<option value="${s.id}" title="${s.description}">${s.label}</option>`).join('')}
        </select>
      </div>

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
        <select id="model-select" class="model-select">
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
        <select id="effort-select" class="effort-select">
          ${efforts.map(e => `<option value="${e.id}" ${e.id === selectedEffort ? 'selected' : ''}>${e.label}</option>`).join('') || '<option>max</option>'}
        </select>
      </div>
    </div>

    <div class="input-wrapper">
      <textarea id="prompt-input" placeholder="输入 coding 任务..." rows="1"></textarea>
      <button id="send-btn" title="发送">↑</button>
    </div>
  `;

  // Initialize custom selects
  initCustomSelects();

  // Get DOM elements
  const textarea = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const skillSelect = document.getElementById('skill-select') as HTMLSelectElement;

  // Auto-resize textarea
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });

  // Send on button click
  sendBtn.addEventListener('click', () => submit(wsClient, textarea, skillSelect));

  // Send on Enter (without Shift)
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit(wsClient, textarea, skillSelect);
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

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close all others first
      document.querySelectorAll('.custom-select-wrapper.open').forEach(w => {
        if (w !== wrapper) w.classList.remove('open');
      });
      wrapper.classList.toggle('open');
    });

    // Item selection
    const items = dropdown.querySelectorAll('.custom-dropdown-item');
    items.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const value = item.getAttribute('data-value') || '';
        const label = item.querySelector('span:nth-child(2)')?.textContent || '';
        
        // Update UI
        const triggerLabel = trigger.querySelector('.label') as HTMLElement;
        triggerLabel.textContent = label;
        
        // Update selected state
        items.forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        
        // Update hidden select
        hiddenSelect.value = value;
        
        // Update store
        if (type === 'model') {
          store.setSelectedModel(value);
        } else if (type === 'effort') {
          store.setSelectedEffort(value);
        } else if (type === 'skill') {
          store.setSelectedSkill(value);
        }
        
        wrapper.classList.remove('open');
      });
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    wrappers.forEach(w => w.classList.remove('open'));
  });
}

function submit(wsClient: WsClient, textarea: HTMLTextAreaElement, skillSelect: HTMLSelectElement): void {
  const rawContent = textarea.value.trim();
  if (!rawContent) return;

  const activeThread = store.getActiveThread();
  const isRunning = activeThread && store.state.runningThreadIds.has(activeThread.id);

  if (isRunning) return;

  // Prepend /skill-name if a skill is selected
  const selectedSkill = skillSelect.value;
  const content = selectedSkill ? `/${selectedSkill} ${rawContent}` : rawContent;

  wsClient.send({
    type: 'submit_task',
    threadId: activeThread?.id,
    content,
    cwd: activeThread?.cwd,
    model: store.state.selectedModel || undefined,
    effort: store.state.selectedEffort || undefined,
  });

  textarea.value = '';
  textarea.style.height = 'auto';
  
  // Reset skill select
  skillSelect.value = '';
  // Also update custom UI for skill
  const skillWrapper = document.querySelector('.custom-select-wrapper.skill') as HTMLElement;
  if (skillWrapper) {
    const triggerLabel = skillWrapper.querySelector('.custom-select-trigger .label') as HTMLElement;
    const items = skillWrapper.querySelectorAll('.custom-dropdown-item');
    if (triggerLabel) triggerLabel.textContent = '无 Skill';
    items.forEach(item => {
      item.classList.toggle('selected', item.getAttribute('data-value') === '');
    });
  }
  store.setSelectedSkill('');
}
