// WebSocket client with auto-reconnect and message queue

import type { ClientMessage, ServerMessage } from '@vibe-bridge/shared';

type MessageHandler = (msg: ServerMessage) => void;

const STORAGE_KEY_SERVER_URL = 'vibe_bridge_server_url';

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private messageQueue: ClientMessage[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _connected = false;
  private url: string;

  constructor() {
    this.url = this.getServerUrl();
  }

  private getServerUrl(): string {
    const savedUrl = localStorage.getItem(STORAGE_KEY_SERVER_URL);
    if (savedUrl) {
      try {
        const url = new URL(savedUrl);
        const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${wsProtocol}//${url.host}/ws`;
      } catch {
        // Invalid URL, fall through
      }
    }
    // Default to current host
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }

  static getHttpUrl(): string {
    const savedUrl = localStorage.getItem(STORAGE_KEY_SERVER_URL);
    if (savedUrl) {
      try {
        const url = new URL(savedUrl);
        return url.origin;
      } catch {
        // Fall through
      }
    }
    return location.origin;
  }

  static setServerUrl(url: string): void {
    localStorage.setItem(STORAGE_KEY_SERVER_URL, url);
  }

  static getStoredServerUrl(): string | null {
    return localStorage.getItem(STORAGE_KEY_SERVER_URL);
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this._connected = true;
      this.reconnectDelay = 1000;

      // Flush queued messages
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift()!;
        this.send(msg);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        for (const handler of this.handlers) {
          handler(msg);
        }
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
      this._connected = false;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.messageQueue.push(msg);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    console.log(`[WS] Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    }, this.reconnectDelay);
  }
}
