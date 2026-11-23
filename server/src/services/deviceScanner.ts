import { execFile } from 'node:child_process';
import dgram from 'node:dgram';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { promisify } from 'node:util';
import { fingerprintSwitchHttpBanner, SWITCH_MODEL_SPECS } from './switchInspector.js';
import { snmpGet, snmpValToString } from './snmpClient.js';

const execFileAsync = promisify(execFile);

export type AutoScanDeviceKind = 'server' | 'proxmox' | 'opnsense' | 'switch' | 'hikvision' | 'unifi';

export interface AutoScannedDevice {
  host: string;
  port: number;
  protocol: string;
  name: string;
  detail: string;
  mac?: string;
  vendor?: string;
  modelPreset?: string;
  deviceKind?: 'nvr' | 'dvr' | 'camera' | 'auto';
  controllerType?: 'unifi-os' | 'classic' | 'standalone';
  unifiDeviceType?: 'uap' | 'usw' | 'ugw' | 'udm' | 'uxg' | 'other';
  confidence: 'high';
}

export interface AutoScanResponse {
  ok: boolean;
  kind: AutoScanDeviceKind;
  subnet: string;
  scannedIps: number;
  devices: AutoScannedDevice[];
}

const SWITCH_MAC_PREFIXES: Record<string, string> = {
  '00:0A:EB': 'TP-Link',
  '14:CC:20': 'TP-Link',
  '18:D6:C7': 'TP-Link',
  '30:B5:C2': 'TP-Link',
  '50:C7:BF': 'TP-Link',
  '54:AF:97': 'TP-Link',
  '60:32:B1': 'TP-Link',
  '60:E3:27': 'TP-Link',
  '70:4F:57': 'TP-Link',
  '74:DA:88': 'TP-Link',
  '98:DA:C4': 'TP-Link',
  '98:DE:D0': 'TP-Link',
  '98:DF:82': 'TP-Link',
  'A8:42:A1': 'TP-Link',
  'AC:84:C6': 'TP-Link',
  'B0:95:75': 'TP-Link',
  'B0:BE:76': 'TP-Link',
  'C0:06:C3': 'TP-Link',
  'D8:07:B6': 'TP-Link',
  'D8:0D:17': 'TP-Link',
  'D8:47:32': 'TP-Link',
  'E8:94:F6': 'TP-Link',
  'EC:08:6B': 'TP-Link',
  'F4:F2:6D': 'TP-Link',
  '18:E8:29': 'Ubiquiti',
  '24:5A:4C': 'Ubiquiti',
  '44:D9:E7': 'Ubiquiti',
  '68:D7:9A': 'Ubiquiti',
  '74:83:C2': 'Ubiquiti',
  '78:8A:20': 'Ubiquiti',
  '80:2A:A8': 'Ubiquiti',
  'B4:FB:E4': 'Ubiquiti',
  'DC:9F:DB': 'Ubiquiti',
  'E0:63:DA': 'Ubiquiti',
  'F0:9F:C2': 'Ubiquiti',
  '00:0C:42': 'MikroTik',
  '4C:5E:0C': 'MikroTik',
  '64:D1:54': 'MikroTik',
  '6C:3B:6B': 'MikroTik',
  '74:4D:28': 'MikroTik',
  'B8:69:F4': 'MikroTik',
  'CC:2D:E0': 'MikroTik',
  'D4:01:C3': 'MikroTik',
  'D4:CA:6D': 'MikroTik',
  'E4:8D:8C': 'MikroTik',
  '00:1B:D5': 'Cisco',
  '00:23:04': 'Cisco',
  '00:26:CB': 'Cisco',
  '58:AC:78': 'Cisco',
  'A0:F8:49': 'Cisco',
  'F4:CF:E2': 'Cisco',
  '00:09:5B': 'Netgear',
  '20:4E:7F': 'Netgear',
  '28:C6:8E': 'Netgear',
  '44:94:FC': 'Netgear',
  '84:1B:5E': 'Netgear',
  'A0:40:A0': 'Netgear',
  'C4:04:15': 'Netgear',
  'E0:91:F5': 'Netgear',
};

