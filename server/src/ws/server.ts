import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import type { ClientMessage, ServerMessage } from '@vibe-bridge/shared';
import { SessionManager } from '../session/manager.js';
import { handleMessage } from './handler.js';
import { addClient, removeClient, getClientCount, broadcast } from './broadcast.js';

export { broadcast };

export function setupWebSocket(
  server: http.Server, 
  sessionManager: SessionManager,
  checkAuth: (authHeader: string | undefined) => boolean
): void {
  const wss = new WebSocketServer({ 
    server, 
    path: '/ws',
    // Verify authentication before accepting connection
    verifyClient: (info, done) => {
      // 1. Try Authorization header
      let authHeader = info.req.headers.authorization;

      // 2. Try query parameter (for browsers that don't support headers in WebSocket)
      if (!authHeader) {
        const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
        const token = url.searchParams.get('token');
        if (token) {
          authHeader = `Basic ${token}`;
        }
      }

      const isAuthenticated = checkAuth(authHeader);
      done(isAuthenticated);
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    addClient(ws);
    console.log(`[WS] Client connected (${getClientCount()} total)`);

    send(ws, { type: 'connected', serverVersion: '0.1.0' });

    ws.on('message', (data: Buffer) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());
        handleMessage(msg, sessionManager);
      } catch (err) {
        send(ws, { type: 'error', message: 'Invalid message format' });
      }
    });

    ws.on('close', () => {
      removeClient(ws);
      console.log(`[WS] Client disconnected (${getClientCount()} remaining)`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
    });
  });

  console.log('[WS] WebSocket server ready on /ws');
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
