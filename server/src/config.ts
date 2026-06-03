import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load .env but DON'T override system variables. 
// The user has already configured the system environment via cc-desktop-switch.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: false });

export const config = {
  defaultModel: 'auto',

  // Server
  port: parseInt(process.env.PORT || '3900', 10),

  // Sessions
  sessionDir: process.env.SESSION_DIR || './data/sessions',

  // Security
  allowedDirs: (process.env.ALLOWED_DIRS || 'E:\\claude')
    .split('|')
    .map(d => d.trim()),
  
  // Authentication
  authEnabled: process.env.AUTH_ENABLED?.toLowerCase() === 'true',
  authUsername: process.env.AUTH_USERNAME || '',
  authPassword: process.env.AUTH_PASSWORD || '',

  // Agent
  approvalMode: (process.env.APPROVAL_MODE || 'auto') as 'auto' | 'manual',
  maxTokens: parseInt(process.env.MAX_TOKENS || '16384', 10),
  maxTurns: 25, // Max tool use rounds per turn
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