function lookupSwitchMacVendor(mac?: string): string {
  if (!mac) return '';
  const norm = mac.toUpperCase().replace(/-/g, ':').slice(0, 8);
  return SWITCH_MAC_PREFIXES[norm] || '';
}

const EXTRA_UBIQUITI_PREFIXES = new Set([
  '00:15:6D',
  '00:27:22',
  '04:18:D6',
  '1C:6A:7A',
  '24:A4:3C',
  '60:22:32',
  '70:A7:41',
  '94:2A:6F',
  'AC:8B:A9',
  'D8:B3:70',
  'E4:38:83',
  'FC:EC:DA',
]);

function isUbiquitiMac(mac?: string): boolean {
  if (!mac) return false;
  const norm = mac.toUpperCase().replace(/-/g, ':').slice(0, 8);
  return SWITCH_MAC_PREFIXES[norm] === 'Ubiquiti' || EXTRA_UBIQUITI_PREFIXES.has(norm);
}

function inferUnifiDeviceType(text: string): 'uap' | 'usw' | 'ugw' | 'udm' | 'uxg' | 'other' {
  const s = text.toLowerCase();
  if (/udm|dream machine|ucg|cloud gateway/.test(s)) return 'udm';
  if (/uxg/.test(s)) return 'uxg';
  if (/usg|edgerouter|gateway/.test(s)) return 'ugw';
  if (/usw|us-|switch|edgeswitch/.test(s)) return 'usw';
  if (/uap|u6|u7|ac-|nanohd|flexhd|mesh|iw-hd|beacon|ap/.test(s)) return 'uap';
  return 'uap';
}

interface UdpUbiquitiDiscovery {
  ip: string;
  mac?: string;
  hostname?: string;
  model?: string;
  firmware?: string;
}

function discoverUbiquitiUdp(prefixes: string[], timeoutMs = 950): Promise<Map<string, UdpUbiquitiDiscovery>> {
  return new Promise((resolve) => {
    const found = new Map<string, UdpUbiquitiDiscovery>();
    let socket: dgram.Socket | null = null;
    try {
      socket = dgram.createSocket('udp4');
    } catch {
      resolve(found);
      return;
    }

    const done = () => {
      try {
        socket?.close();
      } catch {
        // ignore
      }
      resolve(found);
    };

    const timer = setTimeout(done, timeoutMs);

    socket.on('error', () => {
      clearTimeout(timer);
      done();
    });

    socket.on('message', (msg, rinfo) => {
      // Ubiquiti Discovery v1/v2 TLV parser
      if (msg.length < 4) return;
      const entry: UdpUbiquitiDiscovery = { ip: rinfo.address };
      let offset = 4;
      while (offset + 3 <= msg.length) {
        const t = msg[offset];
        const len = msg.readUInt16BE(offset + 1);
        offset += 3;
        if (offset + len > msg.length) break;
        const val = msg.subarray(offset, offset + len);
        offset += len;
        if (t === 0x01 && len >= 6) {
          entry.mac = Array.from(val.subarray(0, 6))
            .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
            .join(':');
        } else if (t === 0x03 && len > 0) {
          entry.firmware = val.toString('utf8').replace(/\0/g, '').trim();
        } else if (t === 0x0b && len > 0) {
          entry.hostname = val.toString('utf8').replace(/\0/g, '').trim();
        } else if ((t === 0x0c || t === 0x15) && len > 0) {
          entry.model = entry.model || val.toString('utf8').replace(/\0/g, '').trim();
        }
      }
      found.set(rinfo.address, entry);
    });

    socket.bind(0, () => {
      try {
        socket?.setBroadcast(true);
        const probe = Buffer.from([0x01, 0x00, 0x00, 0x00]);
        socket?.send(probe, 10001, '255.255.255.255');
        for (const prefix of prefixes) {
          socket?.send(probe, 10001, `${prefix}.255`);
        }
      } catch {
        // ignore broadcast errors
      }
    });
  });
}

