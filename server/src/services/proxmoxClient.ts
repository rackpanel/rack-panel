import https from 'node:https';
import type {
  ConnectionTestResult,
  GuestPowerAction,
  ProxmoxClusterSnapshot,
  ProxmoxConfig,
  ProxmoxGuest,
  ProxmoxNodeMetrics,
  ProxmoxStorage,
  ProxmoxTask,
  SshServerMetrics,
  TelemetryPoint,
} from '../../../shared/types.js';

interface TicketCache {
  ticket: string;
  csrfToken: string;
  expiresAt: number;
}

export class ProxmoxClient {
  private tickets = new Map<string, TicketCache>();
  private nodeHistory = new Map<string, TelemetryPoint[]>();
  private nodePveVersion = new Map<string, string>();

  clearSession(configId: string): void {
    this.tickets.delete(configId);
  }

  private request<T>(
    cfg: ProxmoxConfig,
    method: 'GET' | 'POST',
    apiPath: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const agent = new https.Agent({
        rejectUnauthorized: !cfg.allowInsecureTls,
      });

      const reqHeaders: Record<string, string> = {
        Accept: 'application/json',
        ...headers,
      };
      if (body !== undefined) {
        reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
        reqHeaders['Content-Length'] = String(Buffer.byteLength(body));
      }

      const req = https.request(
        {
          hostname: cfg.host,
          port: cfg.port || 8006,
          path: `/api2/json${apiPath}`,
          method,
          headers: reqHeaders,
          agent,
          timeout: 8000,
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk: Buffer) => {
            raw += chunk.toString('utf8');
          });
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) {
              reject(new Error(`Proxmox HTTP ${status}: ${raw.slice(0, 180) || res.statusMessage}`));
              return;
            }
            try {
              const parsed = JSON.parse(raw) as { data: T };
              resolve(parsed.data);
            } catch {
              reject(new Error('Invalid JSON response from Proxmox API'));
            }
          });
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error(`Proxmox API timed out (${cfg.host}:${cfg.port})`));
      });
      req.on('error', (err) => reject(err));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  private async getAuthHeaders(cfg: ProxmoxConfig, needsCsrf = false): Promise<Record<string, string>> {
    if (cfg.authType === 'token') {
      if (!cfg.tokenId || !cfg.tokenSecret) {
        throw new Error('Proxmox API Token ID and Secret are required');
      }
      return {
        Authorization: `PVEAPIToken=${cfg.tokenId}=${cfg.tokenSecret}`,
      };
    }

    const cached = this.tickets.get(cfg.id);
    if (cached && cached.expiresAt > Date.now()) {
      return needsCsrf
        ? { Cookie: `PVEAuthCookie=${cached.ticket}`, CSRFPreventionToken: cached.csrfToken }
        : { Cookie: `PVEAuthCookie=${cached.ticket}` };
    }

    if (!cfg.username || !cfg.password) {
      throw new Error('Proxmox username and password are required');
    }

    const form = new URLSearchParams({
      username: cfg.username,
      password: cfg.password,
    }).toString();

    const data = await this.request<{ ticket: string; CSRFPreventionToken: string }>(
      cfg,
      'POST',
      '/access/ticket',
      {},
      form,
    );

    const entry: TicketCache = {
      ticket: data.ticket,
      csrfToken: data.CSRFPreventionToken,
      expiresAt: Date.now() + 90 * 60 * 1000,
    };
    this.tickets.set(cfg.id, entry);

    return needsCsrf
      ? { Cookie: `PVEAuthCookie=${entry.ticket}`, CSRFPreventionToken: entry.csrfToken }
      : { Cookie: `PVEAuthCookie=${entry.ticket}` };
  }

  private async apiGet<T>(cfg: ProxmoxConfig, apiPath: string): Promise<T> {
    const headers = await this.getAuthHeaders(cfg, false);
    return this.request<T>(cfg, 'GET', apiPath, headers);
  }

  private async apiPost<T>(cfg: ProxmoxConfig, apiPath: string, body = ''): Promise<T> {
    const headers = await this.getAuthHeaders(cfg, true);
    return this.request<T>(cfg, 'POST', apiPath, headers, body);
  }

  async testConnection(cfg: ProxmoxConfig): Promise<ConnectionTestResult> {
    try {
      this.tickets.delete(cfg.id);
      const version = await this.apiGet<{ version: string; release: string }>(cfg, '/version');
      const nodes = await this.apiGet<Array<{ node: string; status: string }>>(cfg, '/nodes');
      return {
        ok: true,
        message: `Connected to Proxmox VE ${version.version} (${nodes.length} node${nodes.length === 1 ? '' : 's'})`,
        details: {
          version: version.version,
          release: version.release,
          nodes: nodes.length,
        },
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async executeGuestAction(
    cfg: ProxmoxConfig,
    node: string,
    type: 'qemu' | 'lxc',
    vmid: number,
    action: GuestPowerAction,
  ): Promise<{ upid: string }> {
    const upid = await this.apiPost<string>(
      cfg,
      `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/status/${action}`,
      '',
    );
    return { upid: String(upid ?? '') };
  }

  async createTermProxy(
    cfg: ProxmoxConfig,
    node: string,
    guest?: { type: 'qemu' | 'lxc'; vmid: number },
  ): Promise<{
    wsUrl: string;
    authUser: string;
    ticket: string;
    headers: Record<string, string>;
    rejectUnauthorized: boolean;
  }> {
    const basePath = guest
      ? `/nodes/${encodeURIComponent(node)}/${guest.type}/${guest.vmid}`
      : `/nodes/${encodeURIComponent(node)}`;

    const proxy = await this.apiPost<{ port: number | string; ticket: string; user: string }>(
      cfg,
      `${basePath}/termproxy`,
      '',
    );
    if (!proxy || !proxy.port || !proxy.ticket) {
      throw new Error('Proxmox termproxy did not return a terminal ticket/port');
    }

    const headers = await this.getAuthHeaders(cfg, false);
    const qs = `port=${encodeURIComponent(String(proxy.port))}&vncticket=${encodeURIComponent(proxy.ticket)}`;
    const wsUrl = `wss://${cfg.host}:${cfg.port || 8006}/api2/json${basePath}/vncwebsocket?${qs}`;

    return {
      wsUrl,
      authUser: String(proxy.user || cfg.username || 'root@pam'),
      ticket: String(proxy.ticket),
      headers,
      rejectUnauthorized: !cfg.allowInsecureTls,
    };
  }

  async createVncProxy(
    cfg: ProxmoxConfig,
    node: string,
    type: 'qemu' | 'lxc',
    vmid: number,
  ): Promise<{
    wsUrl: string;
    ticket: string;
    headers: Record<string, string>;
    rejectUnauthorized: boolean;
  }> {
    const basePath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}`;
    const proxy = await this.apiPost<{ port: number | string; ticket: string }>(
      cfg,
      `${basePath}/vncproxy`,
      'websocket=1',
    );
    if (!proxy || !proxy.port || !proxy.ticket) {
      throw new Error('Proxmox vncproxy did not return a VNC port/ticket');
    }

    const headers = await this.getAuthHeaders(cfg, false);
    const qs = `port=${encodeURIComponent(String(proxy.port))}&vncticket=${encodeURIComponent(proxy.ticket)}`;
    const wsUrl = `wss://${cfg.host}:${cfg.port || 8006}/api2/json${basePath}/vncwebsocket?${qs}`;

    return {
      wsUrl,
      ticket: String(proxy.ticket),
      headers,
      rejectUnauthorized: !cfg.allowInsecureTls,
    };
  }

  async collectCluster(
    cfg: ProxmoxConfig,
    resolveSharedSshMetrics?: (nodeName: string, nodeIp?: string) => SshServerMetrics | undefined,
  ): Promise<ProxmoxClusterSnapshot> {
    const now = Date.now();
    try {
      const [clusterStatusRes, rawNodes] = await Promise.all([
        this.apiGet<Array<{ type: string; name: string; quorate?: number; ip?: string; local?: number }>>(
          cfg,
          '/cluster/status',
        ).catch(() => []),
        this.apiGet<
          Array<{
            node: string;
            status: string;
            cpu?: number;
            maxcpu?: number;
            mem?: number;
            maxmem?: number;
            disk?: number;
            maxdisk?: number;
            uptime?: number;
          }>
        >(cfg, '/nodes'),
      ]);

      const clusterEntry = clusterStatusRes.find((c) => c.type === 'cluster');
      const clusterName = clusterEntry?.name || cfg.name;
      const quorate = clusterEntry ? Boolean(clusterEntry.quorate) : true;

      const nodeIpByName = new Map<string, string>();
      for (const entry of clusterStatusRes) {
        if (entry.type === 'node' && entry.name && entry.ip) {
          nodeIpByName.set(entry.name, String(entry.ip));
        }
      }

      const nodes: ProxmoxNodeMetrics[] = [];
      const guests: ProxmoxGuest[] = [];
      const storage: ProxmoxStorage[] = [];
      const tasks: ProxmoxTask[] = [];

      await Promise.all(
        rawNodes.map(async (rawNode) => {
          const nodeName = rawNode.node;
          const nodeIp = nodeIpByName.get(nodeName) || (rawNodes.length === 1 ? cfg.host : undefined);
          const isOnline = rawNode.status === 'online';
          const historyKey = `${cfg.id}:${nodeName}`;
          const prevHist = this.nodeHistory.get(historyKey) ?? [];

          if (!isOnline) {
            nodes.push({
              node: nodeName,
              status: 'offline',
              ipAddress: nodeIp,
              cpuPercent: 0,
              maxCpu: rawNode.maxcpu ?? 0,
              cpuModel: '-',
              memUsedBytes: 0,
              memTotalBytes: rawNode.maxmem ?? 0,
              memPercent: 0,
              swapUsedBytes: 0,
              swapTotalBytes: 0,
              rootfsUsedBytes: 0,
              rootfsTotalBytes: rawNode.maxdisk ?? 0,
              rootfsPercent: 0,
              loadAvg: [0, 0, 0],
              uptimeSeconds: 0,
              pveVersion: this.nodePveVersion.get(historyKey) ?? '-',
              kernelVersion: '-',
              history: prevHist,
            });
            return;
          }

          // If an online SSH collector already polled this exact physical machine, reuse its OS host
          // telemetry and skip the redundant /nodes/:node/status call once pveVersion is cached.
          const sharedSsh = resolveSharedSshMetrics ? resolveSharedSshMetrics(nodeName, nodeIp) : undefined;
          const cachedPveVer = this.nodePveVersion.get(historyKey);
          const canSkipStatusCall = Boolean(sharedSsh && sharedSsh.status === 'online' && cachedPveVer);

          const [statusRes, qemuRes, lxcRes, storageRes, tasksRes] = await Promise.all([
            canSkipStatusCall
              ? Promise.resolve({} as Record<string, any>)
              : this.apiGet<Record<string, any>>(cfg, `/nodes/${encodeURIComponent(nodeName)}/status`).catch(
                  () => ({}) as Record<string, any>,
                ),
            this.apiGet<Array<Record<string, any>>>(cfg, `/nodes/${encodeURIComponent(nodeName)}/qemu`).catch(
              () => [],
            ),
            this.apiGet<Array<Record<string, any>>>(cfg, `/nodes/${encodeURIComponent(nodeName)}/lxc`).catch(
              () => [],
            ),
            this.apiGet<Array<Record<string, any>>>(
              cfg,
              `/nodes/${encodeURIComponent(nodeName)}/storage`,
            ).catch(() => []),
            this.apiGet<Array<Record<string, any>>>(
              cfg,
              `/nodes/${encodeURIComponent(nodeName)}/tasks?limit=15`,
            ).catch(() => []),
          ]);

          if (statusRes.pveversion) {
            const parsedVer =
              String(statusRes.pveversion).split('/')[1] || String(statusRes.pveversion);
            this.nodePveVersion.set(historyKey, parsedVer);
          }

          let cpuPercent: number;
          let maxCpu: number;
          let cpuModel: string;
          let memUsedBytes: number;
          let memTotalBytes: number;
          let memPercent: number;
          let swapUsedBytes: number;
          let swapTotalBytes: number;
          let rootfsUsedBytes: number;
          let rootfsTotalBytes: number;
          let rootfsPercent: number;
          let loadAvg: [number, number, number];
          let uptimeSeconds: number;
          let kernelVersion: string;
          let deduplicatedFrom: string | undefined;

          if (canSkipStatusCall && sharedSsh) {
            const rootDisk = sharedSsh.disks.find((d) => d.mount === '/') || sharedSsh.disks[0];
            cpuPercent = sharedSsh.cpuPercent;
            maxCpu = sharedSsh.cpuCores || Number(rawNode.maxcpu ?? 1);
            cpuModel = sharedSsh.cpuModel || 'Proxmox Host CPU';
            memUsedBytes = sharedSsh.memUsedBytes;
            memTotalBytes = sharedSsh.memTotalBytes || Number(rawNode.maxmem ?? 0);
            memPercent = sharedSsh.memPercent;
            swapUsedBytes = sharedSsh.swapUsedBytes;
            swapTotalBytes = sharedSsh.swapTotalBytes;
            rootfsUsedBytes = rootDisk ? rootDisk.usedBytes : Number(rawNode.disk ?? 0);
            rootfsTotalBytes = rootDisk ? rootDisk.totalBytes : Number(rawNode.maxdisk ?? 0);
            rootfsPercent = rootDisk
              ? rootDisk.usedPercent
              : rootfsTotalBytes > 0
                ? Math.round((rootfsUsedBytes / rootfsTotalBytes) * 1000) / 10
                : 0;
            loadAvg = [...sharedSsh.loadAvg] as [number, number, number];
            uptimeSeconds = sharedSsh.uptimeSeconds || Number(rawNode.uptime ?? 0);
            kernelVersion = sharedSsh.kernel || '-';
            deduplicatedFrom = `SSH (${sharedSsh.hostname})`;
          } else {
            cpuPercent = Math.round(((statusRes.cpu ?? rawNode.cpu ?? 0) as number) * 1000) / 10;
            maxCpu = Number(statusRes.cpuinfo?.cpus ?? rawNode.maxcpu ?? 1);
            cpuModel = String(statusRes.cpuinfo?.model ?? 'Proxmox Host CPU');
            memUsedBytes = Number(statusRes.memory?.used ?? rawNode.mem ?? 0);
            memTotalBytes = Number(statusRes.memory?.total ?? rawNode.maxmem ?? 0);
            memPercent = memTotalBytes > 0 ? Math.round((memUsedBytes / memTotalBytes) * 1000) / 10 : 0;
            swapUsedBytes = Number(statusRes.swap?.used ?? 0);
            swapTotalBytes = Number(statusRes.swap?.total ?? 0);
            rootfsUsedBytes = Number(statusRes.rootfs?.used ?? rawNode.disk ?? 0);
            rootfsTotalBytes = Number(statusRes.rootfs?.total ?? rawNode.maxdisk ?? 0);
            rootfsPercent =
              rootfsTotalBytes > 0 ? Math.round((rootfsUsedBytes / rootfsTotalBytes) * 1000) / 10 : 0;

            const loadRaw = Array.isArray(statusRes.loadavg) ? statusRes.loadavg : [0, 0, 0];
            loadAvg = [
              parseFloat(String(loadRaw[0])) || 0,
              parseFloat(String(loadRaw[1])) || 0,
              parseFloat(String(loadRaw[2])) || 0,
            ];
            uptimeSeconds = Number(statusRes.uptime ?? rawNode.uptime ?? 0);
            kernelVersion = String(statusRes.kversion ?? '-').replace(/^Linux\s+/, '').split(' ')[0] || '-';
          }

          const point: TelemetryPoint = {
            timestamp: now,
            cpuPercent,
            memPercent,
            netRxBps: sharedSsh ? sharedSsh.netTotalRxBps : 0,
            netTxBps: sharedSsh ? sharedSsh.netTotalTxBps : 0,
          };
          const nextHist = [...prevHist.slice(-49), point];
          this.nodeHistory.set(historyKey, nextHist);

          nodes.push({
            node: nodeName,
            status: 'online',
            ipAddress: nodeIp,
            deduplicatedFrom,
            cpuPercent,
            maxCpu,
            cpuModel,
            memUsedBytes,
            memTotalBytes,
            memPercent,
            swapUsedBytes,
            swapTotalBytes,
            rootfsUsedBytes,
            rootfsTotalBytes,
            rootfsPercent,
            loadAvg,
            uptimeSeconds,
            pveVersion: this.nodePveVersion.get(historyKey) || String(statusRes.pveversion ?? 'PVE'),
            kernelVersion,
            history: nextHist,
          });

          const mapGuest = (g: Record<string, any>, type: 'qemu' | 'lxc'): ProxmoxGuest => {
            const memUsed = Number(g.mem ?? 0);
            const memMax = Number(g.maxmem ?? 0);
            return {
              vmid: Number(g.vmid),
              name: String(g.name || `${type}-${g.vmid}`),
              node: nodeName,
              type,
              status:
                g.status === 'running' || g.status === 'stopped' || g.status === 'paused'
                  ? g.status
                  : 'unknown',
              cpuPercent: Math.round(Number(g.cpu ?? 0) * 1000) / 10,
              cpus: Number(g.cpus ?? 1),
              memUsedBytes: memUsed,
              memMaxBytes: memMax,
              memPercent: memMax > 0 ? Math.round((memUsed / memMax) * 1000) / 10 : 0,
              diskUsedBytes: Number(g.disk ?? 0),
              diskMaxBytes: Number(g.maxdisk ?? 0),
              netInBytes: Number(g.netin ?? 0),
              netOutBytes: Number(g.netout ?? 0),
              uptimeSeconds: Number(g.uptime ?? 0),
              tags: g.tags ? String(g.tags).split(';').filter(Boolean) : [],
              template: Boolean(g.template),
            };
          };

          for (const q of qemuRes) guests.push(mapGuest(q, 'qemu'));
          for (const l of lxcRes) guests.push(mapGuest(l, 'lxc'));

          for (const s of storageRes) {
            const totalBytes = Number(s.total ?? 0);
            const usedBytes = Number(s.used ?? 0);
            const availBytes = Number(s.avail ?? Math.max(0, totalBytes - usedBytes));
            storage.push({
              storage: String(s.storage),
              node: nodeName,
              type: String(s.type ?? 'dir'),
              content: String(s.content ?? ''),
              active: Boolean(s.active),
              enabled: s.enabled !== 0,
              shared: Boolean(s.shared),
              usedBytes,
              availBytes,
              totalBytes,
              usedPercent: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0,
            });
          }

          for (const t of tasksRes) {
            tasks.push({
              upid: String(t.upid ?? ''),
              node: nodeName,
              type: String(t.type ?? 'task'),
              id: String(t.id ?? ''),
              user: String(t.user ?? ''),
              status: String(t.status ?? 'running'),
              startTime: Number(t.starttime ?? 0) * 1000,
              endTime: t.endtime ? Number(t.endtime) * 1000 : undefined,
            });
          }
        }),
      );

      nodes.sort((a, b) => a.node.localeCompare(b.node));
      guests.sort((a, b) => a.vmid - b.vmid);
      tasks.sort((a, b) => b.startTime - a.startTime);

      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        status: 'online',
        collectedAt: now,
        clusterName,
        quorate,
        nodes,
        guests,
        storage,
        tasks: tasks.slice(0, 20),
      };
    } catch (err) {
      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        collectedAt: now,
        clusterName: cfg.name,
        quorate: false,
        nodes: [],
        guests: [],
        storage: [],
        tasks: [],
      };
    }
  }
}
