import { store } from '../state/store.js';
import type { WsClient } from '../services/ws-client.js';

export function renderInputBar(wsClient: WsClient): void {
  const el = document.getElementById('input-bar')!;
  const models = store.state.models;
  const efforts = store.state.efforts;
  const skills = store.state.skills;
  const selectedModel = store.state.selectedModel;
  const selectedEffort = store.state.selectedEffort;

  // Build model options
  const modelOptions = models.map(m =>
    `<option value="${m.id}" ${m.id === selectedModel ? 'selected' : ''}>${m.label}</option>`
  ).join('');

  // Build effort options
  const effortOptions = efforts.map(e =>
    `<option value="${e.id}" ${e.id === selectedEffort ? 'selected' : ''}>${e.label}</option>`
  ).join('');

  // Build skill options
  const skillOptions = skills.map(s =>
    `<option value="${s.id}" title="${s.description}">${s.label}</option>`
  ).join('');

  el.innerHTML = `
    <div class="model-selector-row">
      <select id="skill-select" class="skill-select">
        <option value="">无 Skill</option>
        ${skillOptions}
      </select>
      <select id="model-select" class="model-select">${modelOptions || '<option>加载中...</option>'}</select>
      <select id="effort-select" class="effort-select">${effortOptions || '<option>max</option>'}</select>
    </div>
    <div class="input-wrapper">
      <textarea id="prompt-input" placeholder="输入 coding 任务..." rows="1"></textarea>
      <button id="send-btn" title="发送">↑</button>
    </div>
  `;

  const textarea = document.getElementById('prompt-input') as HTMLTextAreaElement;
  const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
  const effortSelect = document.getElementById('effort-select') as HTMLSelectElement;
  const skillSelect = document.getElementById('skill-select') as HTMLSelectElement;

  // Model selection
  modelSelect.addEventListener('change', () => {
    store.setSelectedModel(modelSelect.value);
  });

  // Effort selection
  effortSelect.addEventListener('change', () => {
    store.setSelectedEffort(effortSelect.value);
  });

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
}
