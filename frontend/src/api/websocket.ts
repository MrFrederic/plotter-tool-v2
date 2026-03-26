type MessageCallback = (data: Record<string, unknown>) => void;

const WS_BASE = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

export class WebSocketManager {
  private ws: WebSocket | null = null;
  private listeners: MessageCallback[] = [];
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string;
  private closed = false;
  private messageQueue: Record<string, unknown>[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;

    try {
      this.ws = new WebSocket(`${WS_BASE}/ws/${this.sessionId}`);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.flushQueue();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string') return;
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>;
          this.listeners.forEach((cb) => cb(data));
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        if (!this.closed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts || this.closed) return;

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private flushQueue(): void {
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.messageQueue.shift()!;
      this.ws.send(JSON.stringify(msg));
    }
  }

  send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      this.messageQueue.push(data);
    }
  }

  onMessage(callback: MessageCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.listeners = [];
    this.messageQueue = [];
  }
}
