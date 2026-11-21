import { execFile } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import type {
  ConnectionTestResult,
  TailscaleConfig,
  TailscaleDevice,
  TailscaleSnapshot,
} from '../../../shared/types.js';

interface OAuthTokenCache {
  token: string;
  expiresAt: number;
}

const CANDIDATE_BINARIES = [
  'tailscale',
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

function resolveTailscaleBinary(): string {
  for (const bin of CANDIDATE_BINARIES) {
    if (bin === 'tailscale') continue;
    try {
      if (fs.existsSync(bin)) return bin;
    } catch {
      // ignore
    }
  }
  return 'tailscale';
}

function execLocalStatus(): Promise<any> {
  const bin = resolveTailscaleBinary();
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      ['status', '--json'],
      { timeout: 8000, maxBuffer: 6 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr?.trim() || err.message || 'Failed to run tailscale status';
          reject(new Error(msg));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error('Invalid JSON output from local tailscale status'));
        }
      },
    );
  });
}

function httpsJson<T>(
  method: 'GET' | 'POST',
  apiPath: string,
  headers: Record<string, string>,
  body?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
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
        hostname: 'api.tailscale.com',
        port: 443,
        path: apiPath,
        method,
        headers: reqHeaders,
        timeout: 10000,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => {
          raw += chunk.toString('utf8');
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            let detail = raw.slice(0, 200);
            try {
              const parsed = JSON.parse(raw);
              if (parsed?.message) detail = String(parsed.message);
            } catch {
              // ignore
            }
            reject(new Error(`Tailscale API HTTP ${status}: ${detail || res.statusMessage}`));
            return;
          }
          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(new Error('Invalid JSON response from Tailscale API'));
          }
        });
      },
    );

    req.on('timeout', () => req.destroy(new Error('Tailscale API request timed out')));
    req.on('error', (err) => reject(err));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function pickIpv4(ips: string[]): string {
  return ips.find((ip) => ip.includes('.') && !ip.includes(':')) || '';
}

function pickIpv6(ips: string[]): string {
  return ips.find((ip) => ip.includes(':')) || '';
}

