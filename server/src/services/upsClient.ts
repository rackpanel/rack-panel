import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ConnectionTestResult,
  UpsConfig,
  UpsModelPreset,
  UpsSnapshot,
} from '../../../shared/types.js';
import { snmpGet, snmpValToString } from './snmpClient.js';

export interface UpsPresetSpec {
  id: UpsModelPreset;
  label: string;
  manufacturer: string;
  model: string;
  ratedVa: number;
  ratedWatts: number;
  nominalVoltage: number;
  heightU: number;
  outletCount: number;
}

export const UPS_MODEL_PRESETS: Record<UpsModelPreset, UpsPresetSpec> = {
  auto: {
    id: 'auto',
    label: 'Auto-Detect (SNMP RFC 1628 / Eaton / APC / NUT)',
    manufacturer: 'UPS',
    model: 'Managed UPS',
    ratedVa: 1500,
    ratedWatts: 1350,
    nominalVoltage: 230,
    heightU: 2,
    outletCount: 8,
  },
  'ibm-3000va-2700w-hv': {
    id: 'ibm-3000va-2700w-hv',
    label: 'IBM 3000VA/2700W Rack HV UPS (2U)',
    manufacturer: 'IBM / Eaton',
    model: 'IBM 3000VA/2700W Rack HV UPS',
    ratedVa: 3000,
    ratedWatts: 2700,
    nominalVoltage: 230,
    heightU: 2,
    outletCount: 8,
  },
  'tesla-powerwall-2': {
    id: 'tesla-powerwall-2',
    label: 'Tesla Powerwall 2 / + (5kW · 13.5kWh)',
    manufacturer: 'Tesla Energy',
    model: 'Tesla Powerwall 2 (13.5 kWh)',
    ratedVa: 5000,
    ratedWatts: 5000,
    nominalVoltage: 240,
    heightU: 0,
    outletCount: 0,
  },
  'tesla-powerwall-3': {
    id: 'tesla-powerwall-3',
    label: 'Tesla Powerwall 3 (11.5kW · 13.5kWh)',
    manufacturer: 'Tesla Energy',
    model: 'Tesla Powerwall 3 (13.5 kWh)',
    ratedVa: 11500,
    ratedWatts: 11500,
    nominalVoltage: 240,
    heightU: 0,
    outletCount: 0,
  },
  'apc-smartups': {
    id: 'apc-smartups',
    label: 'APC Smart-UPS Rackmount',
    manufacturer: 'APC / Schneider Electric',
    model: 'Smart-UPS RM',
    ratedVa: 1500,
    ratedWatts: 1350,
    nominalVoltage: 230,
    heightU: 2,
    outletCount: 6,
  },
  'eaton-5px': {
    id: 'eaton-5px',
    label: 'Eaton 5PX / 9PX Rack UPS',
    manufacturer: 'Eaton',
    model: 'Eaton 5PX / 9PX',
    ratedVa: 2200,
    ratedWatts: 1980,
    nominalVoltage: 230,
    heightU: 2,
    outletCount: 8,
  },
  cyberpower: {
    id: 'cyberpower',
    label: 'CyberPower OR / PR Rack UPS',
    manufacturer: 'CyberPower',
    model: 'CyberPower PR Rackmount',
    ratedVa: 1500,
    ratedWatts: 1350,
    nominalVoltage: 230,
    heightU: 2,
    outletCount: 8,
  },
  'generic-rfc1628': {
    id: 'generic-rfc1628',
    label: 'Generic RFC 1628 SNMP / NUT UPS',
    manufacturer: 'Generic',
    model: 'RFC 1628 UPS',
    ratedVa: 1500,
    ratedWatts: 1200,
    nominalVoltage: 230,
    heightU: 2,
    outletCount: 6,
  },
};

function snmpNum(val: string | number | Buffer | null | undefined): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function snmpGetWithFallback(
  host: string,
  port: number,
  community: string,
  oid: string,
  version: '1' | '2c',
  timeoutMs = 1500,
): Promise<string | number | Buffer | null> {
  const primaryVer = version === '1' ? 0 : 1;
  const vb = await snmpGet(host, community, oid, port, timeoutMs, primaryVer);
  if (vb && vb.value !== null && vb.value !== undefined) return vb.value;
  if (version === '2c') {
    const vb1 = await snmpGet(host, community, oid, port, timeoutMs, 0);
    if (vb1 && vb1.value !== null && vb1.value !== undefined) return vb1.value;
  }
  return null;
}

