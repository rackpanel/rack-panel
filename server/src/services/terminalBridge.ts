import type { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import type { ConfigStore } from '../store/configStore.js';
import type { SshCollector } from './sshCollector.js';
import type { ProxmoxClient } from './proxmoxClient.js';

interface TerminalClientMessage {
  type: 'input' | 'resize' | 'ping';
  data?: string;
  cols?: number;
  rows?: number;
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export async function handleTerminalConnection(
  ws: WebSocket,
  req: IncomingMessage,
  store: ConfigStore,
  ssh: SshCollector,
  proxmox: ProxmoxClient,
): Promise<void> {
  const url = new URL(req.url || '/ws/terminal', 'http://localhost');
  const kind = url.searchParams.get('kind') || '';
  const cols = Math.max(40, Math.min(300, Number(url.searchParams.get('cols')) || 100));
  const rows = Math.max(10, Math.min(120, Number(url.searchParams.get('rows')) || 28));

  try {
    if (kind === 'ssh') {
      const serverId = url.searchParams.get('serverId') || '';
      if (serverId.startsWith('demo-')) {
        attachDemoShell(ws, `root@${serverId}`, serverId);
        return;
      }
      const cfg = store.getServer(serverId);
      if (!cfg) {
        sendJson(ws, { type: 'error', message: 'SSH server configuration not found.' });
        ws.close();
        return;
      }

      sendJson(ws, { type: 'status', status: 'connecting', label: `${cfg.name} (${cfg.host})` });
      const channel = await ssh.openShell(cfg, cols, rows);
      sendJson(ws, { type: 'status', status: 'connected', label: `${cfg.name} (${cfg.host})` });

      channel.on('data', (chunk: Buffer) => {
        sendJson(ws, { type: 'data', data: chunk.toString('utf8') });
      });
      channel.stderr.on('data', (chunk: Buffer) => {
        sendJson(ws, { type: 'data', data: chunk.toString('utf8') });
      });
      channel.on('close', () => {
        sendJson(ws, { type: 'status', status: 'closed', message: 'SSH session closed.' });
        if (ws.readyState === WebSocket.OPEN) ws.close();
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString('utf8')) as TerminalClientMessage;
          if (msg.type === 'input' && typeof msg.data === 'string') {
            channel.write(msg.data);
          } else if (msg.type === 'resize' && msg.cols && msg.rows) {
            channel.setWindow(
              Math.max(10, Math.min(120, msg.rows)),
              Math.max(40, Math.min(300, msg.cols)),
              0,
              0,
            );
          }
        } catch {
          // ignore
        }
      });

      ws.on('close', () => {
        try {
          channel.end();
        } catch {
          // ignore
        }
      });
      return;
    }

    if (kind === 'proxmox-lxc' || kind === 'proxmox-qemu' || kind === 'proxmox-node') {
      const configId = url.searchParams.get('configId') || '';
      const node = url.searchParams.get('node') || '';
      const vmid = Number(url.searchParams.get('vmid') || '0');
      const guestName = url.searchParams.get('name') || '';

      if (configId === 'demo-pve-cluster') {
        const prompt =
          kind === 'proxmox-node'
            ? `root@${node || 'pve-node-01'}`
            : `root@${guestName || `ct-${vmid}`}`;
        attachDemoShell(ws, prompt, guestName || node);
        return;
      }

      const cfg = store.getProxmox(configId);
      if (!cfg) {
        sendJson(ws, { type: 'error', message: 'Proxmox connection not found.' });
        ws.close();
        return;
      }
      if (!node) {
        sendJson(ws, { type: 'error', message: 'Proxmox node parameter is required.' });
        ws.close();
        return;
      }

      const guest =
        kind === 'proxmox-lxc'
          ? { type: 'lxc' as const, vmid }
          : kind === 'proxmox-qemu'
            ? { type: 'qemu' as const, vmid }
            : undefined;

      const label = guest ? `${guestName || `${guest.type}-${vmid}`} (#${vmid} @ ${node})` : `PVE Node ${node}`;
      sendJson(ws, { type: 'status', status: 'connecting', label });

      const proxy = await proxmox.createTermProxy(cfg, node, guest);
      const upstream = new WebSocket(proxy.wsUrl, ['binary'], {
        headers: proxy.headers,
        rejectUnauthorized: proxy.rejectUnauthorized,
      });

      let authenticated = false;
      let keepaliveTimer: NodeJS.Timeout | null = null;

      upstream.on('open', () => {
        // Proxmox termproxy auth handshake: "<user>:<ticket>\n"
        upstream.send(`${proxy.authUser}:${proxy.ticket}\n`);
        keepaliveTimer = setInterval(() => {
          if (upstream.readyState === WebSocket.OPEN && authenticated) {
            upstream.send('2');
          }
        }, 30000);
      });

      upstream.on('message', (data: Buffer | string) => {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        if (!authenticated) {
          if (text.startsWith('OK')) {
            authenticated = true;
            sendJson(ws, { type: 'status', status: 'connected', label });
            upstream.send(`1:${cols}:${rows}:`);
            const remainder = text.slice(2);
            if (remainder) sendJson(ws, { type: 'data', data: remainder });
            return;
          }
          sendJson(ws, { type: 'error', message: `Proxmox terminal auth failed: ${text.slice(0, 160)}` });
          upstream.close();
          return;
        }
        sendJson(ws, { type: 'data', data: text });
      });

      upstream.on('error', (err) => {
        sendJson(ws, {
          type: 'error',
          message: `Proxmox terminal WebSocket error: ${err.message}`,
        });
        if (ws.readyState === WebSocket.OPEN) ws.close();
      });

      upstream.on('close', () => {
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        sendJson(ws, { type: 'status', status: 'closed', message: 'Proxmox terminal closed.' });
        if (ws.readyState === WebSocket.OPEN) ws.close();
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString('utf8')) as TerminalClientMessage;
          if (upstream.readyState !== WebSocket.OPEN || !authenticated) return;
          if (msg.type === 'input' && typeof msg.data === 'string') {
            const bytes = Buffer.byteLength(msg.data, 'utf8');
            upstream.send(`0:${bytes}:${msg.data}`);
          } else if (msg.type === 'resize' && msg.cols && msg.rows) {
            upstream.send(
              `1:${Math.max(40, Math.min(300, msg.cols))}:${Math.max(10, Math.min(120, msg.rows))}:`,
            );
          }
        } catch {
          // ignore
        }
      });

      ws.on('close', () => {
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        try {
          upstream.close();
        } catch {
          // ignore
        }
      });
      return;
    }

    sendJson(ws, { type: 'error', message: `Unsupported terminal kind: ${kind}` });
    ws.close();
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const hint =
      kind === 'proxmox-qemu' && /serial/i.test(rawMsg)
        ? `${rawMsg} (Tip: attach a serial0 socket to the VM in Proxmox Hardware settings to use text terminal.)`
        : kind.startsWith('proxmox') && /403|permission/i.test(rawMsg)
          ? `${rawMsg} (Ensure your Proxmox user/token has VM.Console / Sys.Console permissions.)`
          : rawMsg;
    sendJson(ws, { type: 'error', message: hint });
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
}

