import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  ConnectionTestResult,
  HikvisionChannel,
  HikvisionConfig,
  HikvisionHdd,
  HikvisionSnapshot,
  TelemetryPoint,
} from '../../../shared/types.js';

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
  nc: number;
}

interface RawHttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface CachedFrame {
  timestamp: number;
  contentType: string;
  buffer: Buffer;
}

function md5Hex(data: string): string {
  return crypto.createHash('md5').update(data, 'utf8').digest('hex');
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function parseDigestHeader(headerVal: string): DigestChallenge | null {
  if (!/^Digest\s+/i.test(headerVal.trim())) return null;
  const params: Record<string, string> = {};
  const re = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(headerVal)) !== null) {
    params[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  }
  if (!params.realm || !params.nonce) return null;
  return {
    realm: params.realm,
    nonce: params.nonce,
    qop: params.qop,
    opaque: params.opaque,
    algorithm: params.algorithm,
    nc: 0,
  };
}

function buildDigestAuthHeader(
  challenge: DigestChallenge,
  method: string,
  uriPath: string,
  username: string,
  password: string,
): string {
  challenge.nc += 1;
  const ncHex = challenge.nc.toString(16).padStart(8, '0');
  const cnonce = crypto.randomBytes(8).toString('hex');
  const alg = (challenge.algorithm || 'MD5').toUpperCase();
  const hashFn = alg.startsWith('SHA-256') ? sha256Hex : md5Hex;

  let ha1 = hashFn(`${username}:${challenge.realm}:${password}`);
  if (alg.endsWith('-SESS')) {
    ha1 = hashFn(`${ha1}:${challenge.nonce}:${cnonce}`);
  }
  const ha2 = hashFn(`${method}:${uriPath}`);

  let qopChoice = '';
  if (challenge.qop) {
    const qops = challenge.qop.split(',').map((q) => q.trim());
    qopChoice = qops.includes('auth') ? 'auth' : qops[0];
  }

  const response = qopChoice
    ? hashFn(`${ha1}:${challenge.nonce}:${ncHex}:${cnonce}:${qopChoice}:${ha2}`)
    : hashFn(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uriPath}"`,
    `response="${response}"`,
  ];
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (qopChoice) {
    parts.push(`qop=${qopChoice}`);
    parts.push(`nc=${ncHex}`);
    parts.push(`cnonce="${cnonce}"`);
  }
  return `Digest ${parts.join(', ')}`;
}

