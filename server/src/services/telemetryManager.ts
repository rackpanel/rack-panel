import type {
  AlertItem,
  CommandResult,
  GuestPowerAction,
  HikvisionConfig,
  HikvisionSnapshot,
  OpnsenseConfig,
  OpnsenseServiceAction,
  OpnsenseSnapshot,
  OverviewResponse,
  ProxmoxClusterSnapshot,
  ProxmoxConfig,
  ProxmoxGuest,
  ProxmoxNodeMetrics,
  ProxmoxStorage,
  SshServerConfig,
  SshServerMetrics,
  SshServerPublic,
  TailscaleConfig,
  TailscaleSnapshot,
  UnifiConfig,
  UnifiSnapshot,
  UpsConfig,
  UpsSnapshot,
} from '../../../shared/types.js';
import { ConfigStore } from '../store/configStore.js';
import { SshCollector } from './sshCollector.js';
import { ProxmoxClient } from './proxmoxClient.js';
import { TailscaleClient } from './tailscaleClient.js';
import { OpnsenseClient } from './opnsenseClient.js';
import { HikvisionClient } from './hikvisionClient.js';
import { UnifiClient } from './unifiClient.js';
import { UpsClient } from './upsClient.js';
import { DemoProvider } from './demoProvider.js';
import { DeviceIdentityRegistry } from './deviceRegistry.js';

export class TelemetryManager {
  private sshMetrics = new Map<string, SshServerMetrics>();
  private proxmoxSnapshots = new Map<string, ProxmoxClusterSnapshot>();
  private sshProxmoxSnapshots = new Map<string, ProxmoxClusterSnapshot>();
  private autoProxmoxPromoted = new Set<string>();
  private tailscaleSnapshots = new Map<string, TailscaleSnapshot>();
  private opnsenseSnapshots = new Map<string, OpnsenseSnapshot>();
  private hikvisionSnapshots = new Map<string, HikvisionSnapshot>();
  private unifiSnapshots = new Map<string, UnifiSnapshot>();
  private upsSnapshots = new Map<string, UpsSnapshot>();
  private tailscaleLastPoll = new Map<string, number>();
  private preferredSshPrimary = new Map<string, string>();
  private preferredProxmoxPrimary = new Map<string, string>();
  private preferredTailscalePrimary = new Map<string, string>();
  private preferredOpnsensePrimary = new Map<string, string>();
  private preferredHikvisionPrimary = new Map<string, string>();
  private listeners = new Set<() => void>();
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;
  readonly devices = new DeviceIdentityRegistry();
  readonly demo = new DemoProvider();

