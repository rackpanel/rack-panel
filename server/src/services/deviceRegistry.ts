import crypto from 'node:crypto';
import type { DeviceSourceKind } from '../../../shared/types.js';

export interface DeviceObservation {
  entityKey: string;
  source: DeviceSourceKind;
  machineId?: string;
  ips?: string[];
  hostnames?: string[];
}

export interface CanonicalDeviceInfo {
  canonicalId: string;
  entityKeys: string[];
  linkedSources: DeviceSourceKind[];
  ips: string[];
  hostnames: string[];
  machineId?: string;
}

const GENERIC_HOSTNAMES = new Set([
  '',
  'localhost',
  'localhost.localdomain',
  'unknown',
  'linux',
  'ubuntu',
  'debian',
  'server',
  'node',
  'host',
  'pve',
]);

export function isIpLiteral(raw: string): boolean {
  const s = raw.trim();
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) return true;
  if (s.includes(':') && /^[0-9a-fA-F:]+$/.test(s)) return true;
  return false;
}

export function normalizeIp(raw?: string): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  // Strip CIDR suffix or IPv6 scope id
  const cleaned = s.split('/')[0].split('%')[0].trim();
  if (!isIpLiteral(cleaned)) return '';
  // Ignore loopback, link-local, unspecified, and common docker bridge gateway
  if (
    cleaned === '127.0.0.1' ||
    cleaned === '::1' ||
    cleaned === '0.0.0.0' ||
    cleaned === '::' ||
    cleaned.startsWith('127.') ||
    cleaned.startsWith('169.254.') ||
    cleaned.startsWith('fe80:')
  ) {
    return '';
  }
  return cleaned;
}

export function normalizeHostname(raw?: string): string {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\.+$/, '');
  if (!s || isIpLiteral(s)) return '';
  // Use the short label before domain suffix (.local, .lan, .ts.net, etc.)
  const short = s.split('.')[0].trim();
  if (!short || short.length < 2 || GENERIC_HOSTNAMES.has(short)) return '';
  // Only accept plausible hostname characters
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(short)) return '';
  return short;
}

export function normalizeMachineId(raw?: string): string {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '');
  if (cleaned.length < 12) return '';
  // Ignore all-zero or all-f dummy DMI/machine IDs
  if (/^0+$/.test(cleaned) || /^f+$/.test(cleaned)) return '';
  return cleaned;
}

/**
 * Maintains an equivalence graph (Union-Find) across SSH servers, Proxmox nodes,
 * Tailscale devices, and OPNsense firewalls so multiple entries pointing to the
 * same physical machine (even with different IPs, hostnames, or credentials)
 * resolve to a single canonical device ID.
 */
export class DeviceIdentityRegistry {
  private observations = new Map<
    string,
    {
      entityKey: string;
      source: DeviceSourceKind;
      machineId?: string;
      ips: Set<string>;
      hostnames: Set<string>;
    }
  >();

  private resolvedByEntity = new Map<string, CanonicalDeviceInfo>();
  private resolvedById = new Map<string, CanonicalDeviceInfo>();

  upsert(obs: DeviceObservation): void {
    let rec = this.observations.get(obs.entityKey);
    if (!rec) {
      rec = {
        entityKey: obs.entityKey,
        source: obs.source,
        ips: new Set<string>(),
        hostnames: new Set<string>(),
      };
      this.observations.set(obs.entityKey, rec);
    }

    const mid = normalizeMachineId(obs.machineId);
    if (mid) rec.machineId = mid;

    if (obs.ips) {
      for (const ip of obs.ips) {
        const norm = normalizeIp(ip);
        if (norm) rec.ips.add(norm);
      }
    }
    if (obs.hostnames) {
      for (const h of obs.hostnames) {
        const norm = normalizeHostname(h);
        if (norm) rec.hostnames.add(norm);
      }
    }
  }

  remove(entityKey: string): void {
    this.observations.delete(entityKey);
  }

  removeByPrefix(prefix: string): void {
    for (const key of Array.from(this.observations.keys())) {
      if (key.startsWith(prefix)) {
        this.observations.delete(key);
      }
    }
  }

