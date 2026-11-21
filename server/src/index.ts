import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  AuthUserPublic,
  GuestPowerAction,
  OpnsenseConfig,
  OpnsenseServiceAction,
  ProxmoxConfig,
  SshServerConfig,
  TailscaleConfig,
  UserRole,
} from '../../shared/types.js';
import { ConfigStore } from './store/configStore.js';
import { SshCollector } from './services/sshCollector.js';
import { ProxmoxClient } from './services/proxmoxClient.js';
import { TailscaleClient } from './services/tailscaleClient.js';
import { OpnsenseClient } from './services/opnsenseClient.js';
import {
  bringUpLocalTailscale,
  buildRemoteTailscaleInstallScript,
  getLocalTailscaleHostStatus,
  installLocalTailscale,
} from './services/tailscaleSetup.js';
import { handleTerminalConnection } from './services/terminalBridge.js';
import { handleVncConnection, registerVncSession } from './services/vncBridge.js';
import { TelemetryManager } from './services/telemetryManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const store = new ConfigStore();
const ssh = new SshCollector();
const proxmox = new ProxmoxClient();
const tailscale = new TailscaleClient();
const opnsense = new OpnsenseClient();
const telemetry = new TelemetryManager(store, ssh, proxmox, tailscale, opnsense);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

interface AuthenticatedRequest extends express.Request {
  auth?: {
    token: string;
    user: AuthUserPublic;
    pinLocked: boolean;
  };
}

function extractBearerToken(req: { headers?: Record<string, string | string[] | undefined> }): string {
  const hdr = req.headers?.authorization;
  const raw = Array.isArray(hdr) ? hdr[0] : hdr || '';
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

// Health check (public)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime(), timestamp: Date.now() });
});

// ---- Public Auth Routes ----
app.get('/api/auth/status', (req, res) => {
  const settings = store.getSettings();
  const setupRequired = !store.hasUsers();
  const token = extractBearerToken(req);
  const found = token ? store.getSessionByToken(token) : null;
  const pinLocked = Boolean(found && found.session.pinLocked && settings.splashPinEnabled);
  res.json({
    setupRequired,
    authenticated: Boolean(found),
    pinLocked,
    splashPinEnabled: settings.splashPinEnabled,
    user: found ? found.user : null,
    rackTitle: settings.rackTitle || 'RACK//PANEL',
  });
});

