import { execFile } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { promisify } from 'node:util';
import { Client as SshClient } from 'ssh2';
import { snmpGet, snmpValToString } from './snmpClient.js';
import type {
  ConnectionTestResult,
  TelemetryPoint,
  UnifiClientInfo,
  UnifiConfig,
  UnifiControllerType,
  UnifiDevice,
  UnifiDevicePort,
  UnifiDeviceRadio,
  UnifiSnapshot,
  UnifiWlanInfo,
} from '../../../shared/types.js';

interface UnifiSession {
  cookie: string;
  csrfToken: string;
  prefix: '/proxy/network' | '';
  port: number;
  resolvedType: 'unifi-os' | 'classic';
}

interface HttpRawResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const execFileAsync = promisify(execFile);

function probeTcp(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.connect(port, host);
  });
}

async function pingHost(host: string): Promise<boolean> {
  try {
    await execFileAsync('ping', ['-c', '1', '-W', '1000', host], { timeout: 2200 });
    return true;
  } catch {
    try {
      await execFileAsync('ping', ['-c', '1', '-W', '1', host], { timeout: 2200 });
      return true;
    } catch {
      return false;
    }
  }
}

function runUnifiSshCommand(
  host: string,
  port: number,
  username: string,
  password: string,
  command: string,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.end();
      reject(new Error(`SSH timed out (${host}:${port})`));
    }, timeoutMs);

    client.on('ready', () => {
      client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            client.end();
            reject(err);
          }
          return;
        }
        let out = '';
        stream.on('data', (d: Buffer) => {
          out += d.toString('utf8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          out += d.toString('utf8');
        });
        stream.on('close', () => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            client.end();
            resolve(out);
          }
        });
      });
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    client.connect({
      host,
      port,
      username,
      password,
      readyTimeout: timeoutMs,
      tryKeyboard: true,
    });
  });
}

function inferStandaloneDeviceType(hint: string): UnifiDevice['type'] {
  const s = hint.toLowerCase();
  if (/udm|ucg|dream|cloud gateway/.test(s)) return 'udm';
  if (/uxg/.test(s)) return 'uxg';
  if (/usg|gateway|router/.test(s)) return 'ugw';
  if (/usw|us-|switch|edgeswitch/.test(s)) return 'usw';
  if (/uap|u6|u7|ac-|nanohd|flexhd|mesh|iw-hd|ap\b/.test(s)) return 'uap';
  return 'uap';
}

export class UnifiClient {
  private historyMap = new Map<string, TelemetryPoint[]>();
  private sessionCache = new Map<string, UnifiSession>();

