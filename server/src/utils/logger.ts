// Simple structured logger

export const log = {
  info: (...args: any[]) => console.log('[Vibe]', ...args),
  warn: (...args: any[]) => console.warn('[Vibe]', ...args),
  error: (...args: any[]) => console.error('[Vibe]', ...args),
  debug: (...args: any[]) => {
    if (process.env.DEBUG) console.log('[Vibe:DEBUG]', ...args);
  },
};
