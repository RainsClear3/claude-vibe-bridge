// Path safety validation - all file operations must be within allowed directories

import path from 'path';
import { config } from '../config.js';

/**
 * Resolve a path to absolute and check it's within allowed directories.
 * Returns the resolved path if valid, throws if not.
 */
export function validatePath(inputPath: string): string {
  // Normalize: handle both / and \ on Windows
  const resolved = path.resolve(inputPath);

  const isAllowed = config.allowedDirs.some(allowedDir => {
    const normalizedAllowed = path.resolve(allowedDir);
    return resolved.startsWith(normalizedAllowed + path.sep) || resolved === normalizedAllowed;
  });

  if (!isAllowed) {
    throw new Error(
      `Access denied: "${resolved}" is not within allowed directories (${config.allowedDirs.join(', ')})`
    );
  }

  return resolved;
}

/**
 * Validate a working directory for command execution.
 */
export function validateCwd(cwd: string): string {
  return validatePath(cwd);
}
