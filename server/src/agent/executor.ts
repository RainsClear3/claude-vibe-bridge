// Tool execution implementations - sandboxed file operations and command execution

import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { validatePath, validateCwd } from '../utils/sandbox.js';

const execAsync = promisify(exec);

const MAX_FILE_SIZE = 50 * 1024; // 50KB max for read_file output
const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  threadCwd: string,
): Promise<string> {
  try {
    switch (name) {
      case 'read_file':
        return await handleReadFile(input);
      case 'write_file':
        return await handleWriteFile(input);
      case 'edit_file':
        return await handleEditFile(input);
      case 'execute_command':
        return await handleExecuteCommand(input, threadCwd);
      case 'list_directory':
        return await handleListDirectory(input);
      case 'search_files':
        return await handleSearchFiles(input);
      default:
        return `Error: Unknown tool "${name}"`;
    }
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
}

async function handleReadFile(input: Record<string, unknown>): Promise<string> {
  const filePath = validatePath(input.path as string);
  const offset = (input.offset as number) || 0;
  const limit = (input.limit as number) || 2000;

  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const selectedLines = lines.slice(offset, offset + limit);

  // Add line numbers
  const numbered = selectedLines.map((line, i) => `${offset + i + 1}\t${line}`).join('\n');

  // Truncate if too large
  if (numbered.length > MAX_FILE_SIZE) {
    return numbered.slice(0, MAX_FILE_SIZE) + '\n... (truncated)';
  }

  const totalLines = lines.length;
  const shownRange = `lines ${offset + 1}-${Math.min(offset + limit, totalLines)} of ${totalLines}`;

  return `[${shownRange}]\n${numbered}`;
}

async function handleWriteFile(input: Record<string, unknown>): Promise<string> {
  const filePath = validatePath(input.path as string);
  const content = input.content as string;

  // Create parent directories
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  await fs.writeFile(filePath, content, 'utf-8');
  return `Successfully wrote ${content.length} bytes to ${filePath}`;
}

async function handleEditFile(input: Record<string, unknown>): Promise<string> {
  const filePath = validatePath(input.path as string);
  const oldString = input.old_string as string;
  const newString = input.new_string as string;

  const content = await fs.readFile(filePath, 'utf-8');

  // Check if old_string exists
  const index = content.indexOf(oldString);
  if (index === -1) {
    return `Error: old_string not found in ${filePath}. Make sure it matches exactly.`;
  }

  // Check if it's unique
  const secondIndex = content.indexOf(oldString, index + 1);
  if (secondIndex !== -1) {
    return `Error: old_string is not unique in ${filePath}. It appears at least twice. Provide more context to make it unique.`;
  }

  const newContent = content.replace(oldString, newString);
  await fs.writeFile(filePath, newContent, 'utf-8');

  return `Successfully edited ${filePath}`;
}

async function handleExecuteCommand(
  input: Record<string, unknown>,
  threadCwd: string,
): Promise<string> {
  const command = input.command as string;
  const cwd = input.cwd ? validateCwd(input.cwd as string) : validateCwd(threadCwd);
  const timeoutMs = Math.min(
    (input.timeout_ms as number) || DEFAULT_TIMEOUT,
    MAX_TIMEOUT,
  );

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024, // 1MB
      windowsHide: true,
    });

    let result = '';
    if (stdout) result += stdout;
    if (stderr) result += (result ? '\n' : '') + stderr;
    return result || '(no output)';
  } catch (err: any) {
    let msg = `Command failed: ${err.message}`;
    if (err.stdout) msg += `\nstdout: ${err.stdout}`;
    if (err.stderr) msg += `\nstderr: ${err.stderr}`;
    return msg;
  }
}

async function handleListDirectory(input: Record<string, unknown>): Promise<string> {
  const dirPath = validatePath(input.path as string);

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const lines: string[] = [];

  for (const entry of entries) {
    const type = entry.isDirectory() ? 'dir' : 'file';
    let size = '';
    if (entry.isFile()) {
      try {
        const stat = await fs.stat(path.join(dirPath, entry.name));
        size = ` (${formatSize(stat.size)})`;
      } catch {
        // ignore stat errors
      }
    }
    lines.push(`  ${type === 'dir' ? '📁' : '📄'} ${entry.name}${size}`);
  }

  return `${dirPath}:\n${lines.join('\n')}`;
}

async function handleSearchFiles(input: Record<string, unknown>): Promise<string> {
  const searchPath = validatePath(input.path as string);
  const pattern = input.pattern as string;
  const glob = input.glob as string | undefined;

  const results: string[] = [];
  const maxResults = 100;

  await searchRecursive(searchPath, pattern, glob, results, maxResults);

  if (results.length === 0) {
    return `No matches found for "${pattern}" in ${searchPath}`;
  }

  return `Found ${results.length} match(es):\n${results.join('\n')}`;
}

async function searchRecursive(
  dir: string,
  pattern: string,
  glob: string | undefined,
  results: string[],
  maxResults: number,
): Promise<void> {
  if (results.length >= maxResults) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // Skip unreadable directories
  }

  const regex = new RegExp(pattern, 'gi');

  for (const entry of entries) {
    if (results.length >= maxResults) break;

    // Skip common non-source directories
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await searchRecursive(fullPath, pattern, glob, results, maxResults);
    } else if (entry.isFile()) {
      // Apply glob filter
      if (glob && !matchGlob(entry.name, glob)) continue;

      try {
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (regex.test(lines[i])) {
            results.push(`${fullPath}:${i + 1}: ${lines[i].trim()}`);
            regex.lastIndex = 0; // Reset regex state
          }
        }
      } catch {
        // Skip binary or unreadable files
      }
    }
  }
}

function matchGlob(filename: string, glob: string): boolean {
  // Simple glob matching: *.ext, *.{ext1,ext2}
  if (glob.startsWith('*.')) {
    const ext = glob.slice(1); // e.g., ".ts"
    if (ext.startsWith('{')) {
      // Multiple extensions: *.{ts,js}
      const exts = ext.slice(1, -1).split(',').map(e => '.' + e.trim());
      return exts.some(e => filename.endsWith(e));
    }
    return filename.endsWith(ext);
  }
  return filename.includes(glob);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