function attachDemoShell(ws: WebSocket, promptHost: string, label: string): void {
  sendJson(ws, { type: 'status', status: 'connected', label: `${label} (Demo Shell)` });
  const prompt = `\x1b[36m${promptHost}\x1b[0m:\x1b[32m~\x1b[0m# `;
  sendJson(ws, {
    type: 'data',
    data: `Connected to Demo Shell (${label}). Type 'help', 'uptime', 'df -h', 'free -h', 'uname -a', or 'exit'.\r\n${prompt}`,
  });

  let lineBuf = '';
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString('utf8')) as TerminalClientMessage;
      if (msg.type !== 'input' || typeof msg.data !== 'string') return;
      for (const ch of msg.data) {
        if (ch === '\x03') {
          lineBuf = '';
          sendJson(ws, { type: 'data', data: `^C\r\n${prompt}` });
        } else if (ch === '\x7f' || ch === '\b') {
          if (lineBuf.length > 0) {
            lineBuf = lineBuf.slice(0, -1);
            sendJson(ws, { type: 'data', data: '\b \b' });
          }
        } else if (ch === '\r' || ch === '\n') {
          const cmd = lineBuf.trim();
          lineBuf = '';
          let out = '';
          if (cmd === 'help') {
            out = 'Demo commands: help, uptime, uname -a, df -h, free -h, clear, exit\r\n';
          } else if (cmd === 'uptime') {
            out = ' 21:44:02 up 42 days,  6:22,  1 user,  load average: 1.18, 1.05, 0.94\r\n';
          } else if (cmd === 'uname -a') {
            out = `Linux ${label} 6.8.12-4-pve #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux\r\n`;
          } else if (cmd === 'df -h') {
            out = 'Filesystem      Size  Used Avail Use% Mounted on\r\n/dev/nvme0n1p2  256G   61G  195G  24% /\r\n';
          } else if (cmd === 'free -h') {
            out = '               total        used        free      available\r\nMem:            32Gi        19Gi       4.2Gi           13Gi\r\n';
          } else if (cmd === 'clear') {
            sendJson(ws, { type: 'data', data: `\x1b[2J\x1b[H${prompt}` });
            continue;
          } else if (cmd === 'exit') {
            sendJson(ws, { type: 'data', data: '\r\nlogout\r\n' });
            ws.close();
            return;
          } else if (cmd) {
            out = `[demo] executed: ${cmd}\r\n`;
          }
          sendJson(ws, { type: 'data', data: `\r\n${out}${prompt}` });
        } else {
          lineBuf += ch;
          sendJson(ws, { type: 'data', data: ch });
        }
      }
    } catch {
      // ignore
    }
  });
}
