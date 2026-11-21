import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type {
  AuthUserPublic,
  OpnsenseConfig,
  OpnsenseConfigPublic,
  PanelSettings,
  ProxmoxConfig,
  ProxmoxConfigPublic,
  SshServerConfig,
  SshServerPublic,
  TailscaleConfig,
  TailscaleConfigPublic,
  UserRole,
} from '../../../shared/types.js';

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

  constructor() {
    this.data = this.load();
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
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(encrypted, null, 2), { mode: 0o600 });
  }

  private save(): void {
    this.writeRaw(this.data);
  }

  getSettings(): PanelSettings {
    const hasSplashPin = Boolean(this.data.splashPin && /^\d{4}$/.test(this.data.splashPin));
    return {
      ...this.data.settings,
      splashPinEnabled: Boolean(this.data.settings.splashPinEnabled && hasSplashPin),
      hasSplashPin,
    };
  }

  updateSettings(patch: Partial<PanelSettings> & { splashPin?: string }): PanelSettings {
    const { splashPin, hasSplashPin: _ignored, ...rest } = patch;
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
}
