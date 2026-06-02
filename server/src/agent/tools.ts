// Tool schema definitions for the Anthropic Messages API

import type { Tool } from '@vibe-bridge/shared';

export const codingTools: Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given absolute path. Returns the file content with line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to read',
        },
        offset: {
          type: 'number',
          description: 'Line number to start reading from (0-indexed, optional)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to read (optional, default 2000)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file and parent directories if they do not exist. Overwrites existing content.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to write',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by finding and replacing text. The old_string must be unique within the file. Use write_file for creating new files.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the file to edit',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to find (must be unique in the file)',
        },
        new_string: {
          type: 'string',
          description: 'The text to replace old_string with',
        },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'execute_command',
    description: 'Execute a shell command and return stdout and stderr. Use this for running build tools, tests, git commands, installing packages, etc.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command (optional, defaults to thread cwd)',
        },
        timeout_ms: {
          type: 'number',
          description: 'Timeout in milliseconds (optional, default 30000, max 120000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at the given path. Shows file sizes and types.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the directory to list',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for a text pattern in files within a directory. Returns matching lines with file paths and line numbers.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the directory to search in',
        },
        pattern: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        glob: {
          type: 'string',
          description: 'File glob pattern to filter (e.g., "*.ts", "*.py"). Optional.',
        },
      },
      required: ['path', 'pattern'],
    },
  },
];