function queryNutServer(
  host: string,
  port = 3493,
  upsName?: string,
  timeoutMs = 2500,
): Promise<{ upsName: string; vars: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let buffer = '';
    let phase: 'list_ups' | 'list_var' = upsName ? 'list_var' : 'list_ups';
    let targetUps = (upsName || '').trim();
    let settled = false;

    const finish = (err?: Error, result?: { upsName: string; vars: Record<string, string> }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else if (result) resolve(result);
    };

    const timer = setTimeout(() => finish(new Error('NUT connection timed out')), timeoutMs);

    socket.on('error', (err) => {
      clearTimeout(timer);
      finish(err);
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (phase === 'list_ups') {
        if (buffer.includes('END LIST UPS')) {
          const m = buffer.match(/UPS\s+(\S+)\s+/);
          if (!m) {
            clearTimeout(timer);
            finish(new Error('No UPS found on NUT server'));
            return;
          }
          targetUps = m[1];
          phase = 'list_var';
          buffer = '';
          socket.write(`LIST VAR ${targetUps}\n`);
        } else if (buffer.includes('ERR ')) {
          clearTimeout(timer);
          finish(new Error(buffer.trim()));
        }
      } else if (phase === 'list_var') {
        if (buffer.includes('END LIST VAR')) {
          clearTimeout(timer);
          const vars: Record<string, string> = {};
          for (const line of buffer.split(/\r?\n/)) {
            const m = line.match(/^VAR\s+\S+\s+(\S+)\s+"(.*)"$/);
            if (m) vars[m[1]] = m[2];
          }
          finish(undefined, { upsName: targetUps, vars });
        } else if (buffer.includes('ERR ')) {
          clearTimeout(timer);
          finish(new Error(buffer.trim()));
        }
      }
    });

    socket.connect(port, host, () => {
      if (phase === 'list_ups') {
        socket.write('LIST UPS\n');
      } else {
        socket.write(`LIST VAR ${targetUps}\n`);
      }
    });
  });
}

function powerwallRequest(
  host: string,
  port: number,
  method: 'GET' | 'POST',
  reqPath: string,
  body?: unknown,
  cookieHeader?: string,
  timeoutMs = 3500,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname: host,
        port,
        path: reqPath,
        method,
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          if (raw.length < 131072) raw += chunk.toString('utf8');
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, data: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Tesla Powerwall Gateway timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function teslaCloudGet(
  host: string,
  reqPath: string,
  bearerToken: string,
  timeoutMs = 5000,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        port: 443,
        path: reqPath,
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          if (raw.length < 262144) raw += chunk.toString('utf8');
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Tesla Cloud API timed out')));
    req.on('error', reject);
    req.end();
  });
}

function teslaAuthPost(body: Record<string, string>, timeoutMs = 8000): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        hostname: 'auth.tesla.com',
        port: 443,
        path: '/oauth2/v3/token',
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          Accept: 'application/json',
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          if (raw.length < 131072) raw += chunk.toString('utf8');
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Tesla auth.tesla.com timed out')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

const TESLA_REDIRECT_URI = 'https://auth.tesla.com/void/callback';
const TESLA_CLIENT_ID = 'ownerapi';

const __upsFilename = fileURLToPath(import.meta.url);
const __upsDirname = path.dirname(__upsFilename);
const DATA_DIR = path.resolve(__upsDirname, '../../data');
const TESLA_PRIV_KEY_PATH = path.join(DATA_DIR, 'tesla-partner-private.pem');
const TESLA_PUB_KEY_PATH = path.join(DATA_DIR, 'tesla-partner-public.pem');

export function getOrCreateTeslaPartnerPublicKeyPem(): string {
  try {
    if (fs.existsSync(TESLA_PUB_KEY_PATH)) {
      const existing = fs.readFileSync(TESLA_PUB_KEY_PATH, 'utf8').trim();
      if (existing.includes('BEGIN PUBLIC KEY')) return `${existing}\n`;
    }
  } catch {
    // generate fresh keypair below
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TESLA_PRIV_KEY_PATH, privateKey, { mode: 0o600 });
    fs.writeFileSync(TESLA_PUB_KEY_PATH, publicKey, { mode: 0o644 });
  } catch {
    // non-fatal if directory is read-only
  }
  return publicKey;
}

