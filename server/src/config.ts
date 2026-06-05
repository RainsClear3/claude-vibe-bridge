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
  allowedDirs: (process.env.ALLOWED_DIRS || `${process.env.USERPROFILE || 'C:\\'}`)
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
// We use labelOverride from configLibrary if available, otherwise fall back to surface name
const MODEL_SURFACE_NAMES: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.7',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
};

// Check if string indicates a 1M variant (case-insensitive)
function has1mSuffix(s: string): boolean {
  const lower = s.toLowerCase();
  return lower.includes('[1m]') || lower.includes(' 1m');
}

// Strip [1m]/[1M] suffix from model string (case-insensitive)
function strip1m(s: string): string {
  return s.replace(/\s*\[1m\]/i, '').trim();
}

// Extract CLI alias from standard Claude model name: "claude-opus-4-8" → "opus"
// Returns '' if the name doesn't match any known model family — no fallback.
function modelNameToAlias(name: string): string {
  const lower = strip1m(name).toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('sonnet')) return 'sonnet';
  if (lower.includes('haiku')) return 'haiku';
  return '';
}

// Normalize any model name to standard CLI alias.
// Accepts: CLI aliases ("opus", "sonnet[1m]"), Claude model names ("claude-opus-4-8"),
// labelOverride values ("mimo-v2.5"), or any mixed format.
// Returns '' if the name can't be resolved — no fallback to a default model.
export function normalizeModel(model: string): string {
  if (!model) return '';
  const is1m = has1mSuffix(model);
  const lower = strip1m(model).toLowerCase();

  // Direct CLI alias match
  if (lower === 'opus' || lower === 'sonnet' || lower === 'haiku') {
    return is1m ? `${lower}[1m]` : lower;
  }

  // Full Claude model name: "claude-opus-4-8", "claude-sonnet-4-6[1m]", etc.
  if (lower.includes('claude-')) {
    const alias = modelNameToAlias(lower);
    if (!alias) return '';
    return alias + (is1m ? '[1m]' : '');
  }

  // Try to match via configLibrary labelOverride reverse map → extract alias
  const reverseMap = buildLabelOverrideReverseMap();
  const standard = reverseMap.get(strip1m(model).toLowerCase()); // match without [1m] suffix
  if (standard) {
    return modelNameToAlias(standard) + (is1m ? '[1m]' : '');
  }

  // Last resort: check if the unknown name contains opus/sonnet/haiku
  if (lower.includes('opus') || lower.includes('sonnet') || lower.includes('haiku')) {
    const alias = modelNameToAlias(lower);
    if (!alias) return '';
    return alias + (is1m ? '[1m]' : '');
  }

  // Cannot resolve — no fallback
  console.warn(`[Config] normalizeModel: cannot resolve model name "${model}"`);
  return '';
}

// Build a reverse map from configLibrary: labelOverride value → standard model base name
// e.g. if configLibrary has { labelOverride: "proxy-x", name: "claude-opus-4-8" },
// the map will be: "proxy-x" → "claude-opus-4-8"
let _reverseMap: Map<string, string> | null = null;
function buildLabelOverrideReverseMap(): Map<string, string> {
  if (_reverseMap) return _reverseMap;
  _reverseMap = new Map();
  try {
    const configLibDir = path.join(process.env.LOCALAPPDATA!, 'Claude-3p', 'configLibrary');
    const metaRaw = fs.readFileSync(path.join(configLibDir, '_meta.json'), 'utf-8');
    const meta = JSON.parse(metaRaw);
    if (!meta.appliedId) return _reverseMap;
    const configPath = path.join(configLibDir, `${meta.appliedId}.json`);
    if (!fs.existsSync(configPath)) return _reverseMap;
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    for (const m of configData.inferenceModels || []) {
      if (m.labelOverride && m.name) {
        _reverseMap.set(m.labelOverride.toLowerCase(), m.name);
      }
    }
  } catch {}
  return _reverseMap;
}

// Extract CLI alias from model name: "claude-opus-4-8" → "opus"
// Handles 1M variants case-insensitively: "claude-opus-4-8[1M]" → "opus[1m]"
// Returns '' if the name doesn't match any known model — no fallback.
function extractAlias(name: string): string {
  const has1m = /\[1m\]/i.test(name);
  const base = name.replace(/\[1m\]/i, '').trim();
  let alias = '';
  if (/opus/i.test(base)) alias = 'opus';
  else if (/sonnet/i.test(base)) alias = 'sonnet';
  else if (/haiku/i.test(base)) alias = 'haiku';
  if (!alias) {
    console.warn(`[Config] extractAlias: unknown model name "${name}"`);
    return '';
  }
  return has1m ? `${alias}[1m]` : alias;
}

// Display label from alias: "opus[1m]" → "Opus 4.7 1M"
function aliasToLabel(alias: string): string {
  const labels: Record<string, string> = {
    'opus': 'Opus 4.7',
    'opus[1m]': 'Opus 4.7 1M',
    'sonnet': 'Sonnet 4.6',
    'sonnet[1m]': 'Sonnet 4.6 1M',
    'haiku': 'Haiku 4.5',
    'haiku[1m]': 'Haiku 4.5 1M',
  };
  return labels[alias] || alias;
}

