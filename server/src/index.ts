import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { setupWebSocket } from './ws/server.js';
import { SessionManager } from './session/manager.js';

// Basic Auth helper function
export function checkAuth(authHeader: string | undefined): boolean {
  if (!config.authEnabled) return true;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }
  
  const base64Credentials = authHeader.slice('Basic '.length);
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');
  
  return username === config.authUsername && password === config.authPassword;
}

// Auth middleware
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!config.authEnabled) {
    next();
    return;
  }
  
  if (checkAuth(req.headers.authorization)) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Claude Anywhere"');
    res.status(401).send('Authentication required');
  }
}

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
  
  // Apply authentication middleware
  app.use(authMiddleware);

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
  const sessionManager = new SessionManager();
  await sessionManager.load();

  // Setup WebSocket
  setupWebSocket(server, sessionManager, checkAuth);

  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Claude Anywhere] Port ${config.port} is already in use. Kill the existing process first:`);
      console.error(`  netstat -ano | findstr :${config.port}`);
      console.error(`  taskkill /F /PID <PID>`);
    } else {
      console.error('[Claude Anywhere] Server error:', err.message);
    }
    process.exit(1);
  });

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[Claude Anywhere] Server running on http://0.0.0.0:${config.port}`);
    console.log(`[Claude Anywhere] Mode: Transparent bridge to Claude Desktop 3P`);
    console.log(`[Claude Anywhere] Allowed dirs: ${config.allowedDirs.join(', ')}`);
    console.log(`[Claude Anywhere] Open on phone: http://<your-ip>:${config.port}`);
  });
}

main().catch(err => {
  console.error('[Claude Anywhere] Fatal:', err);
  process.exit(1);
});