function xmlTag(xml: string, tag: string): string {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${tag}>`, 'gi');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function resolveFfmpegBinary(): string | null {
  const candidates = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export class HikvisionClient {
  private digestCache = new Map<string, DigestChallenge>();
  private history = new Map<string, TelemetryPoint[]>();
  private frameCache = new Map<string, CachedFrame>();
  private inflightFrames = new Map<string, Promise<{ contentType: string; buffer: Buffer }>>();

  private getCacheKey(cfg: HikvisionConfig): string {
    return `${cfg.protocol}://${cfg.host}:${cfg.port}:${cfg.username}`;
  }

  private rawRequest(
    cfg: HikvisionConfig,
    method: 'GET' | 'PUT' | 'POST',
    apiPath: string,
    headers: Record<string, string>,
    body?: string | Buffer,
    timeoutMs = 7500,
  ): Promise<RawHttpResponse> {
    return new Promise((resolve, reject) => {
      const isHttps = cfg.protocol === 'https';
      const mod = isHttps ? https : http;
      const agent = isHttps ? new https.Agent({ rejectUnauthorized: !cfg.allowInsecureTls }) : undefined;

      const reqHeaders: Record<string, string> = {
        Accept: '*/*',
        Connection: 'close',
        ...headers,
      };
      if (body !== undefined) {
        const len = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length;
        reqHeaders['Content-Length'] = String(len);
        if (!reqHeaders['Content-Type']) {
          reqHeaders['Content-Type'] = 'application/xml; charset=utf-8';
        }
      }

      const req = mod.request(
        {
          hostname: cfg.host,
          port: cfg.port || (isHttps ? 443 : 80),
          path: apiPath,
          method,
          headers: reqHeaders,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            });
          });
        },
      );

      req.on('timeout', () => req.destroy(new Error(`Hikvision ISAPI timed out (${cfg.host}:${cfg.port})`)));
      req.on('error', (err) => reject(err));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  /**
   * Performs an ISAPI request with automatic HTTP Digest / Basic Auth challenge negotiation.
   */
  async requestIsapi(
    cfg: HikvisionConfig,
    method: 'GET' | 'PUT' | 'POST',
    apiPath: string,
    body?: string | Buffer,
    timeoutMs = 7500,
  ): Promise<RawHttpResponse> {
    const username = cfg.username || 'admin';
    const password = cfg.password || '';
    const cacheKey = this.getCacheKey(cfg);
    const cachedChallenge = this.digestCache.get(cacheKey);

    const headers: Record<string, string> = {};
    if (cachedChallenge) {
      headers.Authorization = buildDigestAuthHeader(cachedChallenge, method, apiPath, username, password);
    }

    let res = await this.rawRequest(cfg, method, apiPath, headers, body, timeoutMs);

    if (res.statusCode === 401) {
      const wwwAuthRaw = res.headers['www-authenticate'];
      const wwwList = Array.isArray(wwwAuthRaw) ? wwwAuthRaw : wwwAuthRaw ? [wwwAuthRaw] : [];
      let digestChal: DigestChallenge | null = null;
      for (const h of wwwList) {
        digestChal = parseDigestHeader(h);
        if (digestChal) break;
      }

      if (digestChal) {
        this.digestCache.set(cacheKey, digestChal);
        const authHdr = buildDigestAuthHeader(digestChal, method, apiPath, username, password);
        res = await this.rawRequest(cfg, method, apiPath, { Authorization: authHdr }, body, timeoutMs);
      } else {
        const basic = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
        res = await this.rawRequest(cfg, method, apiPath, { Authorization: `Basic ${basic}` }, body, timeoutMs);
      }
    }

    return res;
  }

  private async getXml(cfg: HikvisionConfig, apiPath: string, timeoutMs = 7000): Promise<{ ok: boolean; status: number; xml: string }> {
    try {
      const res = await this.requestIsapi(cfg, 'GET', apiPath, undefined, timeoutMs);
      const xml = res.body.toString('utf8');
      return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, xml };
    } catch {
      return { ok: false, status: 0, xml: '' };
    }
  }

  private inferDeviceType(cfg: HikvisionConfig, rawType: string, model: string): 'NVR' | 'DVR' | 'IPCamera' {
    if (cfg.deviceKind === 'nvr') return 'NVR';
    if (cfg.deviceKind === 'dvr') return 'DVR';
    if (cfg.deviceKind === 'camera') return 'IPCamera';
    const combined = `${rawType} ${model}`.toUpperCase();
    if (combined.includes('NVR') || /DS-(?:76|77|86|96)\d+/i.test(model)) return 'NVR';
    if (combined.includes('DVR') || /DS-(?:71|72|73|81|90)\d+/i.test(model)) return 'DVR';
    if (combined.includes('IPCAMERA') || combined.includes('CAMERA') || /DS-2(?:CD|DE|CV|XS)/i.test(model)) {
      return 'IPCamera';
    }
    return 'NVR';
  }

  async testConnection(cfg: HikvisionConfig): Promise<ConnectionTestResult> {
    try {
      const res = await this.requestIsapi(cfg, 'GET', '/ISAPI/System/deviceInfo');
      if (res.statusCode === 401 || res.statusCode === 403) {
        return {
          ok: false,
          message: `Hikvision authentication failed (HTTP ${res.statusCode}). Verify username and password.`,
        };
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return {
          ok: false,
          message: `Hikvision ISAPI returned HTTP ${res.statusCode}: ${res.body.toString('utf8').slice(0, 140)}`,
        };
      }
      const xml = res.body.toString('utf8');
      const deviceName = xmlTag(xml, 'deviceName') || cfg.name || cfg.host;
      const model = xmlTag(xml, 'model') || 'Hikvision Device';
      const serial = xmlTag(xml, 'serialNumber') || '-';
      const fw = xmlTag(xml, 'firmwareVersion') || '-';
      const build = xmlTag(xml, 'firmwareReleasedDate') || '';
      const fwFull = build ? `${fw} ${build}` : fw;

      return {
        ok: true,
        message: `Connected to ${deviceName} — ${model} (${fwFull})`,
        details: {
          deviceName,
          model,
          serialNumber: serial,
          firmware: fwFull,
        },
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async collect(cfg: HikvisionConfig): Promise<HikvisionSnapshot> {
    const now = Date.now();
    const prevHist = this.history.get(cfg.id) ?? [];

    try {
      const [
        devInfoRes,
        sysStatusRes,
        proxyChRes,
        proxyStatusRes,
        analogChRes,
        streamChRes,
        hddRes,
        ptzChRes,
      ] = await Promise.all([
        this.getXml(cfg, '/ISAPI/System/deviceInfo'),
        this.getXml(cfg, '/ISAPI/System/status'),
        this.getXml(cfg, '/ISAPI/ContentMgmt/InputProxy/channels'),
        this.getXml(cfg, '/ISAPI/ContentMgmt/InputProxy/channels/status'),
        this.getXml(cfg, '/ISAPI/System/Video/inputs/channels'),
        this.getXml(cfg, '/ISAPI/Streaming/channels'),
        this.getXml(cfg, '/ISAPI/ContentMgmt/Storage/hdd').then(async (r) =>
          r.ok && r.xml.includes('<hdd') ? r : this.getXml(cfg, '/ISAPI/ContentMgmt/Storage'),
        ),
        this.getXml(cfg, '/ISAPI/PTZCtrl/channels'),
      ]);

      if (!devInfoRes.ok && !sysStatusRes.ok && !streamChRes.ok) {
        if (devInfoRes.status === 401 || devInfoRes.status === 403) {
          throw new Error(`Hikvision ISAPI authentication failed (HTTP ${devInfoRes.status})`);
        }
        throw new Error(`Unable to reach Hikvision ISAPI on ${cfg.host}:${cfg.port}`);
      }

      const infoXml = devInfoRes.xml;
      const deviceName = xmlTag(infoXml, 'deviceName') || cfg.name;
      const model = xmlTag(infoXml, 'model') || 'Hikvision';
      const serialNumber = xmlTag(infoXml, 'serialNumber') || '-';
      const firmwareVersion = xmlTag(infoXml, 'firmwareVersion') || '-';
      const firmwareBuild = xmlTag(infoXml, 'firmwareReleasedDate') || '';
      const macAddress = xmlTag(infoXml, 'macAddress') || '';
      const rawDevType = xmlTag(infoXml, 'deviceType');
      const deviceType = this.inferDeviceType(cfg, rawDevType, model);

      // System Status (Uptime, CPU, Memory)
      const statusXml = sysStatusRes.xml;
      const uptimeSeconds = parseInt(xmlTag(statusXml, 'deviceUpTime'), 10) || 0;
      const cpuPercent = Math.min(100, Math.max(0, parseFloat(xmlTag(statusXml, 'cpuUtilization')) || 0));
      let memPercent = parseFloat(xmlTag(statusXml, 'memoryUsage')) || 0;
      const memAvail = parseFloat(xmlTag(statusXml, 'memoryAvailable')) || 0;
      if (memPercent > 100 && memAvail > 0) {
        // Some firmware reports KB instead of percentage
        memPercent = Math.round((memPercent / (memPercent + memAvail)) * 1000) / 10;
      } else {
        memPercent = Math.min(100, Math.max(0, Math.round(memPercent * 10) / 10));
      }

      // Parse Streaming Channels (/ISAPI/Streaming/channels)
      // Hikvision convention: channelId * 100 + 1 = Main Stream (e.g. 101), channelId * 100 + 2 = Sub Stream (e.g. 102)
      const streamInfoByChannel = new Map<
        number,
        {
          mainStreamId: number;
          subStreamId: number;
          name: string;
          codec: string;
          resolution: string;
          fps: number;
          bitrateKbps: number;
        }
      >();

      for (const sBlock of xmlBlocks(streamChRes.xml, 'StreamingChannel')) {
        const rawStreamId = parseInt(xmlTag(sBlock, 'id'), 10);
        if (!rawStreamId) continue;
        const chNum = rawStreamId >= 100 ? Math.floor(rawStreamId / 100) : rawStreamId;
        const streamIdx = rawStreamId >= 100 ? rawStreamId % 100 : 1;

        const existing = streamInfoByChannel.get(chNum) ?? {
          mainStreamId: chNum * 100 + 1,
          subStreamId: chNum * 100 + 2,
          name: xmlTag(sBlock, 'channelName') || `Camera ${chNum}`,
          codec: 'H.265',
          resolution: '-',
          fps: 25,
          bitrateKbps: 0,
        };

        if (streamIdx === 1 || !streamInfoByChannel.has(chNum)) {
          const codecRaw = (xmlTag(sBlock, 'videoCodecType') || 'H.265').toUpperCase();
          const w = parseInt(xmlTag(sBlock, 'videoResolutionWidth'), 10) || 0;
          const h = parseInt(xmlTag(sBlock, 'videoResolutionHeight'), 10) || 0;
          const rawFps = parseInt(xmlTag(sBlock, 'maxFrameRate'), 10) || 0;
          // Hikvision ISAPI encodes maxFrameRate as fps * 100 (e.g. 2500 -> 25 fps, 3000 -> 30 fps)
          const fps = rawFps >= 100 ? Math.round(rawFps / 100) : rawFps || 25;
          const bitrate =
            parseInt(xmlTag(sBlock, 'constantBitRate'), 10) ||
            parseInt(xmlTag(sBlock, 'vbrUpperCap'), 10) ||
            0;

          existing.mainStreamId = rawStreamId >= 100 ? chNum * 100 + 1 : rawStreamId;
          existing.name = xmlTag(sBlock, 'channelName') || existing.name;
          existing.codec = codecRaw.includes('265') || codecRaw.includes('HEVC') ? 'H.265' : codecRaw.includes('264') ? 'H.264' : codecRaw;
          if (w > 0 && h > 0) existing.resolution = `${w}x${h}`;
          existing.fps = fps;
          existing.bitrateKbps = bitrate;
        } else if (streamIdx === 2) {
          existing.subStreamId = rawStreamId;
        }

        streamInfoByChannel.set(chNum, existing);
      }

      // PTZ enabled channels
      const ptzChannels = new Set<number>();
      for (const pBlock of xmlBlocks(ptzChRes.xml, 'PTZChannel')) {
        const enabled = xmlTag(pBlock, 'enabled').toLowerCase() !== 'false';
        const cid =
          parseInt(xmlTag(pBlock, 'videoInputID'), 10) || parseInt(xmlTag(pBlock, 'id'), 10);
        if (enabled && cid) ptzChannels.add(cid);
      }

      // Online status map for InputProxy channels (NVR / hybrid DVR)
      const proxyOnlineMap = new Map<
        number,
        { online: boolean; ipAddress: string; detectResult: string }
      >();
      for (const stBlock of xmlBlocks(proxyStatusRes.xml, 'InputProxyChannelStatus')) {
        const id = parseInt(xmlTag(stBlock, 'id'), 10);
        if (!id) continue;
        const onlineStr = xmlTag(stBlock, 'online').toLowerCase();
        const detectResult = xmlTag(stBlock, 'chanDetectResult').toLowerCase();
        const online = onlineStr === 'true' || detectResult === 'connect' || detectResult === 'connected';
        const ip = xmlTag(stBlock, 'ipAddress');
        proxyOnlineMap.set(id, { online, ipAddress: ip, detectResult });
      }

      const channelsMap = new Map<number, HikvisionChannel>();

      // 1) Digital IP Channels from /ISAPI/ContentMgmt/InputProxy/channels (NVRs like DS-7732NI-I4 / 16P(B))
      for (const chBlock of xmlBlocks(proxyChRes.xml, 'InputProxyChannel')) {
        const id = parseInt(xmlTag(chBlock, 'id'), 10);
        if (!id) continue;
        const name = xmlTag(chBlock, 'name') || `Camera ${String(id).padStart(2, '0')}`;
        const ip = xmlTag(chBlock, 'ipAddress') || proxyOnlineMap.get(id)?.ipAddress || '';
        const proto = xmlTag(chBlock, 'proxyProtocol') || 'HIKVISION';
        const stInfo = proxyOnlineMap.get(id);
        const online = stInfo ? stInfo.online : Boolean(ip);
        const streamMeta = streamInfoByChannel.get(id);

        // On Hikvision -16P PoE NVRs (like DS-7732NI-I4 / 16P(B)), built-in PoE ports use internal 192.168.254.x subnet
        let poePort: number | null = null;
        if (ip.startsWith('192.168.254.')) {
          poePort = id <= 16 ? id : parseInt(ip.split('.')[3], 10) - 1;
        } else if (xmlTag(chBlock, 'poe').toLowerCase() === 'true') {
          poePort = id;
        }

        channelsMap.set(id, {
          id,
          name,
          sourceType: 'ip',
          online,
          recording: online,
          ipAddress: ip || cfg.host,
          model: xmlTag(chBlock, 'model') || (poePort ? `Hikvision PoE #${poePort}` : 'IP Camera'),
          protocol: proto,
          poePort,
          mainStreamId: streamMeta?.mainStreamId ?? id * 100 + 1,
          subStreamId: streamMeta?.subStreamId ?? id * 100 + 2,
          codec: streamMeta?.codec ?? 'H.265',
          resolution: streamMeta?.resolution ?? '1920x1080',
          fps: streamMeta?.fps ?? 25,
          bitrateKbps: streamMeta?.bitrateKbps ?? 4096,
          ptzSupported: ptzChannels.has(id),
        });
      }

      // Include any InputProxyChannelStatus channels not present in InputProxyChannel list
      for (const [id, stInfo] of proxyOnlineMap.entries()) {
        if (channelsMap.has(id)) continue;
        const streamMeta = streamInfoByChannel.get(id);
        const ip = stInfo.ipAddress || '';
        const poePort = ip.startsWith('192.168.254.') && id <= 16 ? id : null;
        channelsMap.set(id, {
          id,
          name: streamMeta?.name || `Camera ${String(id).padStart(2, '0')}`,
          sourceType: 'ip',
          online: stInfo.online,
          recording: stInfo.online,
          ipAddress: ip || cfg.host,
          model: poePort ? `Hikvision PoE #${poePort}` : 'IP Camera',
          protocol: 'HIKVISION',
          poePort,
          mainStreamId: streamMeta?.mainStreamId ?? id * 100 + 1,
          subStreamId: streamMeta?.subStreamId ?? id * 100 + 2,
          codec: streamMeta?.codec ?? 'H.265',
          resolution: streamMeta?.resolution ?? '1920x1080',
          fps: streamMeta?.fps ?? 25,
          bitrateKbps: streamMeta?.bitrateKbps ?? 4096,
          ptzSupported: ptzChannels.has(id),
        });
      }

      // 2) Analog / Local Video Input Channels (DVRs & standalone IP Cameras)
      for (const vBlock of xmlBlocks(analogChRes.xml, 'VideoInputChannel')) {
        const id = parseInt(xmlTag(vBlock, 'id'), 10);
        if (!id || channelsMap.has(id)) continue;
        const enabledRaw = xmlTag(vBlock, 'videoInputEnabled').toLowerCase();
        const resDesc = xmlTag(vBlock, 'resDesc');
        const noVideo = resDesc.toLowerCase() === 'no video' || enabledRaw === 'false';
        const online = deviceType === 'IPCamera' ? true : !noVideo;
        const streamMeta = streamInfoByChannel.get(id);

        channelsMap.set(id, {
          id,
          name: xmlTag(vBlock, 'name') || streamMeta?.name || (deviceType === 'IPCamera' ? deviceName : `Analog CH${id}`),
          sourceType: deviceType === 'IPCamera' ? 'local' : 'analog',
          online,
          recording: online,
          ipAddress: cfg.host,
          model: deviceType === 'IPCamera' ? model : resDesc || 'TurboHD Analog',
          protocol: deviceType === 'IPCamera' ? 'ISAPI' : 'TVI/Analog',
          poePort: null,
          mainStreamId: streamMeta?.mainStreamId ?? id * 100 + 1,
          subStreamId: streamMeta?.subStreamId ?? id * 100 + 2,
          codec: streamMeta?.codec ?? 'H.265',
          resolution: streamMeta?.resolution ?? '1920x1080',
          fps: streamMeta?.fps ?? 25,
          bitrateKbps: streamMeta?.bitrateKbps ?? 4096,
          ptzSupported: ptzChannels.has(id),
        });
      }

      // 3) Fallback: build channels directly from /ISAPI/Streaming/channels if neither InputProxy nor VideoInputs returned entries
      if (channelsMap.size === 0 && streamInfoByChannel.size > 0) {
        for (const [id, streamMeta] of streamInfoByChannel.entries()) {
          channelsMap.set(id, {
            id,
            name: streamMeta.name || `Channel ${id}`,
            sourceType: deviceType === 'IPCamera' ? 'local' : 'ip',
            online: true,
            recording: true,
            ipAddress: cfg.host,
            model,
            protocol: 'ISAPI',
            poePort: null,
            mainStreamId: streamMeta.mainStreamId,
            subStreamId: streamMeta.subStreamId,
            codec: streamMeta.codec,
            resolution: streamMeta.resolution,
            fps: streamMeta.fps,
            bitrateKbps: streamMeta.bitrateKbps,
            ptzSupported: ptzChannels.has(id),
          });
        }
      }

      const channels = Array.from(channelsMap.values()).sort((a, b) => a.id - b.id);
      const onlineChannels = channels.filter((c) => c.online).length;
      const recordingChannels = channels.filter((c) => c.recording).length;

      // Storage / SATA HDDs (/ISAPI/ContentMgmt/Storage/hdd)
      // Note: Hikvision ISAPI reports <capacity> and <freeSpace> in Megabytes (MB)
      const MB = 1024 * 1024;
      const hdds: HikvisionHdd[] = [];
      let storageTotalBytes = 0;
      let storageFreeBytes = 0;

      for (const hBlock of xmlBlocks(hddRes.xml, 'hdd')) {
        const id = parseInt(xmlTag(hBlock, 'id'), 10) || hdds.length + 1;
        const name = xmlTag(hBlock, 'hddName') || `HDD ${id}`;
        const type = xmlTag(hBlock, 'hddType') || 'SATA';
        const rawStatus = (xmlTag(hBlock, 'status') || 'ok').toLowerCase();
        const status: HikvisionHdd['status'] =
          rawStatus === 'ok' || rawStatus === 'normal'
            ? 'ok'
            : rawStatus.includes('sleep')
              ? 'sleeping'
              : rawStatus.includes('unformat') || rawStatus.includes('notexist')
                ? 'unformatted'
                : rawStatus.includes('err') || rawStatus.includes('exception') || rawStatus.includes('smartFailed')
                  ? 'error'
                  : 'unknown';
        const capMb = parseFloat(xmlTag(hBlock, 'capacity')) || 0;
        const freeMb = parseFloat(xmlTag(hBlock, 'freeSpace')) || 0;
        const capacityBytes = Math.round(capMb * MB);
        const freeBytes = Math.min(capacityBytes, Math.round(freeMb * MB));
        const usedBytes = Math.max(0, capacityBytes - freeBytes);
        const usedPercent = capacityBytes > 0 ? Math.round((usedBytes / capacityBytes) * 1000) / 10 : 0;

        storageTotalBytes += capacityBytes;
        storageFreeBytes += freeBytes;

        hdds.push({
          id,
          name,
          type,
          status,
          statusText: rawStatus.toUpperCase(),
          capacityBytes,
          freeBytes,
          usedBytes,
          usedPercent,
          property: xmlTag(hBlock, 'property') || 'RW',
        });
      }

      const storageUsedBytes = Math.max(0, storageTotalBytes - storageFreeBytes);
      const storagePercent =
        storageTotalBytes > 0 ? Math.round((storageUsedBytes / storageTotalBytes) * 1000) / 10 : 0;

      const totalBitrateBps = channels
        .filter((c) => c.online)
        .reduce((acc, c) => acc + (c.bitrateKbps * 1000) / 8, 0);

      const point: TelemetryPoint = {
        timestamp: now,
        cpuPercent,
        memPercent,
        netRxBps: Math.round(totalBitrateBps),
        netTxBps: 0,
      };
      const nextHist = [...prevHist.slice(-49), point];
      this.history.set(cfg.id, nextHist);

      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        status: 'online',
        collectedAt: now,
        deviceName,
        deviceType,
        model,
        serialNumber,
        firmwareVersion,
        firmwareBuild,
        macAddress,
        uptimeSeconds,
        cpuPercent,
        memPercent,
        totalChannels: channels.length,
        onlineChannels,
        recordingChannels,
        storageTotalBytes,
        storageUsedBytes,
        storageFreeBytes,
        storagePercent,
        channels,
        hdds,
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
        deviceName: cfg.name,
        deviceType: cfg.deviceKind === 'dvr' ? 'DVR' : cfg.deviceKind === 'camera' ? 'IPCamera' : 'NVR',
        model: '-',
        serialNumber: '-',
        firmwareVersion: '-',
        firmwareBuild: '',
        macAddress: '',
        uptimeSeconds: 0,
        cpuPercent: 0,
        memPercent: 0,
        totalChannels: 0,
        onlineChannels: 0,
        recordingChannels: 0,
        storageTotalBytes: 0,
        storageUsedBytes: 0,
        storageFreeBytes: 0,
        storagePercent: 0,
        channels: [],
        hdds: [],
        history: prevHist,
      };
    }
  }

  /**
   * Fetches a live JPEG frame for a channel via ISAPI Digest Auth with multi-stream fallbacks
   * and optional RTSP FFmpeg single-frame extraction fallback.
   */
  async fetchChannelFrame(
    cfg: HikvisionConfig,
    channelId: number,
    streamKind: 'sub' | 'main' = 'sub',
  ): Promise<{ contentType: string; buffer: Buffer }> {
    const frameKey = `${cfg.id}:${channelId}:${streamKind}`;
    const now = Date.now();
    const cached = this.frameCache.get(frameKey);
    if (cached && now - cached.timestamp < 180) {
      return { contentType: cached.contentType, buffer: cached.buffer };
    }

    const inflight = this.inflightFrames.get(frameKey);
    if (inflight) return inflight;

    const task = (async (): Promise<{ contentType: string; buffer: Buffer }> => {
      const mainId = channelId * 100 + 1;
      const subId = channelId * 100 + 2;
      const candidatePaths =
        streamKind === 'main'
          ? [
              `/ISAPI/Streaming/channels/${mainId}/picture`,
              `/ISAPI/Streaming/channels/${subId}/picture`,
              `/ISAPI/Streaming/channels/${channelId}/picture`,
            ]
          : [
              `/ISAPI/Streaming/channels/${subId}/picture`,
              `/ISAPI/Streaming/channels/${mainId}/picture?videoResolutionWidth=960&videoResolutionHeight=540`,
              `/ISAPI/Streaming/channels/${mainId}/picture`,
              `/ISAPI/Streaming/channels/${channelId}/picture`,
            ];

      for (const pathCandidate of candidatePaths) {
        try {
          const res = await this.requestIsapi(cfg, 'GET', pathCandidate, undefined, 5500);
          const ct = String(res.headers['content-type'] || '').toLowerCase();
          const isJpeg =
            res.statusCode >= 200 &&
            res.statusCode < 300 &&
            res.body.length > 256 &&
            (ct.includes('image') || (res.body[0] === 0xff && res.body[1] === 0xd8));
          if (isJpeg) {
            const out = { contentType: 'image/jpeg', buffer: res.body };
            this.frameCache.set(frameKey, { timestamp: Date.now(), ...out });
            return out;
          }
        } catch {
          // try next candidate
        }
      }

      // Fallback: grab single frame from RTSP stream via FFmpeg if installed
      const ffmpegBin = resolveFfmpegBinary();
      if (ffmpegBin) {
        const rtspFrame = await this.grabRtspFrameWithFfmpeg(
          ffmpegBin,
          cfg,
          streamKind === 'main' ? mainId : subId,
        ).catch(() => null);
        if (rtspFrame && rtspFrame.length > 256) {
          const out = { contentType: 'image/jpeg', buffer: rtspFrame };
          this.frameCache.set(frameKey, { timestamp: Date.now(), ...out });
          return out;
        }
      }

      throw new Error(`No live frame returned for channel ${channelId}`);
    })();

    this.inflightFrames.set(frameKey, task);
    try {
      return await task;
    } finally {
      this.inflightFrames.delete(frameKey);
    }
  }

  private grabRtspFrameWithFfmpeg(
    ffmpegBin: string,
    cfg: HikvisionConfig,
    streamId: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const user = encodeURIComponent(cfg.username || 'admin');
      const pass = encodeURIComponent(cfg.password || '');
      const rtspPort = cfg.rtspPort || 554;
      const rtspUrl = `rtsp://${user}:${pass}@${cfg.host}:${rtspPort}/Streaming/Channels/${streamId}`;

      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-rtsp_transport',
        'tcp',
        '-i',
        rtspUrl,
        '-frames:v',
        '1',
        '-vf',
        'scale=960:-1',
        '-q:v',
        '5',
        '-f',
        'image2',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ];

      const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'ignore'] });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('RTSP snapshot timed out'));
      }, 6000);

      proc.stdout.on('data', (c: Buffer) => chunks.push(c));
      proc.on('close', (code) => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        if (code === 0 && buf.length > 256) resolve(buf);
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Streams continuous multipart/x-mixed-replace MJPEG video for a channel,
   * using either RTSP -> FFmpeg (high-FPS) or ISAPI continuous frame pumping.
   */
  async streamChannelMjpeg(
    cfg: HikvisionConfig,
    channelId: number,
    options: { streamKind: 'sub' | 'main'; mode: 'isapi' | 'rtsp'; fps: number },
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const boundary = 'rackpanelframe';
    res.writeHead(200, {
      'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, pre-check=0, post-check=0, max-age=0',
      Pragma: 'no-cache',
      Connection: 'close',
    });

    const ffmpegBin = options.mode === 'rtsp' ? resolveFfmpegBinary() : null;
    if (ffmpegBin) {
      const streamId = channelId * 100 + (options.streamKind === 'main' ? 1 : 2);
      const user = encodeURIComponent(cfg.username || 'admin');
      const pass = encodeURIComponent(cfg.password || '');
      const rtspUrl = `rtsp://${user}:${pass}@${cfg.host}:${cfg.rtspPort || 554}/Streaming/Channels/${streamId}`;
      const fps = Math.max(1, Math.min(15, options.fps || 8));

      const proc = spawn(
        ffmpegBin,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-rtsp_transport',
          'tcp',
          '-i',
          rtspUrl,
          '-an',
          '-vf',
          options.streamKind === 'main' ? 'scale=1280:-1' : 'scale=854:-1',
          '-r',
          String(fps),
          '-q:v',
          '6',
          '-f',
          'mpjpeg',
          '-boundary_tag',
          boundary,
          'pipe:1',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );

      proc.stdout.on('data', (chunk: Buffer) => {
        if (!res.writableEnded) res.write(chunk);
      });

      const cleanup = () => {
        if (!proc.killed) proc.kill('SIGKILL');
      };
      req.on('close', cleanup);
      res.on('close', cleanup);
      proc.on('close', () => {
        if (!res.writableEnded) res.end();
      });
      return;
    }

    // ISAPI frame pump mode (works everywhere with zero external binaries)
    let closed = false;
    const intervalMs = Math.max(250, Math.round(1000 / Math.max(0.5, Math.min(4, options.fps || 2))));
    req.on('close', () => {
      closed = true;
    });
    res.on('close', () => {
      closed = true;
    });

    while (!closed && !res.writableEnded) {
      const started = Date.now();
      try {
        const frame = await this.fetchChannelFrame(cfg, channelId, options.streamKind);
        if (closed || res.writableEnded) break;
        res.write(
          `--${boundary}\r\nContent-Type: ${frame.contentType}\r\nContent-Length: ${frame.buffer.length}\r\n\r\n`,
        );
        res.write(frame.buffer);
        res.write('\r\n');
      } catch {
        // skip dropped frame
      }
      const elapsed = Date.now() - started;
      const wait = Math.max(80, intervalMs - elapsed);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  /**
   * Sends ISAPI PTZ continuous movement command (pan/tilt/zoom in -100..100).
   */
  async ptzControl(
    cfg: HikvisionConfig,
    channelId: number,
    pan: number,
    tilt: number,
    zoom: number,
  ): Promise<{ ok: boolean; message: string }> {
    const p = Math.max(-100, Math.min(100, Math.round(pan)));
    const t = Math.max(-100, Math.min(100, Math.round(tilt)));
    const z = Math.max(-100, Math.min(100, Math.round(zoom)));
    const xml = `<?xml version="1.0" encoding="UTF-8"?><PTZData><pan>${p}</pan><tilt>${t}</tilt><zoom>${z}</zoom></PTZData>`;
    const res = await this.requestIsapi(
      cfg,
      'PUT',
      `/ISAPI/PTZCtrl/channels/${encodeURIComponent(String(channelId))}/continuous`,
      xml,
    );
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return { ok: true, message: 'PTZ command sent' };
    }
    return {
      ok: false,
      message: `PTZ returned HTTP ${res.statusCode}`,
    };
  }
}
