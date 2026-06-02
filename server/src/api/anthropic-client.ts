// Anthropic Messages API streaming client
// Handles POST /v1/messages with SSE streaming

import { config } from '../config.js';
import type {
  MessageRequest,
  MessageResponse,
  StreamEvent,
  ContentBlock,
} from '@vibe-bridge/shared';

export class AnthropicClient {
  private baseUrl: string;
  private apiKey: string;
  private version: string;

  constructor() {
    this.baseUrl = config.anthropicBaseUrl.replace(/\/+$/, '');
    this.apiKey = config.anthropicApiKey;
    this.version = config.anthropicVersion;
  }

  /**
   * Stream a message request. Returns an async iterable of SSE events.
   */
  async *streamMessages(request: MessageRequest): AsyncGenerator<StreamEvent> {
    const url = `${this.baseUrl}/v1/messages`;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'anthropic-version': this.version,
      'x-api-key': this.apiKey,
    };

    const body = JSON.stringify({
      ...request,
      stream: true,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: request.stream === false ? undefined : undefined, // no abort here; handled upstream
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split('\n');
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);
          } else if (line === '') {
            // Empty line = end of event
            if (eventData) {
              try {
                const parsed = JSON.parse(eventData);
                // Assign the event type from the event: line
                if (eventType) {
                  parsed.type = eventType;
                }
                yield parsed as StreamEvent;
              } catch {
                // Skip malformed events
                console.warn('[Anthropic] Failed to parse SSE data:', eventData.slice(0, 100));
              }
            }
            eventType = '';
            eventData = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Non-streaming message request (for testing).
   */
  async createMessage(request: MessageRequest): Promise<MessageResponse> {
    const url = `${this.baseUrl}/v1/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': this.version,
        'x-api-key': this.apiKey,
      },
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<MessageResponse>;
  }
}
