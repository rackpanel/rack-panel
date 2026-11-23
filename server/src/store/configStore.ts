import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import type {
  AuthUserPublic,
  HikvisionConfig,
  HikvisionConfigPublic,
  OpnsenseConfig,
  OpnsenseConfigPublic,
  PanelSettings,
  ProxmoxConfig,
  ProxmoxConfigPublic,
  SshServerConfig,
  SshServerPublic,
  TailscaleConfig,
  TailscaleConfigPublic,
  UnifiConfig,
  UnifiConfigPublic,
  UpsConfig,
  UpsConfigPublic,
  UserRole,
} from '../../../shared/types.js';
import type { TursoDatabase } from '../db/tursoDb.js';
import {
  appSettings,
  hikvisionConfigs,
  opnsenseConfigs,
  proxmoxConfigs,
  sessions,
  sshServers,
  tailscaleConfigs,
  unifiConfigs,
  upsConfigs,
  users,
} from '../db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDataDir(): string {
  if (process.env.RACK_PANEL_DATA_DIR) {
    return path.resolve(process.env.RACK_PANEL_DATA_DIR);
  }
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return path.join(dir, 'data');
    }
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd(), 'data');
}

const DATA_DIR = resolveDataDir();
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const KEY_FILE = path.join(DATA_DIR, '.secret.key');

interface StoredUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
  lastLoginAt?: string;
}

interface StoredSession {
  token: string;
  userId: string;
  pinLocked: boolean;
  createdAt: string;
  lastUsedAt: string;
  userAgent?: string;
}

