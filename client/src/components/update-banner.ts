// Update banner: shown above the chat container when a newer release is
// available on GitHub. Lets the user view release notes and download the APK.

import {
  checkForUpdate,
  dismissUpdate,
  isDismissed,
  openDownload,
  invalidateCache,
  type UpdateInfo,
} from '../services/update-checker.js';

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let bannerEl: HTMLElement | null = null;
let lastLatestVersion = '';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBanner(info: UpdateInfo): void {
  removeBanner();

  if (!info.available) return;
  if (isDismissed(info.latestVersion)) return;

  lastLatestVersion = info.latestVersion;

  const banner = document.createElement('div');
  banner.id = 'update-banner';
  banner.className = 'update-banner';
  banner.innerHTML = `
    <div class="update-banner-icon">🎉</div>
    <div class="update-banner-body">
      <div class="update-banner-title">发现新版本 v${escapeHtml(info.latestVersion)}</div>
      <div class="update-banner-sub">当前 v${escapeHtml(info.currentVersion)} · 点击查看更新内容</div>
    </div>
    <div class="update-banner-actions">
      <button class="update-banner-btn update-banner-dismiss" title="忽略此版本" aria-label="dismiss">✕</button>
    </div>
  `;

  banner.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.update-banner-dismiss')) {
      dismissUpdate(info.latestVersion);
      removeBanner();
      return;
    }
    showUpdateDialog(info);
  });

  const main = document.getElementById('main-area');
  const statusBar = document.getElementById('status-bar');
  if (main && statusBar && statusBar.parentElement === main) {
    main.insertBefore(banner, statusBar.nextSibling);
  } else if (main) {
    main.prepend(banner);
  } else {
    document.body.appendChild(banner);
  }
  bannerEl = banner;
}

function removeBanner(): void {
  if (bannerEl) {
    bannerEl.remove();
    bannerEl = null;
  }
}

function showUpdateDialog(info: UpdateInfo): void {
  const existing = document.getElementById('update-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'update-dialog';
  dialog.className = 'update-dialog-overlay';
  dialog.innerHTML = `
    <div class="update-dialog" role="dialog" aria-modal="true">
      <div class="update-dialog-header">
        <div class="update-dialog-title">🎉 发现新版本</div>
        <button class="update-dialog-close" aria-label="close">✕</button>
      </div>
      <div class="update-dialog-version">
        v${escapeHtml(info.currentVersion)} → <strong>v${escapeHtml(info.latestVersion)}</strong>
      </div>
      <div class="update-dialog-notes">${
        info.releaseNotes
          ? `<pre>${escapeHtml(info.releaseNotes)}</pre>`
          : '<div class="update-dialog-empty">无更新说明</div>'
      }</div>
      <div class="update-dialog-actions">
        <button class="update-dialog-btn update-dialog-later">稍后</button>
        <button class="update-dialog-btn update-dialog-primary">下载并安装</button>
      </div>
    </div>
  `;

  const close = () => dialog.remove();
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });
  dialog.querySelector('.update-dialog-close')!.addEventListener('click', close);
  dialog.querySelector('.update-dialog-later')!.addEventListener('click', () => {
    dismissUpdate(info.latestVersion);
    close();
  });
  dialog.querySelector('.update-dialog-primary')!.addEventListener('click', () => {
    const url = info.apkUrl || info.releaseUrl;
    if (url) openDownload(url);
  });

  document.body.appendChild(dialog);
}

export async function runUpdateCheck(force = false): Promise<UpdateInfo | null> {
  try {
    if (force) invalidateCache();
    const info = await checkForUpdate(force);
    renderBanner(info);
    return info;
  } catch (err) {
    console.warn('[update] check failed:', err);
    return null;
  }
}

export function startAutoUpdateCheck(): void {
  // First check after a short delay so we don't compete with the initial render
  setTimeout(() => {
    runUpdateCheck(false);
  }, 5_000);

  // Periodic background checks
  setInterval(() => {
    runUpdateCheck(false);
  }, CHECK_INTERVAL_MS);
}

export function getLastLatestVersion(): string {
  return lastLatestVersion;
}