function httpsJsonRequest(
  hostname: string,
  reqPath: string,
  method: 'GET' | 'POST',
  body?: unknown,
  bearerToken?: string,
  timeoutMs = 10000,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = https.request(
      {
        hostname,
        port: 443,
        path: reqPath,
        method,
        timeout: timeoutMs,
        headers: {
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          if (raw.length < 262144) raw += chunk.toString('utf8');
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${hostname} timed out`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export class UpsClient {
  private pendingTeslaAuth = new Map<
    string,
    { codeVerifier: string; clientId: string; redirectUri: string; createdAt: number }
  >();

  startTeslaOAuthPkce(clientId?: string, redirectUri?: string): { authUrl: string; state: string } {
    const now = Date.now();
    for (const [k, v] of this.pendingTeslaAuth.entries()) {
      if (now - v.createdAt > 10 * 60_000) this.pendingTeslaAuth.delete(k);
    }

    const cleanClientId = (clientId || '').trim() || TESLA_CLIENT_ID;
    const cleanRedirectUri = (redirectUri || '').trim() || TESLA_REDIRECT_URI;
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('base64url');

    this.pendingTeslaAuth.set(state, {
      codeVerifier,
      clientId: cleanClientId,
      redirectUri: cleanRedirectUri,
      createdAt: now,
    });

    const scope =
      cleanClientId === TESLA_CLIENT_ID
        ? 'openid email offline_access'
        : 'openid offline_access energy_device_data';

    const params = new URLSearchParams({
      client_id: cleanClientId,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: cleanRedirectUri,
      response_type: 'code',
      scope,
      state,
    });

    return {
      authUrl: `https://auth.tesla.com/oauth2/v3/authorize?${params.toString()}`,
      state,
    };
  }

  async exchangeTeslaOAuthCallback(
    callbackUrlOrCode: string,
    expectedState?: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; isFleetApi: boolean }> {
    const trimmed = callbackUrlOrCode.trim();
    if (!trimmed) throw new Error('Callback URL is required');

    let code = '';
    let state = expectedState || '';
    try {
      const parsedUrl = new URL(trimmed);
      code = parsedUrl.searchParams.get('code') || '';
      state = parsedUrl.searchParams.get('state') || state;
    } catch {
      const mCode = trimmed.match(/[?&]code=([^&]+)/);
      const mState = trimmed.match(/[?&]state=([^&]+)/);
      code = mCode ? decodeURIComponent(mCode[1]) : trimmed;
      if (mState) state = decodeURIComponent(mState[1]);
    }

    if (!code) throw new Error('No authorization code found in callback URL');
    const pending = state ? this.pendingTeslaAuth.get(state) : undefined;
    if (!pending) {
      throw new Error('OAuth session expired or invalid state — click "1. Open Tesla Login" again');
    }
    this.pendingTeslaAuth.delete(state);

    const res = await teslaAuthPost({
      grant_type: 'authorization_code',
      client_id: pending.clientId,
      code,
      code_verifier: pending.codeVerifier,
      redirect_uri: pending.redirectUri,
    });

    if (res.status >= 400 || !res.data?.access_token) {
      throw new Error(
        res.data?.error_description || res.data?.error || `Tesla token exchange failed (HTTP ${res.status})`,
      );
    }

    return {
      accessToken: String(res.data.access_token),
      refreshToken: String(res.data.refresh_token || ''),
      expiresIn: Number(res.data.expires_in) || 28800,
      isFleetApi: pending.clientId !== TESLA_CLIENT_ID,
    };
  }

  async refreshTeslaOAuthToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const res = await teslaAuthPost({
      grant_type: 'refresh_token',
      client_id: TESLA_CLIENT_ID,
      refresh_token: refreshToken,
    });
    if (res.status >= 400 || !res.data?.access_token) {
      throw new Error(res.data?.error_description || `Tesla token refresh failed (HTTP ${res.status})`);
    }
    return {
      accessToken: String(res.data.access_token),
      refreshToken: String(res.data.refresh_token || refreshToken),
      expiresIn: Number(res.data.expires_in) || 28800,
    };
  }

  async registerTeslaPartnerAccount(input: {
    clientId: string;
    clientSecret: string;
    domain: string;
    regionHost?: string;
  }): Promise<{ ok: boolean; message: string; publicKeyPem: string }> {
    const clientId = input.clientId.trim();
    const clientSecret = input.clientSecret.trim();
    const domain = input.domain
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');
    const regionHost = (input.regionHost || 'fleet-api.prd.eu.vn.cloud.tesla.com')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '');

    if (!clientId || !clientSecret || !domain) {
      throw new Error('Client ID, Client Secret, and Domain are all required');
    }

    const publicKeyPem = getOrCreateTeslaPartnerPublicKeyPem();

    const tokenRes = await httpsJsonRequest(
      'fleet-auth.prd.vn.cloud.tesla.com',
      '/oauth2/v3/token',
      'POST',
      {
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'openid energy_device_data',
        audience: `https://${regionHost}`,
      },
    );

    if (tokenRes.status >= 400 || !tokenRes.data?.access_token) {
      throw new Error(
        tokenRes.data?.error_description ||
          tokenRes.data?.error ||
          `Failed to obtain partner token (HTTP ${tokenRes.status})`,
      );
    }

    const partnerToken = String(tokenRes.data.access_token);
    const regRes = await httpsJsonRequest(
      regionHost,
      '/api/1/partner_accounts',
      'POST',
      { domain },
      partnerToken,
    );

    if (regRes.status >= 400) {
      const detail =
        typeof regRes.data === 'object'
          ? regRes.data?.error || regRes.data?.message || JSON.stringify(regRes.data)
          : String(regRes.data || '');
      throw new Error(`Partner registration failed (HTTP ${regRes.status}): ${detail}`);
    }

    return {
      ok: true,
      message: `Partner account registered for ${domain} in ${regionHost}`,
      publicKeyPem,
    };
  }
  async testConnection(cfg: UpsConfig): Promise<ConnectionTestResult> {
    try {
      const snap = await this.collect(cfg);
      if (snap.status === 'error' || snap.status === 'offline') {
        return {
          ok: false,
          message: snap.errorMessage || 'Unable to reach UPS',
        };
      }
      return {
        ok: true,
        message: `Connected: ${snap.manufacturer} ${snap.model} · Battery ${snap.batteryChargePercent ?? '?'}% · Load ${snap.outputLoadPercent ?? '?'}%`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async collect(
    cfg: UpsConfig,
    onTokenRefresh?: (tokens: { accessToken: string; refreshToken: string }) => void,
  ): Promise<UpsSnapshot> {
    const now = Date.now();
    const preset = UPS_MODEL_PRESETS[cfg.modelPreset] || UPS_MODEL_PRESETS['ibm-3000va-2700w-hv'];
    const ratedVa = cfg.ratedVa || preset.ratedVa;
    const ratedWatts = cfg.ratedWatts || preset.ratedWatts;

    if (cfg.id.startsWith('demo-')) {
      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        protocol: cfg.protocol,
        model: preset.model,
        manufacturer: preset.manufacturer,
        serialNumber: 'IBM-3000HV-2U-8842',
        firmwareVersion: 'NMC v4.12',
        status: 'online',
        outputSource: 'normal',
        batteryChargePercent: 100,
        estimatedRuntimeMinutes: 46,
        batteryVoltage: 72.4,
        batteryTempC: 27,
        inputVoltage: 232,
        inputFrequencyHz: 50.0,
        outputVoltage: 230,
        outputLoadPercent: 24,
        outputWatts: Math.round(ratedWatts * 0.24),
        ratedVa,
        ratedWatts,
        alarmsCount: 0,
        isDemo: true,
        collectedAt: now,
      };
    }

    if (cfg.protocol === 'powerwall-cloud') {
      try {
        const apiHost = (cfg.host || 'owner-api.teslamotors.com')
          .replace(/^https?:\/\//, '')
          .replace(/\/.*$/, '');
        let token = (cfg.password || '').trim();
        const refreshToken = (cfg.community || '').trim();
        if (!token && refreshToken && refreshToken !== 'public') {
          const refreshed = await this.refreshTeslaOAuthToken(refreshToken);
          token = refreshed.accessToken;
          onTokenRefresh?.({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken });
        }
        if (!token) {
          throw new Error('Tesla Cloud API Access Token is required (use Sign in with Tesla)');
        }

        const cloudGetWithRefresh = async (reqPath: string) => {
          let resp = await teslaCloudGet(apiHost, reqPath, token);
          if (resp.status === 401 && refreshToken && refreshToken !== 'public') {
            const refreshed = await this.refreshTeslaOAuthToken(refreshToken);
            token = refreshed.accessToken;
            onTokenRefresh?.({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken });
            resp = await teslaCloudGet(apiHost, reqPath, token);
          }
          return resp;
        };

        let siteId = (cfg.upsName || '').trim();
        let siteName = '';
        if (!siteId) {
          const prodRes = await cloudGetWithRefresh('/api/1/products');
          if (prodRes.status >= 400) {
            const detail = prodRes.data?.error ? ` (${prodRes.data.error})` : '';
            throw new Error(
              prodRes.status === 401
                ? 'Tesla Cloud token expired or unauthorized (HTTP 401)'
                : prodRes.status === 412
                  ? `Tesla Fleet API Partner Registration required for this region (HTTP 412${detail})`
                  : `Tesla Cloud /api/1/products failed (HTTP ${prodRes.status}${detail})`,
            );
          }
          const items: any[] = Array.isArray(prodRes.data?.response) ? prodRes.data.response : [];
          const batterySite = items.find(
            (p) => p && (p.resource_type === 'battery' || p.energy_site_id !== undefined),
          );
          if (!batterySite || !batterySite.energy_site_id) {
            throw new Error('No Powerwall energy site found on this Tesla account');
          }
          siteId = String(batterySite.energy_site_id);
          siteName = String(batterySite.site_name || '');
        }

        const [liveRes, infoRes] = await Promise.all([
          cloudGetWithRefresh(`/api/1/energy_sites/${encodeURIComponent(siteId)}/live_status`),
          cloudGetWithRefresh(`/api/1/energy_sites/${encodeURIComponent(siteId)}/site_info`).catch(() => null),
        ]);

        if (liveRes.status >= 400) {
          throw new Error(
            liveRes.status === 401
              ? 'Tesla Cloud token expired or unauthorized (HTTP 401)'
              : `Tesla Cloud live_status failed (HTTP ${liveRes.status})`,
          );
        }

        const live = liveRes.data?.response ?? {};
        const info = infoRes?.data?.response ?? {};
        const chargePct =
          typeof live.percentage_charged === 'number' ? Math.round(live.percentage_charged * 10) / 10 : null;
        const loadWatts = typeof live.load_power === 'number' ? Math.round(live.load_power) : null;
        const solarWatts = typeof live.solar_power === 'number' ? Math.round(live.solar_power) : null;
        const gridWatts = typeof live.grid_power === 'number' ? Math.round(live.grid_power) : null;
        const battWatts = typeof live.battery_power === 'number' ? Math.round(live.battery_power) : null;
        const nameplateEnergy =
          typeof info.nameplate_energy === 'number' && info.nameplate_energy > 0 ? info.nameplate_energy : 13500;
        const nameplatePower =
          typeof info.nameplate_power === 'number' && info.nameplate_power > 0 ? info.nameplate_power : ratedWatts;

        const gridStatusStr = String(live.grid_status || live.island_status || 'Active');
        const islanded = /inactive|island/i.test(gridStatusStr);
        const discharging = islanded || (battWatts !== null && battWatts > 50);
        const loadPct =
          loadWatts !== null && nameplatePower > 0 ? Math.min(100, Math.round((loadWatts / nameplatePower) * 100)) : null;
        const estRuntimeMin =
          chargePct !== null && loadWatts !== null && loadWatts > 20
            ? Math.round((((chargePct / 100) * nameplateEnergy) / loadWatts) * 60)
            : null;

        return {
          configId: cfg.id,
          name: cfg.name,
          host: apiHost,
          protocol: 'powerwall-cloud',
          model: siteName ? `${preset.model} · ${siteName}` : preset.model,
          manufacturer: 'Tesla Energy',
          serialNumber: siteId,
          firmwareVersion: String(info.version || 'Tesla Fleet API'),
          status: islanded ? ((chargePct ?? 100) < 15 ? 'low-battery' : 'on-battery') : 'online',
          outputSource: discharging ? 'battery' : 'normal',
          batteryChargePercent: chargePct,
          estimatedRuntimeMinutes: estRuntimeMin,
          batteryVoltage: null,
          batteryTempC: null,
          inputVoltage: islanded ? 0 : preset.nominalVoltage,
          inputFrequencyHz: 50,
          outputVoltage: preset.nominalVoltage,
          outputLoadPercent: loadPct,
          outputWatts: loadWatts,
          solarWatts,
          gridWatts,
          batteryWatts: battWatts,
          gridStatus: gridStatusStr,
          ratedVa,
          ratedWatts: nameplatePower,
          alarmsCount: islanded ? 1 : 0,
          collectedAt: now,
        };
      } catch (err) {
        return {
          configId: cfg.id,
          name: cfg.name,
          host: cfg.host || 'fleet-api.prd.eu.vn.cloud.tesla.com',
          protocol: 'powerwall-cloud',
          model: preset.model,
          manufacturer: 'Tesla Energy',
          serialNumber: '',
          firmwareVersion: '',
          status: 'offline',
          outputSource: 'unknown',
          batteryChargePercent: null,
          estimatedRuntimeMinutes: null,
          batteryVoltage: null,
          batteryTempC: null,
          inputVoltage: null,
          inputFrequencyHz: null,
          outputVoltage: null,
          outputLoadPercent: null,
          outputWatts: null,
          ratedVa,
          ratedWatts,
          alarmsCount: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
          collectedAt: now,
        };
      }
    }

    if (cfg.protocol === 'powerwall') {
      try {
        const port = cfg.port || 443;
        let cookieHeader = '';
        if (cfg.password) {
          const loginRes = await powerwallRequest(cfg.host, port, 'POST', '/api/login/Basic', {
            username: 'customer',
            password: cfg.password,
            email: 'customer@tesla.com',
            force_sm_off: false,
          });
          if (loginRes.status >= 400) {
            throw new Error(`Powerwall login failed (HTTP ${loginRes.status})`);
          }
          const setCookies = loginRes.headers['set-cookie'];
          if (Array.isArray(setCookies) && setCookies.length > 0) {
            cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
          } else if (loginRes.data?.token) {
            cookieHeader = `AuthCookie=${loginRes.data.token}`;
          }
        }

        const [soeRes, aggRes, gridRes, statusRes] = await Promise.all([
          powerwallRequest(cfg.host, port, 'GET', '/api/system_status/soe', undefined, cookieHeader),
          powerwallRequest(cfg.host, port, 'GET', '/api/meters/aggregates', undefined, cookieHeader),
          powerwallRequest(cfg.host, port, 'GET', '/api/system_status/grid_status', undefined, cookieHeader).catch(
            () => null,
          ),
          powerwallRequest(cfg.host, port, 'GET', '/api/status', undefined, cookieHeader).catch(() => null),
        ]);

        if (soeRes.status >= 400 && aggRes.status >= 400) {
          throw new Error(
            soeRes.status === 401 || soeRes.status === 403
              ? 'Powerwall authentication required — enter Gateway customer password'
              : `Powerwall API error (HTTP ${soeRes.status || aggRes.status})`,
          );
        }

        const chargePct =
          typeof soeRes.data?.percentage === 'number' ? Math.round(soeRes.data.percentage * 10) / 10 : null;
        const loadWatts =
          typeof aggRes.data?.load?.instant_power === 'number' ? Math.round(aggRes.data.load.instant_power) : null;
        const siteWatts =
          typeof aggRes.data?.site?.instant_power === 'number' ? Math.round(aggRes.data.site.instant_power) : null;
        const battWatts =
          typeof aggRes.data?.battery?.instant_power === 'number'
            ? Math.round(aggRes.data.battery.instant_power)
            : null;
        const solarWatts =
          typeof aggRes.data?.solar?.instant_power === 'number' ? Math.round(aggRes.data.solar.instant_power) : null;
        const siteVolt =
          typeof aggRes.data?.site?.instant_average_voltage === 'number'
            ? Math.round(aggRes.data.site.instant_average_voltage * 10) / 10
            : null;
        const loadVolt =
          typeof aggRes.data?.load?.instant_average_voltage === 'number'
            ? Math.round(aggRes.data.load.instant_average_voltage * 10) / 10
            : siteVolt;
        const freq =
          typeof aggRes.data?.site?.frequency === 'number'
            ? Math.round(aggRes.data.site.frequency * 10) / 10
            : null;

        const gridStatusStr = String(gridRes?.data?.grid_status || 'SystemGridConnected');
        const islanded = /islanded/i.test(gridStatusStr);
        const discharging = islanded || (battWatts !== null && battWatts > 50);
        const loadPct =
          loadWatts !== null && ratedWatts > 0 ? Math.min(100, Math.round((loadWatts / ratedWatts) * 100)) : null;
        const estRuntimeMin =
          chargePct !== null && loadWatts !== null && loadWatts > 20
            ? Math.round((((chargePct / 100) * 13500) / loadWatts) * 60)
            : null;

        return {
          configId: cfg.id,
          name: cfg.name,
          host: cfg.host,
          protocol: 'powerwall',
          model: preset.model,
          manufacturer: 'Tesla Energy',
          serialNumber: String(statusRes?.data?.din || ''),
          firmwareVersion: String(statusRes?.data?.version || ''),
          status: islanded ? ((chargePct ?? 100) < 15 ? 'low-battery' : 'on-battery') : 'online',
          outputSource: discharging ? 'battery' : 'normal',
          batteryChargePercent: chargePct,
          estimatedRuntimeMinutes: estRuntimeMin,
          batteryVoltage: null,
          batteryTempC: null,
          inputVoltage: islanded ? 0 : siteVolt,
          inputFrequencyHz: freq,
          outputVoltage: loadVolt,
          outputLoadPercent: loadPct,
          outputWatts: loadWatts,
          solarWatts,
          gridWatts: siteWatts,
          batteryWatts: battWatts,
          gridStatus: gridStatusStr,
          ratedVa,
          ratedWatts,
          alarmsCount: islanded ? 1 : 0,
          collectedAt: now,
        };
      } catch (err) {
        return {
          configId: cfg.id,
          name: cfg.name,
          host: cfg.host,
          protocol: 'powerwall',
          model: preset.model,
          manufacturer: 'Tesla Energy',
          serialNumber: '',
          firmwareVersion: '',
          status: 'offline',
          outputSource: 'unknown',
          batteryChargePercent: null,
          estimatedRuntimeMinutes: null,
          batteryVoltage: null,
          batteryTempC: null,
          inputVoltage: null,
          inputFrequencyHz: null,
          outputVoltage: null,
          outputLoadPercent: null,
          outputWatts: null,
          ratedVa,
          ratedWatts,
          alarmsCount: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
          collectedAt: now,
        };
      }
    }

    if (cfg.protocol === 'nut') {
      try {
        const { upsName, vars } = await queryNutServer(cfg.host, cfg.port || 3493, cfg.upsName);
        const statusStr = (vars['ups.status'] || '').toUpperCase();
        const isLow = statusStr.includes('LB');
        const isOnBatt = statusStr.includes('OB');
        const isBypass = statusStr.includes('BYPASS');
        const status: UpsSnapshot['status'] = isLow
          ? 'low-battery'
          : isOnBatt
            ? 'on-battery'
            : isBypass
              ? 'bypass'
              : 'online';
        const outputSource: UpsSnapshot['outputSource'] = isOnBatt
          ? 'battery'
          : isBypass
            ? 'bypass'
            : statusStr.includes('OL')
              ? 'normal'
              : 'unknown';

        const loadPct = vars['ups.load'] !== undefined ? Number(vars['ups.load']) : null;
        const realPower = vars['ups.realpower'] !== undefined ? Number(vars['ups.realpower']) : null;
        const runtimeSec = vars['battery.runtime'] !== undefined ? Number(vars['battery.runtime']) : null;

        return {
          configId: cfg.id,
          name: cfg.name,
          host: cfg.host,
          protocol: 'nut',
          model: vars['ups.model'] || `${preset.model} (${upsName})`,
          manufacturer: vars['ups.mfr'] || preset.manufacturer,
          serialNumber: vars['ups.serial'] || '',
          firmwareVersion: vars['ups.firmware'] || '',
          status,
          outputSource,
          batteryChargePercent: vars['battery.charge'] !== undefined ? Number(vars['battery.charge']) : null,
          estimatedRuntimeMinutes: runtimeSec !== null && Number.isFinite(runtimeSec) ? Math.round(runtimeSec / 60) : null,
          batteryVoltage: vars['battery.voltage'] !== undefined ? Number(vars['battery.voltage']) : null,
          batteryTempC: vars['ups.temperature'] !== undefined ? Number(vars['ups.temperature']) : null,
          inputVoltage: vars['input.voltage'] !== undefined ? Number(vars['input.voltage']) : null,
          inputFrequencyHz: vars['input.frequency'] !== undefined ? Number(vars['input.frequency']) : null,
          outputVoltage: vars['output.voltage'] !== undefined ? Number(vars['output.voltage']) : null,
          outputLoadPercent: loadPct !== null && Number.isFinite(loadPct) ? loadPct : null,
          outputWatts:
            realPower !== null && Number.isFinite(realPower)
              ? Math.round(realPower)
              : loadPct !== null && Number.isFinite(loadPct)
                ? Math.round((loadPct / 100) * ratedWatts)
                : null,
          ratedVa,
          ratedWatts,
          alarmsCount: status === 'online' ? 0 : 1,
          collectedAt: now,
        };
      } catch (err) {
        return {
          configId: cfg.id,
          name: cfg.name,
          host: cfg.host,
          protocol: 'nut',
          model: preset.model,
          manufacturer: preset.manufacturer,
          serialNumber: '',
          firmwareVersion: '',
          status: 'offline',
          outputSource: 'unknown',
          batteryChargePercent: null,
          estimatedRuntimeMinutes: null,
          batteryVoltage: null,
          batteryTempC: null,
          inputVoltage: null,
          inputFrequencyHz: null,
          outputVoltage: null,
          outputLoadPercent: null,
          outputWatts: null,
          ratedVa,
          ratedWatts,
          alarmsCount: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
          collectedAt: now,
        };
      }
    }

    // SNMP (RFC 1628 UPS-MIB + Eaton/IBM XUPS MIB + APC PowerNet MIB fallback)
    const comm = cfg.community || 'public';
    const port = cfg.port || 161;
    const ver = cfg.snmpVersion || '2c';

    try {
      const [
        sysDescrRaw,
        mfrRaw,
        modelRaw,
        fwRaw,
        battStatusRaw,
        runtimeRaw,
        chargeRaw,
        battVoltRaw,
        tempRaw,
        inFreqRaw,
        inVoltRaw,
        outSrcRaw,
        outVoltRaw,
        outPowerRaw,
        outLoadRaw,
        alarmsRaw,
      ] = await Promise.all([
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.1.1.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.1.1.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.1.2.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.1.3.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.2.1.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.2.3.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.2.4.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.2.5.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.2.7.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.3.3.1.2.1', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.3.3.1.3.1', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.4.1.0', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.4.4.1.2.1', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.4.4.1.4.1', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.4.4.1.5.1', ver),
        snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.2.1.33.1.6.1.0', ver),
      ]);

      const anyResponded =
        sysDescrRaw !== null ||
        mfrRaw !== null ||
        modelRaw !== null ||
        chargeRaw !== null ||
        outLoadRaw !== null;

      if (!anyResponded) {
        return {
          configId: cfg.id,
          name: cfg.name,
          host: cfg.host,
          protocol: 'snmp',
          model: preset.model,
          manufacturer: preset.manufacturer,
          serialNumber: '',
          firmwareVersion: '',
          status: 'offline',
          outputSource: 'unknown',
          batteryChargePercent: null,
          estimatedRuntimeMinutes: null,
          batteryVoltage: null,
          batteryTempC: null,
          inputVoltage: null,
          inputFrequencyHz: null,
          outputVoltage: null,
          outputLoadPercent: null,
          outputWatts: null,
          ratedVa,
          ratedWatts,
          alarmsCount: 0,
          errorMessage: `No SNMP response from ${cfg.host}:${port} (community "${comm}")`,
          collectedAt: now,
        };
      }

      // If RFC 1628 charge/load were empty, try Eaton/IBM XUPS MIB (1.3.6.1.4.1.534.1) & APC (1.3.6.1.4.1.318.1.1.1)
      let chargePct = snmpNum(chargeRaw);
      let loadPct = snmpNum(outLoadRaw);
      let outWatts = snmpNum(outPowerRaw);
      let inVolt = snmpNum(inVoltRaw);
      let outVolt = snmpNum(outVoltRaw);
      let runtimeMin = snmpNum(runtimeRaw);

      if (chargePct === null) {
        chargePct =
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.534.1.2.4.0', ver, 900)) ??
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.318.1.1.1.2.2.1.0', ver, 900));
      }
      if (loadPct === null) {
        loadPct =
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.534.1.4.1.0', ver, 900)) ??
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.318.1.1.1.4.2.3.0', ver, 900));
      }
      if (inVolt === null) {
        inVolt =
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.534.1.3.4.1.2.1', ver, 900)) ??
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.318.1.1.1.3.2.1.0', ver, 900));
      }
      if (outVolt === null) {
        outVolt =
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.534.1.4.4.1.2.1', ver, 900)) ??
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.318.1.1.1.4.2.1.0', ver, 900));
      }

      const outSrcNum = snmpNum(outSrcRaw);
      const battStatusNum = snmpNum(battStatusRaw);
      const outputSource: UpsSnapshot['outputSource'] =
        outSrcNum === 3
          ? 'normal'
          : outSrcNum === 5
            ? 'battery'
            : outSrcNum === 4
              ? 'bypass'
              : outSrcNum !== null
                ? 'other'
                : 'unknown';

      const status: UpsSnapshot['status'] =
        battStatusNum === 3 || battStatusNum === 4
          ? 'low-battery'
          : outputSource === 'battery'
            ? 'on-battery'
            : outputSource === 'bypass'
              ? 'bypass'
              : 'online';

      let battTempC = snmpNum(tempRaw);
      if (battTempC === null || battTempC <= 0) {
        const altTemp =
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.534.1.6.1.0', ver, 900)) ??
          snmpNum(await snmpGetWithFallback(cfg.host, port, comm, '1.3.6.1.4.1.318.1.1.1.2.2.2.0', ver, 900));
        if (altTemp !== null && altTemp > 0) {
          battTempC = altTemp;
        } else if (battTempC === 0) {
          // Many UPS cards return 0 on upsBatteryTemperature when no temperature probe is fitted
          battTempC = null;
        }
      }

      const battVoltRawNum = snmpNum(battVoltRaw);
      const inFreqRawNum = snmpNum(inFreqRaw);

      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        protocol: 'snmp',
        model: (modelRaw ? snmpValToString(modelRaw).trim() : '') || preset.model,
        manufacturer: (mfrRaw ? snmpValToString(mfrRaw).trim() : '') || preset.manufacturer,
        serialNumber: '',
        firmwareVersion:
          (fwRaw ? snmpValToString(fwRaw).trim() : '') ||
          (sysDescrRaw ? snmpValToString(sysDescrRaw).trim().slice(0, 64) : ''),
        status,
        outputSource,
        batteryChargePercent: chargePct,
        estimatedRuntimeMinutes: runtimeMin,
        batteryVoltage: battVoltRawNum !== null ? Math.round((battVoltRawNum / 10) * 10) / 10 : null,
        batteryTempC: battTempC,
        inputVoltage: inVolt,
        inputFrequencyHz: inFreqRawNum !== null ? Math.round((inFreqRawNum / 10) * 10) / 10 : null,
        outputVoltage: outVolt,
        outputLoadPercent: loadPct,
        outputWatts:
          outWatts !== null
            ? outWatts
            : loadPct !== null
              ? Math.round((loadPct / 100) * ratedWatts)
              : null,
        ratedVa,
        ratedWatts,
        alarmsCount: snmpNum(alarmsRaw) ?? 0,
        collectedAt: now,
      };
    } catch (err) {
      return {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        protocol: 'snmp',
        model: preset.model,
        manufacturer: preset.manufacturer,
        serialNumber: '',
        firmwareVersion: '',
        status: 'error',
        outputSource: 'unknown',
        batteryChargePercent: null,
        estimatedRuntimeMinutes: null,
        batteryVoltage: null,
        batteryTempC: null,
        inputVoltage: null,
        inputFrequencyHz: null,
        outputVoltage: null,
        outputLoadPercent: null,
        outputWatts: null,
        ratedVa,
        ratedWatts,
        alarmsCount: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
        collectedAt: now,
      };
    }
  }
}