interface PersistedData {
  settings: PanelSettings;
  splashPin?: string;
  users: StoredUser[];
  sessions: StoredSession[];
  servers: SshServerConfig[];
  proxmox: ProxmoxConfig[];
  tailscale: TailscaleConfig[];
  opnsense: OpnsenseConfig[];
  hikvision: HikvisionConfig[];
  unifi: UnifiConfig[];
  ups?: UpsConfig[];
}

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(plain: string, stored: string): boolean {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const derived = crypto.scryptSync(plain, parts[1], 64);
    const expected = Buffer.from(parts[2], 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

const DEFAULT_SETTINGS: PanelSettings = {
  pollIntervalMs: 4000,
  temperatureUnit: 'C',
  demoMode: true,
  rackTitle: 'RACK//PANEL',
  screenDimSeconds: 0,
  idleSplashSeconds: 60,
  splashPinEnabled: false,
};

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function getEncryptionKey(): Buffer {
  const envSecret = process.env.RACK_PANEL_SECRET;
  if (envSecret && envSecret.length >= 16) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  ensureDataDir();
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
    return Buffer.from(raw, 'hex');
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

const ENCRYPTED_PREFIX = 'enc:v1:';

function encryptSecret(plain?: string): string | undefined {
  if (!plain) return undefined;
  if (plain.startsWith(ENCRYPTED_PREFIX)) return plain;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value?: string): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value;
  try {
    const key = getEncryptionKey();
    const parts = value.slice(ENCRYPTED_PREFIX.length).split(':');
    if (parts.length !== 3) return undefined;
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const data = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

export class ConfigStore {
  private data: PersistedData;
  private dbReady = false;
  private saveScheduled = false;
  private persistInFlight = false;
  private persistQueued = false;

  constructor(private readonly db?: TursoDatabase) {
    this.data = this.db ? this.emptyData() : this.load();
  }

  private emptyData(): PersistedData {
    return {
      settings: { ...DEFAULT_SETTINGS },
      users: [],
      sessions: [],
      servers: [],
      proxmox: [],
      tailscale: [],
      opnsense: [],
      hikvision: [],
      unifi: [],
    };
  }

  async init(): Promise<void> {
    if (!this.db) return;
    await this.db.init();

    const [userRows, settingRows] = await Promise.all([
      this.db.drizzle.select({ id: users.id }).from(users).limit(1),
      this.db.drizzle.select({ key: appSettings.key }).from(appSettings).where(eq(appSettings.key, 'settings')).limit(1),
    ]);
    const hasRowsInDb = userRows.length > 0 || settingRows.length > 0;

    if (!hasRowsInDb && fs.existsSync(CONFIG_FILE)) {
      this.data = this.load();
      await this.persistToDb();
    } else if (hasRowsInDb) {
      this.data = await this.loadFromDb();
    } else {
      this.data = this.emptyData();
      await this.persistToDb();
    }
    this.dbReady = true;
  }

  private async loadFromDb(): Promise<PersistedData> {
    if (!this.db) return this.emptyData();
    const out = this.emptyData();
    const dz = this.db.drizzle;

    const settingsRows = await dz.select().from(appSettings).where(eq(appSettings.key, 'settings'));
    if (settingsRows[0]?.valueJson) {
      try {
        out.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRows[0].valueJson) };
      } catch {
        // keep default
      }
    }

    const pinRows = await dz.select().from(appSettings).where(eq(appSettings.key, 'splashPin'));
    if (pinRows[0]?.valueJson) {
      out.splashPin = decryptSecret(pinRows[0].valueJson);
    }

    const userRows = await dz.select().from(users);
    out.users = userRows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      role: r.role as UserRole,
      passwordHash: r.passwordHash,
      createdAt: r.createdAt,
      lastLoginAt: r.lastLoginAt || undefined,
    }));

    const sessRows = await dz.select().from(sessions);
    out.sessions = sessRows
      .map((r) => ({
        token: decryptSecret(r.token) || '',
        userId: r.userId,
        pinLocked: Boolean(r.pinLocked),
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        userAgent: r.userAgent || undefined,
      }))
      .filter((s) => Boolean(s.token));

    const srvRows = await dz.select().from(sshServers);
    out.servers = srvRows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      username: r.username,
      authMethod: r.authMethod as SshServerConfig['authMethod'],
      password: decryptSecret(r.password || undefined),
      privateKey: decryptSecret(r.privateKey || undefined),
      passphrase: decryptSecret(r.passphrase || undefined),
      rackUnit: r.rackUnit || '',
      tags: JSON.parse(r.tagsJson || '[]'),
      enabled: Boolean(r.enabled),
      createdAt: r.createdAt,
    }));

    const pveRows = await dz.select().from(proxmoxConfigs);
    out.proxmox = pveRows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      authType: r.authType as ProxmoxConfig['authType'],
      username: r.username,
      password: decryptSecret(r.password || undefined),
      tokenId: r.tokenId || '',
      tokenSecret: decryptSecret(r.tokenSecret || undefined),
      allowInsecureTls: Boolean(r.allowInsecureTls),
      enabled: Boolean(r.enabled),
      createdAt: r.createdAt,
    }));

    const tsRows = await dz.select().from(tailscaleConfigs);
    out.tailscale = tsRows.map((r) => ({
      id: r.id,
      name: r.name,
      mode: r.mode as TailscaleConfig['mode'],
      tailnet: r.tailnet,
      apiKey: decryptSecret(r.apiKey || undefined),
      oauthClientId: r.oauthClientId || undefined,
      oauthClientSecret: decryptSecret(r.oauthClientSecret || undefined),
      enabled: Boolean(r.enabled),
      createdAt: r.createdAt,
    }));

    const opnRows = await dz.select().from(opnsenseConfigs);
    out.opnsense = opnRows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      protocol: r.protocol as OpnsenseConfig['protocol'],
      apiKey: decryptSecret(r.apiKey || undefined),
      apiSecret: decryptSecret(r.apiSecret || undefined),
      allowInsecureTls: Boolean(r.allowInsecureTls),
      enabled: Boolean(r.enabled),
      createdAt: r.createdAt,
    }));

    const hikRows = await dz.select().from(hikvisionConfigs);
    out.hikvision = hikRows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      protocol: r.protocol as HikvisionConfig['protocol'],
      rtspPort: r.rtspPort,
      username: r.username,
      password: decryptSecret(r.password || undefined),
      deviceKind: r.deviceKind as HikvisionConfig['deviceKind'],
      allowInsecureTls: Boolean(r.allowInsecureTls),
      enabled: Boolean(r.enabled),
      createdAt: r.createdAt,
    }));

    const uniRows = await dz.select().from(unifiConfigs);
    out.unifi = uniRows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      port: r.port,
      controllerType: r.controllerType as UnifiConfig['controllerType'],
      site: r.site || 'default',
      username: r.username || undefined,
      password: decryptSecret(r.password || undefined),
      apiKey: decryptSecret(r.apiKey || undefined),
      allowInsecureTls: Boolean(r.allowInsecureTls),
      enabled: Boolean(r.enabled),
      createdAt: r.createdAt,
    }));

    const upsRows = await dz.select().from(upsConfigs);
    out.ups = upsRows.map((r) => ({
      id: r.id,
      name: r.name,
      host: r.host,
      protocol: (r.protocol as UpsConfig['protocol']) || 'snmp',
      port: r.port,
      community: decryptSecret(r.community || undefined),
      password: decryptSecret(r.password || undefined),
      snmpVersion: (r.snmpVersion as UpsConfig['snmpVersion']) || '2c',
      upsName: r.upsName || undefined,
      modelPreset: (r.modelPreset as UpsConfig['modelPreset']) || 'ibm-3000va-2700w-hv',
      ratedVa: r.ratedVa,
      ratedWatts: r.ratedWatts,
      heightU: r.heightU,
      enabled: Boolean(r.enabled),
      createdAt: r.createdAt,
    }));

    return out;
  }

  private persistToDb(): Promise<void> {
    if (!this.db) return Promise.resolve();
    const snap = JSON.parse(JSON.stringify(this.data)) as PersistedData;
    const { hasSplashPin: _omit, ...cleanSettings } = snap.settings;
    const encPin = encryptSecret(snap.splashPin) || null;

    return this.db.runDrizzleTransaction(async (tx) => {
      await tx
        .insert(appSettings)
        .values({ key: 'settings', valueJson: JSON.stringify(cleanSettings) })
        .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: JSON.stringify(cleanSettings) } });

      if (encPin) {
        await tx
          .insert(appSettings)
          .values({ key: 'splashPin', valueJson: encPin })
          .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: encPin } });
      } else {
        await tx.delete(appSettings).where(eq(appSettings.key, 'splashPin'));
      }

      await tx.delete(users);
      if (snap.users.length > 0) {
        await tx
          .insert(users)
          .values(
            snap.users.map((u) => ({
              id: u.id,
              username: u.username,
              displayName: u.displayName,
              role: u.role,
              passwordHash: u.passwordHash,
              createdAt: u.createdAt,
              lastLoginAt: u.lastLoginAt || null,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(sessions);
      if (snap.sessions.length > 0) {
        await tx
          .insert(sessions)
          .values(
            snap.sessions.map((s) => ({
              token: encryptSecret(s.token) || s.token,
              userId: s.userId,
              pinLocked: s.pinLocked ? 1 : 0,
              createdAt: s.createdAt,
              lastUsedAt: s.lastUsedAt,
              userAgent: s.userAgent || null,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(sshServers);
      if (snap.servers.length > 0) {
        await tx
          .insert(sshServers)
          .values(
            snap.servers.map((s) => ({
              id: s.id,
              name: s.name,
              host: s.host,
              port: s.port,
              username: s.username,
              authMethod: s.authMethod,
              password: encryptSecret(s.password) || null,
              privateKey: encryptSecret(s.privateKey) || null,
              passphrase: encryptSecret(s.passphrase) || null,
              rackUnit: s.rackUnit || '',
              tagsJson: JSON.stringify(s.tags || []),
              enabled: s.enabled ? 1 : 0,
              createdAt: s.createdAt,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(proxmoxConfigs);
      if (snap.proxmox.length > 0) {
        await tx
          .insert(proxmoxConfigs)
          .values(
            snap.proxmox.map((p) => ({
              id: p.id,
              name: p.name,
              host: p.host,
              port: p.port,
              authType: p.authType,
              username: p.username,
              password: encryptSecret(p.password) || null,
              tokenId: p.tokenId || '',
              tokenSecret: encryptSecret(p.tokenSecret) || null,
              allowInsecureTls: p.allowInsecureTls ? 1 : 0,
              enabled: p.enabled ? 1 : 0,
              createdAt: p.createdAt,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(tailscaleConfigs);
      if (snap.tailscale.length > 0) {
        await tx
          .insert(tailscaleConfigs)
          .values(
            snap.tailscale.map((t) => ({
              id: t.id,
              name: t.name,
              mode: t.mode,
              tailnet: t.tailnet,
              apiKey: encryptSecret(t.apiKey) || null,
              oauthClientId: t.oauthClientId || null,
              oauthClientSecret: encryptSecret(t.oauthClientSecret) || null,
              enabled: t.enabled ? 1 : 0,
              createdAt: t.createdAt,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(opnsenseConfigs);
      if (snap.opnsense.length > 0) {
        await tx
          .insert(opnsenseConfigs)
          .values(
            snap.opnsense.map((o) => ({
              id: o.id,
              name: o.name,
              host: o.host,
              port: o.port,
              protocol: o.protocol,
              apiKey: encryptSecret(o.apiKey) || null,
              apiSecret: encryptSecret(o.apiSecret) || null,
              allowInsecureTls: o.allowInsecureTls ? 1 : 0,
              enabled: o.enabled ? 1 : 0,
              createdAt: o.createdAt,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(hikvisionConfigs);
      if (snap.hikvision.length > 0) {
        await tx
          .insert(hikvisionConfigs)
          .values(
            snap.hikvision.map((h) => ({
              id: h.id,
              name: h.name,
              host: h.host,
              port: h.port,
              protocol: h.protocol,
              rtspPort: h.rtspPort,
              username: h.username,
              password: encryptSecret(h.password) || null,
              deviceKind: h.deviceKind,
              allowInsecureTls: h.allowInsecureTls ? 1 : 0,
              enabled: h.enabled ? 1 : 0,
              createdAt: h.createdAt,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(unifiConfigs);
      if ((snap.unifi ?? []).length > 0) {
        await tx
          .insert(unifiConfigs)
          .values(
            (snap.unifi ?? []).map((u) => ({
              id: u.id,
              name: u.name,
              host: u.host,
              port: u.port,
              controllerType: u.controllerType,
              site: u.site || 'default',
              username: u.username || null,
              password: encryptSecret(u.password) || null,
              apiKey: encryptSecret(u.apiKey) || null,
              allowInsecureTls: u.allowInsecureTls ? 1 : 0,
              enabled: u.enabled ? 1 : 0,
              createdAt: u.createdAt,
            })),
          )
          .onConflictDoNothing();
      }

      await tx.delete(upsConfigs);
      if ((snap.ups ?? []).length > 0) {
        await tx
          .insert(upsConfigs)
          .values(
            (snap.ups ?? []).map((u) => ({
              id: u.id,
              name: u.name,
              host: u.host,
              protocol: u.protocol,
              port: u.port,
              community: encryptSecret(u.community) || null,
              password: encryptSecret(u.password) || null,
              snmpVersion: u.snmpVersion || '2c',
              upsName: u.upsName || null,
              modelPreset: u.modelPreset || 'ibm-3000va-2700w-hv',
              ratedVa: u.ratedVa || 3000,
              ratedWatts: u.ratedWatts || 2700,
              heightU: u.heightU || 2,
              enabled: u.enabled ? 1 : 0,
              createdAt: u.createdAt,
            })),
          )
          .onConflictDoNothing();
      }
    });
  }

  private load(): PersistedData {
    ensureDataDir();
    if (!fs.existsSync(CONFIG_FILE)) {
      const initial: PersistedData = {
        settings: { ...DEFAULT_SETTINGS },
        users: [],
        sessions: [],
        servers: [],
        proxmox: [],
        tailscale: [],
        opnsense: [],
        hikvision: [],
        unifi: [],
      };
      this.writeRaw(initial);
      return initial;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<PersistedData>;
      return {
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
        splashPin: decryptSecret(parsed.splashPin),
        users: Array.isArray(parsed.users) ? parsed.users : [],
        sessions: Array.isArray(parsed.sessions)
          ? parsed.sessions
              .map((sess) => ({
                ...sess,
                token: decryptSecret(sess.token) || '',
              }))
              .filter((sess) => Boolean(sess.token))
          : [],
        servers: (parsed.servers ?? []).map((s) => ({
          ...s,
          password: decryptSecret(s.password),
          privateKey: decryptSecret(s.privateKey),
          passphrase: decryptSecret(s.passphrase),
        })),
        proxmox: (parsed.proxmox ?? []).map((p) => ({
          ...p,
          password: decryptSecret(p.password),
          tokenSecret: decryptSecret(p.tokenSecret),
        })),
        tailscale: (parsed.tailscale ?? []).map((t) => ({
          ...t,
          apiKey: decryptSecret(t.apiKey),
          oauthClientSecret: decryptSecret(t.oauthClientSecret),
        })),
        opnsense: (parsed.opnsense ?? []).map((o) => ({
          ...o,
          apiKey: decryptSecret(o.apiKey),
          apiSecret: decryptSecret(o.apiSecret),
        })),
        hikvision: (parsed.hikvision ?? []).map((h) => ({
          ...h,
          password: decryptSecret(h.password),
        })),
        unifi: (parsed.unifi ?? []).map((u) => ({
          ...u,
          password: decryptSecret(u.password),
          apiKey: decryptSecret(u.apiKey),
        })),
      };
    } catch {
      return {
        settings: { ...DEFAULT_SETTINGS },
        users: [],
        sessions: [],
        servers: [],
        proxmox: [],
        tailscale: [],
        opnsense: [],
        hikvision: [],
        unifi: [],
      };
    }
  }

  private writeRaw(data: PersistedData): void {
    ensureDataDir();
    const { hasSplashPin: _omit, ...cleanSettings } = data.settings;
    const encrypted: PersistedData = {
      settings: cleanSettings,
      splashPin: encryptSecret(data.splashPin),
      users: data.users ?? [],
      sessions: (data.sessions ?? []).map((sess) => ({
        ...sess,
        token: encryptSecret(sess.token) || sess.token,
      })),
      servers: data.servers.map((s) => ({
        ...s,
        password: encryptSecret(s.password),
        privateKey: encryptSecret(s.privateKey),
        passphrase: encryptSecret(s.passphrase),
      })),
      proxmox: data.proxmox.map((p) => ({
        ...p,
        password: encryptSecret(p.password),
        tokenSecret: encryptSecret(p.tokenSecret),
      })),
      tailscale: (data.tailscale ?? []).map((t) => ({
        ...t,
        apiKey: encryptSecret(t.apiKey),
        oauthClientSecret: encryptSecret(t.oauthClientSecret),
      })),
      opnsense: (data.opnsense ?? []).map((o) => ({
        ...o,
        apiKey: encryptSecret(o.apiKey),
        apiSecret: encryptSecret(o.apiSecret),
      })),
      hikvision: (data.hikvision ?? []).map((h) => ({
        ...h,
        password: encryptSecret(h.password),
      })),
      unifi: (data.unifi ?? []).map((u) => ({
        ...u,
        password: encryptSecret(u.password),
        apiKey: encryptSecret(u.apiKey),
      })),
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
  }

  private flushDbSave(): void {
    if (this.persistInFlight) {
      this.persistQueued = true;
      return;
    }
    this.persistInFlight = true;
    void this.persistToDb()
      .catch((err) => {
        console.error('[turso] configStore persist error:', err);
      })
      .finally(() => {
        this.persistInFlight = false;
        if (this.persistQueued) {
          this.persistQueued = false;
          this.flushDbSave();
        }
      });
  }

  private save(): void {
    if (this.db) {
      if (this.dbReady) {
        if (!this.saveScheduled) {
          this.saveScheduled = true;
          queueMicrotask(() => {
            this.saveScheduled = false;
            this.flushDbSave();
          });
        }
      }
      return;
    }
    this.writeRaw(this.data);
  }

  getSettings(): PanelSettings {
    const hasSplashPin = Boolean(this.data.splashPin && /^\d{4}$/.test(this.data.splashPin));
    const hasTeslaClientSecret = Boolean(this.data.settings.teslaClientSecret);
    return {
      ...this.data.settings,
      teslaClientSecret: undefined,
      hasTeslaClientSecret,
      splashPinEnabled: Boolean(this.data.settings.splashPinEnabled && hasSplashPin),
      hasSplashPin,
    };
  }

  getTeslaPartnerSecrets(): {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    domain: string;
  } {
    return {
      clientId: (this.data.settings.teslaClientId || '').trim(),
      clientSecret: (this.data.settings.teslaClientSecret || '').trim(),
      redirectUri: (this.data.settings.teslaRedirectUri || 'https://auth.tesla.com/void/callback').trim(),
      domain: (this.data.settings.teslaPartnerDomain || '').trim(),
    };
  }

  async factoryResetKeepUsers(): Promise<PanelSettings> {
    this.data = {
      settings: { ...DEFAULT_SETTINGS },
      splashPin: undefined,
      users: [...(this.data.users ?? [])],
      sessions: [...(this.data.sessions ?? [])],
      servers: [],
      proxmox: [],
      tailscale: [],
      opnsense: [],
      hikvision: [],
      unifi: [],
    };
    if (this.db) {
      if (this.dbReady) {
        await this.persistToDb();
      }
    } else {
      this.writeRaw(this.data);
    }
    return this.getSettings();
  }

  updateSettings(patch: Partial<PanelSettings> & { splashPin?: string }): PanelSettings {
    const {
      splashPin,
      hasSplashPin: _ignored,
      hasTeslaClientSecret: _ignoredSecret,
      teslaClientSecret,
      ...rest
    } = patch;
    if (splashPin !== undefined && splashPin !== '') {
      const cleaned = String(splashPin).trim();
      if (!/^\d{4}$/.test(cleaned)) {
        throw new Error('PIN must be exactly 4 digits (0–9)');
      }
      this.data.splashPin = cleaned;
    }

    const nextEnabled =
      rest.splashPinEnabled !== undefined ? Boolean(rest.splashPinEnabled) : Boolean(this.data.settings.splashPinEnabled);
    if (nextEnabled && (!this.data.splashPin || !/^\d{4}$/.test(this.data.splashPin))) {
      throw new Error('Set a 4-digit PIN before enabling splash PIN unlock');
    }

    if (!nextEnabled && this.data.sessions) {
      for (const s of this.data.sessions) {
        s.pinLocked = false;
      }
    }

    this.data.settings = {
      ...this.data.settings,
      ...rest,
      teslaClientSecret:
        teslaClientSecret !== undefined && teslaClientSecret !== ''
          ? String(teslaClientSecret).trim()
          : this.data.settings.teslaClientSecret,
      splashPinEnabled: nextEnabled,
      pollIntervalMs: Math.max(2000, Math.min(60000, Number(rest.pollIntervalMs ?? this.data.settings.pollIntervalMs))),
    };
    this.save();
    return this.getSettings();
  }

  verifySplashPin(pin: string): boolean {
    if (!this.data.settings.splashPinEnabled || !this.data.splashPin) {
      return true;
    }
    const candidate = String(pin ?? '').trim();
    const expected = this.data.splashPin;
    if (candidate.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'));
  }

  // ---- Users & Persistent Auth Sessions ----

  private toPublicUser(u: StoredUser): AuthUserPublic {
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    };
  }

  hasUsers(): boolean {
    return (this.data.users ?? []).length > 0;
  }

  listUsersPublic(): AuthUserPublic[] {
    return (this.data.users ?? []).map((u) => this.toPublicUser(u));
  }

  createUser(input: {
    username: string;
    displayName?: string;
    password: string;
    role?: UserRole;
  }): AuthUserPublic {
    if (!this.data.users) this.data.users = [];
    const username = String(input.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,32}$/.test(username)) {
      throw new Error('Username must be 2–32 characters (letters, numbers, ., _, -)');
    }
    const password = String(input.password || '');
    if (password.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    if (this.data.users.some((u) => u.username === username)) {
      throw new Error(`Username "${username}" already exists`);
    }
    const role: UserRole = this.data.users.length === 0 ? 'admin' : input.role === 'admin' ? 'admin' : 'operator';
    const user: StoredUser = {
      id: `usr-${crypto.randomBytes(5).toString('hex')}`,
      username,
      displayName: String(input.displayName || '').trim() || username,
      role,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    this.data.users.push(user);
    this.save();
    return this.toPublicUser(user);
  }

  updateUserPassword(userId: string, newPassword: string): void {
    const user = (this.data.users ?? []).find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    const pwd = String(newPassword || '');
    if (pwd.length < 4) throw new Error('Password must be at least 4 characters');
    user.passwordHash = hashPassword(pwd);
    this.save();
  }

  deleteUser(userId: string): boolean {
    if (!this.data.users) return false;
    const target = this.data.users.find((u) => u.id === userId);
    if (!target) return false;
    const adminCount = this.data.users.filter((u) => u.role === 'admin').length;
    if (target.role === 'admin' && adminCount <= 1) {
      throw new Error('Cannot delete the last admin account');
    }
    this.data.users = this.data.users.filter((u) => u.id !== userId);
    this.data.sessions = (this.data.sessions ?? []).filter((s) => s.userId !== userId);
    this.save();
    return true;
  }

  authenticateUser(username: string, password: string): AuthUserPublic | null {
    const norm = String(username || '').trim().toLowerCase();
    const user = (this.data.users ?? []).find((u) => u.username === norm);
    if (!user) return null;
    if (!verifyPassword(String(password || ''), user.passwordHash)) return null;
    user.lastLoginAt = new Date().toISOString();
    this.save();
    return this.toPublicUser(user);
  }

  createSession(userId: string, userAgent?: string): StoredSession {
    if (!this.data.sessions) this.data.sessions = [];
    const nowIso = new Date().toISOString();
    const session: StoredSession = {
      token: `rp_${crypto.randomBytes(32).toString('hex')}`,
      userId,
      pinLocked: false,
      createdAt: nowIso,
      lastUsedAt: nowIso,
      userAgent: userAgent ? String(userAgent).slice(0, 120) : undefined,
    };
    this.data.sessions.push(session);
    this.save();
    return { ...session };
  }

  getSessionByToken(token: string): { session: StoredSession; user: AuthUserPublic } | null {
    if (!token) return null;
    const sess = (this.data.sessions ?? []).find((s) => {
      if (s.token.length !== token.length) return false;
      try {
        return crypto.timingSafeEqual(Buffer.from(s.token, 'utf8'), Buffer.from(token, 'utf8'));
      } catch {
        return false;
      }
    });
    if (!sess) return null;
    const user = (this.data.users ?? []).find((u) => u.id === sess.userId);
    if (!user) return null;
    return { session: { ...sess }, user: this.toPublicUser(user) };
  }

  setSessionPinLocked(token: string, locked: boolean): boolean {
    const sess = (this.data.sessions ?? []).find((s) => s.token === token);
    if (!sess) return false;
    sess.pinLocked = Boolean(locked && this.getSettings().splashPinEnabled);
    sess.lastUsedAt = new Date().toISOString();
    this.save();
    return true;
  }

  revokeSession(token: string): boolean {
    if (!this.data.sessions || !token) return false;
    const before = this.data.sessions.length;
    this.data.sessions = this.data.sessions.filter((s) => s.token !== token);
    if (this.data.sessions.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listServers(): SshServerConfig[] {
    return this.data.servers.map((s) => ({ ...s, tags: [...s.tags] }));
  }

  toPublicServer(s: SshServerConfig): SshServerPublic {
    const { password, privateKey, passphrase, ...rest } = s;
    return {
      ...rest,
      hasPassword: Boolean(password),
      hasPrivateKey: Boolean(privateKey),
      hasPassphrase: Boolean(passphrase),
    };
  }

  listServersPublic(): SshServerPublic[] {
    return this.data.servers.map((s) => this.toPublicServer(s));
  }

  getServer(id: string): SshServerConfig | undefined {
    return this.data.servers.find((s) => s.id === id);
  }

  upsertServer(input: Partial<SshServerConfig> & { name: string; host: string; username?: string }): SshServerConfig {
    const existing = input.id ? this.data.servers.find((s) => s.id === input.id) : undefined;
    const authMethod = input.authMethod ?? existing?.authMethod ?? 'tailscale';
    const record: SshServerConfig = {
      id: existing?.id ?? `srv-${crypto.randomBytes(5).toString('hex')}`,
      name: input.name.trim(),
      host: input.host.trim(),
      port: Number(input.port) || 22,
      username: (input.username ?? existing?.username ?? '').trim(),
      authMethod,
      password: input.password !== undefined && input.password !== '' ? input.password : existing?.password,
      privateKey: input.privateKey !== undefined && input.privateKey !== '' ? input.privateKey : existing?.privateKey,
      passphrase: input.passphrase !== undefined && input.passphrase !== '' ? input.passphrase : existing?.passphrase,
      rackUnit: input.rackUnit?.trim() ?? existing?.rackUnit ?? '',
      tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : existing?.tags ?? [],
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    if (existing) {
      const idx = this.data.servers.findIndex((s) => s.id === existing.id);
      this.data.servers[idx] = record;
    } else {
      this.data.servers.push(record);
    }
    this.save();
    return record;
  }

  deleteServer(id: string): boolean {
    const before = this.data.servers.length;
    this.data.servers = this.data.servers.filter((s) => s.id !== id);
    if (this.data.servers.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listProxmox(): ProxmoxConfig[] {
    return this.data.proxmox.map((p) => ({ ...p }));
  }

  toPublicProxmox(p: ProxmoxConfig): ProxmoxConfigPublic {
    const { password, tokenSecret, ...rest } = p;
    return {
      ...rest,
      hasPassword: Boolean(password),
      hasTokenSecret: Boolean(tokenSecret),
    };
  }

  listProxmoxPublic(): ProxmoxConfigPublic[] {
    return this.data.proxmox.map((p) => this.toPublicProxmox(p));
  }

  getProxmox(id: string): ProxmoxConfig | undefined {
    return this.data.proxmox.find((p) => p.id === id);
  }

  upsertProxmox(input: Partial<ProxmoxConfig> & { name: string; host: string }): ProxmoxConfig {
    const existing = input.id ? this.data.proxmox.find((p) => p.id === input.id) : undefined;
    const record: ProxmoxConfig = {
      id: existing?.id ?? `pve-${crypto.randomBytes(5).toString('hex')}`,
      name: input.name.trim(),
      host: input.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      port: Number(input.port) || 8006,
      authType: input.authType ?? existing?.authType ?? 'token',
      username: (input.username ?? existing?.username ?? 'root@pam').trim(),
      password: input.password !== undefined && input.password !== '' ? input.password : existing?.password,
      tokenId: (input.tokenId ?? existing?.tokenId ?? '').trim(),
      tokenSecret:
        input.tokenSecret !== undefined && input.tokenSecret !== '' ? input.tokenSecret : existing?.tokenSecret,
      allowInsecureTls: input.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    if (existing) {
      const idx = this.data.proxmox.findIndex((p) => p.id === existing.id);
      this.data.proxmox[idx] = record;
    } else {
      this.data.proxmox.push(record);
    }
    this.save();
    return record;
  }

  deleteProxmox(id: string): boolean {
    const before = this.data.proxmox.length;
    this.data.proxmox = this.data.proxmox.filter((p) => p.id !== id);
    if (this.data.proxmox.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listTailscale(): TailscaleConfig[] {
    return (this.data.tailscale ?? []).map((t) => ({ ...t }));
  }

  toPublicTailscale(t: TailscaleConfig): TailscaleConfigPublic {
    const { apiKey, oauthClientSecret, ...rest } = t;
    return {
      ...rest,
      hasApiKey: Boolean(apiKey),
      hasOauthSecret: Boolean(oauthClientSecret),
    };
  }

  listTailscalePublic(): TailscaleConfigPublic[] {
    return this.listTailscale().map((t) => this.toPublicTailscale(t));
  }

  getTailscale(id: string): TailscaleConfig | undefined {
    return (this.data.tailscale ?? []).find((t) => t.id === id);
  }

  upsertTailscale(input: Partial<TailscaleConfig> & { name: string }): TailscaleConfig {
    if (!this.data.tailscale) this.data.tailscale = [];
    const existing = input.id ? this.data.tailscale.find((t) => t.id === input.id) : undefined;
    const record: TailscaleConfig = {
      id: existing?.id ?? `ts-${crypto.randomBytes(5).toString('hex')}`,
      name: input.name.trim(),
      mode: input.mode ?? existing?.mode ?? 'local',
      tailnet: (input.tailnet ?? existing?.tailnet ?? '-').trim() || '-',
      apiKey: input.apiKey !== undefined && input.apiKey !== '' ? input.apiKey.trim() : existing?.apiKey,
      oauthClientId:
        input.oauthClientId !== undefined && input.oauthClientId !== ''
          ? input.oauthClientId.trim()
          : existing?.oauthClientId,
      oauthClientSecret:
        input.oauthClientSecret !== undefined && input.oauthClientSecret !== ''
          ? input.oauthClientSecret.trim()
          : existing?.oauthClientSecret,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    if (existing) {
      const idx = this.data.tailscale.findIndex((t) => t.id === existing.id);
      this.data.tailscale[idx] = record;
    } else {
      this.data.tailscale.push(record);
    }
    this.save();
    return record;
  }

  deleteTailscale(id: string): boolean {
    if (!this.data.tailscale) return false;
    const before = this.data.tailscale.length;
    this.data.tailscale = this.data.tailscale.filter((t) => t.id !== id);
    if (this.data.tailscale.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listOpnsense(): OpnsenseConfig[] {
    return (this.data.opnsense ?? []).map((o) => ({ ...o }));
  }

  toPublicOpnsense(o: OpnsenseConfig): OpnsenseConfigPublic {
    const { apiKey, apiSecret, ...rest } = o;
    return {
      ...rest,
      hasApiKey: Boolean(apiKey),
      hasApiSecret: Boolean(apiSecret),
    };
  }

  listOpnsensePublic(): OpnsenseConfigPublic[] {
    return this.listOpnsense().map((o) => this.toPublicOpnsense(o));
  }

  getOpnsense(id: string): OpnsenseConfig | undefined {
    return (this.data.opnsense ?? []).find((o) => o.id === id);
  }

  upsertOpnsense(input: Partial<OpnsenseConfig> & { name: string; host: string }): OpnsenseConfig {
    if (!this.data.opnsense) this.data.opnsense = [];
    const existing = input.id ? this.data.opnsense.find((o) => o.id === input.id) : undefined;
    const protocol = input.protocol ?? existing?.protocol ?? 'https';
    const record: OpnsenseConfig = {
      id: existing?.id ?? `opn-${crypto.randomBytes(5).toString('hex')}`,
      name: input.name.trim(),
      host: input.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      port: Number(input.port) || existing?.port || (protocol === 'https' ? 443 : 80),
      protocol,
      apiKey: input.apiKey !== undefined && input.apiKey !== '' ? input.apiKey.trim() : existing?.apiKey,
      apiSecret:
        input.apiSecret !== undefined && input.apiSecret !== '' ? input.apiSecret.trim() : existing?.apiSecret,
      allowInsecureTls: input.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    if (existing) {
      const idx = this.data.opnsense.findIndex((o) => o.id === existing.id);
      this.data.opnsense[idx] = record;
    } else {
      this.data.opnsense.push(record);
    }
    this.save();
    return record;
  }

  deleteOpnsense(id: string): boolean {
    if (!this.data.opnsense) return false;
    const before = this.data.opnsense.length;
    this.data.opnsense = this.data.opnsense.filter((o) => o.id !== id);
    if (this.data.opnsense.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listHikvision(): HikvisionConfig[] {
    return (this.data.hikvision ?? []).map((h) => ({ ...h }));
  }

  toPublicHikvision(h: HikvisionConfig): HikvisionConfigPublic {
    const { password, ...rest } = h;
    return {
      ...rest,
      hasPassword: Boolean(password),
    };
  }

  listHikvisionPublic(): HikvisionConfigPublic[] {
    return this.listHikvision().map((h) => this.toPublicHikvision(h));
  }

  getHikvision(id: string): HikvisionConfig | undefined {
    return (this.data.hikvision ?? []).find((h) => h.id === id);
  }

  upsertHikvision(input: Partial<HikvisionConfig> & { name: string; host: string }): HikvisionConfig {
    if (!this.data.hikvision) this.data.hikvision = [];
    const existing = input.id ? this.data.hikvision.find((h) => h.id === input.id) : undefined;
    const protocol = input.protocol ?? existing?.protocol ?? 'http';
    const record: HikvisionConfig = {
      id: existing?.id ?? `hik-${crypto.randomBytes(5).toString('hex')}`,
      name: input.name.trim(),
      host: input.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      port: Number(input.port) || existing?.port || (protocol === 'https' ? 443 : 80),
      protocol,
      rtspPort: Number(input.rtspPort) || existing?.rtspPort || 554,
      username: (input.username ?? existing?.username ?? 'admin').trim() || 'admin',
      password:
        input.password !== undefined && input.password !== '' ? input.password : existing?.password,
      deviceKind: input.deviceKind ?? existing?.deviceKind ?? 'auto',
      allowInsecureTls: input.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    if (existing) {
      const idx = this.data.hikvision.findIndex((h) => h.id === existing.id);
      this.data.hikvision[idx] = record;
    } else {
      this.data.hikvision.push(record);
    }
    this.save();
    return record;
  }

  deleteHikvision(id: string): boolean {
    if (!this.data.hikvision) return false;
    const before = this.data.hikvision.length;
    this.data.hikvision = this.data.hikvision.filter((h) => h.id !== id);
    if (this.data.hikvision.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listUnifi(): UnifiConfig[] {
    return (this.data.unifi ?? []).map((u) => ({ ...u }));
  }

  toPublicUnifi(u: UnifiConfig): UnifiConfigPublic {
    const { password, apiKey, ...rest } = u;
    return {
      ...rest,
      hasPassword: Boolean(password),
      hasApiKey: Boolean(apiKey),
    };
  }

  listUnifiPublic(): UnifiConfigPublic[] {
    return this.listUnifi().map((u) => this.toPublicUnifi(u));
  }

  getUnifi(id: string): UnifiConfig | undefined {
    return (this.data.unifi ?? []).find((u) => u.id === id);
  }

  upsertUnifi(input: Partial<UnifiConfig> & { name: string; host: string }): UnifiConfig {
    if (!this.data.unifi) this.data.unifi = [];
    const existing = input.id ? this.data.unifi.find((u) => u.id === input.id) : undefined;
    const controllerType = input.controllerType ?? existing?.controllerType ?? 'auto';
    const record: UnifiConfig = {
      id: existing?.id ?? `uni-${crypto.randomBytes(5).toString('hex')}`,
      name: input.name.trim(),
      host: input.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      port: Number(input.port) || existing?.port || (controllerType === 'classic' ? 8443 : 443),
      controllerType,
      site: (input.site ?? existing?.site ?? 'default').trim() || 'default',
      username: input.username !== undefined ? input.username.trim() : existing?.username ?? 'admin',
      password:
        input.password !== undefined && input.password !== '' ? input.password : existing?.password,
      apiKey:
        input.apiKey !== undefined && input.apiKey !== '' ? input.apiKey.trim() : existing?.apiKey,
      allowInsecureTls: input.allowInsecureTls ?? existing?.allowInsecureTls ?? true,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    if (existing) {
      const idx = this.data.unifi.findIndex((u) => u.id === existing.id);
      this.data.unifi[idx] = record;
    } else {
      this.data.unifi.push(record);
    }
    this.save();
    return record;
  }

  deleteUnifi(id: string): boolean {
    if (!this.data.unifi) return false;
    const before = this.data.unifi.length;
    this.data.unifi = this.data.unifi.filter((u) => u.id !== id);
    if (this.data.unifi.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  listUps(): UpsConfig[] {
    return (this.data.ups ?? []).map((u) => ({ ...u }));
  }

  toPublicUps(u: UpsConfig): UpsConfigPublic {
    const { community, password, ...rest } = u;
    return {
      ...rest,
      hasCommunity: Boolean(community),
      hasPassword: Boolean(password),
    };
  }

  listUpsPublic(): UpsConfigPublic[] {
    return this.listUps().map((u) => this.toPublicUps(u));
  }

  getUps(id: string): UpsConfig | undefined {
    return (this.data.ups ?? []).find((u) => u.id === id);
  }

  upsertUps(input: Partial<UpsConfig> & { name: string; host: string }): UpsConfig {
    if (!this.data.ups) this.data.ups = [];
    const existing = input.id ? this.data.ups.find((u) => u.id === input.id) : undefined;
    const protocol = input.protocol ?? existing?.protocol ?? 'snmp';
    const defaultPort = protocol === 'nut' ? 3493 : protocol === 'powerwall' ? 443 : 161;
    const record: UpsConfig = {
      id: existing?.id ?? `ups-${crypto.randomBytes(5).toString('hex')}`,
      name: input.name.trim(),
      host: input.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''),
      protocol,
      port: Number(input.port) || existing?.port || defaultPort,
      community:
        input.community !== undefined && input.community !== ''
          ? input.community.trim()
          : existing?.community ?? 'public',
      password:
        input.password !== undefined && input.password !== ''
          ? input.password
          : existing?.password,
      snmpVersion: input.snmpVersion ?? existing?.snmpVersion ?? '2c',
      upsName: input.upsName !== undefined ? input.upsName.trim() : existing?.upsName,
      modelPreset: input.modelPreset ?? existing?.modelPreset ?? 'ibm-3000va-2700w-hv',
      ratedVa: Number(input.ratedVa) || existing?.ratedVa || 3000,
      ratedWatts: Number(input.ratedWatts) || existing?.ratedWatts || 2700,
      heightU: Number(input.heightU) || existing?.heightU || 2,
      enabled: input.enabled ?? existing?.enabled ?? true,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    if (existing) {
      const idx = this.data.ups.findIndex((u) => u.id === existing.id);
      this.data.ups[idx] = record;
    } else {
      this.data.ups.push(record);
    }
    this.save();
    return record;
  }

  deleteUps(id: string): boolean {
    if (!this.data.ups) return false;
    const before = this.data.ups.length;
    this.data.ups = this.data.ups.filter((u) => u.id !== id);
    if (this.data.ups.length !== before) {
      this.save();
      return true;
    }
    return false;
  }
}
