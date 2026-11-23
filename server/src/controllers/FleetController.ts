import { Controller, Inject } from '@tsed/di';
import { Delete, Get, Post, Put } from '@tsed/schema';
import { Req, Res } from '@tsed/common';
import type express from 'express';
import type {
  DockerContainerAction,
  GuestPowerAction,
  HikvisionConfig,
  OpnsenseConfig,
  OpnsenseServiceAction,
  ProxmoxConfig,
  SshServerConfig,
  TailscaleConfig,
} from '../../../shared/types.js';
import { DockerService } from '../services/dockerService.js';
import { getOrCreateTeslaPartnerPublicKeyPem } from '../services/upsClient.js';
import {
  bringUpLocalTailscale,
  buildRemoteTailscaleInstallScript,
  getLocalTailscaleHostStatus,
  installLocalTailscale,
} from '../services/tailscaleSetup.js';
import { registerVncSession } from '../services/vncBridge.js';
import { RackPanelRuntime, type AuthenticatedRequest } from '../runtime.js';

@Controller('/')
export class FleetController {
  private readonly docker: DockerService;

  constructor(@Inject(RackPanelRuntime) private readonly rt: RackPanelRuntime) {
    this.docker = new DockerService(rt.store, rt.ssh);
  }

  // ---- Overview & Settings ----

  @Get('/overview')
  getOverview(@Res() res: express.Response): void {
    res.json(this.rt.telemetry.getOverview());
  }

  @Post('/poll')
  async triggerPoll(@Res() res: express.Response): Promise<void> {
    await this.rt.telemetry.pollNow(true);
    res.json(this.rt.telemetry.getOverview());
  }

  @Get('/settings')
  getSettings(@Res() res: express.Response): void {
    res.json(this.rt.store.getSettings());
  }

