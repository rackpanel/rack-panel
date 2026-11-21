import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';

export interface VncSessionEntry {
  wsUrl: string;
  headers: Record<string, string>;
  rejectUnauthorized: boolean;
  label: string;
  expiresAt: number;
}

const sessions = new Map<string, VncSessionEntry>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, entry] of sessions.entries()) {
    if (entry.expiresAt < now) sessions.delete(key);
  }
}

export function registerVncSession(entry: Omit<VncSessionEntry, 'expiresAt'>): string {
  pruneExpired();
  const token = crypto.randomBytes(20).toString('hex');
  sessions.set(token, {
    ...entry,
    expiresAt: Date.now() + 60_000,
  });
  return token;
}

export function handleVncConnection(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url || '/ws/vnc', 'http://localhost');
  const token = url.searchParams.get('token') || '';
  const session = sessions.get(token);
  sessions.delete(token);

  if (!session || session.expiresAt < Date.now()) {
    ws.close(1008, 'Invalid or expired VNC session token');
    return;
  }

  const upstream = new WebSocket(session.wsUrl, ['binary'], {
    headers: session.headers,
    rejectUnauthorized: session.rejectUnauthorized,
  });

  const pendingClientFrames: Array<Buffer | ArrayBuffer | Buffer[]> = [];

  upstream.on('open', () => {
    for (const frame of pendingClientFrames) {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(frame, { binary: true });
      }
    }
    pendingClientFrames.length = 0;
  });

  upstream.on('message', (data, isBinary) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data, { binary: isBinary });
    }
  });

  upstream.on('error', (err) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, `Proxmox VNC error: ${err.message.slice(0, 100)}`);
    }
  });

  upstream.on('close', (code, reason) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(code === 1005 ? 1000 : code, reason.toString('utf8').slice(0, 100));
    }
  });

  ws.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pendingClientFrames.push(data as Buffer);
    }
  });

  ws.on('close', () => {
    try {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    } catch {
      // ignore
    }
  });
}
