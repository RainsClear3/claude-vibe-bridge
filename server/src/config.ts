import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env but DON'T override system variables. 
// The user has already configured the system environment via cc-desktop-switch.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: false });

// --- Auto-discovery: scan Claude Desktop directories for UUIDs ---

const CLAUDE_3P_BASE = path.join(process.env.LOCALAPPDATA!, 'Claude-3p');

/** 
 * Auto-discover userId and appId from Claude Desktop's claude-code-sessions directory.
 * Scans: %LOCALAPPDATA%\Claude-3p\claude-code-sessions\{userId}\{appId}\
 * Returns the first valid pair found, or null.
 */
function discoverDesktopIds(): { userId: string; appId: string; sessionsDir: string } | null {
  const sessionsBase = path.join(CLAUDE_3P_BASE, 'claude-code-sessions');
  try {
    const userDirs = fs.readdirSync(sessionsBase);
    for (const userId of userDirs) {
      const userDir = path.join(sessionsBase, userId);
      if (!fs.statSync(userDir).isDirectory()) continue;
      const appDirs = fs.readdirSync(userDir);
      for (const appId of appDirs) {
        const appDir = path.join(userDir, appId);
        if (!fs.statSync(appDir).isDirectory()) continue;
        // Validate: directory should contain at least one .json file
        const files = fs.readdirSync(appDir).filter(f => f.endsWith('.json'));
        if (files.length > 0) {
          return { userId, appId, sessionsDir: appDir };
        }
      }
    }
  } catch {}
  return null;
}

const discovered = discoverDesktopIds();

// Final UUID values: .env override > auto-discovery > hardcoded fallback
const userId = process.env.CLAUDE_DESKTOP_USER_ID || discovered?.userId || '57cbd131-529f-47ce-92e3-ff7e091ef616';
const appId = process.env.CLAUDE_DESKTOP_APP_ID || discovered?.appId || '00000000-0000-4000-8000-000000000001';

if (discovered) {
  console.log(`[Config] Auto-discovered Claude Desktop: userId=${userId.slice(0, 8)}... appId=${appId.slice(0, 8)}...`);
}

export const config = {
  defaultModel: '',  // Empty = don't pass --model, let CLI use its default

  // Server
  port: parseInt(process.env.PORT || '3900', 10),

  // Security
  allowedDirs: (process.env.ALLOWED_DIRS || 'E:\\claude')
    .split('|')
    .map(d => d.trim()),
  
  // Authentication
  authEnabled: process.env.AUTH_ENABLED?.toLowerCase() === 'true',
  authUsername: process.env.AUTH_USERNAME || '',
  authPassword: process.env.AUTH_PASSWORD || '',

  // Claude Desktop 3P paths (auto-discovered or .env override)
  claudeDesktopUserId: userId,
  claudeDesktopAppId: appId,
};

// --- Model & Effort ---
// The CLI accepts short aliases (haiku/opus/sonnet) which it resolves
// through env vars ANTHROPIC_DEFAULT_*_MODEL to the actual API model names.
// We show Claude's surface names to the user.

export interface ModelConfig {
  cliAlias: string;   // CLI --model arg: "haiku", "opus", "sonnet"
  label: string;      // Display: "Opus 4.7", "Sonnet 4.6", "Haiku 4.5"
}

export interface EffortConfig {
  id: string;
  label: string;
}

export const EFFORT_LEVELS: EffortConfig[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra high' },
  { id: 'max', label: 'Max' },
];

// Surface model names for display (matches Claude Desktop's bottom-right menu)
const MODEL_SURFACE_NAMES: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.7',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
};

// Extract CLI alias from model name: "claude-opus-4-8" → "opus"
function extractAlias(name: string): string {
  if (name.includes('opus')) return 'opus';
  if (name.includes('sonnet')) return 'sonnet';
  if (name.includes('haiku')) return 'haiku';
  return name;
}

export function loadModelsFromConfigLibrary(): ModelConfig[] {
  const configLibDir = path.join(
    process.env.LOCALAPPDATA!,
    'Claude-3p', 'configLibrary'
  );
  try {
    const metaRaw = fs.readFileSync(path.join(configLibDir, '_meta.json'), 'utf-8');
    const meta = JSON.parse(metaRaw);
    const appliedId = meta.appliedId;
    if (!appliedId) return [];

    const configPath = path.join(configLibDir, `${appliedId}.json`);
    if (!fs.existsSync(configPath)) return [];

    const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const models: any[] = configData.inferenceModels || [];

    return models.map((m: any) => ({
      cliAlias: extractAlias(m.name),
      label: MODEL_SURFACE_NAMES[m.name] || m.labelOverride || m.name,
    }));
  } catch {
    return [];
  }
}