export const DEFAULT_AUTO_SCAN_SUBNETS = [
  '192.168.1.0/24',
  '192.168.0.0/24',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
] as const;

const COMMON_HOST_OCTETS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 40, 45, 46, 50, 55, 60, 64, 70, 80, 88, 90, 100, 101, 102,
  110, 120, 150, 200, 250, 254,
];

function parseIpv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let val = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    val = ((val << 8) | n) >>> 0;
  }
  return val;
}

function intToIpv4(val: number): string {
  return [(val >>> 24) & 255, (val >>> 16) & 255, (val >>> 8) & 255, val & 255].join('.');
}

function parseCidr(raw: string): { networkInt: number; mask: number; prefixLen: number; basePrefix24: string } | null {
  const m = raw.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const ipInt = parseIpv4ToInt(m[1]);
  if (ipInt === null) return null;
  const prefixLen = m[2] !== undefined ? Math.max(8, Math.min(32, Number(m[2]))) : 24;
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0;
  const networkInt = (ipInt & mask) >>> 0;
  const baseParts = intToIpv4(networkInt).split('.');
  return {
    networkInt,
    mask,
    prefixLen,
    basePrefix24: `${baseParts[0]}.${baseParts[1]}.${baseParts[2]}`,
  };
}

export function resolveScanTargets(
  requestedSubnet: string | undefined,
  arpMap: Map<string, string>,
  mode: 'full' | 'priority' = 'full',
): { subnetLabel: string; candidateIps: string[]; broadcastPrefixes: string[] } {
  const tokens =
    requestedSubnet && requestedSubnet.trim()
      ? requestedSubnet
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [...DEFAULT_AUTO_SCAN_SUBNETS];

  const parsedCidrs = tokens.map(parseCidr).filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (parsedCidrs.length === 0) {
    for (const def of DEFAULT_AUTO_SCAN_SUBNETS) {
      const p = parseCidr(def);
      if (p) parsedCidrs.push(p);
    }
  }

  const candidateSet = new Set<string>();
  const broadcastPrefixes = new Set<string>();
  const localInterfaceIps: number[] = [];

  const ifaces = os.networkInterfaces();
  for (const entries of Object.values(ifaces)) {
    if (!entries) continue;
    for (const addr of entries) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('100.')) {
        const ipInt = parseIpv4ToInt(addr.address);
        if (ipInt !== null) localInterfaceIps.push(ipInt);
      }
    }
  }

  const addSlash24 = (prefix24: string, fullSweep: boolean) => {
    broadcastPrefixes.add(prefix24);
    if (fullSweep) {
      for (let oct = 1; oct <= 254; oct++) candidateSet.add(`${prefix24}.${oct}`);
    } else {
      for (const oct of COMMON_HOST_OCTETS) candidateSet.add(`${prefix24}.${oct}`);
    }
  };

  for (const cidr of parsedCidrs) {
    if (cidr.prefixLen >= 24) {
      if (cidr.prefixLen === 32) {
        candidateSet.add(intToIpv4(cidr.networkInt));
      } else if (cidr.prefixLen === 24) {
        addSlash24(cidr.basePrefix24, mode === 'full');
      } else {
        const hostCount = Math.max(1, (1 << (32 - cidr.prefixLen)) - 2);
        for (let offset = 1; offset <= hostCount; offset++) {
          candidateSet.add(intToIpv4((cidr.networkInt + offset) >>> 0));
        }
      }
      broadcastPrefixes.add(cidr.basePrefix24);
      for (const ip of arpMap.keys()) {
        const ipInt = parseIpv4ToInt(ip);
        if (ipInt !== null && ((ipInt & cidr.mask) >>> 0) === cidr.networkInt) {
          candidateSet.add(ip);
        }
      }
    } else {
      // Supernets (e.g. 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16):
      // Sweep base /24, local interface /24s inside the supernet, and all ARP-discovered hosts + priority octets
      addSlash24(cidr.basePrefix24, mode === 'full');

      for (const localInt of localInterfaceIps) {
        if (((localInt & cidr.mask) >>> 0) === cidr.networkInt) {
          const parts = intToIpv4(localInt).split('.');
          addSlash24(`${parts[0]}.${parts[1]}.${parts[2]}`, mode === 'full');
        }
      }

      const arpPrefixes = new Set<string>();
      for (const ip of arpMap.keys()) {
        const ipInt = parseIpv4ToInt(ip);
        if (ipInt !== null && ((ipInt & cidr.mask) >>> 0) === cidr.networkInt) {
          candidateSet.add(ip);
          const parts = ip.split('.');
          if (parts.length === 4) {
            arpPrefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
          }
        }
      }
      for (const arpPrefix of arpPrefixes) {
        addSlash24(arpPrefix, false);
      }
    }
  }

  return {
    subnetLabel: tokens.join(', '),
    candidateIps: Array.from(candidateSet),
    broadcastPrefixes: Array.from(broadcastPrefixes),
  };
}