  /**
   * Recomputes all connected device components via Union-Find across:
   *  1. Exact hardware/OS machineId
   *  2. Overlapping non-loopback IP addresses (LAN, Tailscale, VLAN, etc.)
   *  3. Matching normalized short OS hostname (e.g. pve3 across SSH, Proxmox, Tailscale)
   */
  rebuild(): void {
    const keys = Array.from(this.observations.keys());
    const parent = new Map<string, string>();
    for (const k of keys) parent.set(k, k);

    const find = (x: string): string => {
      let cur = x;
      while (parent.get(cur) !== cur) {
        cur = parent.get(cur)!;
      }
      let p = x;
      while (parent.get(p) !== cur) {
        const next = parent.get(p)!;
        parent.set(p, cur);
        p = next;
      }
      return cur;
    };

    const union = (a: string, b: string): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) {
        parent.set(rb, ra);
      }
    };

    const byMachineId = new Map<string, string>();
    const byIp = new Map<string, string>();
    const byHostname = new Map<string, string>();

    for (const rec of this.observations.values()) {
      if (rec.machineId) {
        const prev = byMachineId.get(rec.machineId);
        if (prev) union(prev, rec.entityKey);
        else byMachineId.set(rec.machineId, rec.entityKey);
      }
      for (const ip of rec.ips) {
        const prev = byIp.get(ip);
        if (prev) union(prev, rec.entityKey);
        else byIp.set(ip, rec.entityKey);
      }
      for (const h of rec.hostnames) {
        const prev = byHostname.get(h);
        if (prev) union(prev, rec.entityKey);
        else byHostname.set(h, rec.entityKey);
      }
    }

    const groups = new Map<string, string[]>();
    for (const k of keys) {
      const root = find(k);
      let list = groups.get(root);
      if (!list) {
        list = [];
        groups.set(root, list);
      }
      list.push(k);
    }

    this.resolvedByEntity.clear();
    this.resolvedById.clear();

    for (const memberKeys of groups.values()) {
      const sourcesSet = new Set<DeviceSourceKind>();
      const ipsSet = new Set<string>();
      const hostnamesSet = new Set<string>();
      const machineIds: string[] = [];

      for (const k of memberKeys) {
        const rec = this.observations.get(k);
        if (!rec) continue;
        sourcesSet.add(rec.source);
        if (rec.machineId) machineIds.push(rec.machineId);
        for (const ip of rec.ips) ipsSet.add(ip);
        for (const h of rec.hostnames) hostnamesSet.add(h);
      }

      machineIds.sort();
      const sortedIps = Array.from(ipsSet).sort();
      const sortedHostnames = Array.from(hostnamesSet).sort();
      const sortedKeys = [...memberKeys].sort();

      const seed = machineIds[0]
        ? `mid:${machineIds[0]}`
        : sortedHostnames[0]
          ? `host:${sortedHostnames[0]}`
          : sortedIps[0]
            ? `ip:${sortedIps[0]}`
            : `ent:${sortedKeys[0]}`;

      const canonicalId = `dev-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 10)}`;
      const linkedSources = Array.from(sourcesSet).sort();

      const info: CanonicalDeviceInfo = {
        canonicalId,
        entityKeys: sortedKeys,
        linkedSources,
        ips: sortedIps,
        hostnames: sortedHostnames,
        machineId: machineIds[0],
      };

      this.resolvedById.set(canonicalId, info);
      for (const k of sortedKeys) {
        this.resolvedByEntity.set(k, info);
      }
    }
  }

  getByEntity(entityKey: string): CanonicalDeviceInfo | undefined {
    return this.resolvedByEntity.get(entityKey);
  }

  getByCanonicalId(canonicalId: string): CanonicalDeviceInfo | undefined {
    return this.resolvedById.get(canonicalId);
  }

  getCanonicalIdFor(entityKey: string): string {
    return this.resolvedByEntity.get(entityKey)?.canonicalId ?? entityKey;
  }

  /**
   * Look up an entity by a raw IP or hostname without requiring prior registration.
   */
  findByHint(hostOrIp?: string, hostname?: string): CanonicalDeviceInfo | undefined {
    const ip = normalizeIp(hostOrIp);
    const h1 = normalizeHostname(hostOrIp);
    const h2 = normalizeHostname(hostname);

    for (const info of this.resolvedById.values()) {
      if (ip && info.ips.includes(ip)) return info;
      if (h2 && info.hostnames.includes(h2)) return info;
      if (h1 && info.hostnames.includes(h1)) return info;
    }
    return undefined;
  }

  getAllDevices(): CanonicalDeviceInfo[] {
    return Array.from(this.resolvedById.values());
  }
}