// Convert any model name (alias, proxy name, or standard name) to the
// standard Claude model name for storage in session meta files.
// Examples: "sonnet" → "claude-sonnet-4-6", "mimo-v2.5[1M]" → "claude-opus-4-8[1m]"
// Ensures vibe-bridge and Claude Desktop 3P sessions use the same format.
export function resolveClaudeModelName(model: string): string {
  const alias = normalizeModel(model); // "sonnet", "opus[1m]", etc.
  if (!alias) return model; // can't resolve, pass through
  // Try configLibrary mapping first
  const aliasToFull = getAliasToFullModelMap();
  if (aliasToFull[alias]) return aliasToFull[alias];
  // Fallback: hardcoded standard Claude model names
  const fallbackMap: Record<string, string> = {
    'opus': 'claude-opus-4-8',
    'opus[1m]': 'claude-opus-4-8[1m]',
    'sonnet': 'claude-sonnet-4-6',
    'sonnet[1m]': 'claude-sonnet-4-6[1m]',
    'haiku': 'claude-haiku-4-5',
    'haiku[1m]': 'claude-haiku-4-5[1m]',
  };
  return fallbackMap[alias] || model;
}

// Build a map from CLI alias (e.g. "opus", "opus[1m]") to the full
// Claude model name (e.g. "claude-opus-4-8", "claude-opus-4-8[1m]").
// Reads from configLibrary inferenceModels to be dynamically correct.
// Returns empty object if configLibrary is unavailable — no hardcoded fallback.
let _aliasToFullMap: Record<string, string> | null = null;
export function getAliasToFullModelMap(): Record<string, string> {
  if (_aliasToFullMap) return _aliasToFullMap;
  _aliasToFullMap = {};

  const configLibDir = path.join(process.env.LOCALAPPDATA!, 'Claude-3p', 'configLibrary');
  try {
    const metaRaw = fs.readFileSync(path.join(configLibDir, '_meta.json'), 'utf-8');
    const meta = JSON.parse(metaRaw);
    if (!meta.appliedId) throw new Error('no appliedId');
    const configPath = path.join(configLibDir, `${meta.appliedId}.json`);
    if (!fs.existsSync(configPath)) throw new Error('config not found');
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    for (const m of configData.inferenceModels || []) {
      if (!m.name) continue;
      const alias = extractAlias(m.name);
      if (!alias) continue;
      _aliasToFullMap[alias] = m.name;
      if (m.supports1m) {
        _aliasToFullMap[`${alias}[1m]`] = `${m.name}[1m]`;
      }
    }
  } catch {
    console.warn('[Config] getAliasToFullModelMap: configLibrary unavailable, returning empty map');
    _aliasToFullMap = {};
  }
  return _aliasToFullMap;
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

    const result: ModelConfig[] = [];

    for (const m of models) {
      const alias = extractAlias(m.name);
      if (!alias) continue; // skip unrecognized models — no fallback
      // 基础模型
      result.push({
        cliAlias: alias,
        label: MODEL_SURFACE_NAMES[m.name] || aliasToLabel(alias),
      });
      // 1M 变体 (如果桌面版配置支持)
      if (m.supports1m) {
        const alias1m = `${alias}[1m]`;
        result.push({
          cliAlias: alias1m,
          label: aliasToLabel(alias1m),
        });
      }
    }

    return result;
  } catch {
    console.warn('[Config] loadModelsFromConfigLibrary: configLibrary unavailable');
    return [];
  }
}

// Build the full set of env vars that claude.exe needs, from ~/.claude/settings.json.
// Also patches the disk file to ensure non-1M models don't have [1M] suffix.
// This is necessary because claude.exe reads settings.json from disk, not from process.env.
// Without patching, cc-switch can rewrite settings.json with incorrect [1M] suffixes.
// NOT memoized: re-reads and re-patches every time, so cc-switch rewrites are corrected.
export function getCliEnvVars(): Record<string, string> {
  const envVars: Record<string, string> = {};

  const settingsPath = path.join(process.env.USERPROFILE!, '.claude', 'settings.json');
  let settings: any = null;
  let needsPatch = false;

  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    const env = settings.env || {};

    // Pass through upstream URL and auth token
    if (env.ANTHROPIC_BASE_URL) envVars.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL;
    if (env.ANTHROPIC_AUTH_TOKEN) envVars.ANTHROPIC_AUTH_TOKEN = env.ANTHROPIC_AUTH_TOKEN;

    // For each model family, normalize non-1M/1M and fix disk file
    for (const family of ['OPUS', 'SONNET', 'HAIKU']) {
      const modelKey = `ANTHROPIC_DEFAULT_${family}_MODEL`;
      const nameKey = `ANTHROPIC_DEFAULT_${family}_MODEL_NAME`;
      const model1MKey = `ANTHROPIC_DEFAULT_${family}_1M_MODEL`;

      const rawModel = env[modelKey] || '';
      const cleanName = env[nameKey] || rawModel.replace(/\[1M\]/i, '').trim();

      if (cleanName) {
        envVars[modelKey] = cleanName;        // non-1M
        // Fix disk: non-1M should not have [1M]
        if (env[modelKey] !== cleanName) {
          env[modelKey] = cleanName;
          needsPatch = true;
        }
      }
      if (env[model1MKey]) {
        envVars[model1MKey] = env[model1MKey];
      }
      if (!envVars[model1MKey] && cleanName) {
        envVars[model1MKey] = `${cleanName}[1M]`;  // fallback
        env[model1MKey] = `${cleanName}[1M]`;
        needsPatch = true;
      }
    }

    // Patch disk file if any [1M] suffix was corrected
    if (needsPatch && settings) {
      try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
        console.log('[Config] Patched settings.json: fixed non-1M model names');
      } catch (writeErr: any) {
        console.warn('[Config] Failed to patch settings.json:', writeErr.message);
      }
    }

    console.log('[Config] CLI env vars:', Object.keys(envVars).map(k => `${k}=${envVars[k]}`).join(', '));
  } catch {
    console.warn('[Config] getCliEnvVars: settings.json unavailable');
  }
  return envVars;
}
