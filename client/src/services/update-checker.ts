// GitHub Releases-based update checker for the Android APK.
// Anonymous requests to api.github.com are rate-limited (60/hour/IP); we cache
// the result in localStorage for 1 hour to avoid hitting the limit.

const REPO_OWNER = 'RainsClear3';
const REPO_NAME = 'claude-anywhere';
const CACHE_KEY = 'vb-update-cache';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseUrl: string;
  apkUrl: string;
  publishedAt: string;
  error?: string;
}

interface CachedUpdate {
  fetchedAt: number;
  latest: {
    tagName: string;
    body: string;
    htmlUrl: string;
    apkUrl: string;
    publishedAt: string;
  } | null;
  error?: string;
}

/** Read the bundled app version. Vite injects it at build time from
 *  capacitor.config.ts (see vite.config.ts `define` option). */
export function getCurrentVersion(): string {
  const injected = (globalThis as any).__APP_VERSION__;
  if (typeof injected === 'string' && injected.length > 0) return injected;
  return '0.0.0';
}

export function compareVersions(a: string, b: string): number {
  const strip = (v: string) => v.replace(/^v/i, '');
  const pa = strip(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = strip(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function readCache(): CachedUpdate | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUpdate;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data: CachedUpdate): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();

  // Try cache first (unless forced)
  if (!force) {
    const cached = readCache();
    if (cached) {
      if (cached.error) {
        return {
          available: false,
          currentVersion,
          latestVersion: '',
          releaseNotes: '',
          releaseUrl: '',
          apkUrl: '',
          publishedAt: '',
          error: cached.error,
        };
      }
      if (cached.latest) {
        const latestVersion = cached.latest.tagName.replace(/^v/i, '');
        return {
          available: compareVersions(latestVersion, currentVersion) > 0,
          currentVersion,
          latestVersion,
          releaseNotes: cached.latest.body,
          releaseUrl: cached.latest.htmlUrl,
          apkUrl: cached.latest.apkUrl,
          publishedAt: cached.latest.publishedAt,
        };
      }
    }
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status}`);
    }
    const release = await res.json();
    const tagName: string = release.tag_name || '';
    const body: string = release.body || '';
    const htmlUrl: string = release.html_url || '';
    const publishedAt: string = release.published_at || '';
    // Pick the release apk (prefer debug, then release, then any .apk)
    const assets: Array<{ name: string; browser_download_url: string }> = release.assets || [];
    const debugAsset = assets.find((a) => /debug/i.test(a.name) && a.name.endsWith('.apk'));
    const releaseAsset = assets.find((a) => /release/i.test(a.name) && a.name.endsWith('.apk'));
    const anyApk = assets.find((a) => a.name.endsWith('.apk'));
    const apkUrl = (debugAsset || releaseAsset || anyApk)?.browser_download_url || htmlUrl;

    writeCache({
      fetchedAt: Date.now(),
      latest: { tagName, body, htmlUrl, apkUrl, publishedAt },
    });

    const latestVersion = tagName.replace(/^v/i, '');
    return {
      available: compareVersions(latestVersion, currentVersion) > 0,
      currentVersion,
      latestVersion,
      releaseNotes: body,
      releaseUrl: htmlUrl,
      apkUrl,
      publishedAt,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Cache the error briefly so we don't hammer the API when offline
    writeCache({ fetchedAt: Date.now(), latest: null, error: message });
    return {
      available: false,
      currentVersion,
      latestVersion: '',
      releaseNotes: '',
      releaseUrl: '',
      apkUrl: '',
      publishedAt: '',
      error: message,
    };
  }
}

export function openDownload(url: string): void {
  // Best-effort: let the system handle the URL. On Android this triggers
  // a download / install prompt for the APK.
  window.open(url, '_blank', 'noopener');
}

export function dismissUpdate(latestVersion: string): void {
  try {
    localStorage.setItem(`vb-update-dismissed:${latestVersion}`, String(Date.now()));
  } catch {
    // ignore
  }
}

export function isDismissed(latestVersion: string): boolean {
  try {
    return !!localStorage.getItem(`vb-update-dismissed:${latestVersion}`);
  } catch {
    return false;
  }
}

export function invalidateCache(): void {
  clearCache();
}