async function readArpMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { stdout } = await execFileAsync('arp', ['-an'], { timeout: 2000 });
    for (const line of stdout.split('\n')) {
      const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]{11,17})/);
      if (m && m[2] !== '(incomplete)') {
        const mac = m[2]
          .split(':')
          .map((b) => b.padStart(2, '0'))
          .join(':')
          .toUpperCase();
        map.set(m[1], mac);
      }
    }
  } catch {
    // ignore arp errors
  }
  return map;
}

function probeTcpPort(host: string, port: number, timeoutMs = 350): Promise<boolean> {
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

function readSshBanner(host: string, port = 22, timeoutMs = 900): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let buf = '';
    const done = (banner: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(banner);
    };
    socket.setTimeout(timeoutMs);
    socket.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const firstLine = buf.split(/\r?\n/)[0]?.trim();
      if (firstLine && firstLine.startsWith('SSH-')) {
        done(firstLine);
      }
    });
    socket.on('timeout', () => done(buf.startsWith('SSH-') ? buf.trim() : null));
    socket.on('error', () => done(null));
    socket.connect(port, host);
  });
}

function readTelnetBanner(host: string, port = 23, timeoutMs = 900): Promise<string> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let out = '';
    const done = () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(out);
    };
    socket.setTimeout(timeoutMs);
    socket.on('data', (chunk: Buffer) => {
      // strip Telnet IAC sequences
      const printable: number[] = [];
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 0xff && i + 2 < chunk.length) {
          i += 2;
          continue;
        }
        printable.push(chunk[i]);
      }
      out += Buffer.from(printable).toString('utf8');
      if (out.length > 512) done();
    });
    socket.on('timeout', done);
    socket.on('error', done);
    socket.connect(port, host);
  });
}

function fetchHttpMeta(
  host: string,
  port: number,
  useHttps: boolean,
  reqPath = '/',
  timeoutMs = 1500,
): Promise<{ status: number; headers: Record<string, string>; body: string } | null> {
  return new Promise((resolve) => {
    const client = useHttps ? https : http;
    const req = client.request(
      {
        hostname: host,
        port,
        path: reqPath,
        method: 'GET',
        timeout: timeoutMs,
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          if (body.length < 16384) body += chunk.toString('utf8');
        });
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v || '');
          }
          resolve({ status: res.statusCode || 0, headers, body });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function probeRtspOptions(host: string, port = 554, timeoutMs = 1000): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let out = '';
    const done = (res: string | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(res);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.write(`OPTIONS rtsp://${host}:${port}/ RTSP/1.0\r\nCSeq: 1\r\n\r\n`);
    });
    socket.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
      if (out.includes('\r\n\r\n') || out.length > 512) {
        done(out.startsWith('RTSP/') ? out : null);
      }
    });
    socket.on('timeout', () => done(out.startsWith('RTSP/') ? out : null));
    socket.on('error', () => done(null));
    socket.connect(port, host);
  });
}