  private requestRaw(
    host: string,
    port: number,
    method: string,
    reqPath: string,
    headers: Record<string, string>,
    body?: string,
    allowInsecureTls = true,
    timeoutMs = 6000,
  ): Promise<HttpRawResponse> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: host,
          port,
          path: reqPath,
          method,
          timeout: timeoutMs,
          rejectUnauthorized: !allowInsecureTls,
          headers: {
            Accept: 'application/json',
            ...headers,
            ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString('utf8');
          });
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 0,
              headers: res.headers,
              body: data,
            });
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`UniFi request timed out (${host}:${port}${reqPath})`));
      });
      req.on('error', (err) => reject(err));
      if (body) req.write(body);
      req.end();
    });
  }

  private extractCookies(setCookieHeader: string | string[] | undefined): string {
    if (!setCookieHeader) return '';
    const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    return arr
      .map((c) => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }

  private async authenticate(cfg: UnifiConfig, forceRefresh = false): Promise<UnifiSession> {
    if (!forceRefresh) {
      const cached = this.sessionCache.get(cfg.id);
      if (cached) return cached;
    }

    // If API Key is provided, UniFi OS / Network 8.x+ accepts X-API-KEY directly without cookie login
    if (cfg.apiKey && cfg.apiKey.trim()) {
      const port = cfg.port || (cfg.controllerType === 'classic' ? 8443 : 443);
      const isClassic = cfg.controllerType === 'classic';
      const sess: UnifiSession = {
        cookie: '',
        csrfToken: '',
        prefix: isClassic ? '' : '/proxy/network',
        port,
        resolvedType: isClassic ? 'classic' : 'unifi-os',
      };
      this.sessionCache.set(cfg.id, sess);
      return sess;
    }

    const payload = JSON.stringify({
      username: cfg.username || 'admin',
      password: cfg.password || '',
      remember: true,
    });

    const attempts: Array<{ port: number; path: string; prefix: '/proxy/network' | ''; resolvedType: 'unifi-os' | 'classic' }> = [];
    if (cfg.controllerType === 'unifi-os') {
      attempts.push({ port: cfg.port || 443, path: '/api/auth/login', prefix: '/proxy/network', resolvedType: 'unifi-os' });
    } else if (cfg.controllerType === 'classic') {
      attempts.push({ port: cfg.port || 8443, path: '/api/login', prefix: '', resolvedType: 'classic' });
    } else {
      attempts.push({ port: cfg.port || 443, path: '/api/auth/login', prefix: '/proxy/network', resolvedType: 'unifi-os' });
      attempts.push({ port: cfg.port && cfg.port !== 443 ? cfg.port : 8443, path: '/api/login', prefix: '', resolvedType: 'classic' });
    }

    let lastErr = 'Authentication failed';
    for (const att of attempts) {
      try {
        const res = await this.requestRaw(
          cfg.host,
          att.port,
          'POST',
          att.path,
          { 'Content-Type': 'application/json' },
          payload,
          cfg.allowInsecureTls,
        );
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cookie = this.extractCookies(res.headers['set-cookie']);
          const csrf = String(res.headers['x-csrf-token'] || '');
          const sess: UnifiSession = {
            cookie,
            csrfToken: csrf,
            prefix: att.prefix,
            port: att.port,
            resolvedType: att.resolvedType,
          };
          this.sessionCache.set(cfg.id, sess);
          return sess;
        }
        lastErr = `HTTP ${res.statusCode}: ${res.body.slice(0, 140)}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }

    throw new Error(`UniFi login failed: ${lastErr}`);
  }

  private async apiRequest<T = any>(
    cfg: UnifiConfig,
    method: 'GET' | 'POST',
    endpoint: string,
    bodyObj?: unknown,
    retryAuth = true,
  ): Promise<{ data: T; session: UnifiSession }> {
    const sess = await this.authenticate(cfg);
    const headers: Record<string, string> = {};
    if (cfg.apiKey && cfg.apiKey.trim()) {
      headers['X-API-KEY'] = cfg.apiKey.trim();
    }
    if (sess.cookie) headers.Cookie = sess.cookie;
    if (sess.csrfToken) headers['X-CSRF-Token'] = sess.csrfToken;
    if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';

    const fullPath = `${sess.prefix}${endpoint}`;
    const res = await this.requestRaw(
      cfg.host,
      sess.port,
      method,
      fullPath,
      headers,
      bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined,
      cfg.allowInsecureTls,
    );

    if ((res.statusCode === 401 || res.statusCode === 403) && retryAuth && !cfg.apiKey) {
      this.sessionCache.delete(cfg.id);
      return this.apiRequest<T>(cfg, method, endpoint, bodyObj, false);
    }

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`UniFi API ${res.statusCode} on ${fullPath}`);
    }

    const parsed = JSON.parse(res.body) as { data?: T; meta?: { rc?: string; msg?: string } };
    return { data: (parsed.data ?? (parsed as unknown as T)) as T, session: sess };
  }

  async testConnection(cfg: UnifiConfig): Promise<ConnectionTestResult> {
    if (cfg.controllerType === 'standalone') {
      try {
        const community = cfg.apiKey?.trim() || 'public';
        const snmpDescr = await snmpGet(cfg.host, community, '1.3.6.1.2.1.1.1.0', 161).catch(() => null);
        const descrText = snmpDescr ? snmpValToString(snmpDescr.value) : '';

        if (cfg.username && cfg.password) {
          const sshPort = cfg.port && cfg.port !== 443 && cfg.port !== 8443 ? cfg.port : 22;
          const out = await runUnifiSshCommand(cfg.host, sshPort, cfg.username, cfg.password, 'mca-cli-op info || uname -a');
          const modelMatch = out.match(/Model:\s*([^\r\n]+)/i);
          const verMatch = out.match(/Version:\s*([^\r\n]+)/i);
          return {
            ok: true,
            message: `Standalone UniFi reachable via SSH${modelMatch ? ` (${modelMatch[1].trim()})` : ''}${verMatch ? ` · v${verMatch[1].trim()}` : ''}`,
          };
        }

        const [p22, p443, p80] = await Promise.all([
          probeTcp(cfg.host, 22, 1200),
          probeTcp(cfg.host, 443, 1200),
          probeTcp(cfg.host, 80, 1200),
        ]);
        const pingOk = p22 || p443 || p80 || Boolean(descrText) || (await pingHost(cfg.host));
        if (!pingOk) {
          return { ok: false, message: `Standalone UniFi device ${cfg.host} is unreachable` };
        }
        return {
          ok: true,
          message: descrText
            ? `Standalone UniFi reachable via SNMP (${descrText.slice(0, 60)})`
            : `Standalone UniFi device ${cfg.host} is online`,
        };
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    try {
      const site = encodeURIComponent(cfg.site || 'default');
      const { data: devs, session } = await this.apiRequest<any[]>(cfg, 'GET', `/api/s/${site}/stat/device`);
      const count = Array.isArray(devs) ? devs.length : 0;
      return {
        ok: true,
        message: `Connected to UniFi (${session.resolvedType === 'unifi-os' ? 'UniFi OS' : 'Classic'} on :${session.port}) · ${count} adopted device(s)`,
        details: {
          controllerType: session.resolvedType,
          port: session.port,
          devices: count,
        },
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async collectStandalone(cfg: UnifiConfig): Promise<UnifiSnapshot> {
    const now = Date.now();
    const community = cfg.apiKey?.trim() || 'public';
    let model = 'UniFi Standalone';
    let firmware = '-';
    let mac = '';
    let uptimeSeconds = 0;
    let cpuPercent = 0;
    let memPercent = 0;
    let reachable = false;

    const [snmpDescr, snmpUp] = await Promise.all([
      snmpGet(cfg.host, community, '1.3.6.1.2.1.1.1.0', 161).catch(() => null),
      snmpGet(cfg.host, community, '1.3.6.1.2.1.1.3.0', 161).catch(() => null),
    ]);
    if (snmpDescr) {
      const descr = snmpValToString(snmpDescr.value);
      if (descr) {
        model = descr.slice(0, 48);
        reachable = true;
      }
    }
    if (snmpUp && typeof snmpUp.value === 'number') {
      uptimeSeconds = Math.floor(snmpUp.value / 100);
      reachable = true;
    }

    if (cfg.username && cfg.password) {
      try {
        const sshPort = cfg.port && cfg.port !== 443 && cfg.port !== 8443 ? cfg.port : 22;
        const out = await runUnifiSshCommand(
          cfg.host,
          sshPort,
          cfg.username,
          cfg.password,
          'mca-cli-op info 2>/dev/null; echo "---"; cat /proc/uptime 2>/dev/null; echo "---"; free 2>/dev/null || cat /proc/meminfo 2>/dev/null',
        );
        reachable = true;
        const mMatch = out.match(/Model:\s*([^\r\n]+)/i);
        const vMatch = out.match(/Version:\s*([^\r\n]+)/i);
        const macMatch = out.match(/MAC Address:\s*([0-9a-fA-F:]{17})/i);
        const upMatch = out.match(/Uptime:\s*(\d+)\s*seconds/i);
        if (mMatch) model = mMatch[1].trim();
        if (vMatch) firmware = vMatch[1].trim();
        if (macMatch) mac = macMatch[1].toUpperCase();
        if (upMatch) {
          uptimeSeconds = Number(upMatch[1]) || uptimeSeconds;
        } else {
          const procUp = out.match(/---\r?\n(\d+(?:\.\d+)?)\s+\d+/);
          if (procUp) uptimeSeconds = Math.floor(Number(procUp[1]) || 0);
        }
        const memTotal = out.match(/MemTotal:\s*(\d+)\s*kB/i);
        const memAvail = out.match(/MemAvailable:\s*(\d+)\s*kB/i) || out.match(/MemFree:\s*(\d+)\s*kB/i);
        if (memTotal && memAvail) {
          const tot = Number(memTotal[1]);
          const av = Number(memAvail[1]);
          if (tot > 0) memPercent = Math.round(((tot - av) / tot) * 1000) / 10;
        }
      } catch {
        // fallback to TCP/ping below
      }
    }

    if (!reachable) {
      const [p22, p443, p80] = await Promise.all([
        probeTcp(cfg.host, 22, 1000),
        probeTcp(cfg.host, 443, 1000),
        probeTcp(cfg.host, 80, 1000),
      ]);
      reachable = p22 || p443 || p80 || (await pingHost(cfg.host));
    }

    const devType = inferStandaloneDeviceType(`${cfg.site || ''} ${cfg.name} ${model}`);
    const device: UnifiDevice = {
      id: `${cfg.id}-standalone`,
      mac: mac || `standalone:${cfg.host}`,
      name: cfg.name,
      model,
      modelName: model,
      type: devType,
      ip: cfg.host,
      version: firmware,
      adopted: false,
      state: reachable ? 'online' : 'offline',
      uptimeSeconds,
      cpuPercent,
      memPercent,
      loadAvg1: null,
      numClients: 0,
      numUserClients: 0,
      numGuestClients: 0,
      txBytes: 0,
      rxBytes: 0,
      satisfaction: null,
      poeWatts: 0,
      portCount: 0,
      ports: [],
      radios: [],
    };

    const hist = this.historyMap.get(cfg.id) ?? [];
    hist.push({
      timestamp: now,
      cpuPercent,
      memPercent,
      netRxBps: 0,
      netTxBps: 0,
    });
    if (hist.length > 60) hist.shift();
    this.historyMap.set(cfg.id, hist);

    return {
      configId: cfg.id,
      name: cfg.name,
      host: cfg.host,
      controllerType: 'standalone',
      site: cfg.site || 'standalone',
      status: reachable ? 'online' : 'offline',
      errorMessage: reachable ? undefined : `Standalone UniFi device ${cfg.host} is unreachable`,
      collectedAt: now,
      controllerVersion: firmware,
      totalDevices: 1,
      onlineDevices: reachable ? 1 : 0,
      totalClients: 0,
      wiredClients: 0,
      wirelessClients: 0,
      guestClients: 0,
      wanIp: '',
      ispName: '',
      wanLatencyMs: null,
      wanRxBps: 0,
      wanTxBps: 0,
      devices: [device],
      clients: [],
      wlans: [],
      history: [...hist],
    };
  }

  async collect(cfg: UnifiConfig): Promise<UnifiSnapshot> {
    if (cfg.controllerType === 'standalone') {
      return this.collectStandalone(cfg);
    }
    const site = encodeURIComponent(cfg.site || 'default');
    const now = Date.now();
    try {
      const [devRes, staRes, wlanRes, healthRes] = await Promise.all([
        this.apiRequest<any[]>(cfg, 'GET', `/api/s/${site}/stat/device`),
        this.apiRequest<any[]>(cfg, 'GET', `/api/s/${site}/stat/sta`),
        this.apiRequest<any[]>(cfg, 'GET', `/api/s/${site}/rest/wlanconf`).catch(() => ({ data: [] as any[], session: devResSafe(null) })),
        this.apiRequest<any[]>(cfg, 'GET', `/api/s/${site}/stat/health`).catch(() => ({ data: [] as any[], session: devResSafe(null) })),
      ]);

      const rawDevices = Array.isArray(devRes.data) ? devRes.data : [];
      const rawClients = Array.isArray(staRes.data) ? staRes.data : [];
      const rawWlans = Array.isArray(wlanRes.data) ? wlanRes.data : [];
      const rawHealth = Array.isArray(healthRes.data) ? healthRes.data : [];

      const devices: UnifiDevice[] = rawDevices.map((d) => {
        const sysStats = d['system-stats'] || {};
        const cpuPct = Math.round(parseFloat(String(sysStats.cpu ?? d.cpu ?? 0)) * 10) / 10;
        const memPct = Math.round(parseFloat(String(sysStats.mem ?? d.mem ?? 0)) * 10) / 10;
        const rawPorts = Array.isArray(d.port_table) ? d.port_table : [];
        let poeWatts = 0;
        const ports: UnifiDevicePort[] = rawPorts.map((p: any) => {
          const pw = Math.round((parseFloat(String(p.poe_power || 0)) || 0) * 10) / 10;
          if (p.poe_enable && pw > 0) poeWatts += pw;
          return {
            portIdx: Number(p.port_idx || 0),
            name: String(p.name || `Port ${p.port_idx || 0}`),
            up: Boolean(p.up),
            speedMbps: Number(p.speed || 0),
            fullDuplex: Boolean(p.full_duplex),
            poeEnable: Boolean(p.poe_enable),
            poeWatts: pw,
            media: String(p.media || 'GE'),
          };
        });

        const rawRadios = Array.isArray(d.radio_table_stats) ? d.radio_table_stats : Array.isArray(d.radio_table) ? d.radio_table : [];
        const radios: UnifiDeviceRadio[] = rawRadios.map((r: any) => ({
          name: String(r.name || r.radio || 'wifi'),
          radio: String(r.radio || 'ng'),
          channel: Number(r.channel || 0),
          txPower: Number(r.tx_power || 0),
          satisfaction: r.satisfaction !== undefined && r.satisfaction >= 0 ? Number(r.satisfaction) : null,
          numClients: Number(r.num_sta || 0),
        }));

        const rawType = String(d.type || 'other').toLowerCase();
        const type: UnifiDevice['type'] =
          rawType === 'uap' || rawType === 'usw' || rawType === 'ugw' || rawType === 'udm' || rawType === 'uxg'
            ? rawType
            : 'other';

        const stateCode = Number(d.state ?? 0);
        const state: UnifiDevice['state'] =
          stateCode === 1 ? 'online' : stateCode === 4 ? 'upgrading' : stateCode === 2 ? 'adopting' : 'offline';

        return {
          id: String(d._id || d.mac),
          mac: String(d.mac || '').toUpperCase(),
          name: String(d.name || d.hostname || d.model || d.mac),
          model: String(d.model || ''),
          modelName: String(d.model_in_lts ? d.model : d.shortname || d.model || ''),
          type,
          ip: String(d.ip || ''),
          version: String(d.version || ''),
          adopted: Boolean(d.adopted),
          state,
          uptimeSeconds: Number(d.uptime || 0),
          cpuPercent: cpuPct,
          memPercent: memPct,
          loadAvg1: sysStats.loadavg_1 !== undefined ? parseFloat(String(sysStats.loadavg_1)) : null,
          numClients: Number(d.num_sta || 0),
          numUserClients: Number(d['user-num_sta'] || 0),
          numGuestClients: Number(d['guest-num_sta'] || 0),
          txBytes: Number(d.tx_bytes || 0),
          rxBytes: Number(d.rx_bytes || 0),
          satisfaction: d.satisfaction !== undefined && d.satisfaction >= 0 ? Number(d.satisfaction) : null,
          poeWatts: Math.round(poeWatts * 10) / 10,
          portCount: ports.length,
          ports,
          radios,
        };
      });

      const clients: UnifiClientInfo[] = rawClients.map((c) => ({
        mac: String(c.mac || '').toUpperCase(),
        name: String(c.name || c.hostname || c.mac || 'Client'),
        hostname: String(c.hostname || ''),
        ip: String(c.ip || ''),
        isWired: Boolean(c.is_wired),
        network: String(c.network || ''),
        essid: String(c.essid || ''),
        channel: c.channel !== undefined ? Number(c.channel) : null,
        rssi: c.rssi !== undefined ? Number(c.rssi) : c.signal !== undefined ? Number(c.signal) : null,
        txRateMbps: c.tx_rate !== undefined ? Math.round(Number(c.tx_rate) / 1000) : null,
        rxRateMbps: c.rx_rate !== undefined ? Math.round(Number(c.rx_rate) / 1000) : null,
        txBytes: Number(c.tx_bytes || 0),
        rxBytes: Number(c.rx_bytes || 0),
        uptimeSeconds: Number(c.uptime || 0),
        apMac: String(c.ap_mac || '').toUpperCase(),
        swMac: String(c.sw_mac || '').toUpperCase(),
        swPort: c.sw_port !== undefined ? Number(c.sw_port) : null,
        oui: String(c.oui || ''),
      }));

      const wlanClientCounts = new Map<string, number>();
      for (const c of clients) {
        if (!c.isWired && c.essid) {
          wlanClientCounts.set(c.essid, (wlanClientCounts.get(c.essid) || 0) + 1);
        }
      }

      const wlans: UnifiWlanInfo[] = rawWlans.map((w) => ({
        id: String(w._id || w.name),
        name: String(w.name || 'SSID'),
        enabled: w.enabled !== false,
        security: String(w.security || 'wpapsk'),
        wpaMode: String(w.wpa_mode || 'wpa2'),
        isGuest: Boolean(w.is_guest),
        vlan: w.vlan_enabled && w.vlan ? Number(w.vlan) : null,
        numClients: wlanClientCounts.get(String(w.name || '')) || 0,
      }));

      const wanSubsystem = rawHealth.find((h) => h.subsystem === 'wan') || {};
      const wlanSubsystem = rawHealth.find((h) => h.subsystem === 'wlan') || {};
      const controllerVersion = String(wlanSubsystem.version || rawDevices[0]?.version || '-');
      const wanRxBps = Number(wanSubsystem['rx_bytes-r'] || 0);
      const wanTxBps = Number(wanSubsystem['tx_bytes-r'] || 0);

      const avgCpu =
        devices.length > 0
          ? Math.round((devices.reduce((acc, d) => acc + d.cpuPercent, 0) / devices.length) * 10) / 10
          : 0;
      const avgMem =
        devices.length > 0
          ? Math.round((devices.reduce((acc, d) => acc + d.memPercent, 0) / devices.length) * 10) / 10
          : 0;

      const hist = this.historyMap.get(cfg.id) ?? [];
      hist.push({
        timestamp: now,
        cpuPercent: avgCpu,
        memPercent: avgMem,
        netRxBps: wanRxBps,
        netTxBps: wanTxBps,
      });
      if (hist.length > 60) hist.shift();
      this.historyMap.set(cfg.id, hist);

      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        controllerType: devRes.session.resolvedType,
        site: cfg.site || 'default',
        status: 'online',
        collectedAt: now,
        controllerVersion,
        totalDevices: devices.length,
        onlineDevices: devices.filter((d) => d.state === 'online').length,
        totalClients: clients.length,
        wiredClients: clients.filter((c) => c.isWired).length,
        wirelessClients: clients.filter((c) => !c.isWired).length,
        guestClients: clients.filter((c) => c.network.toLowerCase().includes('guest')).length,
        wanIp: String(wanSubsystem.wan_ip || ''),
        ispName: String(wanSubsystem.isp_name || ''),
        wanLatencyMs: wanSubsystem.latency !== undefined ? Number(wanSubsystem.latency) : null,
        wanRxBps,
        wanTxBps,
        devices,
        clients,
        wlans,
        history: [...hist],
      };
    } catch (err) {
      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        controllerType: cfg.controllerType,
        site: cfg.site || 'default',
        status: 'offline',
        errorMessage: err instanceof Error ? err.message : String(err),
        collectedAt: now,
        controllerVersion: '-',
        totalDevices: 0,
        onlineDevices: 0,
        totalClients: 0,
        wiredClients: 0,
        wirelessClients: 0,
        guestClients: 0,
        wanIp: '',
        ispName: '',
        wanLatencyMs: null,
        wanRxBps: 0,
        wanTxBps: 0,
        devices: [],
        clients: [],
        wlans: [],
        history: this.historyMap.get(cfg.id) ?? [],
      };
    }
  }

  async deviceAction(
    cfg: UnifiConfig,
    mac: string,
    action: 'restart' | 'locate' | 'unlocate' | 'poe-cycle',
    portIdx?: number,
  ): Promise<{ ok: boolean; message: string }> {
    if (cfg.controllerType === 'standalone') {
      if (!cfg.username || !cfg.password) {
        return {
          ok: false,
          message: 'Add SSH username & password on this standalone UniFi device to run remote commands.',
        };
      }
      const sshPort = cfg.port && cfg.port !== 443 && cfg.port !== 8443 ? cfg.port : 22;
      const cmd =
        action === 'restart'
          ? 'reboot'
          : action === 'locate'
            ? 'mca-cli-op set-locate'
            : action === 'unlocate'
              ? 'mca-cli-op clear-locate'
              : '';
      if (!cmd) {
        return { ok: false, message: 'PoE port cycling requires a UniFi Controller.' };
      }
      await runUnifiSshCommand(cfg.host, sshPort, cfg.username, cfg.password, cmd);
      return { ok: true, message: `Sent ${action} via SSH to ${cfg.name}` };
    }

    const site = encodeURIComponent(cfg.site || 'default');
    const cleanMac = mac.toLowerCase();
    const body =
      action === 'restart'
        ? { cmd: 'restart', mac: cleanMac }
        : action === 'locate'
          ? { cmd: 'set-locate', mac: cleanMac }
          : action === 'unlocate'
            ? { cmd: 'unset-locate', mac: cleanMac }
            : { cmd: 'power-cycle', mac: cleanMac, port_idx: Number(portIdx || 1) };

    await this.apiRequest(cfg, 'POST', `/api/s/${site}/cmd/devmgr`, body);
    return { ok: true, message: `Sent ${action} command to ${mac}` };
  }

  async reconnectClient(cfg: UnifiConfig, clientMac: string): Promise<{ ok: boolean; message: string }> {
    const site = encodeURIComponent(cfg.site || 'default');
    await this.apiRequest(cfg, 'POST', `/api/s/${site}/cmd/stamgr`, {
      cmd: 'kick-sta',
      mac: clientMac.toLowerCase(),
    });
    return { ok: true, message: `Reconnected client ${clientMac}` };
  }
}

function devResSafe(_v: any): any {
  return { cookie: '', csrfToken: '', prefix: '/proxy/network', port: 443, resolvedType: 'unifi-os' };
}