  @Put('/settings')
  updateSettings(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const updated = this.rt.store.updateSettings(req.body ?? {});
      this.rt.telemetry.start();
      this.rt.telemetry.notify();
      res.json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/settings/lock')
  lockSplash(@Req() req: AuthenticatedRequest, @Res() res: express.Response): void {
    if (!req.auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const settings = this.rt.store.getSettings();
    if (settings.splashPinEnabled && settings.hasSplashPin) {
      this.rt.store.setSessionPinLocked(req.auth.token, true);
    }
    res.json({ ok: true, pinLocked: settings.splashPinEnabled && settings.hasSplashPin });
  }

  @Post('/settings/verify-pin')
  verifyPin(@Req() req: AuthenticatedRequest, @Res() res: express.Response): void {
    const pin = String(req.body?.pin ?? '');
    if (this.rt.store.verifySplashPin(pin)) {
      if (req.auth) {
        this.rt.store.setSessionPinLocked(req.auth.token, false);
      }
      res.json({ ok: true, pinLocked: false });
      return;
    }
    res.status(401).json({ ok: false, error: 'Incorrect 4-digit PIN' });
  }

  @Post('/settings/factory-reset')
  async factoryReset(@Res() res: express.Response): Promise<void> {
    try {
      const settings = await this.rt.store.factoryResetKeepUsers();
      this.rt.topology.resetState('all');
      this.rt.telemetry.resetAllSnapshots();
      res.json({ ok: true, settings });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- SSH Servers ----

  @Get('/servers')
  listServers(@Res() res: express.Response): void {
    res.json(this.rt.store.listServersPublic());
  }

  @Post('/servers/test')
  async testServer(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const existing = body.id ? this.rt.store.getServer(String(body.id)) : undefined;
      const cfg: SshServerConfig = {
        id: existing?.id ?? 'test',
        name: String(body.name || 'test'),
        host: String(body.host || existing?.host || ''),
        port: Number(body.port || existing?.port || 22),
        username: String(body.username || existing?.username || 'root'),
        authMethod: body.authMethod || existing?.authMethod || 'password',
        password: body.password ? String(body.password) : existing?.password,
        privateKey: body.privateKey ? String(body.privateKey) : existing?.privateKey,
        passphrase: body.passphrase ? String(body.passphrase) : existing?.passphrase,
        rackUnit: body.rackUnit ? String(body.rackUnit) : existing?.rackUnit || '',
        tags: Array.isArray(body.tags) ? body.tags : existing?.tags || [],
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      if (!cfg.host) {
        res.status(400).json({ ok: false, message: 'Host is required' });
        return;
      }
      const result = await this.rt.ssh.testConnection(cfg);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/servers')
  async createServer(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const body = req.body ?? {};
      if (!body.name || !body.host || !body.username) {
        res.status(400).json({ error: 'Name, host, and username are required' });
        return;
      }
      const saved = this.rt.store.upsertServer({
        name: String(body.name),
        host: String(body.host),
        port: body.port ? Number(body.port) : 22,
        username: String(body.username),
        authMethod: body.authMethod || 'password',
        password: body.password ? String(body.password) : undefined,
        privateKey: body.privateKey ? String(body.privateKey) : undefined,
        passphrase: body.passphrase ? String(body.passphrase) : undefined,
        rackUnit: body.rackUnit ? String(body.rackUnit) : '',
        tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
        enabled: body.enabled !== false,
      });
      void this.rt.telemetry.pollServerById(saved.id);
      res.status(201).json(this.rt.store.toPublicServer(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Put('/servers/:id')
  async updateServer(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const body = req.body ?? {};
      const existing = this.rt.store.getServer(id);
      if (!existing) {
        res.status(404).json({ error: 'Server not found' });
        return;
      }
      const saved = this.rt.store.upsertServer({
        ...existing,
        ...body,
        id,
        password: body.password !== undefined ? String(body.password) : undefined,
        privateKey: body.privateKey !== undefined ? String(body.privateKey) : undefined,
        passphrase: body.passphrase !== undefined ? String(body.passphrase) : undefined,
      });
      this.rt.ssh.disconnect(id);
      void this.rt.telemetry.pollServerById(saved.id);
      res.json(this.rt.store.toPublicServer(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/servers/:id')
  deleteServer(@Req() req: express.Request, @Res() res: express.Response): void {
    const id = String(req.params.id);
    const deleted = this.rt.store.deleteServer(id);
    this.rt.ssh.disconnect(id);
    if (deleted) this.rt.telemetry.removeServerState(id);
    res.json({ deleted });
  }

  @Post('/servers/:id/exec')
  async execOnServer(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    const command = String(req.body?.command || '').trim();
    if (!command) {
      res.status(400).json({ error: 'Command is required' });
      return;
    }
    try {
      const result = await this.rt.telemetry.executeServerCommand(String(req.params.id), command);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/servers/:id/install-tailscale')
  async installTailscaleOnServer(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const serverId = String(req.params.id);
      if (serverId.startsWith('demo-')) {
        res.json({
          ok: true,
          message: 'Demo host already has Tailscale SSH enabled (100.64.10.11).',
          output: '[DEMO] Tailscale already installed and --ssh enabled.',
          tailscaleIp: '100.64.10.11',
        });
        return;
      }
      const cfg = this.rt.store.getServer(serverId);
      if (!cfg) {
        res.status(404).json({ ok: false, message: 'Server not found', output: '' });
        return;
      }
      const authKey = typeof req.body?.authKey === 'string' ? req.body.authKey.trim() : '';
      const enableSsh = req.body?.enableSsh !== false;
      const switchToTailscaleSsh = Boolean(req.body?.switchToTailscaleSsh);

      const script = buildRemoteTailscaleInstallScript({ authKey, enableSsh });
      const execRes = await this.rt.ssh.runCommand(cfg, script, 120000);
      const combined = [execRes.stdout, execRes.stderr].filter(Boolean).join('\n').trim();
      const ipMatch = execRes.stdout.match(/===TS_IP===\s*\n([^\s\n]+)/);
      const tailscaleIp = ipMatch ? ipMatch[1].trim() : '';
      const urlMatch = combined.match(/https:\/\/login\.tailscale\.com\/a\/[^\s]+/i);
      const authUrl = urlMatch ? urlMatch[0] : undefined;

      if (execRes.exitCode === 0) {
        if (switchToTailscaleSsh && tailscaleIp) {
          this.rt.store.upsertServer({
            ...cfg,
            host: tailscaleIp,
            authMethod: 'tailscale',
            tags: Array.from(new Set([...cfg.tags, 'tailscale'])),
          });
          this.rt.ssh.disconnect(cfg.id);
          this.rt.telemetry.notify();
          void this.rt.telemetry.pollServerById(cfg.id);
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
  }

  // ---- Proxmox VE ----

  @Get('/proxmox')
  listProxmox(@Res() res: express.Response): void {
    res.json(this.rt.store.listProxmoxPublic());
  }

  @Post('/proxmox/test')
  async testProxmox(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const existing = body.id ? this.rt.store.getProxmox(String(body.id)) : undefined;
      const cfg: ProxmoxConfig = {
        id: existing?.id ?? 'test',
        name: String(body.name || 'test'),
        host: String(body.host || existing?.host || ''),
        port: Number(body.port || existing?.port || 8006),
        authType: body.authType || existing?.authType || 'token',
        username: String(body.username || existing?.username || 'root@pam'),
        password: body.password ? String(body.password) : existing?.password,
        tokenId: body.tokenId !== undefined ? String(body.tokenId) : existing?.tokenId || '',
        tokenSecret: body.tokenSecret ? String(body.tokenSecret) : existing?.tokenSecret,
        allowInsecureTls: body.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      if (!cfg.host) {
        res.status(400).json({ ok: false, message: 'Host is required' });
        return;
      }
      const result = await this.rt.proxmox.testConnection(cfg);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/proxmox')
  async createProxmox(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const body = req.body ?? {};
      if (!body.name || !body.host || !body.username) {
        res.status(400).json({ error: 'Name, host, and username are required' });
        return;
      }
      const saved = this.rt.store.upsertProxmox({
        name: String(body.name),
        host: String(body.host),
        port: body.port ? Number(body.port) : 8006,
        authType: body.authType || 'token',
        username: String(body.username),
        password: body.password ? String(body.password) : undefined,
        tokenId: body.tokenId ? String(body.tokenId) : '',
        tokenSecret: body.tokenSecret ? String(body.tokenSecret) : undefined,
        allowInsecureTls: body.allowInsecureTls !== false,
        enabled: body.enabled !== false,
      });
      void this.rt.telemetry.pollProxmoxById(saved.id);
      res.status(201).json(this.rt.store.toPublicProxmox(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Put('/proxmox/:id')
  async updateProxmox(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const id = String(req.params.id);
      const body = req.body ?? {};
      const existing = this.rt.store.getProxmox(id);
      if (!existing) {
        res.status(404).json({ error: 'Proxmox connection not found' });
        return;
      }
      const saved = this.rt.store.upsertProxmox({
        ...existing,
        ...body,
        id,
        password: body.password !== undefined ? String(body.password) : undefined,
        tokenSecret: body.tokenSecret !== undefined ? String(body.tokenSecret) : undefined,
      });
      void this.rt.telemetry.pollProxmoxById(saved.id);
      res.json(this.rt.store.toPublicProxmox(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/proxmox/:id')
  deleteProxmox(@Req() req: express.Request, @Res() res: express.Response): void {
    const id = String(req.params.id);
    const deleted = this.rt.store.deleteProxmox(id);
    if (deleted) this.rt.telemetry.removeProxmoxState(id);
    res.json({ deleted });
  }

  @Post('/proxmox/:id/nodes/:node/:type/:vmid/action')
  async proxmoxGuestAction(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    const type = String(req.params.type) as 'qemu' | 'lxc';
    const action = String(req.body?.action || '') as GuestPowerAction;
    if (!['qemu', 'lxc'].includes(type)) {
      res.status(400).json({ error: 'Invalid guest type' });
      return;
    }
    if (!['start', 'shutdown', 'stop', 'reboot'].includes(action)) {
      res.status(400).json({ error: 'Invalid power action' });
      return;
    }
    try {
      const result = await this.rt.telemetry.executeProxmoxGuestAction(
        String(req.params.id),
        String(req.params.node),
        type,
        Number(req.params.vmid),
        action,
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- Docker Engine & Containers (via SSH Hosts) ----

  @Get('/docker')
  async listDockerHosts(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const serverId = req.query?.serverId ? String(req.query.serverId) : undefined;
      const hosts = await this.docker.listDockerHosts(serverId);
      res.json(hosts);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/docker/:serverId/containers/:containerId/action')
  async dockerContainerAction(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    const action = String(req.body?.action || '') as DockerContainerAction;
    if (!['start', 'stop', 'restart', 'pause', 'unpause', 'remove'].includes(action)) {
      res.status(400).json({ error: 'Invalid Docker action' });
      return;
    }
    try {
      const result = await this.docker.containerAction(
        String(req.params.serverId),
        String(req.params.containerId),
        action,
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Get('/docker/:serverId/containers/:containerId/logs')
  async dockerContainerLogs(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const tail = req.query?.tail ? Number(req.query.tail) : 200;
      const result = await this.docker.getContainerLogs(
        String(req.params.serverId),
        String(req.params.containerId),
        tail,
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/docker/:serverId/containers/:containerId/exec')
  async dockerContainerExec(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    const command = String(req.body?.command || '').trim();
    if (!command) {
      res.status(400).json({ error: 'Command is required' });
      return;
    }
    try {
      const result = await this.docker.execInContainer(
        String(req.params.serverId),
        String(req.params.containerId),
        command,
      );
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/docker/:serverId/prune')
  async dockerPrune(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    const target = String(req.body?.target || 'containers') as 'containers' | 'images' | 'all';
    if (!['containers', 'images', 'all'].includes(target)) {
      res.status(400).json({ error: 'Invalid prune target' });
      return;
    }
    try {
      const result = await this.docker.pruneHost(String(req.params.serverId), target);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/proxmox/:id/nodes/:node/:type/:vmid/vnc')
  async proxmoxVnc(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    const configId = String(req.params.id);
    const node = String(req.params.node);
    const type = String(req.params.type) as 'qemu' | 'lxc';
    const vmid = Number(req.params.vmid);

    if (!['qemu', 'lxc'].includes(type) || !Number.isFinite(vmid)) {
      res.status(400).json({ error: 'Invalid Proxmox guest parameters' });
      return;
    }
    if (configId === 'demo-pve') {
      res.status(400).json({
        error: 'Live noVNC console requires a real Proxmox VE cluster connection. Add yours in Settings.',
      });
      return;
    }
    const cfg = this.rt.store.getProxmox(configId);
    if (!cfg) {
      res.status(404).json({ error: 'Proxmox connection not found' });
      return;
    }
    try {
      const ticket = await this.rt.proxmox.createVncProxy(cfg, node, type, vmid);
      const token = registerVncSession({
        wsUrl: ticket.wsUrl,
        headers: ticket.headers,
        rejectUnauthorized: ticket.rejectUnauthorized,
        label: `${cfg.name} · ${node}/${type}/${vmid}`,
      });
      res.json({
        token,
        password: ticket.ticket,
        node,
        type,
        vmid,
        wsPath: `/ws/vnc?token=${encodeURIComponent(token)}`,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- Tailscale ----

  @Get('/tailscale/local-status')
  async localTailscaleStatus(@Res() res: express.Response): Promise<void> {
    try {
      res.json(await getLocalTailscaleHostStatus());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/tailscale/local-install')
  async localTailscaleInstall(@Res() res: express.Response): Promise<void> {
    try {
      const result = await installLocalTailscale();
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err), output: '' });
    }
  }

  @Post('/tailscale/local-up')
  async localTailscaleUp(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const authKey = typeof req.body?.authKey === 'string' ? req.body.authKey : undefined;
      const enableSsh = req.body?.enableSsh !== false;
      const hostname = typeof req.body?.hostname === 'string' ? req.body.hostname : undefined;
      const result = await bringUpLocalTailscale({ authKey, enableSsh, hostname });
      if (result.ok) {
        const hasLocalCfg = this.rt.store.listTailscale().some((t) => t.mode === 'local');
        if (!hasLocalCfg) {
          const saved = this.rt.store.upsertTailscale({
            name: 'Local Tailscale Node',
            mode: 'local',
            tailnet: '-',
            enabled: true,
          });
          void this.rt.telemetry.pollTailscaleById(saved.id);
        } else {
          void this.rt.telemetry.pollNow(true);
        }
      }
      res.status(result.ok ? 200 : 500).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err), output: '' });
    }
  }

  @Get('/tailscale')
  listTailscale(@Res() res: express.Response): void {
    res.json(this.rt.store.listTailscalePublic());
  }

  @Post('/tailscale/test')
  async testTailscale(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const existing = body.id ? this.rt.store.getTailscale(String(body.id)) : undefined;
      const cfg: TailscaleConfig = {
        id: existing?.id ?? 'test',
        name: String(body.name || 'Tailscale'),
        mode: body.mode || existing?.mode || 'api',
        tailnet: String(body.tailnet || existing?.tailnet || '-'),
        apiKey: body.apiKey ? String(body.apiKey) : existing?.apiKey,
        oauthClientId: body.oauthClientId !== undefined ? String(body.oauthClientId) : existing?.oauthClientId,
        oauthClientSecret: body.oauthClientSecret ? String(body.oauthClientSecret) : existing?.oauthClientSecret,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      const result = await this.rt.tailscale.testConnection(cfg);
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/tailscale')
  createTailscale(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const body = req.body ?? {};
      const saved = this.rt.store.upsertTailscale({
        name: String(body.name || 'Tailscale Tailnet'),
        mode: body.mode || 'api',
        tailnet: String(body.tailnet || '-'),
        apiKey: body.apiKey ? String(body.apiKey) : undefined,
        oauthClientId: body.oauthClientId ? String(body.oauthClientId) : undefined,
        oauthClientSecret: body.oauthClientSecret ? String(body.oauthClientSecret) : undefined,
        enabled: body.enabled !== false,
      });
      void this.rt.telemetry.pollTailscaleById(saved.id);
      res.status(201).json(this.rt.store.toPublicTailscale(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Put('/tailscale/:id')
  updateTailscale(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const id = String(req.params.id);
      const body = req.body ?? {};
      const existing = this.rt.store.getTailscale(id);
      if (!existing) {
        res.status(404).json({ error: 'Tailscale connection not found' });
        return;
      }
      const saved = this.rt.store.upsertTailscale({
        ...existing,
        ...body,
        id,
        apiKey: body.apiKey !== undefined ? String(body.apiKey) : undefined,
        oauthClientSecret: body.oauthClientSecret !== undefined ? String(body.oauthClientSecret) : undefined,
      });
      void this.rt.telemetry.pollTailscaleById(saved.id);
      res.json(this.rt.store.toPublicTailscale(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/tailscale/:id')
  deleteTailscale(@Req() req: express.Request, @Res() res: express.Response): void {
    const id = String(req.params.id);
    const deleted = this.rt.store.deleteTailscale(id);
    if (deleted) this.rt.telemetry.removeTailscaleState(id);
    res.json({ deleted });
  }

  @Post('/tailscale/:id/sync')
  async syncTailscale(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const snap = await this.rt.telemetry.pollTailscaleById(String(req.params.id));
      if (!snap) {
        res.status(404).json({ error: 'Tailscale integration not found' });
        return;
      }
      res.json(snap);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- OPNsense ----

  @Get('/opnsense')
  listOpnsense(@Res() res: express.Response): void {
    res.json(this.rt.store.listOpnsensePublic());
  }

  @Post('/opnsense/test')
  async testOpnsense(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const existing = body.id ? this.rt.store.getOpnsense(String(body.id)) : undefined;
      const cfg: OpnsenseConfig = {
        id: existing?.id ?? 'test',
        name: String(body.name || 'OPNsense Firewall'),
        host: String(body.host || existing?.host || ''),
        port: Number(body.port || existing?.port || 443),
        protocol: body.protocol === 'http' ? 'http' : existing?.protocol || 'https',
        apiKey: body.apiKey ? String(body.apiKey) : existing?.apiKey,
        apiSecret: body.apiSecret ? String(body.apiSecret) : existing?.apiSecret,
        allowInsecureTls: body.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      if (!cfg.host) {
        res.status(400).json({ ok: false, message: 'OPNsense host is required' });
        return;
      }
      res.json(await this.rt.opnsense.testConnection(cfg));
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/opnsense')
  createOpnsense(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const body = req.body ?? {};
      if (!body.name || !body.host) {
        res.status(400).json({ error: 'Name and host are required' });
        return;
      }
      const saved = this.rt.store.upsertOpnsense({
        name: String(body.name),
        host: String(body.host),
        port: body.port ? Number(body.port) : body.protocol === 'http' ? 80 : 443,
        protocol: body.protocol === 'http' ? 'http' : 'https',
        apiKey: body.apiKey ? String(body.apiKey) : undefined,
        apiSecret: body.apiSecret ? String(body.apiSecret) : undefined,
        allowInsecureTls: body.allowInsecureTls !== false,
        enabled: body.enabled !== false,
      });
      void this.rt.telemetry.pollOpnsenseById(saved.id);
      res.status(201).json(this.rt.store.toPublicOpnsense(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Put('/opnsense/:id')
  updateOpnsense(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const id = String(req.params.id);
      const body = req.body ?? {};
      const existing = this.rt.store.getOpnsense(id);
      if (!existing) {
        res.status(404).json({ error: 'OPNsense firewall not found' });
        return;
      }
      const saved = this.rt.store.upsertOpnsense({
        ...existing,
        ...body,
        id,
        apiKey: body.apiKey !== undefined ? String(body.apiKey) : undefined,
        apiSecret: body.apiSecret !== undefined ? String(body.apiSecret) : undefined,
      });
      void this.rt.telemetry.pollOpnsenseById(saved.id);
      res.json(this.rt.store.toPublicOpnsense(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/opnsense/:id')
  deleteOpnsense(@Req() req: express.Request, @Res() res: express.Response): void {
    const id = String(req.params.id);
    const deleted = this.rt.store.deleteOpnsense(id);
    if (deleted) this.rt.telemetry.removeOpnsenseState(id);
    res.json({ deleted });
  }

  @Post('/opnsense/:id/services/:serviceId/:action')
  async opnsenseServiceAction(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    const action = String(req.params.action) as OpnsenseServiceAction;
    if (!['start', 'stop', 'restart'].includes(action)) {
      res.status(400).json({ error: 'Invalid service action' });
      return;
    }
    try {
      const result = await this.rt.telemetry.executeOpnsenseServiceAction(
        String(req.params.id),
        String(req.params.serviceId),
        action,
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/opnsense/:id/system/:action')
  async opnsenseSystemAction(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    const action = String(req.params.action) as 'reboot' | 'halt' | 'firmware-check';
    if (!['reboot', 'halt', 'firmware-check'].includes(action)) {
      res.status(400).json({ error: 'Invalid OPNsense system action' });
      return;
    }
    try {
      const result = await this.rt.telemetry.executeOpnsenseSystemAction(String(req.params.id), action);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- Hikvision ----

  @Get('/hikvision')
  listHikvision(@Res() res: express.Response): void {
    res.json(this.rt.store.listHikvisionPublic());
  }

  @Post('/hikvision/test')
  async testHikvision(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const existing = body.id ? this.rt.store.getHikvision(String(body.id)) : undefined;
      const cfg: HikvisionConfig = {
        id: existing?.id ?? 'test',
        name: String(body.name || 'Hikvision NVR'),
        host: String(body.host || existing?.host || ''),
        port: Number(body.port || existing?.port || (body.protocol === 'https' ? 443 : 80)),
        protocol: body.protocol === 'https' ? 'https' : existing?.protocol || 'http',
        rtspPort: Number(body.rtspPort || existing?.rtspPort || 554),
        username: String(body.username || existing?.username || 'admin'),
        password: body.password ? String(body.password) : existing?.password,
        deviceKind:
          body.deviceKind === 'nvr' || body.deviceKind === 'dvr' || body.deviceKind === 'camera'
            ? body.deviceKind
            : existing?.deviceKind || 'auto',
        allowInsecureTls: body.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      if (!cfg.host) {
        res.status(400).json({ ok: false, message: 'Hikvision host IP is required' });
        return;
      }
      res.json(await this.rt.hikvision.testConnection(cfg));
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/hikvision')
  createHikvision(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const body = req.body ?? {};
      if (!body.name || !body.host) {
        res.status(400).json({ error: 'Name and host are required' });
        return;
      }
      const saved = this.rt.store.upsertHikvision({
        name: String(body.name),
        host: String(body.host),
        port: body.port ? Number(body.port) : body.protocol === 'https' ? 443 : 80,
        protocol: body.protocol === 'https' ? 'https' : 'http',
        rtspPort: body.rtspPort ? Number(body.rtspPort) : 554,
        username: body.username ? String(body.username) : 'admin',
        password: body.password ? String(body.password) : undefined,
        deviceKind:
          body.deviceKind === 'nvr' || body.deviceKind === 'dvr' || body.deviceKind === 'camera'
            ? body.deviceKind
            : 'auto',
        allowInsecureTls: body.allowInsecureTls !== false,
        enabled: body.enabled !== false,
      });
      void this.rt.telemetry.pollHikvisionById(saved.id);
      res.status(201).json(this.rt.store.toPublicHikvision(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Put('/hikvision/:id')
  updateHikvision(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const id = String(req.params.id);
      const body = req.body ?? {};
      const existing = this.rt.store.getHikvision(id);
      if (!existing) {
        res.status(404).json({ error: 'Hikvision device not found' });
        return;
      }
      const saved = this.rt.store.upsertHikvision({
        ...existing,
        ...body,
        id,
        password: body.password !== undefined ? String(body.password) : undefined,
      });
      void this.rt.telemetry.pollHikvisionById(saved.id);
      res.json(this.rt.store.toPublicHikvision(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/hikvision/:id')
  deleteHikvision(@Req() req: express.Request, @Res() res: express.Response): void {
    const id = String(req.params.id);
    const deleted = this.rt.store.deleteHikvision(id);
    if (deleted) this.rt.telemetry.removeHikvisionState(id);
    res.json({ deleted });
  }

  @Get('/hikvision/:id/channels/:channelId/snapshot')
  async hikvisionSnapshot(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const configId = String(req.params.id);
      const channelId = Math.max(1, Number(req.params.channelId) || 1);
      const streamKind = req.query.stream === 'main' ? 'main' : 'sub';

      if (configId === 'demo-hikvision-nvr') {
        const svg = this.rt.telemetry.demo.renderDemoCameraSvg(channelId);
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.send(svg);
        return;
      }

      const cfg = this.rt.store.getHikvision(configId);
      if (!cfg) {
        res.status(404).json({ error: 'Hikvision device not found' });
        return;
      }

      const frame = await this.rt.hikvision.fetchChannelFrame(cfg, channelId, streamKind);
      res.setHeader('Content-Type', frame.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.send(frame.buffer);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Get('/hikvision/:id/channels/:channelId/mjpeg')
  async hikvisionMjpeg(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    const configId = String(req.params.id);
    const channelId = Math.max(1, Number(req.params.channelId) || 1);
    const streamKind = req.query.stream === 'main' ? 'main' : 'sub';
    const mode = req.query.mode === 'rtsp' ? 'rtsp' : 'isapi';
    const fps = Math.max(1, Math.min(15, Number(req.query.fps) || 5));

    if (configId === 'demo-hikvision-nvr') {
      const svg = this.rt.telemetry.demo.renderDemoCameraSvg(channelId);
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(svg);
      return;
    }

    const cfg = this.rt.store.getHikvision(configId);
    if (!cfg) {
      res.status(404).json({ error: 'Hikvision device not found' });
      return;
    }

    await this.rt.hikvision.streamChannelMjpeg(cfg, channelId, { streamKind, mode, fps }, req, res);
  }

  @Post('/hikvision/:id/channels/:channelId/ptz')
  async hikvisionPtz(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const configId = String(req.params.id);
      const channelId = Math.max(1, Number(req.params.channelId) || 1);
      const pan = Number(req.body?.pan) || 0;
      const tilt = Number(req.body?.tilt) || 0;
      const zoom = Number(req.body?.zoom) || 0;

      if (configId === 'demo-hikvision-nvr') {
        res.json({
          ok: true,
          message:
            pan === 0 && tilt === 0 && zoom === 0
              ? `[Demo] PTZ stopped on CH${channelId}`
              : `[Demo] PTZ moving CH${channelId} (pan=${pan}, tilt=${tilt}, zoom=${zoom})`,
        });
        return;
      }

      const cfg = this.rt.store.getHikvision(configId);
      if (!cfg) {
        res.status(404).json({ error: 'Hikvision device not found' });
        return;
      }

      const result = await this.rt.hikvision.ptzControl(cfg, channelId, pan, tilt, zoom);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- UniFi ----

  @Get('/unifi')
  listUnifi(@Res() res: express.Response): void {
    res.json(this.rt.store.listUnifiPublic());
  }

  @Post('/unifi')
  saveUnifi(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const body = req.body ?? {};
      if (!body.name || !body.host) {
        res.status(400).json({ error: 'Name and host are required' });
        return;
      }
      const saved = this.rt.store.upsertUnifi({
        id: body.id ? String(body.id) : undefined,
        name: String(body.name),
        host: String(body.host),
        port: body.port ? Number(body.port) : 443,
        controllerType:
          body.controllerType === 'unifi-os' || body.controllerType === 'classic' || body.controllerType === 'standalone'
            ? body.controllerType
            : 'auto',
        site: body.site ? String(body.site) : 'default',
        username: body.username !== undefined ? String(body.username) : 'admin',
        password: body.password !== undefined ? String(body.password) : undefined,
        apiKey: body.apiKey !== undefined ? String(body.apiKey) : undefined,
        allowInsecureTls: body.allowInsecureTls !== false,
        enabled: body.enabled !== false,
      });
      void this.rt.telemetry.pollUnifiById(saved.id);
      res.status(body.id ? 200 : 201).json(this.rt.store.toPublicUnifi(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/unifi/test')
  async testUnifi(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const existing = body.id ? this.rt.store.getUnifi(String(body.id)) : undefined;
      const result = await this.rt.unifi.testConnection({
        id: existing?.id ?? 'test',
        name: String(body.name || 'UniFi'),
        host: String(body.host || existing?.host || ''),
        port: Number(body.port || existing?.port || 443),
        controllerType:
          body.controllerType === 'unifi-os' || body.controllerType === 'classic' || body.controllerType === 'standalone'
            ? body.controllerType
            : existing?.controllerType || 'auto',
        site: String(body.site || existing?.site || 'default'),
        username: body.username !== undefined ? String(body.username) : existing?.username || 'admin',
        password: body.password ? String(body.password) : existing?.password,
        apiKey: body.apiKey ? String(body.apiKey) : existing?.apiKey,
        allowInsecureTls: body.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/unifi/:id')
  deleteUnifi(@Req() req: express.Request, @Res() res: express.Response): void {
    const id = String(req.params.id);
    const deleted = this.rt.store.deleteUnifi(id);
    if (deleted) this.rt.telemetry.removeUnifiState(id);
    res.json({ deleted });
  }

  @Post('/unifi/:id/devices/:mac/action')
  async unifiDeviceAction(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const cfg = this.rt.store.getUnifi(String(req.params.id));
      if (!cfg) {
        res.status(404).json({ ok: false, message: 'UniFi controller not found' });
        return;
      }
      const action = req.body?.action;
      if (!['restart', 'locate', 'unlocate', 'poe-cycle'].includes(action)) {
        res.status(400).json({ ok: false, message: 'Invalid UniFi device action' });
        return;
      }
      const result = await this.rt.unifi.deviceAction(
        cfg,
        String(req.params.mac),
        action,
        req.body?.portIdx ? Number(req.body.portIdx) : undefined,
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/unifi/:id/clients/:mac/reconnect')
  async unifiReconnectClient(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const cfg = this.rt.store.getUnifi(String(req.params.id));
      if (!cfg) {
        res.status(404).json({ ok: false, message: 'UniFi controller not found' });
        return;
      }
      const result = await this.rt.unifi.reconnectClient(cfg, String(req.params.mac));
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ---- UPS / Power Units ----

  @Get('/ups')
  listUps(@Res() res: express.Response): void {
    res.json(this.rt.store.listUpsPublic());
  }

  @Post('/ups')
  upsertUps(@Req() req: express.Request, @Res() res: express.Response): void {
    try {
      const body = req.body ?? {};
      const protocol =
        body.protocol === 'nut'
          ? 'nut'
          : body.protocol === 'powerwall'
            ? 'powerwall'
            : body.protocol === 'powerwall-cloud'
              ? 'powerwall-cloud'
              : 'snmp';
      const defaultHost = protocol === 'powerwall-cloud' ? 'fleet-api.prd.eu.vn.cloud.tesla.com' : '';
      const defaultPort = protocol === 'nut' ? 3493 : protocol === 'powerwall' || protocol === 'powerwall-cloud' ? 443 : 161;
      const saved = this.rt.store.upsertUps({
        id: body.id ? String(body.id) : undefined,
        name: String(body.name || 'IBM 3000VA/2700W Rack HV UPS'),
        host: String(body.host || defaultHost),
        protocol,
        port: Number(body.port) || defaultPort,
        community: body.community !== undefined ? String(body.community) : undefined,
        password: body.password !== undefined ? String(body.password) : undefined,
        snmpVersion: body.snmpVersion === '1' ? '1' : '2c',
        upsName: body.upsName !== undefined ? String(body.upsName) : undefined,
        modelPreset: body.modelPreset ? String(body.modelPreset) as any : 'ibm-3000va-2700w-hv',
        ratedVa: Number(body.ratedVa) || 3000,
        ratedWatts: Number(body.ratedWatts) || 2700,
        heightU: Number(body.heightU) || 2,
        enabled: body.enabled !== false,
      });
      void this.rt.telemetry.pollUpsById(saved.id);
      res.status(body.id ? 200 : 201).json(this.rt.store.toPublicUps(saved));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Post('/ups/test')
  async testUps(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const body = req.body ?? {};
      const existing = body.id ? this.rt.store.getUps(String(body.id)) : undefined;
      const protocol =
        body.protocol === 'nut'
          ? 'nut'
          : body.protocol === 'powerwall'
            ? 'powerwall'
            : body.protocol === 'powerwall-cloud'
              ? 'powerwall-cloud'
              : existing?.protocol || 'snmp';
      const defaultPort = protocol === 'nut' ? 3493 : protocol === 'powerwall' || protocol === 'powerwall-cloud' ? 443 : 161;
      const result = await this.rt.ups.testConnection({
        id: existing?.id ?? 'test',
        name: String(body.name || 'UPS'),
        host: String(body.host || existing?.host || (protocol === 'powerwall-cloud' ? 'fleet-api.prd.eu.vn.cloud.tesla.com' : '')),
        protocol,
        port: Number(body.port || existing?.port || defaultPort),
        community: body.community ? String(body.community) : existing?.community || 'public',
        password: body.password ? String(body.password) : existing?.password,
        snmpVersion: body.snmpVersion === '1' ? '1' : existing?.snmpVersion || '2c',
        upsName: body.upsName !== undefined ? String(body.upsName) : existing?.upsName,
        modelPreset: (body.modelPreset || existing?.modelPreset || 'ibm-3000va-2700w-hv') as any,
        ratedVa: Number(body.ratedVa || existing?.ratedVa || 3000),
        ratedWatts: Number(body.ratedWatts || existing?.ratedWatts || 2700),
        heightU: Number(body.heightU || existing?.heightU || 2),
        enabled: true,
        createdAt: new Date().toISOString(),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  @Delete('/ups/:id')
  deleteUps(@Req() req: express.Request, @Res() res: express.Response): void {
    const id = String(req.params.id);
    const deleted = this.rt.store.deleteUps(id);
    if (deleted) this.rt.telemetry.removeUpsState(id);
    res.json({ deleted });
  }

  @Post('/ups/tesla-auth/start')
  startTeslaAuth(@Req() req: express.Request, @Res() res: express.Response): void {
    const saved = this.rt.store.getTeslaPartnerSecrets();
    const clientId = req.body?.clientId ? String(req.body.clientId) : saved.clientId;
    const redirectUri = req.body?.redirectUri ? String(req.body.redirectUri) : saved.redirectUri;
    if (!clientId) {
      res.status(400).json({ error: 'Tesla Client ID is not configured. Add it in Settings first.' });
      return;
    }
    res.json(this.rt.ups.startTeslaOAuthPkce(clientId, redirectUri));
  }

  @Post('/ups/tesla-auth/exchange')
  async exchangeTeslaAuth(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const callbackUrl = String(req.body?.callbackUrl || '');
      const state = req.body?.state ? String(req.body.state) : undefined;
      const tokens = await this.rt.ups.exchangeTeslaOAuthCallback(callbackUrl, state);
      res.json({ ok: true, ...tokens });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  @Get('/ups/tesla-auth/public-key')
  getTeslaPublicKey(@Res() res: express.Response): void {
    res.json({ publicKeyPem: getOrCreateTeslaPartnerPublicKeyPem() });
  }

  @Post('/ups/tesla-auth/register-partner')
  async registerTeslaPartner(@Req() req: express.Request, @Res() res: express.Response): Promise<void> {
    try {
      const saved = this.rt.store.getTeslaPartnerSecrets();
      const result = await this.rt.ups.registerTeslaPartnerAccount({
        clientId: String(req.body?.clientId || saved.clientId || ''),
        clientSecret: String(req.body?.clientSecret || saved.clientSecret || ''),
        domain: String(req.body?.domain || saved.domain || ''),
        regionHost: req.body?.regionHost ? String(req.body.regionHost) : undefined,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
