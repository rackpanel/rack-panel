import type {
  HikvisionConfigPublic,
  OpnsenseConfigPublic,
  OverviewResponse,
  ProxmoxConfigPublic,
  SshServerPublic,
  TailscaleConfigPublic,
  UnifiConfigPublic,
} from '@shared/types';
import { getAuthToken } from '@/api/auth';

export interface StreamSnapshotMessage {
  type: 'snapshot';
  overview: OverviewResponse;
  servers: SshServerPublic[];
  proxmox: ProxmoxConfigPublic[];
  tailscale: TailscaleConfigPublic[];
  opnsense?: OpnsenseConfigPublic[];
  hikvision?: HikvisionConfigPublic[];
  unifi?: UnifiConfigPublic[];
}

export type StreamState = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface TelemetryStreamCallbacks {
  onSnapshot: (msg: StreamSnapshotMessage) => void;
  onStateChange: (state: StreamState, error?: string) => void;
}

export class TelemetryStream {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectDelayMs = 1000;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private callbacks: TelemetryStreamCallbacks;

  constructor(callbacks: TelemetryStreamCallbacks) {
    this.callbacks = callbacks;
  }

  connect(): void {
    this.closed = false;
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined') {
      this.callbacks.onStateChange('offline', 'WebSocket not supported in this browser');
      return;
    }
    this.openSocket();
  }

  disconnect(): void {
    this.closed = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  requestPoll(): boolean {
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ type: 'poll' }));
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private openSocket(): void {
    if (this.closed) return;
    this.clearTimers();

    const token = getAuthToken();
    if (!token) {
      this.callbacks.onStateChange('offline', 'Sign in required');
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

    this.callbacks.onStateChange(this.reconnectDelayMs > 1000 ? 'reconnecting' : 'connecting');

    let socket: WebSocket;
    try {
      socket = new window.WebSocket(url);
    } catch (err) {
      this.scheduleReconnect(err instanceof Error ? err.message : 'WebSocket failed to open');
      return;
    }

    this.ws = socket;

    socket.onopen = () => {
      if (this.ws !== socket || this.closed) return;
      this.reconnectDelayMs = 1000;
      this.callbacks.onStateChange('live');
      this.pingTimer = window.setInterval(() => {
        if (this.ws && this.ws.readyState === 1) {
          try {
            this.ws.send(JSON.stringify({ type: 'ping' }));
          } catch {
            // ignore
          }
        }
      }, 20000);
    };

    socket.onmessage = (event) => {
      if (this.ws !== socket || this.closed) return;
      try {
        const data = JSON.parse(String(event.data || ''));
        if (data && data.type === 'snapshot' && data.overview) {
          this.callbacks.onSnapshot(data as StreamSnapshotMessage);
        }
      } catch {
        // ignore malformed frames
      }
    };

    socket.onerror = () => {
      // onclose will trigger reconnect
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.clearTimers();
      if (!this.closed) {
        this.scheduleReconnect('WebSocket connection lost — reconnecting...');
      }
    };
  }

  private scheduleReconnect(reason: string): void {
    if (this.closed) return;
    this.callbacks.onStateChange('reconnecting', reason);
    const wait = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(8000, Math.round(this.reconnectDelayMs * 1.7));
    this.reconnectTimer = window.setTimeout(() => {
      this.openSocket();
    }, wait);
  }
}
