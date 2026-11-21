import http from 'node:http';
import https from 'node:https';
import type {
  ConnectionTestResult,
  OpnsenseConfig,
  OpnsenseFirewallLog,
  OpnsenseGateway,
  OpnsenseInterface,
  OpnsenseService,
  OpnsenseServiceAction,
  OpnsenseSnapshot,
  OpnsenseWireGuardPeer,
  TelemetryPoint,
} from '../../../shared/types.js';

interface IfaceCounterSample {
  timestamp: number;
  counters: Record<string, { inBytes: number; outBytes: number }>;
}

function parseNumber(val: unknown): number {
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.\-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseSizeBytes(val: unknown): number {
  if (typeof val === 'number') return val;
  const s = String(val ?? '').trim();
  const m = s.match(/([\d.]+)\s*([KMGTP])?i?B?/i);
  if (!m) return 0;
  const num = parseFloat(m[1]) || 0;
  const unit = (m[2] || '').toUpperCase();
  const mult: Record<string, number> = {
    '': 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
  };
  return Math.round(num * (mult[unit] ?? 1));
}

function parseUptimeString(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  const s = String(raw ?? '');
  let total = 0;
  // Matches FreeBSD `top` format like "1+00:17:35"
  const plusMatch = s.match(/(\d+)\+(\d+):(\d+)(?::(\d+))?/);
  if (plusMatch) {
    return (
      parseInt(plusMatch[1], 10) * 86400 +
      parseInt(plusMatch[2], 10) * 3600 +
      parseInt(plusMatch[3], 10) * 60 +
      (plusMatch[4] ? parseInt(plusMatch[4], 10) : 0)
    );
  }
  const d = s.match(/(\d+)\s*day/i);
  const hms = s.match(/(\d+):(\d+)(?::(\d+))?/);
  if (d) total += parseInt(d[1], 10) * 86400;
  if (hms) {
    total += parseInt(hms[1], 10) * 3600 + parseInt(hms[2], 10) * 60 + (hms[3] ? parseInt(hms[3], 10) : 0);
  }
  return total;
}

function parseFreeBsdTopHeaders(headers: string[], details: any[]): {
  cpuPercent: number;
  loadAvg: [number, number, number];
  uptimeSeconds: number;
  memUsedBytes: number;
  memTotalBytes: number;
  memPercent: number;
  detectedCores: number;
} {
  let cpuPercent = 0;
  const loadAvg: [number, number, number] = [0, 0, 0];
  let uptimeSeconds = 0;
  let memUsedBytes = 0;
  let memTotalBytes = 0;
  let memPercent = 0;

  for (const rawLine of headers) {
    const line = String(rawLine || '');

    // Load average & uptime: "last pid: 27722; load averages: 0.43, 0.38, 0.29 up 1+00:17:35 22:20:35"
    const loadMatch = line.match(/load averages?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (loadMatch) {
      loadAvg[0] = parseFloat(loadMatch[1]) || 0;
      loadAvg[1] = parseFloat(loadMatch[2]) || 0;
      loadAvg[2] = parseFloat(loadMatch[3]) || 0;
    }
    const upMatch = line.match(/\bup\s+(\d+\+\d+:\d+(?::\d+)?|\d+\s+days?,?\s*\d+:\d+(?::\d+)?|\d+:\d+(?::\d+)?)/i);
    if (upMatch) {
      uptimeSeconds = parseUptimeString(upMatch[1]);
    }

    // CPU: "CPU: 0.2% user, 0.0% nice, 0.2% system, 0.4% interrupt, 99.1% idle"
    if (/CPU:/i.test(line)) {
      const idleMatch = line.match(/([\d.]+)%\s*idle/i);
      if (idleMatch) {
        cpuPercent = Math.max(0, Math.min(100, Math.round((100 - parseFloat(idleMatch[1])) * 10) / 10));
      }
    }

    // Mem: "Mem: 74M Active, 1235M Inact, 1258M Wired, 884M Buf, 9372M Free"
    if (/^Mem:/i.test(line.trim())) {
      const buckets: Record<string, number> = {};
      const re = /([\d.]+)\s*([KMGTP]?)\s*(Active|Inact|Wired|Laundry|Cache|Buf|Free)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const key = m[3].toLowerCase();
        buckets[key] = parseSizeBytes(`${m[1]}${m[2]}`);
      }
      // On FreeBSD top, Buf is already accounted within Wired/Inact — exclude Buf from total
      const total =
        (buckets.active || 0) +
        (buckets.inact || 0) +
        (buckets.wired || 0) +
        (buckets.laundry || 0) +
        (buckets.cache || 0) +
        (buckets.free || 0);
      if (total > 0) {
        memTotalBytes = total;
        const activeWired = (buckets.active || 0) + (buckets.wired || 0) + (buckets.laundry || 0);
        memUsedBytes = activeWired > 0 ? activeWired : Math.max(0, total - (buckets.free || 0));
        memPercent = Math.round((memUsedBytes / memTotalBytes) * 1000) / 10;
      }
    }
  }

  let maxCpuIdx = -1;
  if (Array.isArray(details)) {
    for (const row of details) {
      const cmd = String(row?.COMMAND || '');
      const state = String(row?.STATE || '');
      const cm = cmd.match(/cpu(\d+)/i) || state.match(/CPU(\d+)/i);
      if (cm) {
        const idx = parseInt(cm[1], 10);
        if (idx > maxCpuIdx) maxCpuIdx = idx;
      }
    }
  }

  return {
    cpuPercent,
    loadAvg,
    uptimeSeconds,
    memUsedBytes,
    memTotalBytes,
    memPercent,
    detectedCores: maxCpuIdx >= 0 ? maxCpuIdx + 1 : 0,
  };
}

export class OpnsenseClient {
  private lastIfaces = new Map<string, IfaceCounterSample>();
  private history = new Map<string, TelemetryPoint[]>();
  private resolvedPaths = new Map<string, string>();

  private request<T>(
    cfg: OpnsenseConfig,
    method: 'GET' | 'POST',
    apiPath: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!cfg.apiKey || !cfg.apiSecret) {
        reject(new Error('OPNsense API Key and API Secret are required'));
        return;
      }

      const auth = Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64');
      const payload = body !== undefined ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined;
      const headers: Record<string, string> = {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      };
      if (payload !== undefined) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = String(Buffer.byteLength(payload));
      }

      const isHttps = cfg.protocol !== 'http';
      const mod = isHttps ? https : http;
      const agent = isHttps ? new https.Agent({ rejectUnauthorized: !cfg.allowInsecureTls }) : undefined;

      const req = mod.request(
        {
          hostname: cfg.host,
          port: cfg.port || (isHttps ? 443 : 80),
          path: apiPath,
          method,
          headers,
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
              reject(new Error(`OPNsense HTTP ${status}: ${raw.slice(0, 180) || res.statusMessage}`));
              return;
            }
            try {
              resolve((raw.trim() ? JSON.parse(raw) : {}) as T);
            } catch {
              reject(new Error('Invalid JSON response from OPNsense API'));
            }
          });
        },
      );

      req.on('timeout', () => req.destroy(new Error(`OPNsense API timed out (${cfg.host}:${cfg.port})`)));
      req.on('error', (err) => reject(err));
      if (payload !== undefined) req.write(payload);
      req.end();
    });
  }

  private async getWithFallback<T>(
    cfg: OpnsenseConfig,
    cacheKey: string,
    paths: string[],
    fallbackValue: T,
  ): Promise<{ ok: boolean; data: T; lastError?: Error }> {
    const fullKey = `${cfg.id}:${cacheKey}`;
    const cached = this.resolvedPaths.get(fullKey);
    const ordered = cached ? [cached, ...paths.filter((p) => p !== cached)] : paths;
    let lastError: Error | undefined;

    for (const p of ordered) {
      try {
        const data = await this.request<T>(cfg, 'GET', p);
        this.resolvedPaths.set(fullKey, p);
        return { ok: true, data };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only try alternate endpoint naming on HTTP 400 / 404 (action not found across OPNsense versions)
        if (!/HTTP (400|404)/i.test(lastError.message)) {
          return { ok: false, data: fallbackValue, lastError };
        }
      }
    }
    return { ok: false, data: fallbackValue, lastError };
  }

  async testConnection(cfg: OpnsenseConfig): Promise<ConnectionTestResult> {
    try {
      const [sysInfo, fw, sysTime] = await Promise.all([
        this.getWithFallback<Record<string, any>>(
          cfg,
          'sysInfo',
          ['/api/diagnostics/system/system_information', '/api/diagnostics/system/systemInformation'],
          {},
        ),
        this.getWithFallback<Record<string, any>>(cfg, 'fw', ['/api/core/firmware/status'], {}),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'sysTime',
          ['/api/diagnostics/system/system_time', '/api/diagnostics/system/systemTime'],
          {},
        ),
      ]);

      if (!sysInfo.ok && !fw.ok && !sysTime.ok) {
        throw sysInfo.lastError || fw.lastError || sysTime.lastError || new Error('Unable to reach OPNsense API');
      }

      const version = String(
        sysInfo.data?.versions?.[0] ||
          fw.data?.product?.product_version ||
          fw.data?.product_version ||
          fw.data?.os_version ||
          'OPNsense',
      );
      const hostLabel = String(sysInfo.data?.name || cfg.host);
      return {
        ok: true,
        message: `Connected to ${hostLabel} (${version})`,
        details: {
          hostname: hostLabel,
          version,
          uptime: String(sysTime.data?.uptime || ''),
        },
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async serviceAction(
    cfg: OpnsenseConfig,
    serviceId: string,
    action: OpnsenseServiceAction,
  ): Promise<{ ok: boolean; message: string }> {
    const res = await this.request<Record<string, any>>(
      cfg,
      'POST',
      `/api/core/service/${action}/${encodeURIComponent(serviceId)}`,
      {},
    );
    const resultStr = String(res?.result || res?.status || 'ok');
    return {
      ok: !/fail|error/i.test(resultStr),
      message: `Service ${serviceId}: ${action} (${resultStr})`,
    };
  }

  async systemAction(
    cfg: OpnsenseConfig,
    action: 'reboot' | 'halt' | 'firmware-check',
  ): Promise<{ ok: boolean; message: string }> {
    if (action === 'firmware-check') {
      await this.request(cfg, 'POST', '/api/core/firmware/check', {});
      return { ok: true, message: 'Firmware update check triggered on OPNsense.' };
    }
    const endpoint = action === 'reboot' ? '/api/core/system/reboot' : '/api/core/system/halt';
    await this.request(cfg, 'POST', endpoint, {});
    return {
      ok: true,
      message: action === 'reboot' ? 'Reboot command sent to OPNsense.' : 'Shutdown command sent to OPNsense.',
    };
  }

  async collect(cfg: OpnsenseConfig): Promise<OpnsenseSnapshot> {
    const now = Date.now();
    const prevHist = this.history.get(cfg.id) ?? [];

    try {
      const [
        sysInfoRes,
        sysResourcesRes,
        sysTimeRes,
        sysDiskRes,
        sysTempRes,
        activityRes,
        cpuInfoRes,
        fwStatusRes,
        gwStatusRes,
        trafficIfaceRes,
        ifaceConfigRes,
        ifaceStatsRes,
        ifaceNamesRes,
        servicesWrap,
        pfInfoRes,
        pfMemRes,
        wgWrap,
        fwLogsWrap,
      ] = await Promise.all([
        this.getWithFallback<Record<string, any>>(
          cfg,
          'sysInfo',
          ['/api/diagnostics/system/system_information', '/api/diagnostics/system/systemInformation'],
          {},
        ),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'sysResources',
          ['/api/diagnostics/system/system_resources', '/api/diagnostics/system/systemResources'],
          {},
        ),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'sysTime',
          ['/api/diagnostics/system/system_time', '/api/diagnostics/system/systemTime'],
          {},
        ),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'sysDisk',
          ['/api/diagnostics/system/system_disk', '/api/diagnostics/system/systemDisk'],
          {},
        ),
        this.getWithFallback<any>(
          cfg,
          'sysTemp',
          ['/api/diagnostics/system/system_temperature', '/api/diagnostics/system/systemTemperature'],
          [],
        ),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'activity',
          ['/api/diagnostics/activity/get_activity', '/api/diagnostics/activity/getActivity'],
          {},
        ),
        this.getWithFallback<any>(
          cfg,
          'cpuType',
          ['/api/diagnostics/cpu_usage/get_cpu_type', '/api/diagnostics/cpu_usage/getCPUType'],
          [],
        ),
        this.getWithFallback<Record<string, any>>(cfg, 'fwStatus', ['/api/core/firmware/status'], {}),
        this.getWithFallback<Record<string, any>>(cfg, 'gwStatus', ['/api/routes/gateway/status'], {}),
        this.getWithFallback<Record<string, any>>(cfg, 'trafficIface', ['/api/diagnostics/traffic/interface'], {}),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'ifaceConfig',
          ['/api/diagnostics/interface/get_interface_config', '/api/diagnostics/interface/getInterfaceConfig'],
          {},
        ),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'ifaceStats',
          [
            '/api/diagnostics/interface/get_interface_statistics',
            '/api/diagnostics/interface/getInterfaceStatistics',
          ],
          {},
        ),
        this.getWithFallback<Record<string, string>>(
          cfg,
          'ifaceNames',
          ['/api/diagnostics/interface/get_interface_names', '/api/diagnostics/interface/getInterfaceNames'],
          {},
        ),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'services',
          ['/api/core/service/search?rowCount=50&current=1'],
          {},
        ),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'pfInfo',
          ['/api/diagnostics/firewall/pf_statistics/info', '/api/diagnostics/firewall/pf_states'],
          {},
        ),
        this.getWithFallback<Record<string, any>>(
          cfg,
          'pfMem',
          ['/api/diagnostics/firewall/pf_statistics/memory'],
          {},
        ),
        this.getWithFallback<Record<string, any>>(cfg, 'wg', ['/api/wireguard/service/show'], {}),
        this.getWithFallback<any>(cfg, 'fwLogs', ['/api/diagnostics/firewall/log?limit=25'], []),
      ]);

      // Only fail the whole snapshot if every core endpoint failed (auth error / unreachable)
      if (!sysInfoRes.ok && !sysResourcesRes.ok && !sysTimeRes.ok && !fwStatusRes.ok && !servicesWrap.ok && !activityRes.ok) {
        throw (
          fwStatusRes.lastError ||
          activityRes.lastError ||
          sysResourcesRes.lastError ||
          new Error('Unable to communicate with OPNsense API')
        );
      }

      const sysInfo = sysInfoRes.data;
      const sysResources = sysResourcesRes.data;
      const sysTime = sysTimeRes.data;
      const sysDisk = sysDiskRes.data;
      const sysTemp = sysTempRes.data;
      const activity = activityRes.data;
      const cpuInfo = cpuInfoRes.data;
      const fwStatus = fwStatusRes.data;
      const gwStatus = gwStatusRes.data;
      const trafficIface = trafficIfaceRes.data;
      const ifaceConfig = ifaceConfigRes.data;
      const ifaceStats = ifaceStatsRes.data;
      const ifaceNames = ifaceNamesRes.data;
      const servicesRes = servicesWrap.data;
      const pfInfo = pfInfoRes.data;
      const pfMem = pfMemRes.data;
      const wgRes = wgWrap.data;
      const fwLogsRes = fwLogsWrap.data;

      // Parse FreeBSD top headers from getActivity (works on OPNsense 23.x, 24.x, and 25.x)
      const topStats = parseFreeBsdTopHeaders(
        Array.isArray(activity?.headers) ? activity.headers : [],
        Array.isArray(activity?.details) ? activity.details : [],
      );

      // Memory (prefer systemResources on 24.x+, fall back to FreeBSD top Mem header on 23.x)
      const resMemTotal = parseNumber(sysResources?.memory?.total);
      const resMemUsed = parseNumber(sysResources?.memory?.used);
      const memTotalBytes = resMemTotal > 0 ? resMemTotal : topStats.memTotalBytes;
      const memUsedBytes = resMemTotal > 0 ? resMemUsed : topStats.memUsedBytes;
      const memPercent =
        resMemTotal > 0
          ? parseNumber(sysResources?.memory?.used_frmt) ||
            Math.round((memUsedBytes / memTotalBytes) * 1000) / 10
          : topStats.memPercent;

      // CPU & Load
      const cpuPercent = topStats.cpuPercent;

      const loadStr = String(sysTime?.loadavg || '');
      const loadNums = loadStr
        .split(/[,\s]+/)
        .map((n) => parseFloat(n))
        .filter((n) => !Number.isNaN(n));
      const loadAvg: [number, number, number] =
        loadNums.length >= 3
          ? [loadNums[0], loadNums[1], loadNums[2]]
          : topStats.loadAvg;

      const uptimeSeconds = parseUptimeString(sysTime?.uptime) || topStats.uptimeSeconds;

      const rawCpuModel = Array.isArray(cpuInfo) && cpuInfo[0] ? String(cpuInfo[0]) : '';
      const cpuCoresMatch = rawCpuModel.match(/\((\d+)\s*cores?/i);
      const cpuCores = cpuCoresMatch ? parseInt(cpuCoresMatch[1], 10) : topStats.detectedCores || 4;
      const cpuModel =
        rawCpuModel ||
        (fwStatus?.os_version
          ? `${String(fwStatus.os_version)} (${cpuCores} vCPU)`
          : `OPNsense (${cpuCores} vCPU)`);

      // Disk (Root)
      let diskTotalBytes = 0;
      let diskUsedBytes = 0;
      let diskPercent = 0;
      const devices = Array.isArray(sysDisk?.devices) ? sysDisk.devices : [];
      const rootDisk = devices.find((d: any) => d.mountpoint === '/') || devices[0];
      if (rootDisk) {
        diskTotalBytes = parseSizeBytes(rootDisk.blocks || rootDisk.size);
        diskUsedBytes = parseSizeBytes(rootDisk.used);
        diskPercent = parseNumber(rootDisk.used_pct);
      }

      // Temperature
      let tempC: number | null = null;
      const tempList = Array.isArray(sysTemp) ? sysTemp : [];
      const temps = tempList
        .map((t: any) => parseNumber(t.temperature))
        .filter((v: number) => v > 0 && v < 130);
      if (temps.length > 0) {
        tempC = Math.round(Math.max(...temps) * 10) / 10;
      }

      // PF States (supports OPNsense 23.x nested state-table and 24.x+ flat keys)
      const pfStatesCurrent =
        parseNumber(pfInfo?.info?.['state-table']?.['current-entries']?.total) ||
        parseNumber(pfInfo?.info?.['current entries']) ||
        parseNumber(sysResources?.pf?.states) ||
        0;
      const pfStatesMax =
        parseNumber(pfMem?.memory?.states?.limit) ||
        parseNumber(pfMem?.memory?.states) ||
        parseNumber(pfInfo?.info?.['limit states']) ||
        parseNumber(sysResources?.pf?.max_states) ||
        1000000;
      const pfStatesPercent =
        pfStatesMax > 0 ? Math.round((pfStatesCurrent / pfStatesMax) * 1000) / 10 : 0;

      // Firmware / Version
      const versionRaw = String(
        fwStatus?.product?.product_version ||
          fwStatus?.product_version ||
          (Array.isArray(sysInfo?.versions) && sysInfo.versions[0]) ||
          fwStatus?.os_version ||
          'OPNsense',
      );
      const version = versionRaw.replace(/^OPNsense\s+/i, '').split(' ')[0] || versionRaw;
      const firmwareUpdateAvailable =
        fwStatus?.status === 'update' ||
        fwStatus?.status === 'upgrade' ||
        Boolean(fwStatus?.upgrade_needs_reboot) ||
        Boolean(fwStatus?.upgrade_major_message);

      // Gateways
      const rawGateways = Array.isArray(gwStatus?.items) ? gwStatus.items : [];
      const gateways: OpnsenseGateway[] = rawGateways.map((g: any) => {
        const stRaw = String(g.status || '').toLowerCase();
        const status: OpnsenseGateway['status'] =
          stRaw === 'none' || stRaw === 'online'
            ? 'online'
            : stRaw.includes('down') || stRaw.includes('force_down')
              ? 'down'
              : stRaw.includes('loss')
                ? 'loss'
                : stRaw.includes('delay')
                  ? 'delay'
                  : 'unknown';
        return {
          name: String(g.name || 'GW'),
          address: String(g.address || '-'),
          status,
          statusText: String(g.status_translated || g.status || status),
          delayMs: g.delay && g.delay !== '~' ? parseNumber(g.delay) : null,
          stddevMs: g.stddev && g.stddev !== '~' ? parseNumber(g.stddev) : null,
          lossPercent: g.loss && g.loss !== '~' ? parseNumber(g.loss) : null,
          isDefault: Boolean(g.defaultgw),
        };
      });

      // Interfaces + Throughput Delta
      const isIgnoredDevice = (dev: string) =>
        dev === 'lo0' ||
        dev.startsWith('pflog') ||
        dev.startsWith('enc0') ||
        dev.startsWith('pfsync');

      const getIfaceIp4 = (dev: string): string => {
        const ic = ifaceConfig?.[dev];
        if (ic && Array.isArray(ic.ipv4) && ic.ipv4.length > 0) {
          return String(ic.ipv4[0]?.ipaddr || '');
        }
        return '';
      };

      const getIfaceStatus = (dev: string, fallbackStatus?: unknown): string => {
        const ic = ifaceConfig?.[dev];
        if (ic) {
          if (ic.status) return String(ic.status);
          if (Array.isArray(ic.flags)) {
            return ic.flags.includes('up') ? 'up' : 'down';
          }
        }
        return String(fallbackStatus || 'up');
      };

      const currentCounters: Record<string, { inBytes: number; outBytes: number }> = {};
      const prevSample = this.lastIfaces.get(cfg.id);
      const dtSec = prevSample ? Math.max(0.5, (now - prevSample.timestamp) / 1000) : 0;
      const interfaces: OpnsenseInterface[] = [];

      const trafficMap = trafficIface?.interfaces;
      if (trafficMap && typeof trafficMap === 'object' && Object.keys(trafficMap).length > 0) {
        for (const [key, val] of Object.entries(trafficMap) as Array<[string, any]>) {
          if (!val || typeof val !== 'object') continue;
          const device = String(val.device || key);
          if (isIgnoredDevice(device)) continue;

          const inBytesTotal = parseNumber(val['bytes received'] ?? val['received-bytes']);
          const outBytesTotal = parseNumber(val['bytes transmitted'] ?? val['sent-bytes']);
          currentCounters[device] = { inBytes: inBytesTotal, outBytes: outBytesTotal };

          let inBps = 0;
          let outBps = 0;
          if (prevSample && prevSample.counters[device] && dtSec > 0) {
            inBps = Math.max(0, Math.round((inBytesTotal - prevSample.counters[device].inBytes) / dtSec));
            outBps = Math.max(0, Math.round((outBytesTotal - prevSample.counters[device].outBytes) / dtSec));
          }

          const friendlyName = String(ifaceNames?.[device] || val.name || key);
          interfaces.push({
            device,
            name: friendlyName,
            description: friendlyName,
            ip4: getIfaceIp4(device),
            status: getIfaceStatus(device, val['link state'] === '2' ? 'up' : val.flags),
            inBytesPerSec: inBps,
            outBytesPerSec: outBps,
            inBytesTotal,
            outBytesTotal,
            inErrors: parseNumber(val['input errors'] ?? val['received-errors']),
            outErrors: parseNumber(val['output errors'] ?? val['send-errors']),
          });
        }
      } else {
        // Fallback: deduplicate getInterfaceStatistics by physical device name
        const statsObj = ifaceStats?.statistics || {};
        const byDevice = new Map<
          string,
          {
            device: string;
            name: string;
            ip4: string;
            status: string;
            inBytesTotal: number;
            outBytesTotal: number;
            inErrors: number;
            outErrors: number;
          }
        >();

        for (const [key, val] of Object.entries(statsObj) as Array<[string, any]>) {
          if (!val || typeof val !== 'object') continue;
          const device = String(val.device || val.name || key);
          if (isIgnoredDevice(device)) continue;

          const isLinkRow = String(val.network || '').startsWith('<Link#');
          const addr = String(val.address || '');
          const isIp4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(addr);
          const inBytesTotal = parseNumber(val['bytes received'] ?? val['received-bytes']);
          const outBytesTotal = parseNumber(val['bytes transmitted'] ?? val['sent-bytes']);
          const inErrors = parseNumber(val['input errors'] ?? val['received-errors']);
          const outErrors = parseNumber(val['output errors'] ?? val['send-errors']);

          const existing = byDevice.get(device);
          if (!existing) {
            byDevice.set(device, {
              device,
              name: String(ifaceNames?.[device] || val.name || device),
              ip4: isIp4 ? addr : getIfaceIp4(device),
              status: getIfaceStatus(device, val.flags || val.status),
              inBytesTotal,
              outBytesTotal,
              inErrors,
              outErrors,
            });
          } else {
            if (isIp4 && !existing.ip4) existing.ip4 = addr;
            if (isLinkRow || inBytesTotal > existing.inBytesTotal) {
              existing.inBytesTotal = inBytesTotal;
              existing.outBytesTotal = outBytesTotal;
              existing.inErrors = inErrors;
              existing.outErrors = outErrors;
            }
          }
        }

        for (const entry of byDevice.values()) {
          currentCounters[entry.device] = { inBytes: entry.inBytesTotal, outBytes: entry.outBytesTotal };
          let inBps = 0;
          let outBps = 0;
          if (prevSample && prevSample.counters[entry.device] && dtSec > 0) {
            inBps = Math.max(0, Math.round((entry.inBytesTotal - prevSample.counters[entry.device].inBytes) / dtSec));
            outBps = Math.max(0, Math.round((entry.outBytesTotal - prevSample.counters[entry.device].outBytes) / dtSec));
          }
          interfaces.push({
            device: entry.device,
            name: entry.name,
            description: entry.name,
            ip4: entry.ip4,
            status: entry.status,
            inBytesPerSec: inBps,
            outBytesPerSec: outBps,
            inBytesTotal: entry.inBytesTotal,
            outBytesTotal: entry.outBytesTotal,
            inErrors: entry.inErrors,
            outErrors: entry.outErrors,
          });
        }
      }
      this.lastIfaces.set(cfg.id, { timestamp: now, counters: currentCounters });

      interfaces.sort(
        (a, b) =>
          b.inBytesPerSec + b.outBytesPerSec - (a.inBytesPerSec + a.outBytesPerSec) ||
          b.inBytesTotal + b.outBytesTotal - (a.inBytesTotal + a.outBytesTotal),
      );

      const wanIface = interfaces.find((i) => /^wan$/i.test(i.name)) || interfaces[0];
      const totalRxBps = wanIface ? wanIface.inBytesPerSec : 0;
      const totalTxBps = wanIface ? wanIface.outBytesPerSec : 0;

      // Services
      const rawServices = Array.isArray(servicesRes?.rows) ? servicesRes.rows : [];
      const services: OpnsenseService[] = rawServices.map((s: any) => ({
        id: String(s.id || s.name || ''),
        name: String(s.name || ''),
        description: String(s.description || s.name || ''),
        running: s.running === 1 || s.running === true || s.running === '1',
      }));

      // WireGuard Peers
      const rawWg = Array.isArray(wgRes?.rows) ? wgRes.rows : [];
      const wireguardPeers: OpnsenseWireGuardPeer[] = rawWg
        .filter((r: any) => r.type === 'peer')
        .map((r: any) => {
          const hs = parseNumber(r['latest-handshake']);
          const hsMs = hs > 0 ? hs * 1000 : null;
          return {
            name: String(r.name || r['public-key']?.slice(0, 12) || 'peer'),
            interface: String(r.if || 'wg0'),
            endpoint: String(r.endpoint || '-'),
            latestHandshake: hsMs,
            rxBytes: parseNumber(r['transfer-rx']),
            txBytes: parseNumber(r['transfer-tx']),
            online: hsMs !== null && now - hsMs < 3 * 60 * 1000,
          };
        });

      // Firewall Logs
      const rawLogs = Array.isArray(fwLogsRes) ? fwLogsRes : [];
      const firewallLogs: OpnsenseFirewallLog[] = rawLogs.slice(0, 25).map((l: any, idx: number) => {
        const actRaw = String(l.action || '').toLowerCase();
        const action: OpnsenseFirewallLog['action'] =
          actRaw === 'pass' ? 'pass' : actRaw === 'block' ? 'block' : actRaw === 'rdr' ? 'rdr' : 'other';
        return {
          id: `${l.__digest__ || idx}-${l.__timestamp__ || idx}`,
          timestamp: String(l.__timestamp__ || l.time || ''),
          action,
          interface: String(l.interface_name || l.interface || ''),
          proto: String(l.protoname || l.proto || '').toUpperCase(),
          src: String(l.src || ''),
          srcPort: String(l.srcport || ''),
          dst: String(l.dst || ''),
          dstPort: String(l.dstport || ''),
          label: String(l.label || ''),
        };
      });

      const point: TelemetryPoint = {
        timestamp: now,
        cpuPercent,
        memPercent,
        netRxBps: totalRxBps,
        netTxBps: totalTxBps,
      };
      const nextHist = [...prevHist.slice(-49), point];
      this.history.set(cfg.id, nextHist);

      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        status: 'online',
        collectedAt: now,
        hostname: String(sysInfo?.name || fwStatus?.hostname || cfg.name),
        version,
        uptimeSeconds,
        cpuPercent,
        cpuCores,
        cpuModel,
        loadAvg,
        memUsedBytes,
        memTotalBytes,
        memPercent,
        diskUsedBytes,
        diskTotalBytes,
        diskPercent,
        tempC,
        pfStatesCurrent,
        pfStatesMax,
        pfStatesPercent,
        totalRxBps,
        totalTxBps,
        firmwareUpdateAvailable,
        gateways,
        interfaces: interfaces.slice(0, 12),
        services,
        wireguardPeers,
        firewallLogs,
        history: nextHist,
      };
    } catch (err) {
      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        collectedAt: now,
        hostname: cfg.name,
        version: '-',
        uptimeSeconds: 0,
        cpuPercent: 0,
        cpuCores: 0,
        cpuModel: '-',
        loadAvg: [0, 0, 0],
        memUsedBytes: 0,
        memTotalBytes: 0,
        memPercent: 0,
        diskUsedBytes: 0,
        diskTotalBytes: 0,
        diskPercent: 0,
        tempC: null,
        pfStatesCurrent: 0,
        pfStatesMax: 0,
        pfStatesPercent: 0,
        totalRxBps: 0,
        totalTxBps: 0,
        firmwareUpdateAvailable: false,
        gateways: [],
        interfaces: [],
        services: [],
        wireguardPeers: [],
        firewallLogs: [],
        history: prevHist,
      };
    }
  }
}
