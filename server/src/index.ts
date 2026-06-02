import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { setupWebSocket } from './ws/server.js';
import { SessionManager } from './session/manager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err.message);
});
process.on('unhandledRejection', (err: any) => {
  console.error('[Unhandled Rejection]', err?.message || err);
});

async function main() {
  const app = express();
  const server = http.createServer(app);

  // Parse JSON bodies
  app.use(express.json());

  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });

  // Force no-cache on sw.js to ensure updates propagate quickly
  // Must be BEFORE static middleware to override it
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.get('/sw.js', (_req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Service-Worker-Allowed', '/');
    res.sendFile(path.join(clientDist, 'sw.js'));
  });

  // Serve client build with no-cache to avoid stale Service Worker issues
  app.use(express.static(clientDist, { maxAge: 0, etag: false, lastModified: false }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  // Initialize session manager
  const sessionManager = new SessionManager(config.sessionDir);
  await sessionManager.load();

  // Setup WebSocket
  setupWebSocket(server, sessionManager);

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Vibe Bridge] Port ${config.port} is already in use. Kill the existing process first:`);
      console.error(`  netstat -ano | findstr :${config.port}`);
      console.error(`  taskkill /F /PID <PID>`);
    } else {
      console.error('[Vibe Bridge] Server error:', err.message);
    }
    process.exit(1);
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[Vibe Bridge] Server running on http://0.0.0.0:${config.port}`);
    console.log(`[Vibe Bridge] Mode: Transparent bridge to Claude Desktop 3P`);
    console.log(`[Vibe Bridge] Allowed dirs: ${config.allowedDirs.join(', ')}`);
    console.log(`[Vibe Bridge] Open on phone: http://<your-ip>:${config.port}`);
  });
}

main().catch(err => {
  console.error('[Vibe Bridge] Fatal:', err);
  process.exit(1);
});