app.post('/api/auth/setup', (req, res) => {
  try {
    if (store.hasUsers()) {
      res.status(409).json({ error: 'Initial admin account already exists. Please sign in.' });
      return;
    }
    const { username, displayName, password } = req.body ?? {};
    const user = store.createUser({
      username: String(username || ''),
      displayName: String(displayName || ''),
      password: String(password || ''),
      role: 'admin',
    });
    const session = store.createSession(user.id, req.headers['user-agent']);
    res.status(201).json({
      token: session.token,
      user,
      pinLocked: false,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = store.authenticateUser(String(username || ''), String(password || ''));
  if (!user) {
    res.status(401).json({ error: 'Invalid username or password' });
    return;
  }
  const session = store.createSession(user.id, req.headers['user-agent']);
  res.json({
    token: session.token,
    user,
    pinLocked: false,
  });
});

app.post('/api/auth/logout', (req, res) => {
  const token = extractBearerToken(req);
  if (token) {
    store.revokeSession(token);
  }
  res.json({ ok: true });
});

// ---- Protected API Middleware (Auth + Splash PIN Lock Enforcement) ----
app.use('/api', (req: AuthenticatedRequest, res, next) => {
  const token = extractBearerToken(req);
  const found = token ? store.getSessionByToken(token) : null;
  if (!found) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const settings = store.getSettings();
  const pinLocked = Boolean(found.session.pinLocked && settings.splashPinEnabled);
  req.auth = {
    token: found.session.token,
    user: found.user,
    pinLocked,
  };

  // While PIN-locked on splash screen, allow only read-only overview/settings + PIN unlock/lock routes
  if (pinLocked) {
    const p = req.path;
    const isAllowedWhileLocked =
      (req.method === 'GET' && (p === '/overview' || p === '/settings')) ||
      (req.method === 'POST' && (p === '/settings/verify-pin' || p === '/settings/lock'));
    if (!isAllowedWhileLocked) {
      res.status(423).json({
        error: 'Dashboard is PIN-locked. Enter your 4-digit PIN on the splash screen to unlock.',
        pinLocked: true,
      });
      return;
    }
  }

  next();
});

// ---- User Management Routes ----
app.get('/api/users', (_req, res) => {
  res.json(store.listUsersPublic());
});

app.post('/api/users', (req: AuthenticatedRequest, res) => {
  try {
    if (req.auth?.user.role !== 'admin') {
      res.status(403).json({ error: 'Admin privileges required to add users' });
      return;
    }
    const { username, displayName, password, role } = req.body ?? {};
    const created = store.createUser({
      username: String(username || ''),
      displayName: String(displayName || ''),
      password: String(password || ''),
      role: (role === 'admin' ? 'admin' : 'operator') as UserRole,
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/users/:id/password', (req: AuthenticatedRequest, res) => {
  try {
    const targetId = String(req.params.id);
    const isSelf = req.auth?.user.id === targetId;
    if (!isSelf && req.auth?.user.role !== 'admin') {
      res.status(403).json({ error: 'Admin privileges required to change another user password' });
      return;
    }
    store.updateUserPassword(targetId, String(req.body?.password || ''));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/users/:id', (req: AuthenticatedRequest, res) => {
  try {
    const targetId = String(req.params.id);
    if (req.auth?.user.role !== 'admin') {
      res.status(403).json({ error: 'Admin privileges required to delete users' });
      return;
    }
    if (req.auth.user.id === targetId) {
      res.status(400).json({ error: 'You cannot delete the currently signed-in account' });
      return;
    }
    const deleted = store.deleteUser(targetId);
    res.json({ deleted });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Unified Overview + Live Telemetry Snapshot
app.get('/api/overview', (_req, res) => {
  res.json(telemetry.getOverview());
});

app.post('/api/poll', async (_req, res) => {
  await telemetry.pollNow(true);
  res.json(telemetry.getOverview());
});

// Settings
app.get('/api/settings', (_req, res) => {
  res.json(store.getSettings());
});

app.put('/api/settings', (req, res) => {
  try {
    const updated = store.updateSettings(req.body ?? {});
    telemetry.reschedule();
    telemetry.notify();
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/settings/lock', (req: AuthenticatedRequest, res) => {
  const settings = store.getSettings();
  if (!settings.splashPinEnabled || !req.auth) {
    res.json({ ok: true, pinLocked: false });
    return;
  }
  store.setSessionPinLocked(req.auth.token, true);
  res.json({ ok: true, pinLocked: true });
});

app.post('/api/settings/verify-pin', (req: AuthenticatedRequest, res) => {
  const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
  const ok = store.verifySplashPin(pin);
  if (ok) {
    if (req.auth) {
      store.setSessionPinLocked(req.auth.token, false);
    }
    res.json({ ok: true, pinLocked: false });
    return;
  }
  res.status(403).json({ ok: false, message: 'Incorrect PIN' });
});

// SSH Servers CRUD + Test + Remote Command
app.get('/api/servers', (_req, res) => {
  res.json(store.listServersPublic());
});

app.post('/api/servers/test', async (req, res) => {
  try {
    const body = req.body as Partial<SshServerConfig>;
    const existing = body.id ? store.getServer(body.id) : undefined;
    const authMethod = body.authMethod || existing?.authMethod || 'tailscale';
    if (!body.host || (authMethod !== 'tailscale' && !body.username)) {
      res.status(400).json({
        ok: false,
        message: authMethod === 'tailscale' ? 'Host IP / Tailscale hostname is required' : 'Host IP and username are required',
      });
      return;
    }
    const cfg: SshServerConfig = {
      id: body.id || 'test-temp',
      name: body.name || body.host,
      host: body.host.trim(),
      port: Number(body.port) || 22,
      username: (body.username ?? existing?.username ?? '').trim(),
      authMethod,
      password: body.password || existing?.password,
      privateKey: body.privateKey || existing?.privateKey,
      passphrase: body.passphrase || existing?.passphrase,
      tags: [],
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const result = await ssh.testConnection(cfg);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/servers', async (req, res) => {
  try {
    const body = req.body as Partial<SshServerConfig>;
    const authMethod = body.authMethod || 'tailscale';
    if (!body.name || !body.host || (authMethod !== 'tailscale' && !body.username)) {
      res.status(400).json({
        error: authMethod === 'tailscale' ? 'name and host are required' : 'name, host, and username are required',
      });
      return;
    }
    const saved = store.upsertServer({
      ...body,
      authMethod,
      name: body.name,
      host: body.host,
      username: (body.username ?? '').trim(),
    });
    telemetry.notify();
    void telemetry.pollServerById(saved.id);
    res.status(201).json(store.toPublicServer(saved));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/servers/:id', async (req, res) => {
  try {
    const body = req.body as Partial<SshServerConfig>;
    const existing = store.getServer(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    const saved = store.upsertServer({
      ...body,
      id: existing.id,
      name: body.name ?? existing.name,
      host: body.host ?? existing.host,
      username: body.username ?? existing.username,
    });
    ssh.disconnect(saved.id);
    void telemetry.pollServerById(saved.id);
    res.json(store.toPublicServer(saved));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/servers/:id', (req, res) => {
  const deleted = store.deleteServer(req.params.id);
  telemetry.removeServerState(req.params.id);
  res.json({ deleted });
});

app.post('/api/servers/:id/exec', async (req, res) => {
  try {
    const command = String(req.body?.command ?? '').trim();
    if (!command) {
      res.status(400).json({ error: 'Command cannot be empty' });
      return;
    }
    const result = await telemetry.executeServerCommand(req.params.id, command);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/servers/:id/install-tailscale', async (req, res) => {
  try {
    const serverId = req.params.id;
    if (serverId.startsWith('demo-')) {
      res.json({
        ok: true,
        message: 'Demo host already has Tailscale SSH enabled (100.64.10.11).',
        output: '[DEMO] Tailscale already installed and --ssh enabled.',
        tailscaleIp: '100.64.10.11',
      });
      return;
    }
    const cfg = store.getServer(serverId);
    if (!cfg) {
      res.status(404).json({ ok: false, message: 'Server not found', output: '' });
      return;
    }
    const authKey = typeof req.body?.authKey === 'string' ? req.body.authKey.trim() : '';
    const enableSsh = req.body?.enableSsh !== false;
    const switchToTailscaleSsh = Boolean(req.body?.switchToTailscaleSsh);

    const script = buildRemoteTailscaleInstallScript({ authKey, enableSsh });
    const execRes = await ssh.runCommand(cfg, script, 120000);
    const combined = [execRes.stdout, execRes.stderr].filter(Boolean).join('\n').trim();
    const ipMatch = execRes.stdout.match(/===TS_IP===\s*\n([^\s\n]+)/);
    const tailscaleIp = ipMatch ? ipMatch[1].trim() : '';
    const urlMatch = combined.match(/https:\/\/login\.tailscale\.com\/a\/[^\s]+/i);
    const authUrl = urlMatch ? urlMatch[0] : undefined;

    if (execRes.exitCode === 0) {
      if (switchToTailscaleSsh && tailscaleIp) {
        store.upsertServer({
          ...cfg,
          host: tailscaleIp,
          authMethod: 'tailscale',
          tags: Array.from(new Set([...cfg.tags, 'tailscale'])),
        });
        ssh.disconnect(cfg.id);
        telemetry.notify();
        void telemetry.pollServerById(cfg.id);
      }
      res.json({
        ok: true,
        message: tailscaleIp
          ? `Tailscale ready on ${cfg.name} (${tailscaleIp})${enableSsh ? ' with Tailscale SSH enabled' : ''}`
          : `Tailscale installed on ${cfg.name}`,
        output: combined,
        tailscaleIp: tailscaleIp || undefined,
        authUrl,
      });
      return;
    }

    res.status(500).json({
      ok: false,
      message: `Remote Tailscale setup exited with code ${execRes.exitCode ?? 1}`,
      output: combined,
      tailscaleIp: tailscaleIp || undefined,
      authUrl,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      output: '',
    });
  }
});

// Proxmox VE CRUD + Test + Guest Power Controls
app.get('/api/proxmox', (_req, res) => {
  res.json(store.listProxmoxPublic());
});

app.post('/api/proxmox/test', async (req, res) => {
  try {
    const body = req.body as Partial<ProxmoxConfig>;
    if (!body.host) {
      res.status(400).json({ ok: false, message: 'Proxmox host/IP is required' });
      return;
    }
    const existing = body.id ? store.getProxmox(body.id) : undefined;
    const cfg: ProxmoxConfig = {
      id: body.id || 'pve-test',
      name: body.name || body.host,
      host: body.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      port: Number(body.port) || 8006,
      authType: body.authType || existing?.authType || 'token',
      username: body.username || existing?.username || 'root@pam',
      password: body.password || existing?.password,
      tokenId: body.tokenId || existing?.tokenId,
      tokenSecret: body.tokenSecret || existing?.tokenSecret,
      allowInsecureTls: body.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const result = await proxmox.testConnection(cfg);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/proxmox', async (req, res) => {
  try {
    const body = req.body as Partial<ProxmoxConfig>;
    if (!body.name || !body.host) {
      res.status(400).json({ error: 'name and host are required' });
      return;
    }
    const saved = store.upsertProxmox({
      ...body,
      name: body.name,
      host: body.host,
    });
    telemetry.notify();
    void telemetry.pollProxmoxById(saved.id);
    res.status(201).json(store.toPublicProxmox(saved));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/proxmox/:id', async (req, res) => {
  try {
    const body = req.body as Partial<ProxmoxConfig>;
    const existing = store.getProxmox(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Proxmox connection not found' });
      return;
    }
    const saved = store.upsertProxmox({
      ...body,
      id: existing.id,
      name: body.name ?? existing.name,
      host: body.host ?? existing.host,
    });
    proxmox.clearSession(saved.id);
    void telemetry.pollProxmoxById(saved.id);
    res.json(store.toPublicProxmox(saved));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/proxmox/:id', (req, res) => {
  const deleted = store.deleteProxmox(req.params.id);
  telemetry.removeProxmoxState(req.params.id);
  res.json({ deleted });
});

app.post('/api/proxmox/:id/nodes/:node/:type/:vmid/action', async (req, res) => {
  try {
    const { id, node, type, vmid } = req.params;
    const action = req.body?.action as GuestPowerAction;
    if (type !== 'qemu' && type !== 'lxc') {
      res.status(400).json({ error: 'Guest type must be qemu or lxc' });
      return;
    }
    if (!['start', 'shutdown', 'reboot', 'stop'].includes(action)) {
      res.status(400).json({ error: 'Invalid guest power action' });
      return;
    }
    const result = await telemetry.executeProxmoxGuestAction(id, node, type, Number(vmid), action);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/proxmox/:id/nodes/:node/:type/:vmid/vnc', async (req, res) => {
  try {
    const { id, node, type, vmid } = req.params;
    if (type !== 'qemu' && type !== 'lxc') {
      res.status(400).json({ error: 'Guest type must be qemu or lxc' });
      return;
    }
    if (id === 'demo-pve-cluster') {
      res.json({
        ok: true,
        demo: true,
        token: 'demo',
        password: '',
        label: `Demo ${type.toUpperCase()} #${vmid} (${node})`,
      });
      return;
    }
    const cfg = store.getProxmox(id);
    if (!cfg) {
      res.status(404).json({ error: 'Proxmox connection not found' });
      return;
    }
    const proxy = await proxmox.createVncProxy(cfg, node, type, Number(vmid));
    const label = `${type.toUpperCase()} #${vmid} (${node})`;
    const token = registerVncSession({
      wsUrl: proxy.wsUrl,
      headers: proxy.headers,
      rejectUnauthorized: proxy.rejectUnauthorized,
      label,
    });
    res.json({
      ok: true,
      demo: false,
      token,
      password: proxy.ticket,
      label,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = /403|permission/i.test(msg)
      ? `${msg} (Ensure your Proxmox user/token has VM.Console permission.)`
      : msg;
    res.status(500).json({ error: hint });
  }
});

// Tailscale Local Host Auto-Install & Join
app.get('/api/tailscale/local-status', async (_req, res) => {
  try {
    res.json(await getLocalTailscaleHostStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/tailscale/local-install', async (_req, res) => {
  try {
    const result = await installLocalTailscale();
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err), output: '' });
  }
});

app.post('/api/tailscale/local-up', async (req, res) => {
  try {
    const result = await bringUpLocalTailscale({
      authKey: typeof req.body?.authKey === 'string' ? req.body.authKey : undefined,
      hostname: typeof req.body?.hostname === 'string' ? req.body.hostname : undefined,
      enableSsh: Boolean(req.body?.enableSsh),
    });
    if (result.ok && result.status?.running) {
      // Auto-register Local Tailscale connection if none exists yet
      const existingLocal = store.listTailscale().find((t) => t.mode === 'local');
      if (!existingLocal) {
        const saved = store.upsertTailscale({
          name: result.status.tailnetName || 'Local Tailscale',
          mode: 'local',
          tailnet: result.status.tailnetName || '-',
          enabled: true,
        });
        await telemetry.pollTailscaleById(saved.id);
      } else {
        await telemetry.pollTailscaleById(existingLocal.id);
      }
    }
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err), output: '' });
  }
});

// Tailscale Network Discovery CRUD + Test + Sync
app.get('/api/tailscale', (_req, res) => {
  res.json(store.listTailscalePublic());
});

app.post('/api/tailscale/test', async (req, res) => {
  try {
    const body = req.body as Partial<TailscaleConfig>;
    const existing = body.id ? store.getTailscale(body.id) : undefined;
    const cfg: TailscaleConfig = {
      id: body.id || 'ts-test',
      name: body.name || 'Tailnet',
      mode: body.mode || existing?.mode || 'local',
      tailnet: (body.tailnet ?? existing?.tailnet ?? '-').trim() || '-',
      apiKey: body.apiKey || existing?.apiKey,
      oauthClientId: body.oauthClientId || existing?.oauthClientId,
      oauthClientSecret: body.oauthClientSecret || existing?.oauthClientSecret,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const result = await tailscale.testConnection(cfg);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/tailscale', async (req, res) => {
  try {
    const body = req.body as Partial<TailscaleConfig>;
    const saved = store.upsertTailscale({
      ...body,
      name: body.name?.trim() || (body.mode === 'local' ? 'Local Tailscale' : body.tailnet || 'Tailnet'),
    });
    await telemetry.pollTailscaleById(saved.id);
    res.status(201).json(store.toPublicTailscale(saved));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/tailscale/:id', async (req, res) => {
  try {
    const body = req.body as Partial<TailscaleConfig>;
    const existing = store.getTailscale(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Tailscale connection not found' });
      return;
    }
    const saved = store.upsertTailscale({
      ...body,
      id: existing.id,
      name: body.name ?? existing.name,
    });
    tailscale.clearCache(saved.id);
    await telemetry.pollTailscaleById(saved.id);
    res.json(store.toPublicTailscale(saved));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/tailscale/:id', (req, res) => {
  const deleted = store.deleteTailscale(req.params.id);
  telemetry.removeTailscaleState(req.params.id);
  res.json({ deleted });
});

app.post('/api/tailscale/:id/sync', async (req, res) => {
  try {
    const snap = await telemetry.pollTailscaleById(req.params.id);
    if (!snap) {
      res.status(404).json({ error: 'Tailscale connection not found or disabled' });
      return;
    }
    res.json(snap);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// OPNsense Firewall / Router CRUD + Test + Service & System Actions
app.get('/api/opnsense', (_req, res) => {
  res.json(store.listOpnsensePublic());
});

app.post('/api/opnsense/test', async (req, res) => {
  try {
    const body = req.body as Partial<OpnsenseConfig>;
    if (!body.host) {
      res.status(400).json({ ok: false, message: 'OPNsense host IP / hostname is required' });
      return;
    }
    const existing = body.id ? store.getOpnsense(body.id) : undefined;
    const protocol = body.protocol || existing?.protocol || 'https';
    const cfg: OpnsenseConfig = {
      id: body.id || 'opn-test',
      name: body.name || body.host,
      host: body.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      port: Number(body.port) || existing?.port || (protocol === 'https' ? 443 : 80),
      protocol,
      apiKey: body.apiKey || existing?.apiKey,
      apiSecret: body.apiSecret || existing?.apiSecret,
      allowInsecureTls: body.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    const result = await opnsense.testConnection(cfg);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/opnsense', async (req, res) => {
  try {
    const body = req.body as Partial<OpnsenseConfig>;
    if (!body.name || !body.host) {
      res.status(400).json({ error: 'name and host are required' });
      return;
    }
    const saved = store.upsertOpnsense({
      ...body,
      name: body.name,
      host: body.host,
    });
    telemetry.notify();
    void telemetry.pollOpnsenseById(saved.id);
    res.status(201).json(store.toPublicOpnsense(saved));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put('/api/opnsense/:id', async (req, res) => {
  try {
    const body = req.body as Partial<OpnsenseConfig>;
    const existing = store.getOpnsense(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'OPNsense connection not found' });
      return;
    }
    const saved = store.upsertOpnsense({
      ...body,
      id: existing.id,
      name: body.name ?? existing.name,
      host: body.host ?? existing.host,
    });
    telemetry.notify();
    void telemetry.pollOpnsenseById(saved.id);
    res.json(store.toPublicOpnsense(saved));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete('/api/opnsense/:id', (req, res) => {
  const deleted = store.deleteOpnsense(req.params.id);
  telemetry.removeOpnsenseState(req.params.id);
  res.json({ deleted });
});

app.post('/api/opnsense/:id/services/:serviceId/:action', async (req, res) => {
  try {
    const { id, serviceId, action } = req.params;
    if (!['start', 'stop', 'restart'].includes(action)) {
      res.status(400).json({ error: 'Action must be start, stop, or restart' });
      return;
    }
    const result = await telemetry.executeOpnsenseServiceAction(
      id,
      serviceId,
      action as OpnsenseServiceAction,
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/opnsense/:id/system/:action', async (req, res) => {
  try {
    const { id, action } = req.params;
    if (!['reboot', 'halt', 'firmware-check'].includes(action)) {
      res.status(400).json({ error: 'Invalid OPNsense system action' });
      return;
    }
    const result = await telemetry.executeOpnsenseSystemAction(
      id,
      action as 'reboot' | 'halt' | 'firmware-check',
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Serve built Vue frontend in production
const candidateDistDirs = [
  path.resolve(__dirname, '../../../client/dist'),
  path.resolve(__dirname, '../../../../client/dist'),
];
const clientDist = candidateDistDirs.find((dir) => fs.existsSync(path.join(dir, 'index.html')));

if (clientDist) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const PORT = Number(process.env.PORT) || 3840;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`[rack-panel] Backend listening on http://${HOST}:${PORT} (WebSocket /ws & /ws/terminal)`);
  if (clientDist) {
    console.log(`[rack-panel] Serving frontend bundle from ${clientDist}`);
  }
  telemetry.start();
});

// Live WebSocket telemetry streaming (/ws) + Interactive Terminal bridge (/ws/terminal)
interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
  authToken?: string;
}

const wss = new WebSocketServer({ noServer: true });
const termWss = new WebSocketServer({ noServer: true });
const vncWss = new WebSocketServer({
  noServer: true,
  handleProtocols(protocols) {
    if (protocols.has('binary')) return 'binary';
    return false;
  },
});

function rejectUpgrade(socket: import('node:stream').Duplex, code: number, label: string): void {
  try {
    socket.write(`HTTP/1.1 ${code} ${label}\r\nConnection: close\r\n\r\n`);
  } catch {
    // ignore
  }
  socket.destroy();
}

server.on('upgrade', (req, socket, head) => {
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = parsedUrl.pathname;
  const headerToken = extractBearerToken(req);

  if (pathname === '/ws') {
    const token = parsedUrl.searchParams.get('token') || headerToken;
    const found = token ? store.getSessionByToken(token) : null;
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
    const found = token ? store.getSessionByToken(token) : null;
    if (!found) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    if (found.session.pinLocked && store.getSettings().splashPinEnabled) {
      rejectUpgrade(socket, 423, 'Locked');
      return;
    }
    termWss.handleUpgrade(req, socket, head, (ws) => {
      termWss.emit('connection', ws, req);
    });
  } else if (pathname === '/ws/vnc') {
    const authToken = parsedUrl.searchParams.get('auth') || headerToken;
    const found = authToken ? store.getSessionByToken(authToken) : null;
    if (!found) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    if (found.session.pinLocked && store.getSettings().splashPinEnabled) {
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
  void handleTerminalConnection(ws, req, store, ssh, proxmox);
});

vncWss.on('connection', (ws, req) => {
  handleVncConnection(ws, req);
});

function buildSnapshotPayload(): string {
  return JSON.stringify({
    type: 'snapshot',
    overview: telemetry.getOverview(),
    servers: store.listServersPublic(),
    proxmox: store.listProxmoxPublic(),
    tailscale: store.listTailscalePublic(),
    opnsense: store.listOpnsensePublic(),
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

telemetry.onUpdate(() => {
  broadcastSnapshot();
});

wss.on('connection', (ws: AliveWebSocket) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Push immediate snapshot so the dashboard paints right away
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
        const found = ws.authToken ? store.getSessionByToken(ws.authToken) : null;
        if (!found) {
          ws.close(4401, 'Unauthorized');
          return;
        }
        if (found.session.pinLocked && store.getSettings().splashPinEnabled) {
          return;
        }
        void telemetry.pollNow(true);
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

function gracefulShutdown() {
  clearInterval(wsHeartbeat);
  telemetry.stop();
  wss.close();
  termWss.close();
  vncWss.close();
  server.close(() => process.exit(0));
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