function parseTimestamp(value: unknown): number | null {
  if (!value || typeof value !== 'string') return null;
  if (value.startsWith('0001-01-01')) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export class TailscaleClient {
  private oauthCache = new Map<string, OAuthTokenCache>();

  clearCache(configId: string): void {
    this.oauthCache.delete(configId);
  }

  private async getApiAuthHeader(cfg: TailscaleConfig): Promise<string> {
    if (cfg.mode === 'apiKey') {
      if (!cfg.apiKey) throw new Error('Tailscale API key is required');
      const encoded = Buffer.from(`${cfg.apiKey}:`).toString('base64');
      return `Basic ${encoded}`;
    }

    if (cfg.mode === 'oauth') {
      const cached = this.oauthCache.get(cfg.id);
      if (cached && cached.expiresAt > Date.now() + 60_000) {
        return `Bearer ${cached.token}`;
      }
      if (!cfg.oauthClientId || !cfg.oauthClientSecret) {
        throw new Error('Tailscale OAuth Client ID and Client Secret are required');
      }
      const form = new URLSearchParams({
        client_id: cfg.oauthClientId,
        client_secret: cfg.oauthClientSecret,
        grant_type: 'client_credentials',
      }).toString();

      const res = await httpsJson<{ access_token: string; expires_in?: number }>(
        'POST',
        '/api/v2/oauth/token',
        {},
        form,
      );
      if (!res.access_token) throw new Error('OAuth token response missing access_token');
      const expiresInSec = Number(res.expires_in) || 3600;
      this.oauthCache.set(cfg.id, {
        token: res.access_token,
        expiresAt: Date.now() + expiresInSec * 1000,
      });
      return `Bearer ${res.access_token}`;
    }

    throw new Error(`Unsupported Tailscale auth mode: ${cfg.mode}`);
  }

  private async collectLocal(cfg: TailscaleConfig): Promise<TailscaleSnapshot> {
    const now = Date.now();
    const raw = await execLocalStatus();
    const backendState = String(raw.BackendState ?? '');
    if (backendState && backendState !== 'Running') {
      throw new Error(`Local Tailscale daemon state is "${backendState}" (not Running)`);
    }

    const tailnetName =
      String(raw.CurrentTailnet?.Name ?? raw.MagicDNSSuffix ?? cfg.name).replace(/\.$/, '') || cfg.name;
    const devices: TailscaleDevice[] = [];

    const mapNode = (node: Record<string, any>, isSelf: boolean): TailscaleDevice => {
      const ips: string[] = Array.isArray(node.TailscaleIPs) ? node.TailscaleIPs.map(String) : [];
      const dnsName = String(node.DNSName ?? '').replace(/\.$/, '');
      const hostname = String(node.HostName || dnsName.split('.')[0] || 'unknown');
      const routes: string[] = Array.isArray(node.PrimaryRoutes)
        ? node.PrimaryRoutes.map(String)
        : Array.isArray(node.AllowedIPs)
          ? node.AllowedIPs.map(String).filter((r) => !r.endsWith('/32') && !r.endsWith('/128'))
          : [];

      return {
        id: String(node.ID || node.PublicKey || hostname),
        hostname,
        dnsName,
        ipv4: pickIpv4(ips),
        ipv6: pickIpv6(ips),
        addresses: ips,
        os: String(node.OS ?? 'unknown'),
        online: isSelf ? true : Boolean(node.Online),
        active: isSelf ? true : Boolean(node.Active),
        isSelf,
        lastSeen: isSelf ? now : parseTimestamp(node.LastSeen),
        clientVersion: String(node.ClientVersion ?? raw.Version ?? '').split('-')[0],
        tags: Array.isArray(node.Tags) ? node.Tags.map((t: unknown) => String(t).replace(/^tag:/, '')) : [],
        exitNode: Boolean(node.ExitNode),
        exitNodeOption: Boolean(node.ExitNodeOption),
        advertisedRoutes: routes,
        enabledRoutes: routes,
        relay: String(node.Relay ?? ''),
        curAddr: String(node.CurAddr ?? ''),
        rxBytes: Number(node.RxBytes ?? 0),
        txBytes: Number(node.TxBytes ?? 0),
        authorized: true,
        updateAvailable: false,
        sshEnabled: Array.isArray(node.sshHostKeys) && node.sshHostKeys.length > 0,
      };
    };

    if (raw.Self) {
      devices.push(mapNode(raw.Self, true));
    }

    if (raw.Peer && typeof raw.Peer === 'object') {
      for (const peer of Object.values(raw.Peer) as Array<Record<string, any>>) {
        devices.push(mapNode(peer, false));
      }
    }

    devices.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.hostname.localeCompare(b.hostname);
    });

    return {
      configId: cfg.id,
      name: cfg.name,
      mode: cfg.mode,
      tailnetName,
      status: 'online',
      collectedAt: now,
      selfHostname: raw.Self?.HostName ? String(raw.Self.HostName) : undefined,
      devices,
    };
  }

  private async collectCloudApi(cfg: TailscaleConfig): Promise<TailscaleSnapshot> {
    const now = Date.now();
    const authHeader = await this.getApiAuthHeader(cfg);
    const tailnet = encodeURIComponent((cfg.tailnet || '-').trim() || '-');
    const res = await httpsJson<{ devices?: Array<Record<string, any>> }>(
      'GET',
      `/api/v2/tailnet/${tailnet}/devices?fields=all`,
      { Authorization: authHeader },
    );

    const rawDevices = Array.isArray(res.devices) ? res.devices : [];
    const devices: TailscaleDevice[] = rawDevices.map((d) => {
      const ips: string[] = Array.isArray(d.addresses) ? d.addresses.map(String) : [];
      const dnsName = String(d.name ?? '').replace(/\.$/, '');
      const hostname = String(d.hostname || dnsName.split('.')[0] || 'unknown');
      const lastSeen = parseTimestamp(d.lastSeen);
      const online =
        typeof d.connectedToControl === 'boolean'
          ? d.connectedToControl
          : lastSeen !== null && now - lastSeen < 3 * 60 * 1000;
      const advertisedRoutes = Array.isArray(d.advertisedRoutes) ? d.advertisedRoutes.map(String) : [];
      const enabledRoutes = Array.isArray(d.enabledRoutes) ? d.enabledRoutes.map(String) : [];
      const isExit =
        advertisedRoutes.includes('0.0.0.0/0') ||
        advertisedRoutes.includes('::/0') ||
        enabledRoutes.includes('0.0.0.0/0');

      return {
        id: String(d.id || d.nodeId || hostname),
        hostname,
        dnsName,
        ipv4: pickIpv4(ips),
        ipv6: pickIpv6(ips),
        addresses: ips,
        os: String(d.os ?? 'unknown'),
        online,
        active: online,
        isSelf: false,
        lastSeen,
        clientVersion: String(d.clientVersion ?? '').split('-')[0],
        tags: Array.isArray(d.tags) ? d.tags.map((t: unknown) => String(t).replace(/^tag:/, '')) : [],
        exitNode: enabledRoutes.includes('0.0.0.0/0'),
        exitNodeOption: isExit,
        advertisedRoutes: advertisedRoutes.filter((r) => r !== '0.0.0.0/0' && r !== '::/0'),
        enabledRoutes: enabledRoutes.filter((r) => r !== '0.0.0.0/0' && r !== '::/0'),
        relay: '',
        curAddr: '',
        rxBytes: 0,
        txBytes: 0,
        authorized: d.authorized !== false,
        updateAvailable: Boolean(d.updateAvailable),
      };
    });

    devices.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.hostname.localeCompare(b.hostname);
    });

    const inferredTailnet =
      cfg.tailnet && cfg.tailnet !== '-'
        ? cfg.tailnet
        : devices[0]?.dnsName.split('.').slice(1).join('.') || cfg.name;

    return {
      configId: cfg.id,
      name: cfg.name,
      mode: cfg.mode,
      tailnetName: inferredTailnet,
      status: 'online',
      collectedAt: now,
      devices,
    };
  }

  async collect(cfg: TailscaleConfig): Promise<TailscaleSnapshot> {
    const now = Date.now();
    try {
      if (cfg.mode === 'local') {
        return await this.collectLocal(cfg);
      }
      return await this.collectCloudApi(cfg);
    } catch (err) {
      return {
        configId: cfg.id,
        name: cfg.name,
        mode: cfg.mode,
        tailnetName: cfg.tailnet && cfg.tailnet !== '-' ? cfg.tailnet : cfg.name,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        collectedAt: now,
        devices: [],
      };
    }
  }

  async testConnection(cfg: TailscaleConfig): Promise<ConnectionTestResult> {
    this.clearCache(cfg.id);
    const snap = await this.collect(cfg);
    if (snap.status !== 'online') {
      return {
        ok: false,
        message: snap.errorMessage || 'Unable to connect to Tailscale',
      };
    }
    const onlineCount = snap.devices.filter((d) => d.online).length;
    return {
      ok: true,
      message: `Connected to ${snap.tailnetName} — found ${snap.devices.length} device${snap.devices.length === 1 ? '' : 's'} (${onlineCount} online)`,
      details: {
        tailnet: snap.tailnetName,
        devices: snap.devices.length,
        online: onlineCount,
      },
    };
  }
}