  constructor(
    readonly store: ConfigStore,
    readonly ssh: SshCollector,
    readonly proxmox: ProxmoxClient,
    readonly tailscale: TailscaleClient,
    readonly opnsense: OpnsenseClient,
    readonly hikvision: HikvisionClient,
    readonly unifi: UnifiClient,
    readonly ups: UpsClient,
  ) {}

  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // ignore listener errors
      }
    }
  }

  start(): void {
    void this.pollNow();
    this.reschedule();
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.ssh.disconnectAll();
  }

  reschedule(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const interval = this.store.getSettings().pollIntervalMs;
    this.pollTimer = setInterval(() => {
      void this.pollNow();
    }, interval);
  }

  private rebuildDeviceRegistry(): void {
    const servers = this.store.listServers();
    const proxmox = this.store.listProxmox();
    const tailscale = this.store.listTailscale();
    const opnsense = this.store.listOpnsense();

    // Register Tailscale devices first (bridges hostname <-> Tailscale 100.x.y.z IPs across all sources)
    for (const tsCfg of tailscale) {
      const snap = this.tailscaleSnapshots.get(tsCfg.id);
      if (!snap) continue;
      for (const dev of snap.devices) {
        this.devices.upsert({
          entityKey: `tailscale:${tsCfg.id}:${dev.id}`,
          source: 'tailscale',
          ips: [dev.ipv4, dev.ipv6, ...dev.addresses],
          hostnames: [dev.hostname, dev.dnsName],
        });
      }
    }

    // Register SSH servers (host IP/DNS + discovered OS machineId, hostname, all NIC IPs, Tailscale IP)
    for (const srv of servers) {
      const m = this.sshMetrics.get(srv.id);
      const ips: string[] = [srv.host];
      const hostnames: string[] = [srv.host];
      if (m && m.status === 'online') {
        if (m.ipAddress) ips.push(m.ipAddress);
        if (m.allIps) ips.push(...m.allIps);
        if (m.tailscale?.ip) ips.push(m.tailscale.ip);
        if (m.hostname) hostnames.push(m.hostname);
      }
      this.devices.upsert({
        entityKey: `ssh:${srv.id}`,
        source: 'ssh',
        machineId: m?.machineId,
        ips,
        hostnames,
      });
    }

    // Register Proxmox nodes (or config host hint before first discovery)
    for (const pve of proxmox) {
      const snap = this.proxmoxSnapshots.get(pve.id);
      if (snap && snap.nodes.length > 0) {
        this.devices.remove(`proxmox-host:${pve.id}`);
        for (const node of snap.nodes) {
          const ips: string[] = [];
          if (node.ipAddress) ips.push(node.ipAddress);
          if (snap.nodes.length === 1) ips.push(pve.host);
          this.devices.upsert({
            entityKey: `proxmox:${pve.id}:${node.node}`,
            source: 'proxmox',
            ips,
            hostnames: [node.node, snap.nodes.length === 1 ? pve.host : ''],
          });
        }
      } else {
        this.devices.upsert({
          entityKey: `proxmox-host:${pve.id}`,
          source: 'proxmox',
          ips: [pve.host],
          hostnames: [pve.host],
        });
      }
    }

    // Register OPNsense firewalls
    for (const opn of opnsense) {
      const snap = this.opnsenseSnapshots.get(opn.id);
      const ips: string[] = [opn.host];
      const hostnames: string[] = [opn.host];
      if (snap && snap.status === 'online') {
        if (snap.hostname) hostnames.push(snap.hostname);
        for (const iface of snap.interfaces) {
          if (iface.ip4) ips.push(iface.ip4);
        }
      }
      this.devices.upsert({
        entityKey: `opnsense:${opn.id}`,
        source: 'opnsense',
        ips,
        hostnames,
      });
    }

    // Register Hikvision NVRs / DVRs / IP Cameras
    const hikvisionList = this.store.listHikvision();
    for (const hik of hikvisionList) {
      const snap = this.hikvisionSnapshots.get(hik.id);
      const ips: string[] = [hik.host];
      const hostnames: string[] = [hik.host];
      let machineId: string | undefined;
      if (snap && snap.status === 'online') {
        if (snap.deviceName && snap.deviceName !== '-') hostnames.push(snap.deviceName);
        if (snap.serialNumber && snap.serialNumber !== '-') {
          machineId = snap.serialNumber;
        } else if (snap.macAddress && snap.macAddress !== '-') {
          machineId = snap.macAddress;
        }
      }
      this.devices.upsert({
        entityKey: `hikvision:${hik.id}`,
        source: 'hikvision',
        machineId,
        ips,
        hostnames,
      });
    }

    this.devices.rebuild();
  }

  private sortGroupWithPreferred<T extends { id: string }>(
    group: T[],
    preferredId?: string,
    isHealthy?: (item: T) => boolean,
  ): T[] {
    return [...group].sort((a, b) => {
      if (preferredId) {
        if (a.id === preferredId) return -1;
        if (b.id === preferredId) return 1;
      }
      if (isHealthy) {
        const ha = isHealthy(a) ? 0 : 1;
        const hb = isHealthy(b) ? 0 : 1;
        if (ha !== hb) return ha - hb;
      }
      return 0;
    });
  }

  private getProxmoxClusterKey(cfg: ProxmoxConfig): string {
    const snap = this.proxmoxSnapshots.get(cfg.id);
    if (snap && snap.nodes.length > 0) {
      const nodeCanonicalIds = snap.nodes
        .map((n) => this.devices.getCanonicalIdFor(`proxmox:${cfg.id}:${n.node}`))
        .sort();
      return `pve-nodes:${nodeCanonicalIds.join(',')}`;
    }
    return `pve-host:${this.devices.getCanonicalIdFor(`proxmox-host:${cfg.id}`)}`;
  }

  private getTailscaleGroupKey(cfg: TailscaleConfig): string {
    const snap = this.tailscaleSnapshots.get(cfg.id);
    if (snap && snap.status === 'online' && snap.tailnetName && snap.tailnetName !== '-') {
      return `ts:${snap.tailnetName.trim().toLowerCase()}`;
    }
    if (cfg.tailnet && cfg.tailnet !== '-') {
      return `ts:${cfg.tailnet.trim().toLowerCase()}`;
    }
    return `ts-cfg:${cfg.id}`;
  }

  async pollNow(forceTailscale = false): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const enabledServers = this.store.listServers().filter((s) => s.enabled);
      const enabledProxmox = this.store.listProxmox().filter((p) => p.enabled);
      const enabledTailscale = this.store.listTailscale().filter((t) => t.enabled);
      const enabledOpnsense = this.store.listOpnsense().filter((o) => o.enabled);
      const enabledHikvision = this.store.listHikvision().filter((h) => h.enabled);
      const enabledUnifi = this.store.listUnifi().filter((u) => u.enabled);
      const now = Date.now();

      // Seed identity graph from prior observations + current configs
      this.rebuildDeviceRegistry();

      // 1) Tailscale: deduplicate multiple configs pointing to the same Tailnet
      const tsGroups = new Map<string, TailscaleConfig[]>();
      for (const ts of enabledTailscale) {
        const key = this.getTailscaleGroupKey(ts);
        const list = tsGroups.get(key) ?? [];
        list.push(ts);
        tsGroups.set(key, list);
      }

      await Promise.all(
        Array.from(tsGroups.entries()).map(async ([groupKey, group]) => {
          const ordered = this.sortGroupWithPreferred(
            group,
            this.preferredTailscalePrimary.get(groupKey),
            (t) => this.tailscaleSnapshots.get(t.id)?.status === 'online',
          );
          const primary = ordered[0];
          const minCadence = primary.mode === 'local' ? 4000 : 15000;
          const last = this.tailscaleLastPoll.get(primary.id) ?? 0;
          if (!forceTailscale && now - last < minCadence) return;

          let winningCfg = primary;
          let winningSnap: TailscaleSnapshot | null = null;
          for (const candidate of ordered) {
            this.tailscaleLastPoll.set(candidate.id, now);
            const snap = await this.tailscale.collect(candidate);
            winningCfg = candidate;
            winningSnap = snap;
            if (snap.status === 'online') {
              this.preferredTailscalePrimary.set(groupKey, candidate.id);
              break;
            }
          }

          if (winningSnap) {
            for (const cfg of group) {
              this.tailscaleLastPoll.set(cfg.id, now);
              this.tailscaleSnapshots.set(
                cfg.id,
                cfg.id === winningCfg.id
                  ? winningSnap
                  : {
                      ...winningSnap,
                      configId: cfg.id,
                      name: cfg.name,
                      mode: cfg.mode,
                      devices: winningSnap.devices.map((d) => ({ ...d })),
                    },
              );
            }
          }
        }),
      );

      // Update device identity graph with fresh Tailscale hostname <-> 100.x.y.z mappings
      this.rebuildDeviceRegistry();

      // 2) SSH Servers: deduplicate multiple SSH configs resolving to the same physical machine
      const sshGroups = new Map<string, SshServerConfig[]>();
      for (const srv of enabledServers) {
        const devId = this.devices.getCanonicalIdFor(`ssh:${srv.id}`);
        const list = sshGroups.get(devId) ?? [];
        list.push(srv);
        sshGroups.set(devId, list);
      }

      await Promise.all(
        Array.from(sshGroups.entries()).map(async ([devId, group]) => {
          const ordered = this.sortGroupWithPreferred(
            group,
            this.preferredSshPrimary.get(devId),
            (s) => this.sshMetrics.get(s.id)?.status === 'online',
          );

          let winner = ordered[0];
          let metrics: SshServerMetrics | null = null;

          for (const candidate of ordered) {
            const m = await this.ssh.collect(candidate);
            winner = candidate;
            metrics = m;
            if (m.status === 'online') {
              this.preferredSshPrimary.set(devId, candidate.id);
              break;
            }
          }

          if (metrics) {
            for (const cfg of group) {
              if (cfg.id === winner.id) {
                this.sshMetrics.set(cfg.id, {
                  ...metrics,
                  serverId: cfg.id,
                  deduplicatedFrom: undefined,
                });
              } else {
                // Avoid keeping redundant idle SSH sockets open on shadowed duplicates
                this.ssh.disconnect(cfg.id);
                this.sshMetrics.set(cfg.id, {
                  ...metrics,
                  serverId: cfg.id,
                  deduplicatedFrom: `SSH (${winner.name})`,
                  disks: metrics.disks.map((d) => ({ ...d })),
                  network: metrics.network.map((n) => ({ ...n })),
                  temperatures: metrics.temperatures.map((t) => ({ ...t })),
                  topProcesses: metrics.topProcesses.map((p) => ({ ...p })),
                  services: metrics.services.map((s) => ({ ...s })),
                  history: metrics.history.map((h) => ({ ...h })),
                });
              }
            }
          }
        }),
      );

      // Rebuild identity graph with newly learned OS machineId, hostname, and all NIC IPs from SSH
      this.rebuildDeviceRegistry();

      // Auto-detect any SSH servers that are also Proxmox VE hosts and surface them on the Proxmox page
      await Promise.all(
        enabledServers.map(async (srv) => {
          const m = this.sshMetrics.get(srv.id);
          if (m && !m.deduplicatedFrom) {
            await this.syncSshProxmoxHost(srv, m);
          }
        }),
      );

      // Build map of live online SSH metrics by canonical physical device ID so Proxmox can reuse them
      const onlineSshByDevice = new Map<string, SshServerMetrics>();
      for (const srv of enabledServers) {
        const m = this.sshMetrics.get(srv.id);
        if (m && m.status === 'online') {
          const devId = this.devices.getCanonicalIdFor(`ssh:${srv.id}`);
          if (!onlineSshByDevice.has(devId)) {
            onlineSshByDevice.set(devId, m);
          }
        }
      }

      // 3) Proxmox VE & 4) OPNsense in parallel — each deduplicated per canonical cluster/device
      const pveGroups = new Map<string, ProxmoxConfig[]>();
      for (const pve of enabledProxmox) {
        const key = this.getProxmoxClusterKey(pve);
        const list = pveGroups.get(key) ?? [];
        list.push(pve);
        pveGroups.set(key, list);
      }

      const opnGroups = new Map<string, OpnsenseConfig[]>();
      for (const opn of enabledOpnsense) {
        const devId = this.devices.getCanonicalIdFor(`opnsense:${opn.id}`);
        const list = opnGroups.get(devId) ?? [];
        list.push(opn);
        opnGroups.set(devId, list);
      }

      const hikGroups = new Map<string, HikvisionConfig[]>();
      for (const hik of enabledHikvision) {
        const devId = this.devices.getCanonicalIdFor(`hikvision:${hik.id}`);
        const list = hikGroups.get(devId) ?? [];
        list.push(hik);
        hikGroups.set(devId, list);
      }

      await Promise.all([
        ...Array.from(pveGroups.entries()).map(async ([groupKey, group]) => {
          const ordered = this.sortGroupWithPreferred(
            group,
            this.preferredProxmoxPrimary.get(groupKey),
            (p) => this.proxmoxSnapshots.get(p.id)?.status === 'online',
          );

          let winner = ordered[0];
          let snap: ProxmoxClusterSnapshot | null = null;

          for (const candidate of ordered) {
            const resolver = (nodeName: string, nodeIp?: string): SshServerMetrics | undefined => {
              const direct = this.devices.getByEntity(`proxmox:${candidate.id}:${nodeName}`);
              if (direct && onlineSshByDevice.has(direct.canonicalId)) {
                return onlineSshByDevice.get(direct.canonicalId);
              }
              const hinted = this.devices.findByHint(nodeIp || candidate.host, nodeName);
              if (hinted && onlineSshByDevice.has(hinted.canonicalId)) {
                return onlineSshByDevice.get(hinted.canonicalId);
              }
              return undefined;
            };
            const res = await this.proxmox.collectCluster(candidate, resolver);
            winner = candidate;
            snap = res;
            if (res.status === 'online') {
              this.preferredProxmoxPrimary.set(groupKey, candidate.id);
              break;
            }
          }

          if (snap) {
            for (const cfg of group) {
              if (cfg.id === winner.id) {
                this.proxmoxSnapshots.set(cfg.id, snap);
              } else {
                this.proxmoxSnapshots.set(cfg.id, {
                  ...snap,
                  configId: cfg.id,
                  name: cfg.name,
                  host: cfg.host,
                  nodes: snap.nodes.map((n) => ({
                    ...n,
                    deduplicatedFrom: n.deduplicatedFrom || `PVE (${winner.name})`,
                    history: n.history.map((h) => ({ ...h })),
                  })),
                  guests: snap.guests.map((g) => ({ ...g })),
                  storage: snap.storage.map((s) => ({ ...s })),
                  tasks: snap.tasks.map((t) => ({ ...t })),
                });
              }
            }
          }
        }),
        ...Array.from(opnGroups.entries()).map(async ([devId, group]) => {
          const ordered = this.sortGroupWithPreferred(
            group,
            this.preferredOpnsensePrimary.get(devId),
            (o) => this.opnsenseSnapshots.get(o.id)?.status === 'online',
          );

          let winner = ordered[0];
          let snap: OpnsenseSnapshot | null = null;

          for (const candidate of ordered) {
            const res = await this.opnsense.collect(candidate);
            winner = candidate;
            snap = res;
            if (res.status === 'online') {
              this.preferredOpnsensePrimary.set(devId, candidate.id);
              break;
            }
          }

          if (snap) {
            for (const cfg of group) {
              if (cfg.id === winner.id) {
                this.opnsenseSnapshots.set(cfg.id, { ...snap, deduplicatedFrom: undefined });
              } else {
                this.opnsenseSnapshots.set(cfg.id, {
                  ...snap,
                  configId: cfg.id,
                  name: cfg.name,
                  host: cfg.host,
                  deduplicatedFrom: `OPNsense (${winner.name})`,
                  gateways: snap.gateways.map((g) => ({ ...g })),
                  interfaces: snap.interfaces.map((i) => ({ ...i })),
                  services: snap.services.map((s) => ({ ...s })),
                  wireguardPeers: snap.wireguardPeers.map((w) => ({ ...w })),
                  firewallLogs: snap.firewallLogs.map((l) => ({ ...l })),
                  history: snap.history.map((h) => ({ ...h })),
                });
              }
            }
          }
        }),
        ...Array.from(hikGroups.entries()).map(async ([devId, group]) => {
          const ordered = this.sortGroupWithPreferred(
            group,
            this.preferredHikvisionPrimary.get(devId),
            (h) => this.hikvisionSnapshots.get(h.id)?.status === 'online',
          );

          let winner = ordered[0];
          let snap: HikvisionSnapshot | null = null;

          for (const candidate of ordered) {
            const res = await this.hikvision.collect(candidate);
            winner = candidate;
            snap = res;
            if (res.status === 'online') {
              this.preferredHikvisionPrimary.set(devId, candidate.id);
              break;
            }
          }

          if (snap) {
            for (const cfg of group) {
              if (cfg.id === winner.id) {
                this.hikvisionSnapshots.set(cfg.id, { ...snap, deduplicatedFrom: undefined });
              } else {
                this.hikvisionSnapshots.set(cfg.id, {
                  ...snap,
                  configId: cfg.id,
                  name: cfg.name,
                  host: cfg.host,
                  deduplicatedFrom: `Hikvision (${winner.name})`,
                  channels: snap.channels.map((c) => ({ ...c })),
                  hdds: snap.hdds.map((h) => ({ ...h })),
                  history: snap.history.map((h) => ({ ...h })),
                });
              }
            }
          }
        }),
        ...enabledUnifi.map(async (uCfg) => {
          const snap = await this.unifi.collect(uCfg);
          this.unifiSnapshots.set(uCfg.id, snap);
        }),
        ...this.store
          .listUps()
          .filter((u) => u.enabled)
          .map(async (upsCfg) => {
            const snap = await this.ups.collect(upsCfg, ({ accessToken, refreshToken }) => {
              this.store.upsertUps({
                ...upsCfg,
                password: accessToken,
                community: refreshToken,
              });
            });
            this.upsSnapshots.set(upsCfg.id, snap);
          }),
      ]);

      // Final identity rebuild so overview carries complete canonical IDs & linkedSources
      this.rebuildDeviceRegistry();
    } finally {
      this.polling = false;
      this.notify();
    }
  }

  async pollServerById(id: string): Promise<void> {
    const cfg = this.store.getServer(id);
    if (!cfg || !cfg.enabled) return;
    const metrics = await this.ssh.collect(cfg);
    this.sshMetrics.set(cfg.id, metrics);
    this.rebuildDeviceRegistry();
    await this.syncSshProxmoxHost(cfg, metrics);
    this.notify();
  }

  private isLikelyProxmoxServer(cfg: SshServerConfig, metrics: SshServerMetrics): boolean {
    if (metrics.status !== 'online') return false;
    return (
      /\bpve\b|-pve/i.test(metrics.kernel || '') ||
      /proxmox/i.test(metrics.osPrettyName || '') ||
      cfg.tags.some((t) => /proxmox|pve/i.test(t))
    );
  }

  private hasProxmoxConfigForServer(cfg: SshServerConfig, metrics?: SshServerMetrics): boolean {
    const sshCanonical = this.devices.getCanonicalIdFor(`ssh:${cfg.id}`);
    const serverIps = new Set(
      [cfg.host, metrics?.ipAddress, ...(metrics?.allIps || []), metrics?.tailscale?.ip]
        .filter(Boolean)
        .map((s) => String(s).toLowerCase()),
    );
    for (const pve of this.store.listProxmox()) {
      if (serverIps.has(pve.host.toLowerCase())) return true;
      const pveHostCanonical = this.devices.getCanonicalIdFor(`proxmox-host:${pve.id}`);
      if (pveHostCanonical === sshCanonical) return true;
      const snap = this.proxmoxSnapshots.get(pve.id);
      if (snap) {
        for (const n of snap.nodes) {
          if (this.devices.getCanonicalIdFor(`proxmox:${pve.id}:${n.node}`) === sshCanonical) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private async syncSshProxmoxHost(cfg: SshServerConfig, metrics: SshServerMetrics): Promise<void> {
    if (!this.isLikelyProxmoxServer(cfg, metrics)) {
      this.sshProxmoxSnapshots.delete(cfg.id);
      return;
    }
    if (this.hasProxmoxConfigForServer(cfg, metrics)) {
      this.sshProxmoxSnapshots.delete(cfg.id);
      return;
    }

    // 1. If password auth is available, try auto-linking via Proxmox API (:8006)
    if (!this.autoProxmoxPromoted.has(cfg.id) && cfg.password) {
      this.autoProxmoxPromoted.add(cfg.id);
      const pamUser = cfg.username.includes('@') ? cfg.username : `${cfg.username}@pam`;
      try {
        const testRes = await this.proxmox.testConnection({
          id: 'auto-pve',
          name: cfg.name,
          host: cfg.host,
          port: 8006,
          authType: 'password',
          username: pamUser,
          password: cfg.password,
          tokenId: '',
          allowInsecureTls: true,
          enabled: true,
          createdAt: new Date().toISOString(),
        });
        if (testRes.ok) {
          const saved = this.store.upsertProxmox({
            name: cfg.name,
            host: cfg.host,
            port: 8006,
            authType: 'password',
            username: pamUser,
            password: cfg.password,
            tokenId: '',
            allowInsecureTls: true,
            enabled: true,
          });
          this.sshProxmoxSnapshots.delete(cfg.id);
          await this.pollProxmoxById(saved.id);
          return;
        }
      } catch {
        // Fall through to SSH pvesh telemetry
      }
    }

    // 2. Collect Proxmox cluster/node/guest/storage directly over SSH via `pvesh`
    const now = Date.now();
    const nodeName = (metrics.hostname || cfg.name || cfg.host).split('.')[0] || 'pve';
    const nodes: ProxmoxNodeMetrics[] = [];
    const guests: ProxmoxGuest[] = [];
    const storage: ProxmoxStorage[] = [];

    try {
      const cmdRes = await this.ssh.runCommand(cfg, 'pvesh get /cluster/resources --output-format json 2>/dev/null', 8000);
      if (cmdRes.exitCode === 0 && cmdRes.stdout.trim().startsWith('[')) {
        const items = JSON.parse(cmdRes.stdout) as Array<Record<string, any>>;
        for (const item of items) {
          if (item.type === 'node') {
            const nName = String(item.node || nodeName);
            const maxMem = Number(item.maxmem || metrics.memTotalBytes || 0);
            const usedMem = Number(item.mem || metrics.memUsedBytes || 0);
            const cpuFrac = Number(item.cpu || 0);
            const maxDisk = Number(item.maxdisk || metrics.disks[0]?.totalBytes || 0);
            const usedDisk = Number(item.disk || metrics.disks[0]?.usedBytes || 0);
            nodes.push({
              node: nName,
              status: item.status === 'online' ? 'online' : 'offline',
              cpuPercent: Math.round((cpuFrac > 0 ? cpuFrac * 100 : metrics.cpuPercent) * 10) / 10,
              maxCpu: Number(item.maxcpu || metrics.cpuCores || 1),
              cpuModel: metrics.cpuModel || '',
              memUsedBytes: usedMem,
              memTotalBytes: maxMem,
              memPercent: maxMem > 0 ? Math.round((usedMem / maxMem) * 1000) / 10 : metrics.memPercent,
              swapUsedBytes: metrics.swapUsedBytes || 0,
              swapTotalBytes: metrics.swapTotalBytes || 0,
              rootfsUsedBytes: usedDisk,
              rootfsTotalBytes: maxDisk,
              rootfsPercent: maxDisk > 0 ? Math.round((usedDisk / maxDisk) * 1000) / 10 : 0,
              uptimeSeconds: Number(item.uptime || metrics.uptimeSeconds || 0),
              pveVersion: metrics.osPrettyName || 'Proxmox VE (SSH)',
              kernelVersion: metrics.kernel || '',
              loadAvg: metrics.loadAvg || [0, 0, 0],
              ipAddress: metrics.ipAddress || cfg.host,
              canonicalDeviceId: this.devices.getCanonicalIdFor(`ssh:${cfg.id}`),
              history: metrics.history || [],
            });
          } else if (item.type === 'qemu' || item.type === 'lxc') {
            const maxMem = Number(item.maxmem || 0);
            const usedMem = Number(item.mem || 0);
            guests.push({
              vmid: Number(item.vmid || 0),
              name: String(item.name || `${item.type}-${item.vmid}`),
              node: String(item.node || nodeName),
              type: item.type,
              status: item.status === 'running' ? 'running' : item.status === 'paused' ? 'paused' : 'stopped',
              cpuPercent: Math.round(Number(item.cpu || 0) * 1000) / 10,
              cpus: Number(item.maxcpu || 1),
              memUsedBytes: usedMem,
              memMaxBytes: maxMem,
              memPercent: maxMem > 0 ? Math.round((usedMem / maxMem) * 1000) / 10 : 0,
              diskUsedBytes: Number(item.disk || 0),
              diskMaxBytes: Number(item.maxdisk || 0),
              uptimeSeconds: Number(item.uptime || 0),
              netInBytes: Number(item.netin || 0),
              netOutBytes: Number(item.netout || 0),
              template: Boolean(item.template),
              tags: item.tags ? String(item.tags).split(';').filter(Boolean) : [],
            });
          } else if (item.type === 'storage') {
            const total = Number(item.maxdisk || 0);
            const used = Number(item.disk || 0);
            storage.push({
              storage: String(item.storage || 'local'),
              node: String(item.node || nodeName),
              type: String(item.plugintype || 'dir'),
              content: String(item.content || ''),
              active: item.status === 'available',
              enabled: true,
              shared: Boolean(item.shared),
              usedBytes: used,
              totalBytes: total,
              availBytes: Math.max(0, total - used),
              usedPercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
            });
          }
        }
      }
    } catch {
      // Fallback to single-node SSH summary below
    }

    if (nodes.length === 0) {
      const rootTotal = metrics.disks[0]?.totalBytes || 0;
      const rootUsed = metrics.disks[0]?.usedBytes || 0;
      nodes.push({
        node: nodeName,
        status: 'online',
        cpuPercent: metrics.cpuPercent,
        maxCpu: metrics.cpuCores || 1,
        cpuModel: metrics.cpuModel || '',
        memUsedBytes: metrics.memUsedBytes,
        memTotalBytes: metrics.memTotalBytes,
        memPercent: metrics.memPercent,
        swapUsedBytes: metrics.swapUsedBytes || 0,
        swapTotalBytes: metrics.swapTotalBytes || 0,
        rootfsUsedBytes: rootUsed,
        rootfsTotalBytes: rootTotal,
        rootfsPercent: rootTotal > 0 ? Math.round((rootUsed / rootTotal) * 1000) / 10 : 0,
        uptimeSeconds: metrics.uptimeSeconds,
        pveVersion: metrics.osPrettyName || 'Proxmox VE (SSH)',
        kernelVersion: metrics.kernel || '',
        loadAvg: metrics.loadAvg || [0, 0, 0],
        ipAddress: metrics.ipAddress || cfg.host,
        canonicalDeviceId: this.devices.getCanonicalIdFor(`ssh:${cfg.id}`),
        history: metrics.history || [],
      });
    }

    this.sshProxmoxSnapshots.set(cfg.id, {
      configId: `ssh-pve:${cfg.id}`,
      name: `${cfg.name} (via SSH)`,
      host: cfg.host,
      status: 'online',
      collectedAt: now,
      clusterName: cfg.name,
      quorate: true,
      nodes,
      guests,
      storage,
      tasks: [],
    });
  }

  async pollProxmoxById(id: string): Promise<void> {
    const cfg = this.store.getProxmox(id);
    if (!cfg || !cfg.enabled) return;
    this.rebuildDeviceRegistry();
    const onlineSshByDevice = new Map<string, SshServerMetrics>();
    for (const srv of this.store.listServers()) {
      const m = this.sshMetrics.get(srv.id);
      if (m && m.status === 'online') {
        const devId = this.devices.getCanonicalIdFor(`ssh:${srv.id}`);
        if (!onlineSshByDevice.has(devId)) onlineSshByDevice.set(devId, m);
      }
    }
    const resolver = (nodeName: string, nodeIp?: string): SshServerMetrics | undefined => {
      const direct = this.devices.getByEntity(`proxmox:${cfg.id}:${nodeName}`);
      if (direct && onlineSshByDevice.has(direct.canonicalId)) {
        return onlineSshByDevice.get(direct.canonicalId);
      }
      const hinted = this.devices.findByHint(nodeIp || cfg.host, nodeName);
      if (hinted && onlineSshByDevice.has(hinted.canonicalId)) {
        return onlineSshByDevice.get(hinted.canonicalId);
      }
      return undefined;
    };
    const snap = await this.proxmox.collectCluster(cfg, resolver);
    this.proxmoxSnapshots.set(cfg.id, snap);
    this.rebuildDeviceRegistry();
    this.notify();
  }

  removeServerState(id: string): void {
    this.ssh.disconnect(id);
    this.sshMetrics.delete(id);
    this.sshProxmoxSnapshots.delete(id);
    this.autoProxmoxPromoted.delete(id);
    this.devices.remove(`ssh:${id}`);
    this.rebuildDeviceRegistry();
    this.notify();
  }

  removeProxmoxState(id: string): void {
    this.proxmox.clearSession(id);
    this.proxmoxSnapshots.delete(id);
    this.devices.remove(`proxmox-host:${id}`);
    this.devices.removeByPrefix(`proxmox:${id}:`);
    this.rebuildDeviceRegistry();
    this.notify();
  }

  async pollTailscaleById(id: string): Promise<TailscaleSnapshot | null> {
    const cfg = this.store.getTailscale(id);
    if (!cfg || !cfg.enabled) return null;
    this.tailscaleLastPoll.set(cfg.id, Date.now());
    const snap = await this.tailscale.collect(cfg);
    this.tailscaleSnapshots.set(cfg.id, snap);
    this.rebuildDeviceRegistry();
    this.notify();
    return snap;
  }

  removeTailscaleState(id: string): void {
    this.tailscale.clearCache(id);
    this.tailscaleSnapshots.delete(id);
    this.tailscaleLastPoll.delete(id);
    this.devices.removeByPrefix(`tailscale:${id}:`);
    this.rebuildDeviceRegistry();
    this.notify();
  }

  async pollOpnsenseById(id: string): Promise<OpnsenseSnapshot | null> {
    const cfg = this.store.getOpnsense(id);
    if (!cfg || !cfg.enabled) return null;
    const snap = await this.opnsense.collect(cfg);
    this.opnsenseSnapshots.set(cfg.id, snap);
    this.rebuildDeviceRegistry();
    this.notify();
    return snap;
  }

  removeOpnsenseState(id: string): void {
    this.opnsenseSnapshots.delete(id);
    this.devices.remove(`opnsense:${id}`);
    this.rebuildDeviceRegistry();
    this.notify();
  }

  async pollHikvisionById(id: string): Promise<HikvisionSnapshot | null> {
    const cfg = this.store.getHikvision(id);
    if (!cfg || !cfg.enabled) return null;
    const snap = await this.hikvision.collect(cfg);
    this.hikvisionSnapshots.set(cfg.id, snap);
    this.rebuildDeviceRegistry();
    this.notify();
    return snap;
  }

  removeHikvisionState(id: string): void {
    this.hikvisionSnapshots.delete(id);
    this.devices.remove(`hikvision:${id}`);
    this.rebuildDeviceRegistry();
    this.notify();
  }

  async pollUnifiById(id: string): Promise<UnifiSnapshot | null> {
    const cfg = this.store.getUnifi(id);
    if (!cfg || !cfg.enabled) return null;
    const snap = await this.unifi.collect(cfg);
    this.unifiSnapshots.set(cfg.id, snap);
    this.rebuildDeviceRegistry();
    this.notify();
    return snap;
  }

  removeUnifiState(id: string): void {
    this.unifiSnapshots.delete(id);
    this.devices.remove(`unifi:${id}`);
    this.rebuildDeviceRegistry();
    this.notify();
  }

  async pollUpsById(id: string): Promise<UpsSnapshot | null> {
    const cfg = this.store.getUps(id);
    if (!cfg || !cfg.enabled) return null;
    const snap = await this.ups.collect(cfg, ({ accessToken, refreshToken }) => {
      this.store.upsertUps({
        ...cfg,
        password: accessToken,
        community: refreshToken,
      });
    });
    this.upsSnapshots.set(cfg.id, snap);
    this.notify();
    return snap;
  }

  removeUpsState(id: string): void {
    this.upsSnapshots.delete(id);
    this.notify();
  }

  resetAllSnapshots(): void {
    this.ssh.disconnectAll();
    this.sshMetrics.clear();
    this.proxmoxSnapshots.clear();
    this.sshProxmoxSnapshots.clear();
    this.autoProxmoxPromoted.clear();
    this.tailscaleSnapshots.clear();
    this.opnsenseSnapshots.clear();
    this.hikvisionSnapshots.clear();
    this.unifiSnapshots.clear();
    this.upsSnapshots.clear();
    this.tailscaleLastPoll.clear();
    this.preferredSshPrimary.clear();
    this.preferredProxmoxPrimary.clear();
    this.preferredTailscalePrimary.clear();
    this.preferredOpnsensePrimary.clear();
    this.rebuildDeviceRegistry();
    this.notify();
    void this.pollNow(true);
  }

  async executeOpnsenseServiceAction(
    configId: string,
    serviceId: string,
    action: OpnsenseServiceAction,
  ): Promise<{ ok: boolean; message: string }> {
    if (configId === 'demo-opnsense') {
      const res = this.demo.executeDemoOpnsenseService(serviceId, action);
      this.notify();
      return res;
    }
    const cfg = this.store.getOpnsense(configId);
    if (!cfg) throw new Error('OPNsense connection not found');
    const res = await this.opnsense.serviceAction(cfg, serviceId, action);
    setTimeout(() => {
      void this.pollOpnsenseById(configId);
    }, 1200);
    return res;
  }

  async executeOpnsenseSystemAction(
    configId: string,
    action: 'reboot' | 'halt' | 'firmware-check',
  ): Promise<{ ok: boolean; message: string }> {
    if (configId === 'demo-opnsense') {
      return { ok: true, message: `[Demo] OPNsense ${action} triggered.` };
    }
    const cfg = this.store.getOpnsense(configId);
    if (!cfg) throw new Error('OPNsense connection not found');
    const res = await this.opnsense.systemAction(cfg, action);
    if (action === 'firmware-check') {
      setTimeout(() => {
        void this.pollOpnsenseById(configId);
      }, 2500);
    }
    return res;
  }

  async executeServerCommand(serverId: string, command: string): Promise<CommandResult> {
    if (serverId.startsWith('demo-')) {
      return this.demo.runDemoCommand(serverId, command);
    }
    const cfg = this.store.getServer(serverId);
    if (!cfg) throw new Error('Server not found');
    return this.ssh.runCommand(cfg, command);
  }

  async executeProxmoxGuestAction(
    configId: string,
    node: string,
    type: 'qemu' | 'lxc',
    vmid: number,
    action: GuestPowerAction,
  ): Promise<{ upid: string }> {
    if (configId === 'demo-pve-cluster') {
      const res = this.demo.executeDemoGuestAction(node, type, vmid, action);
      this.notify();
      return res;
    }
    if (configId.startsWith('ssh-pve:')) {
      const serverId = configId.slice('ssh-pve:'.length);
      const srv = this.store.getServer(serverId);
      if (!srv) throw new Error('SSH Proxmox host not found');
      const bin = type === 'qemu' ? 'qm' : 'pct';
      const cmd = `${bin} ${action} ${Number(vmid)}`;
      const out = await this.ssh.runCommand(srv, cmd, 20000);
      if (out.exitCode !== 0) {
        throw new Error(out.stderr || out.stdout || `${cmd} failed with exit code ${out.exitCode}`);
      }
      setTimeout(() => {
        void this.pollServerById(serverId);
      }, 1500);
      return { upid: `ssh:${serverId}:${bin}:${action}:${vmid}` };
    }
    const cfg = this.store.getProxmox(configId);
    if (!cfg) throw new Error('Proxmox connection not found');
    const res = await this.proxmox.executeGuestAction(cfg, node, type, vmid, action);
    setTimeout(() => {
      void this.pollProxmoxById(configId);
    }, 1500);
    return res;
  }

  getOverview(): OverviewResponse {
    const settings = this.store.getSettings();
    const now = Date.now();

    const realServers: Array<{ config: SshServerPublic; metrics: SshServerMetrics }> = this.store
      .listServers()
      .map((cfg) => {
        const devInfo = this.devices.getByEntity(`ssh:${cfg.id}`);
        const baseMetrics = this.sshMetrics.get(cfg.id) ?? {
          serverId: cfg.id,
          status: cfg.enabled ? 'connecting' : 'offline',
          collectedAt: now,
          hostname: cfg.name,
          osPrettyName: cfg.enabled ? 'Connecting...' : 'Disabled',
          kernel: '-',
          arch: '-',
          ipAddress: cfg.host,
          uptimeSeconds: 0,
          cpuModel: '-',
          cpuCores: 0,
          cpuPercent: 0,
          loadAvg: [0, 0, 0],
          memTotalBytes: 0,
          memUsedBytes: 0,
          memAvailableBytes: 0,
          memPercent: 0,
          swapTotalBytes: 0,
          swapUsedBytes: 0,
          swapPercent: 0,
          disks: [],
          network: [],
          netTotalRxBps: 0,
          netTotalTxBps: 0,
          temperatures: [],
          maxTempC: null,
          topProcesses: [],
          services: [],
          history: [],
        };
        const metrics: SshServerMetrics = devInfo
          ? {
              ...baseMetrics,
              canonicalDeviceId: devInfo.canonicalId,
              linkedSources: devInfo.linkedSources,
            }
          : baseMetrics;
        return { config: this.store.toPublicServer(cfg), metrics };
      });

    const realProxmox: ProxmoxClusterSnapshot[] = this.store.listProxmox().map((cfg) => {
      const snap = this.proxmoxSnapshots.get(cfg.id);
      if (!snap) {
        return {
          configId: cfg.id,
          name: cfg.name,
          host: cfg.host,
          status: cfg.enabled ? 'connecting' : 'offline',
          collectedAt: now,
          clusterName: cfg.name,
          quorate: false,
          nodes: [],
          guests: [],
          storage: [],
          tasks: [],
        };
      }
      return {
        ...snap,
        nodes: snap.nodes.map((n) => {
          const devInfo = this.devices.getByEntity(`proxmox:${cfg.id}:${n.node}`);
          return devInfo
            ? {
                ...n,
                canonicalDeviceId: devInfo.canonicalId,
                linkedSources: devInfo.linkedSources,
              }
            : n;
        }),
      };
    });

    for (const [serverId, sshSnap] of this.sshProxmoxSnapshots.entries()) {
      const srv = this.store.getServer(serverId);
      if (!srv || !srv.enabled) continue;
      if (this.hasProxmoxConfigForServer(srv, this.sshMetrics.get(serverId))) continue;
      realProxmox.push(sshSnap);
    }

    const realTailscale: TailscaleSnapshot[] = this.store.listTailscale().map((cfg) => {
      const snap = this.tailscaleSnapshots.get(cfg.id);
      if (!snap) {
        return {
          configId: cfg.id,
          name: cfg.name,
          mode: cfg.mode,
          tailnetName: cfg.tailnet && cfg.tailnet !== '-' ? cfg.tailnet : cfg.name,
          status: cfg.enabled ? 'connecting' : 'offline',
          collectedAt: now,
          devices: [],
        };
      }
      return {
        ...snap,
        devices: snap.devices.map((d) => {
          const devInfo = this.devices.getByEntity(`tailscale:${cfg.id}:${d.id}`);
          return devInfo
            ? {
                ...d,
                canonicalDeviceId: devInfo.canonicalId,
                linkedSources: devInfo.linkedSources,
              }
            : d;
        }),
      };
    });

    const realOpnsense: OpnsenseSnapshot[] = this.store.listOpnsense().map((cfg) => {
      const devInfo = this.devices.getByEntity(`opnsense:${cfg.id}`);
      const snap = this.opnsenseSnapshots.get(cfg.id) ?? {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        status: cfg.enabled ? 'connecting' : 'offline',
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
        history: [],
      };
      return devInfo
        ? {
            ...snap,
            canonicalDeviceId: devInfo.canonicalId,
            linkedSources: devInfo.linkedSources,
          }
        : snap;
    });

    const realHikvision: HikvisionSnapshot[] = this.store.listHikvision().map((cfg) => {
      const devInfo = this.devices.getByEntity(`hikvision:${cfg.id}`);
      const snap: HikvisionSnapshot = this.hikvisionSnapshots.get(cfg.id) ?? {
        configId: cfg.id,
        name: cfg.name,
        host: cfg.host,
        status: cfg.enabled ? 'connecting' : 'offline',
        collectedAt: now,
        deviceName: cfg.name,
        deviceType: cfg.deviceKind === 'dvr' ? 'DVR' : cfg.deviceKind === 'camera' ? 'IPCamera' : 'NVR',
        model: '-',
        serialNumber: '-',
        firmwareVersion: '-',
        firmwareBuild: '-',
        macAddress: '-',
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
        history: [],
      };
      return devInfo
        ? {
            ...snap,
            canonicalDeviceId: devInfo.canonicalId,
            linkedSources: devInfo.linkedSources,
          }
        : snap;
    });

    const servers = settings.demoMode ? [...realServers, ...this.demo.getServerSnapshots()] : realServers;
    const proxmox = settings.demoMode ? [...realProxmox, this.demo.getProxmoxSnapshot()] : realProxmox;
    const tailscale =
      settings.demoMode && realTailscale.length === 0
        ? [this.demo.getTailscaleSnapshot()]
        : realTailscale;
    const opnsense =
      settings.demoMode && realOpnsense.length === 0
        ? [this.demo.getOpnsenseSnapshot()]
        : realOpnsense;
    const hikvision =
      settings.demoMode && realHikvision.length === 0
        ? [this.demo.getHikvisionSnapshot()]
        : realHikvision;

    const enabledUnifi = this.store.listUnifi().filter((u) => u.enabled);
    const unifi: UnifiSnapshot[] = enabledUnifi.map((u) => {
      return (
        this.unifiSnapshots.get(u.id) ?? {
          configId: u.id,
          name: u.name,
          host: u.host,
          controllerType: u.controllerType,
          site: u.site || 'default',
          status: 'connecting',
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
          history: [],
        }
      );
    });

    const alerts: AlertItem[] = [];
    const seenAlertKeys = new Set<string>();
    const countedComputeDevices = new Set<string>();
    const countedStorageNetDevices = new Set<string>();
    const seenProxmoxGuestKeys = new Set<string>();

    const pushAlertOnce = (dedupKey: string, alert: AlertItem) => {
      if (seenAlertKeys.has(dedupKey)) return;
      seenAlertKeys.add(dedupKey);
      alerts.push(alert);
    };

    let cpuSum = 0;
    let cpuCount = 0;
    let totalMemUsedBytes = 0;
    let totalMemBytes = 0;
    let totalStorageUsedBytes = 0;
    let totalStorageBytes = 0;
    let totalNetRxBps = 0;
    let totalNetTxBps = 0;

    let onlineServers = 0;
    for (const s of servers) {
      const devKey = s.metrics.canonicalDeviceId || `ssh:${s.config.id}`;
      if (s.metrics.status === 'online') {
        onlineServers++;
        if (!countedComputeDevices.has(devKey)) {
          countedComputeDevices.add(devKey);
          cpuSum += s.metrics.cpuPercent;
          cpuCount++;
          totalMemUsedBytes += s.metrics.memUsedBytes;
          totalMemBytes += s.metrics.memTotalBytes;
        }
        if (!countedStorageNetDevices.has(devKey)) {
          countedStorageNetDevices.add(devKey);
          totalNetRxBps += s.metrics.netTotalRxBps;
          totalNetTxBps += s.metrics.netTotalTxBps;
          for (const d of s.metrics.disks) {
            totalStorageUsedBytes += d.usedBytes;
            totalStorageBytes += d.totalBytes;
          }
        }

        for (const d of s.metrics.disks) {
          if (d.usedPercent >= 88) {
            pushAlertOnce(`disk:${devKey}:${d.mount}`, {
              id: `disk-${s.config.id}-${d.mount}`,
              severity: d.usedPercent >= 95 ? 'critical' : 'warning',
              source: s.config.name,
              message: `Mount ${d.mount} is at ${d.usedPercent}% capacity`,
              timestamp: now,
            });
          }
        }
        if (s.metrics.cpuPercent >= 88) {
          pushAlertOnce(`cpu:${devKey}`, {
            id: `cpu-${s.config.id}`,
            severity: 'warning',
            source: s.config.name,
            message: `High CPU utilization (${s.metrics.cpuPercent}%)`,
            timestamp: now,
          });
        }
        if (s.metrics.memPercent >= 90) {
          pushAlertOnce(`mem:${devKey}`, {
            id: `mem-${s.config.id}`,
            severity: 'warning',
            source: s.config.name,
            message: `High memory pressure (${s.metrics.memPercent}%)`,
            timestamp: now,
          });
        }
        if (s.metrics.maxTempC !== null && s.metrics.maxTempC >= 75) {
          pushAlertOnce(`temp:${devKey}`, {
            id: `temp-${s.config.id}`,
            severity: s.metrics.maxTempC >= 85 ? 'critical' : 'warning',
            source: s.config.name,
            message: `Thermal sensor elevated (${s.metrics.maxTempC}°C)`,
            timestamp: now,
          });
        }
      } else if (s.metrics.status === 'error') {
        pushAlertOnce(`err:${s.config.id}`, {
          id: `err-${s.config.id}`,
          severity: 'critical',
          source: s.config.name,
          message: s.metrics.errorMessage || 'SSH connection failed',
          timestamp: now,
        });
      }
    }

    let totalProxmoxNodes = 0;
    let onlineProxmoxNodes = 0;
    let runningVms = 0;
    let totalVms = 0;
    let runningLxcs = 0;
    let totalLxcs = 0;

    for (const cluster of proxmox) {
      if (cluster.status === 'error') {
        pushAlertOnce(`pve-err:${cluster.configId}`, {
          id: `pve-err-${cluster.configId}`,
          severity: 'critical',
          source: cluster.name,
          message: cluster.errorMessage || 'Proxmox API unreachable',
          timestamp: now,
        });
      }
      for (const n of cluster.nodes) {
        const devKey = n.canonicalDeviceId || `proxmox:${cluster.configId}:${n.node}`;
        totalProxmoxNodes++;
        if (n.status === 'online') {
          onlineProxmoxNodes++;
          // Only add Proxmox node compute if this physical device wasn't already counted via SSH or another Proxmox config
          if (!countedComputeDevices.has(devKey)) {
            countedComputeDevices.add(devKey);
            cpuSum += n.cpuPercent;
            cpuCount++;
            totalMemUsedBytes += n.memUsedBytes;
            totalMemBytes += n.memTotalBytes;
          }
        } else {
          pushAlertOnce(`pve-node:${devKey}`, {
            id: `pve-node-${cluster.configId}-${n.node}`,
            severity: 'critical',
            source: `${cluster.clusterName}/${n.node}`,
            message: 'Proxmox node is offline',
            timestamp: now,
          });
        }
      }
      for (const g of cluster.guests) {
        if (g.template) continue;
        // Deduplicate guests if multiple Proxmox configs point to the same cluster/node
        const nodeObj = cluster.nodes.find((n) => n.node === g.node);
        const nodeKey = nodeObj?.canonicalDeviceId || `${cluster.clusterName}:${g.node}`;
        const guestKey = `${nodeKey}:${g.type}:${g.vmid}`;
        if (seenProxmoxGuestKeys.has(guestKey)) continue;
        seenProxmoxGuestKeys.add(guestKey);

        if (g.type === 'qemu') {
          totalVms++;
          if (g.status === 'running') runningVms++;
        } else {
          totalLxcs++;
          if (g.status === 'running') runningLxcs++;
        }
      }
    }

    const seenTailscaleDevices = new Set<string>();
    let tailscaleOnlineDevices = 0;
    let tailscaleTotalDevices = 0;
    for (const ts of tailscale) {
      if (ts.status === 'error') {
        pushAlertOnce(`ts-err:${ts.configId}`, {
          id: `ts-err-${ts.configId}`,
          severity: 'warning',
          source: ts.name,
          message: ts.errorMessage || 'Tailscale connection failed',
          timestamp: now,
        });
      }
      for (const d of ts.devices) {
        const key = d.id || d.ipv4 || d.hostname;
        if (seenTailscaleDevices.has(key)) continue;
        seenTailscaleDevices.add(key);
        tailscaleTotalDevices++;
        if (d.online) tailscaleOnlineDevices++;
      }
    }

    let opnsenseOnline = 0;
    const opnsenseTotal = opnsense.length;
    let opnsenseGatewaysOnline = 0;
    let opnsenseGatewaysTotal = 0;
    const seenOpnDevices = new Set<string>();

    for (const opn of opnsense) {
      const devKey = opn.canonicalDeviceId || `opnsense:${opn.configId}`;
      if (opn.status === 'online') {
        opnsenseOnline++;
        const firstForDevice = !seenOpnDevices.has(devKey);
        seenOpnDevices.add(devKey);
        if (firstForDevice) {
          for (const gw of opn.gateways) {
            opnsenseGatewaysTotal++;
            if (gw.status === 'online') {
              opnsenseGatewaysOnline++;
            } else if (gw.status === 'down') {
              pushAlertOnce(`opn-gw:${devKey}:${gw.name}`, {
                id: `opn-gw-${opn.configId}-${gw.name}`,
                severity: 'critical',
                source: `${opn.name}/${gw.name}`,
                message: `WAN Gateway ${gw.name} (${gw.address}) is DOWN`,
                timestamp: now,
              });
            } else if (gw.lossPercent !== null && gw.lossPercent >= 5) {
              pushAlertOnce(`opn-loss:${devKey}:${gw.name}`, {
                id: `opn-loss-${opn.configId}-${gw.name}`,
                severity: 'warning',
                source: `${opn.name}/${gw.name}`,
                message: `Gateway packet loss elevated (${gw.lossPercent}%)`,
                timestamp: now,
              });
            }
          }
          if (opn.pfStatesPercent >= 85) {
            pushAlertOnce(`opn-pf:${devKey}`, {
              id: `opn-pf-${opn.configId}`,
              severity: 'warning',
              source: opn.name,
              message: `Firewall PF state table at ${opn.pfStatesPercent}%`,
              timestamp: now,
            });
          }
        }
      } else if (opn.status === 'error') {
        pushAlertOnce(`opn-err:${opn.configId}`, {
          id: `opn-err-${opn.configId}`,
          severity: 'critical',
          source: opn.name,
          message: opn.errorMessage || 'OPNsense API unreachable',
          timestamp: now,
        });
      }
    }

    let hikvisionOnline = 0;
    const hikvisionTotal = hikvision.length;
    let hikvisionCamerasOnline = 0;
    let hikvisionCamerasTotal = 0;
    const seenHikDevices = new Set<string>();

    for (const hik of hikvision) {
      const devKey = hik.canonicalDeviceId || `hikvision:${hik.configId}`;
      if (hik.status === 'online') {
        hikvisionOnline++;
        const firstForDevice = !seenHikDevices.has(devKey);
        seenHikDevices.add(devKey);
        if (firstForDevice) {
          hikvisionCamerasOnline += hik.onlineChannels;
          hikvisionCamerasTotal += hik.totalChannels;

          for (const hdd of hik.hdds) {
            if (hdd.status === 'error') {
              pushAlertOnce(`hik-hdd:${devKey}:${hdd.id}`, {
                id: `hik-hdd-${hik.configId}-${hdd.id}`,
                severity: 'critical',
                source: `${hik.name}/${hdd.name}`,
                message: `NVR SATA bay ${hdd.name} reported status: ${hdd.statusText}`,
                timestamp: now,
              });
            }
          }
          for (const ch of hik.channels) {
            if (!ch.online) {
              pushAlertOnce(`hik-ch:${devKey}:${ch.id}`, {
                id: `hik-ch-${hik.configId}-${ch.id}`,
                severity: 'warning',
                source: `${hik.name}/CH${ch.id}`,
                message: `Camera "${ch.name}" (CH${ch.id}) is offline`,
                timestamp: now,
              });
            }
          }
        }
      } else if (hik.status === 'error') {
        pushAlertOnce(`hik-err:${hik.configId}`, {
          id: `hik-err-${hik.configId}`,
          severity: 'critical',
          source: hik.name,
          message: hik.errorMessage || 'Hikvision ISAPI unreachable',
          timestamp: now,
        });
      }
    }

    const allCanonicalDevices = this.devices.getAllDevices();
    let deduplicatedSources = 0;
    for (const dev of allCanonicalDevices) {
      if (dev.entityKeys.length > 1) {
        deduplicatedSources += dev.entityKeys.length - 1;
      }
    }

    let unifiOnline = 0;
    let unifiDevicesOnline = 0;
    let unifiDevicesTotal = 0;
    let unifiClientsTotal = 0;
    for (const u of unifi) {
      if (u.status === 'online') unifiOnline++;
      unifiDevicesOnline += u.onlineDevices;
      unifiDevicesTotal += u.totalDevices;
      unifiClientsTotal += u.totalClients;
    }

    const enabledUps = this.store.listUps().filter((u) => u.enabled);
    const ups: UpsSnapshot[] = enabledUps.map((u) => {
      return (
        this.upsSnapshots.get(u.id) ?? {
          configId: u.id,
          name: u.name,
          host: u.host,
          protocol: u.protocol,
          model: u.modelPreset === 'ibm-3000va-2700w-hv' ? 'IBM 3000VA/2700W Rack HV UPS' : u.name,
          manufacturer: 'IBM / Eaton',
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
          ratedVa: u.ratedVa || 3000,
          ratedWatts: u.ratedWatts || 2700,
          alarmsCount: 0,
          collectedAt: now,
        }
      );
    });

    return {
      timestamp: now,
      settings,
      servers,
      proxmox,
      tailscale,
      opnsense,
      hikvision,
      unifi,
      ups,
      summary: {
        totalServers: servers.length,
        onlineServers,
        totalProxmoxNodes,
        onlineProxmoxNodes,
        runningVms,
        totalVms,
        runningLxcs,
        totalLxcs,
        tailscaleOnlineDevices,
        tailscaleTotalDevices,
        opnsenseOnline,
        opnsenseTotal,
        opnsenseGatewaysOnline,
        opnsenseGatewaysTotal,
        hikvisionOnline,
        hikvisionTotal,
        hikvisionCamerasOnline,
        hikvisionCamerasTotal,
        unifiOnline,
        unifiTotal: unifi.length,
        unifiDevicesOnline,
        unifiDevicesTotal,
        unifiClientsTotal,
        avgCpuPercent: cpuCount > 0 ? Math.round((cpuSum / cpuCount) * 10) / 10 : 0,
        totalMemUsedBytes,
        totalMemBytes,
        totalStorageUsedBytes,
        totalStorageBytes,
        totalNetRxBps,
        totalNetTxBps,
        uniquePhysicalDevices: allCanonicalDevices.length,
        deduplicatedSources,
      },
      alerts,
    };
  }
}
