import 'reflect-metadata';
import http from 'node:http';
import { PlatformExpress } from '@tsed/platform-express';
import { WebSocketServer, WebSocket } from 'ws';
import { Server, clientDist } from './Server.js';
import { extractBearerToken, RackPanelRuntime } from './runtime.js';
import { handleTerminalConnection } from './services/terminalBridge.js';
import { handleVncConnection } from './services/vncBridge.js';

interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
  authToken?: string;
}

function rejectUpgrade(socket: import('node:stream').Duplex, code: number, label: string): void {
  try {
    socket.write(`HTTP/1.1 ${code} ${label}\r\nConnection: close\r\n\r\n`);
  } catch {
    // ignore
  }
  socket.destroy();
}

async function bootstrap(): Promise<void> {
  const platform = await PlatformExpress.bootstrap(Server);
  await platform.listen();

  const rt = platform.injector.get<RackPanelRuntime>(RackPanelRuntime)!;
  const httpServer = http.createServer(platform.callback());
  const port = Number(process.env.PORT) || 3840;
  const host = process.env.HOST || '0.0.0.0';

  const wss = new WebSocketServer({ noServer: true });
  const termWss = new WebSocketServer({ noServer: true });
  const vncWss = new WebSocketServer({
    noServer: true,
    handleProtocols(protocols) {
      if (protocols.has('binary')) return 'binary';
      return false;
    },
  });

  httpServer.on('upgrade', (req: http.IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const pathname = parsedUrl.pathname;
    const headerToken = extractBearerToken(req);

    if (pathname === '/ws') {
      const token = parsedUrl.searchParams.get('token') || headerToken;
      const found = token ? rt.store.getSessionByToken(token) : null;
      if (!found) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        (ws as AliveWebSocket).authToken = found.session.token;
        wss.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/terminal') {
      const token = parsedUrl.searchParams.get('token') || headerToken;
      const found = token ? rt.store.getSessionByToken(token) : null;
      if (!found) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      if (found.session.pinLocked && rt.store.getSettings().splashPinEnabled) {
        rejectUpgrade(socket, 423, 'Locked');
        return;
      }
      termWss.handleUpgrade(req, socket, head, (ws) => {
        termWss.emit('connection', ws, req);
      });
    } else if (pathname === '/ws/vnc') {
      const authToken = parsedUrl.searchParams.get('auth') || headerToken;
      const found = authToken ? rt.store.getSessionByToken(authToken) : null;
      if (!found) {
        rejectUpgrade(socket, 401, 'Unauthorized');
        return;
      }
      if (found.session.pinLocked && rt.store.getSettings().splashPinEnabled) {
        rejectUpgrade(socket, 423, 'Locked');
        return;
      }
      vncWss.handleUpgrade(req, socket, head, (ws) => {
        vncWss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  termWss.on('connection', (ws, req) => {
    void handleTerminalConnection(ws, req, rt.store, rt.ssh, rt.proxmox);
  });

  vncWss.on('connection', (ws, req) => {
    handleVncConnection(ws, req);
  });

  function buildSnapshotPayload(): string {
    return JSON.stringify({
      type: 'snapshot',
      overview: rt.telemetry.getOverview(),
      servers: rt.store.listServersPublic(),
      proxmox: rt.store.listProxmoxPublic(),
      tailscale: rt.store.listTailscalePublic(),
      opnsense: rt.store.listOpnsensePublic(),
      hikvision: rt.store.listHikvisionPublic(),
      unifi: rt.store.listUnifiPublic(),
    });
  }

  function broadcastSnapshot(): void {
    if (wss.clients.size === 0) return;
    const payload = buildSnapshotPayload();
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  rt.telemetry.onUpdate(() => {
    broadcastSnapshot();
  });

  wss.on('connection', (ws: AliveWebSocket) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(buildSnapshotPayload());
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString('utf8')) as { type?: string };
        if (msg.type === 'ping') {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } else if (msg.type === 'poll') {
          const found = ws.authToken ? rt.store.getSessionByToken(ws.authToken) : null;
          if (!found) {
            ws.close(4401, 'Unauthorized');
            return;
          }
          if (found.session.pinLocked && rt.store.getSettings().splashPinEnabled) {
            return;
          }
          void rt.telemetry.pollNow(true);
        }
      } catch {
        // ignore malformed messages
      }
    });
  });

  const wsHeartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const sock = client as AliveWebSocket;
      if (sock.isAlive === false) {
        sock.terminate();
        continue;
      }
      sock.isAlive = false;
      sock.ping();
    }
  }, 25000);

  const shutdown = () => {
    clearInterval(wsHeartbeat);
    wss.close();
    termWss.close();
    vncWss.close();
    httpServer.close();
    void platform.stop().finally(() => process.exit(0));
  };

  httpServer.listen(port, host, () => {
    console.log(`[rack-panel] Ts.ED + Drizzle ORM listening on http://${host}:${port} (WebSocket /ws, /ws/terminal, /ws/vnc)`);
    if (clientDist) {
      console.log(`[rack-panel] Serving frontend bundle from ${clientDist}`);
    }
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[rack-panel] Failed to bootstrap Ts.ED server:', err);
  process.exit(1);
});