async function runBatched<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const chunk = await Promise.all(slice.map(fn));
    results.push(...chunk);
  }
  return results;
}

export async function autoScanDevices(
  kind: AutoScanDeviceKind,
  requestedSubnet?: string,
): Promise<AutoScanResponse> {
  const arpMap = await readArpMap();
  const { subnetLabel, candidateIps: allIps, broadcastPrefixes } = resolveScanTargets(
    requestedSubnet,
    arpMap,
    'full',
  );

  const devices: AutoScannedDevice[] = [];

  if (kind === 'proxmox') {
    const openIps = (
      await runBatched(allIps, 64, async (ip) => ((await probeTcpPort(ip, 8006, 320)) ? ip : null))
    ).filter((ip): ip is string => Boolean(ip));

    await runBatched(openIps, 16, async (ip) => {
      const resp = await fetchHttpMeta(ip, 8006, true, '/', 1600);
      if (!resp) return;
      const sig = `${resp.headers['server'] || ''} ${resp.body}`;
      if (/proxmox|pve-api-daemon|PVEAuthCookie|\/pve2\//i.test(sig)) {
        const titleMatch = resp.body.match(/<title[^>]*>([^<]+)<\/title>/i);
        devices.push({
          host: ip,
          port: 8006,
          protocol: 'https',
          name: titleMatch ? titleMatch[1].trim() : `Proxmox VE (${ip})`,
          detail: 'Verified Proxmox VE API (:8006)',
          mac: arpMap.get(ip),
          confidence: 'high',
        });
      }
    });
  } else if (kind === 'opnsense') {
    const openIps = (
      await runBatched(allIps, 64, async (ip) => {
        const has443 = await probeTcpPort(ip, 443, 300);
        if (has443) return { ip, port: 443, https: true };
        const has80 = await probeTcpPort(ip, 80, 300);
        if (has80) return { ip, port: 80, https: false };
        return null;
      })
    ).filter((item): item is { ip: string; port: number; https: boolean } => Boolean(item));

    await runBatched(openIps, 16, async ({ ip, port, https: useHttps }) => {
      const resp = await fetchHttpMeta(ip, port, useHttps, '/', 1500);
      if (!resp) return;
      const combined = `${JSON.stringify(resp.headers)} ${resp.body}`;
      if (/opnsense|deciso/i.test(combined)) {
        devices.push({
          host: ip,
          port,
          protocol: useHttps ? 'https' : 'http',
          name: `OPNsense (${ip})`,
          detail: `Verified OPNsense WebGUI (:${port})`,
          mac: arpMap.get(ip),
          confidence: 'high',
        });
      }
    });
  } else if (kind === 'hikvision') {
    const openIps = (
      await runBatched(allIps, 48, async (ip) => {
        const [p80, p443, p8000, p554] = await Promise.all([
          probeTcpPort(ip, 80, 280),
          probeTcpPort(ip, 443, 280),
          probeTcpPort(ip, 8000, 280),
          probeTcpPort(ip, 554, 280),
        ]);
        if (!p80 && !p443 && !p8000 && !p554) return null;
        return { ip, p80, p443, p8000, p554 };
      })
    ).filter((x): x is { ip: string; p80: boolean; p443: boolean; p8000: boolean; p554: boolean } => Boolean(x));

    await runBatched(openIps, 16, async ({ ip, p80, p443, p8000, p554 }) => {
      let verified = false;
      let proto: 'http' | 'https' = 'http';
      let port = 80;
      let detail = '';

      if (p80 || p443) {
        const useHttps = !p80 && p443;
        const tryPort = useHttps ? 443 : 80;
        const isapi = await fetchHttpMeta(ip, tryPort, useHttps, '/ISAPI/System/deviceInfo', 1400);
        const root = !isapi ? await fetchHttpMeta(ip, tryPort, useHttps, '/', 1400) : isapi;
        const resp = isapi || root;
        if (resp) {
          const combined = `${JSON.stringify(resp.headers)} ${resp.body}`;
          if (/app-webs|dnvrs-webs|hikvision|isapi|ipcamera|network video recorder/i.test(combined)) {
            verified = true;
            proto = useHttps ? 'https' : 'http';
            port = tryPort;
            detail = `Verified Hikvision ISAPI/Web (${proto.toUpperCase()} :${port}${p8000 ? ' · SDK :8000' : ''})`;
          }
        }
      }

      if (!verified && p8000 && p554) {
        const rtsp = await probeRtspOptions(ip, 554, 900);
        if (rtsp && /hikvision|200 OK|401 Unauthorized/i.test(rtsp)) {
          verified = true;
          detail = 'Verified RTSP (:554) + Hikvision SDK (:8000)';
        }
      }

      if (verified) {
        devices.push({
          host: ip,
          port,
          protocol: proto,
          name: `Hikvision (${ip})`,
          detail,
          mac: arpMap.get(ip),
          deviceKind: p8000 ? 'nvr' : 'auto',
          confidence: 'high',
        });
      }
    });
  } else if (kind === 'switch') {
    const openIps = (
      await runBatched(allIps, 48, async (ip) => {
        const [p22, p23, p80, p443] = await Promise.all([
          probeTcpPort(ip, 22, 280),
          probeTcpPort(ip, 23, 280),
          probeTcpPort(ip, 80, 280),
          probeTcpPort(ip, 443, 280),
        ]);
        if (!p22 && !p23 && !p80 && !p443) return null;
        return { ip, p22, p23, p80, p443 };
      })
    ).filter((x): x is { ip: string; p22: boolean; p23: boolean; p80: boolean; p443: boolean } => Boolean(x));

    await runBatched(openIps, 16, async ({ ip, p22, p23, p80, p443 }) => {
      const mac = arpMap.get(ip);
      const macVendor = lookupSwitchMacVendor(mac);

      const banner = p80
        ? await fingerprintSwitchHttpBanner(ip, 80, false)
        : p443
          ? await fingerprintSwitchHttpBanner(ip, 443, true)
          : { reachable: false };

      let detectedModel = banner.model;
      let detectedVendor = banner.vendor;

      if (!detectedModel && !detectedVendor && p23) {
        const telnetBanner = await readTelnetBanner(ip, 23, 800);
        const m = telnetBanner.match(
          /\b(T1600G-28PS|T1600G-28TS|T2600G-28TS|TL-SG3428|TL-SG2428P|CRS326|SG300|CBS350|EdgeSwitch)\b/i,
        );
        if (m) detectedModel = m[1].toUpperCase();
        if (/tp-link|jetstream|\*+\s*user access login\s*\*+/i.test(telnetBanner)) detectedVendor = 'TP-Link JetStream';
        else if (/cisco/i.test(telnetBanner)) detectedVendor = 'Cisco Systems';
        else if (/mikrotik/i.test(telnetBanner)) detectedVendor = 'MikroTik';
        else if (/ubiquiti|edgeswitch/i.test(telnetBanner)) detectedVendor = 'Ubiquiti Inc.';
      }

      if (!detectedModel && !detectedVendor) {
        const snmpDescr = await snmpGet(ip, 'public', '1.3.6.1.2.1.1.1.0', 161).catch(() => null);
        if (snmpDescr) {
          const text = snmpValToString(snmpDescr.value);
          if (/switch|jetstream|t1600g|t2600g|tl-sg|crs326|sg300|edgeswitch|procurve/i.test(text)) {
            const m = text.match(
              /\b(T1600G-28PS|T1600G-28TS|T2600G-28TS|TL-SG3428|TL-SG2428P|CRS326|SG300|CBS350)\b/i,
            );
            if (m) detectedModel = m[1].toUpperCase();
            detectedVendor = detectedVendor || 'Managed Switch (SNMP)';
          }
        }
      }

      if (detectedModel || detectedVendor || (macVendor && (p23 || p22))) {
        const proto = p22 ? 'ssh' : p23 ? 'telnet' : 'http';
        const port = p22 ? 22 : p23 ? 23 : p80 ? 80 : 443;
        const preset = detectedModel && SWITCH_MODEL_SPECS[detectedModel] ? detectedModel : 'auto';
        const label = [detectedVendor || macVendor, detectedModel].filter(Boolean).join(' ') || 'Managed Switch';
        devices.push({
          host: ip,
          port,
          protocol: proto,
          name: `${label} (${ip})`,
          detail: `Verified Switch (${proto.toUpperCase()} :${port}${detectedModel ? ` · ${detectedModel}` : ''})`,
          mac,
          vendor: detectedVendor || macVendor || undefined,
          modelPreset: preset,
          confidence: 'high',
        });
      }
    });
  } else if (kind === 'server') {
    const openIps = (
      await runBatched(allIps, 64, async (ip) => ((await probeTcpPort(ip, 22, 320)) ? ip : null))
    ).filter((ip): ip is string => Boolean(ip));

    await runBatched(openIps, 16, async (ip) => {
      const sshBanner = await readSshBanner(ip, 22, 900);
      if (!sshBanner) return;

      // Exclude Proxmox VE hosts, OPNsense firewalls, and managed switches so only servers show up
      const isPve = await probeTcpPort(ip, 8006, 250);
      if (isPve) {
        const pveResp = await fetchHttpMeta(ip, 8006, true, '/', 800);
        if (pveResp && /proxmox|pve-api-daemon|PVEAuthCookie/i.test(`${pveResp.headers['server'] || ''} ${pveResp.body}`)) {
          return;
        }
      }

      const mac = arpMap.get(ip);
      if (lookupSwitchMacVendor(mac)) {
        const swBanner = await fingerprintSwitchHttpBanner(ip, 80, false);
        if (swBanner.reachable && (swBanner.model || swBanner.vendor)) return;
      }

      // Exclude Dropbear/Cisco/TP-Link switch SSH banners if clearly a network appliance
      if (/cisco|tplink|tp-link|mikrotik/i.test(sshBanner)) return;

      devices.push({
        host: ip,
        port: 22,
        protocol: 'ssh',
        name: `SSH Host (${ip})`,
        detail: sshBanner,
        mac,
        confidence: 'high',
      });
    });
  } else if (kind === 'unifi') {
    const udpFound = await discoverUbiquitiUdp(broadcastPrefixes, 950);

    const openHosts = new Map<string, { p443: boolean; p8443: boolean; p22: boolean }>();
    await runBatched(allIps, 64, async (ip) => {
      const [p443, p8443, p22] = await Promise.all([
        probeTcpPort(ip, 443, 280),
        probeTcpPort(ip, 8443, 280),
        probeTcpPort(ip, 22, 260),
      ]);
      const mac = arpMap.get(ip);
      if (p443 || p8443 || (p22 && isUbiquitiMac(mac)) || isUbiquitiMac(mac) || udpFound.has(ip)) {
        openHosts.set(ip, { p443, p8443, p22 });
      }
    });

    await runBatched(Array.from(openHosts.keys()), 16, async (ip) => {
      const flags = openHosts.get(ip)!;
      const udp = udpFound.get(ip);
      const mac = udp?.mac || arpMap.get(ip);

      // 1. Check Classic UniFi Network Controller (:8443)
      if (flags.p8443) {
        const meta = await fetchHttpMeta(ip, 8443, true, '/status', 900);
        const text = meta ? `${meta.headers['server'] || ''} ${meta.body}` : '';
        if (meta && (/unifi|ubnt|"meta"/i.test(text) || meta.status === 200)) {
          devices.push({
            host: ip,
            port: 8443,
            protocol: 'https',
            name: udp?.hostname || `UniFi Controller (${ip})`,
            detail: 'UniFi Classic Network Server (:8443)',
            mac,
            vendor: 'Ubiquiti UniFi',
            controllerType: 'classic',
            confidence: 'high',
          });
          return;
        }
      }

      // 2. Check UniFi OS Controller (:443)
      if (flags.p443) {
        const meta = await fetchHttpMeta(ip, 443, true, '/proxy/network/api/stat/sysinfo', 900);
        const rootMeta = !meta || meta.status === 404 ? await fetchHttpMeta(ip, 443, true, '/', 900) : meta;
        const text = rootMeta ? `${rootMeta.headers['server'] || ''} ${rootMeta.headers['x-csrf-token'] || ''} ${rootMeta.body}` : '';
        if (rootMeta && (/unifi|ubnt|ui\.com/i.test(text) || Boolean(rootMeta.headers['x-csrf-token']))) {
          devices.push({
            host: ip,
            port: 443,
            protocol: 'https',
            name: udp?.hostname || `UniFi OS (${ip})`,
            detail: `UniFi OS Controller (:443${udp?.model ? ` · ${udp.model}` : ''})`,
            mac,
            vendor: 'Ubiquiti UniFi',
            controllerType: 'unifi-os',
            confidence: 'high',
          });
          return;
        }
      }

      // 3. Standalone UniFi Device (AP / Switch / Gateway without controller)
      let snmpDescr = '';
      let snmpName = '';
      const descrVar = await snmpGet(ip, 'public', '1.3.6.1.2.1.1.1.0', 161).catch(() => null);
      if (descrVar) snmpDescr = snmpValToString(descrVar.value);
      const nameVar = await snmpGet(ip, 'public', '1.3.6.1.2.1.1.5.0', 161).catch(() => null);
      if (nameVar) snmpName = snmpValToString(nameVar.value);

      const isConfirmedUbiquiti =
        Boolean(udp) ||
        isUbiquitiMac(mac) ||
        /ubiquiti|unifi|uap|usw|ugw|udm|uxg|ubnt/i.test(snmpDescr);

      if (!isConfirmedUbiquiti) return;

      const modelHint = udp?.model || snmpDescr || '';
      const devType = inferUnifiDeviceType(`${modelHint} ${udp?.hostname || ''} ${snmpName}`);
      const typeLabel = devType === 'usw' ? 'Switch' : devType === 'uap' ? 'AP' : 'Gateway';
      const displayName = udp?.hostname || snmpName || `UniFi ${typeLabel} (${ip})`;

      devices.push({
        host: ip,
        port: flags.p22 ? 22 : flags.p443 ? 443 : 161,
        protocol: flags.p22 ? 'ssh' : 'standalone',
        name: displayName,
        detail: `Standalone UniFi ${typeLabel}${udp?.model ? ` · ${udp.model}` : ''}${mac ? ` · ${mac}` : ''}`,
        mac,
        vendor: 'Ubiquiti UniFi',
        controllerType: 'standalone',
        unifiDeviceType: devType,
        confidence: 'high',
      });
    });
  }

  devices.sort((a, b) => {
    const pa = a.host.split('.').map(Number);
    const pb = b.host.split('.').map(Number);
    for (let i = 0; i < 4; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  });

  return {
    ok: true,
    kind,
    subnet: subnetLabel,
    scannedIps: allIps.length,
    devices,
  };
}
