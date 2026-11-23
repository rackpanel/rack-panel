import type {
  CommandResult,
  GuestPowerAction,
  HikvisionSnapshot,
  OpnsenseService,
  OpnsenseServiceAction,
  OpnsenseSnapshot,
  ProxmoxClusterSnapshot,
  ProxmoxGuest,
  ProxmoxTask,
  SshServerMetrics,
  SshServerPublic,
  TailscaleSnapshot,
  TelemetryPoint,
} from '../../../shared/types.js';

const GB = 1024 * 1024 * 1024;
const TB = 1024 * GB;

interface DemoGuestState extends ProxmoxGuest {
  baseCpu: number;
  baseMemRatio: number;
}

export class DemoProvider {
  private startedAt = Date.now();
  private tick = 0;
  private serverHistories = new Map<string, TelemetryPoint[]>();
  private pveNodeHistories = new Map<string, TelemetryPoint[]>();
  private opnsenseHistory: TelemetryPoint[] = [];
  private hikvisionHistory: TelemetryPoint[] = [];
  private demoOpnServices: OpnsenseService[] = [
    { id: 'unbound', name: 'unbound', description: 'Unbound DNS Resolver', running: true },
    { id: 'kea-dhcp4', name: 'kea-dhcp4', description: 'Kea DHCPv4 Server', running: true },
    { id: 'wireguard', name: 'wireguard', description: 'WireGuard VPN', running: true },
    { id: 'suricata', name: 'suricata', description: 'Intrusion Detection (IDS/IPS)', running: true },
    { id: 'crowdsec', name: 'crowdsec', description: 'CrowdSec Security Engine', running: true },
    { id: 'dpinger', name: 'dpinger', description: 'Gateway Monitoring Daemon', running: true },
    { id: 'openssh', name: 'openssh', description: 'Secure Shell Daemon', running: true },
    { id: 'ntpd', name: 'ntpd', description: 'Network Time Daemon', running: true },
    { id: 'haproxy', name: 'haproxy', description: 'HAProxy Reverse Proxy', running: false },
  ];
  private demoGuests: DemoGuestState[];
  private demoTasks: ProxmoxTask[];

  readonly servers: SshServerPublic[] = [
    {
      id: 'demo-nas-01',
      name: 'NAS-VAULT-01',
      host: '10.10.20.11',
      port: 22,
      username: 'admin',
      authMethod: 'privateKey',
      rackUnit: 'U14-U15',
      tags: ['storage', 'zfs', '10gbe'],
      enabled: true,
      createdAt: new Date().toISOString(),
      hasPassword: false,
      hasPrivateKey: true,
      hasPassphrase: false,
      isDemo: true,
    },
    {
      id: 'demo-app-02',
      name: 'DOCKER-CORE-02',
      host: '10.10.20.12',
      port: 22,
      username: 'ops',
      authMethod: 'password',
      rackUnit: 'U12',
      tags: ['docker', 'production'],
      enabled: true,
      createdAt: new Date().toISOString(),
      hasPassword: true,
      hasPrivateKey: false,
      hasPassphrase: false,
      isDemo: true,
    },
    {
      id: 'demo-gw-01',
      name: 'EDGE-ROUTER-01',
      host: '10.10.20.1',
      port: 22,
      username: 'root',
      authMethod: 'privateKey',
      rackUnit: 'U04',
      tags: ['network', 'wireguard'],
      enabled: true,
      createdAt: new Date().toISOString(),
      hasPassword: false,
      hasPrivateKey: true,
      hasPassphrase: false,
      isDemo: true,
    },
  ];

  constructor() {
    const now = Date.now();
    this.demoGuests = [
      {
        vmid: 100,
        name: 'home-assistant',
        node: 'pve-node-01',
        type: 'qemu',
        status: 'running',
        cpuPercent: 14.2,
        cpus: 4,
        memUsedBytes: 2.9 * GB,
        memMaxBytes: 4 * GB,
        memPercent: 72.5,
        diskUsedBytes: 24 * GB,
        diskMaxBytes: 64 * GB,
        netInBytes: 42 * GB,
        netOutBytes: 18 * GB,
        uptimeSeconds: 1842310,
        tags: ['iot', 'critical'],
        template: false,
        baseCpu: 14,
        baseMemRatio: 0.72,
      },
      {
        vmid: 101,
        name: 'ubuntu-k3s-01',
        node: 'pve-node-01',
        type: 'qemu',
        status: 'running',
        cpuPercent: 38.6,
        cpus: 8,
        memUsedBytes: 11.4 * GB,
        memMaxBytes: 16 * GB,
        memPercent: 71.3,
        diskUsedBytes: 86 * GB,
        diskMaxBytes: 160 * GB,
        netInBytes: 310 * GB,
        netOutBytes: 265 * GB,
        uptimeSeconds: 1492100,
        tags: ['k3s', 'prod'],
        template: false,
        baseCpu: 38,
        baseMemRatio: 0.71,
      },
      {
        vmid: 102,
        name: 'win-server-lab',
        node: 'pve-node-02',
        type: 'qemu',
        status: 'stopped',
        cpuPercent: 0,
        cpus: 6,
        memUsedBytes: 0,
        memMaxBytes: 12 * GB,
        memPercent: 0,
        diskUsedBytes: 72 * GB,
        diskMaxBytes: 128 * GB,
        netInBytes: 0,
        netOutBytes: 0,
        uptimeSeconds: 0,
        tags: ['lab', 'windows'],
        template: false,
        baseCpu: 22,
        baseMemRatio: 0.58,
      },
      {
        vmid: 103,
        name: 'pbs-backup-vault',
        node: 'pve-node-02',
        type: 'qemu',
        status: 'running',
        cpuPercent: 9.4,
        cpus: 4,
        memUsedBytes: 4.1 * GB,
        memMaxBytes: 8 * GB,
        memPercent: 51.2,
        diskUsedBytes: 18 * GB,
        diskMaxBytes: 48 * GB,
        netInBytes: 1.4 * TB,
        netOutBytes: 220 * GB,
        uptimeSeconds: 2678400,
        tags: ['backup'],
        template: false,
        baseCpu: 11,
        baseMemRatio: 0.51,
      },
      {
        vmid: 201,
        name: 'pihole-dns-01',
        node: 'pve-node-01',
        type: 'lxc',
        status: 'running',
        cpuPercent: 2.1,
        cpus: 2,
        memUsedBytes: 340 * 1024 * 1024,
        memMaxBytes: 1 * GB,
        memPercent: 33.2,
        diskUsedBytes: 2.8 * GB,
        diskMaxBytes: 8 * GB,
        netInBytes: 12 * GB,
        netOutBytes: 9 * GB,
        uptimeSeconds: 3110400,
        tags: ['dns', 'core'],
        template: false,
        baseCpu: 2.4,
        baseMemRatio: 0.33,
      },
      {
        vmid: 202,
        name: 'traefik-ingress',
        node: 'pve-node-01',
        type: 'lxc',
        status: 'running',
        cpuPercent: 6.8,
        cpus: 2,
        memUsedBytes: 620 * 1024 * 1024,
        memMaxBytes: 2 * GB,
        memPercent: 30.3,
        diskUsedBytes: 3.1 * GB,
        diskMaxBytes: 8 * GB,
        netInBytes: 512 * GB,
        netOutBytes: 488 * GB,
        uptimeSeconds: 2940000,
        tags: ['proxy', 'tls'],
        template: false,
        baseCpu: 7.5,
        baseMemRatio: 0.31,
      },
      {
        vmid: 203,
        name: 'jellyfin-media',
        node: 'pve-node-02',
        type: 'lxc',
        status: 'running',
        cpuPercent: 27.5,
        cpus: 6,
        memUsedBytes: 5.2 * GB,
        memMaxBytes: 8 * GB,
        memPercent: 65.0,
        diskUsedBytes: 14 * GB,
        diskMaxBytes: 32 * GB,
        netInBytes: 92 * GB,
        netOutBytes: 1.9 * TB,
        uptimeSeconds: 950400,
        tags: ['media', 'gpu'],
        template: false,
        baseCpu: 26,
        baseMemRatio: 0.64,
      },
      {
        vmid: 204,
        name: 'grafana-metrics',
        node: 'pve-node-02',
        type: 'lxc',
        status: 'running',
        cpuPercent: 11.3,
        cpus: 4,
        memUsedBytes: 2.3 * GB,
        memMaxBytes: 4 * GB,
        memPercent: 57.5,
        diskUsedBytes: 22 * GB,
        diskMaxBytes: 40 * GB,
        netInBytes: 85 * GB,
        netOutBytes: 32 * GB,
        uptimeSeconds: 2160000,
        tags: ['monitoring'],
        template: false,
        baseCpu: 11,
        baseMemRatio: 0.57,
      },
    ];

    this.demoTasks = [
      {
        upid: 'UPID:pve-node-01:00018A21:01F2A910:671201A1:vzdump:100:root@pam:',
        node: 'pve-node-01',
        type: 'vzdump',
        id: '100',
        user: 'root@pam',
        status: 'OK',
        startTime: now - 18 * 60 * 1000,
        endTime: now - 16 * 60 * 1000,
      },
      {
        upid: 'UPID:pve-node-02:0000F411:01F18100:6711FB00:vzstart:203:root@pam:',
        node: 'pve-node-02',
        type: 'vzstart',
        id: '203',
        user: 'root@pam',
        status: 'OK',
        startTime: now - 64 * 60 * 1000,
        endTime: now - 63 * 60 * 1000,
      },
      {
        upid: 'UPID:pve-node-01:0000A192:01EE4012:67118A10:aptupdate::root@pam:',
        node: 'pve-node-01',
        type: 'aptupdate',
        id: '',
        user: 'root@pam',
        status: 'OK',
        startTime: now - 3 * 3600 * 1000,
        endTime: now - 3 * 3600 * 1000 + 42000,
      },
      {
        upid: 'UPID:pve-node-02:000043B0:01EB1099:67110200:qmstop:102:admin@pve:',
        node: 'pve-node-02',
        type: 'qmstop',
        id: '102',
        user: 'admin@pve',
        status: 'OK',
        startTime: now - 6 * 3600 * 1000,
        endTime: now - 6 * 3600 * 1000 + 8000,
      },
    ];

    // Pre-seed 20 history samples so sparklines render smoothly on first load
    for (let i = 20; i >= 1; i--) {
      const ts = now - i * 4000;
      this.seedSample(ts, i);
    }
  }

  private wave(seed: number, base: number, amp: number, min = 0, max = 100): number {
    const val = base + Math.sin(this.tick * 0.35 + seed) * amp + Math.cos(this.tick * 0.17 + seed * 2) * (amp * 0.4);
    return Math.round(Math.max(min, Math.min(max, val)) * 10) / 10;
  }

  private seedSample(ts: number, offset: number): void {
    this.tick = 20 - offset;
    const profiles = [
      { id: 'demo-nas-01', cpu: 24, mem: 68, rx: 48_000_000, tx: 112_000_000 },
      { id: 'demo-app-02', cpu: 52, mem: 74, rx: 14_000_000, tx: 22_000_000 },
      { id: 'demo-gw-01', cpu: 12, mem: 36, rx: 31_000_000, tx: 19_000_000 },
    ];
    profiles.forEach((p, idx) => {
      const hist = this.serverHistories.get(p.id) ?? [];
      hist.push({
        timestamp: ts,
        cpuPercent: this.wave(idx * 2.1, p.cpu, 11, 4, 96),
        memPercent: this.wave(idx * 1.3 + 5, p.mem, 2.4, 15, 95),
        netRxBps: Math.max(250_000, Math.round(p.rx * (0.7 + 0.45 * Math.sin(this.tick * 0.4 + idx)))),
        netTxBps: Math.max(250_000, Math.round(p.tx * (0.7 + 0.45 * Math.cos(this.tick * 0.35 + idx)))),
      });
      this.serverHistories.set(p.id, hist.slice(-50));
    });

    const pveProfiles = [
      { node: 'pve-node-01', cpu: 36, mem: 64 },
      { node: 'pve-node-02', cpu: 29, mem: 52 },
    ];
    pveProfiles.forEach((n, idx) => {
      const hist = this.pveNodeHistories.get(n.node) ?? [];
      hist.push({
        timestamp: ts,
        cpuPercent: this.wave(idx * 3.1 + 1, n.cpu, 9, 5, 95),
        memPercent: this.wave(idx * 1.7 + 2, n.mem, 1.8, 20, 95),
        netRxBps: 0,
        netTxBps: 0,
      });
      this.pveNodeHistories.set(n.node, hist.slice(-50));
    });

    this.opnsenseHistory.push({
      timestamp: ts,
      cpuPercent: this.wave(6.2, 16, 7, 4, 85),
      memPercent: this.wave(3.8, 34, 2, 18, 90),
      netRxBps: Math.max(400_000, Math.round(44_000_000 * (0.7 + 0.4 * Math.sin(this.tick * 0.3)))),
      netTxBps: Math.max(200_000, Math.round(18_000_000 * (0.7 + 0.4 * Math.cos(this.tick * 0.3)))),
    });
    this.opnsenseHistory = this.opnsenseHistory.slice(-50);
  }

  getServerSnapshots(): Array<{ config: SshServerPublic; metrics: SshServerMetrics }> {
    this.tick += 1;
    const now = Date.now();
    const elapsedSec = Math.floor((now - this.startedAt) / 1000);

    const defs = [
      {
        config: this.servers[0],
        hostname: 'nas-vault-01.rack.lan',
        osPrettyName: 'Debian GNU/Linux 12 (bookworm)',
        kernel: '6.6.44-production+truenas',
        arch: 'x86_64',
        cpuModel: 'Intel Xeon E-2388G @ 3.20GHz',
        cpuCores: 16,
        baseCpu: 24,
        memTotal: 64 * GB,
        baseMem: 68.4,
        swapTotal: 8 * GB,
        swapUsed: 0.4 * GB,
        uptimeBase: 3648120,
        rxBase: 48_000_000,
        txBase: 118_000_000,
        iface: 'enp5s0f0',
        tempBase: 44,
        disks: [
          { filesystem: '/dev/nvme0n1p2', mount: '/', totalBytes: 256 * GB, usedBytes: 61 * GB },
          { filesystem: 'tank/media', mount: '/mnt/tank/media', totalBytes: 24 * TB, usedBytes: 17.8 * TB },
          { filesystem: 'tank/backups', mount: '/mnt/tank/backups', totalBytes: 12 * TB, usedBytes: 7.4 * TB },
          { filesystem: 'flash/vms', mount: '/mnt/flash/vms', totalBytes: 4 * TB, usedBytes: 2.1 * TB },
        ],
        procs: [
          { pid: 1420, user: 'root', cpuPercent: 11.4, memPercent: 42.1, command: 'zfs_arc_reclaim' },
          { pid: 2201, user: 'root', cpuPercent: 5.8, memPercent: 6.4, command: 'smbd' },
          { pid: 1984, user: 'root', cpuPercent: 3.1, memPercent: 3.2, command: 'nfsd' },
          { pid: 3012, user: 'sync', cpuPercent: 2.4, memPercent: 2.8, command: 'rsync' },
          { pid: 904, user: 'root', cpuPercent: 0.9, memPercent: 1.4, command: 'smartd' },
        ],
        services: [
          { name: 'zfs-zed', state: 'active' as const, subState: 'running' },
          { name: 'smbd', state: 'active' as const, subState: 'running' },
          { name: 'nfs-server', state: 'active' as const, subState: 'running' },
          { name: 'smartmontools', state: 'active' as const, subState: 'running' },
          { name: 'node_exporter', state: 'active' as const, subState: 'running' },
        ],
      },
      {
        config: this.servers[1],
        hostname: 'docker-core-02.rack.lan',
        osPrettyName: 'Ubuntu 24.04.1 LTS',
        kernel: '6.8.0-49-generic',
        arch: 'x86_64',
        cpuModel: 'AMD Ryzen 9 5900X 12-Core Processor',
        cpuCores: 24,
        baseCpu: 54,
        memTotal: 32 * GB,
        baseMem: 74.2,
        swapTotal: 4 * GB,
        swapUsed: 0.9 * GB,
        uptimeBase: 1924500,
        rxBase: 16_500_000,
        txBase: 24_200_000,
        iface: 'eth0',
        tempBase: 58,
        disks: [
          { filesystem: '/dev/nvme0n1p2', mount: '/', totalBytes: 512 * GB, usedBytes: 218 * GB },
          { filesystem: '/dev/nvme1n1p1', mount: '/var/lib/docker', totalBytes: 2 * TB, usedBytes: 1.42 * TB },
        ],
        procs: [
          { pid: 4120, user: 'postgres', cpuPercent: 18.6, memPercent: 21.4, command: 'postgres' },
          { pid: 3811, user: 'root', cpuPercent: 14.2, memPercent: 12.8, command: 'dockerd' },
          { pid: 5510, user: 'node', cpuPercent: 9.8, memPercent: 11.2, command: 'node' },
          { pid: 4902, user: 'redis', cpuPercent: 4.5, memPercent: 6.1, command: 'redis-server' },
          { pid: 2190, user: 'www-data', cpuPercent: 3.2, memPercent: 4.0, command: 'nginx' },
        ],
        services: [
          { name: 'docker', state: 'active' as const, subState: 'running' },
          { name: 'containerd', state: 'active' as const, subState: 'running' },
          { name: 'postgresql', state: 'active' as const, subState: 'running' },
          { name: 'nginx', state: 'active' as const, subState: 'running' },
          { name: 'tailscaled', state: 'active' as const, subState: 'running' },
        ],
      },
      {
        config: this.servers[2],
        hostname: 'edge-router-01.rack.lan',
        osPrettyName: 'Debian GNU/Linux 12 (bookworm)',
        kernel: '6.1.0-26-amd64',
        arch: 'x86_64',
        cpuModel: 'Intel Processor N100 @ 3.40GHz',
        cpuCores: 4,
        baseCpu: 13,
        memTotal: 8 * GB,
        baseMem: 36.8,
        swapTotal: 2 * GB,
        swapUsed: 0,
        uptimeBase: 5184200,
        rxBase: 32_000_000,
        txBase: 19_000_000,
        iface: 'eth0-wan',
        tempBase: 41,
        disks: [{ filesystem: '/dev/sda2', mount: '/', totalBytes: 128 * GB, usedBytes: 24 * GB }],
        procs: [
          { pid: 612, user: 'root', cpuPercent: 4.8, memPercent: 8.4, command: 'suricata' },
          { pid: 844, user: 'root', cpuPercent: 2.1, memPercent: 3.1, command: 'wg-quick' },
          { pid: 721, user: 'unbound', cpuPercent: 1.4, memPercent: 5.2, command: 'unbound' },
          { pid: 502, user: 'root', cpuPercent: 0.7, memPercent: 1.9, command: 'kea-dhcp4' },
        ],
        services: [
          { name: 'nftables', state: 'active' as const, subState: 'exited' },
          { name: 'wg-quick@wg0', state: 'active' as const, subState: 'exited' },
          { name: 'unbound', state: 'active' as const, subState: 'running' },
          { name: 'suricata', state: 'active' as const, subState: 'running' },
        ],
      },
    ];

    return defs.map((d, idx) => {
      const cpuPercent = this.wave(idx * 2.1, d.baseCpu, 10.5, 3, 96);
      const memPercent = this.wave(idx * 1.4 + 4, d.baseMem, 2.2, 12, 95);
      const memUsedBytes = Math.round((memPercent / 100) * d.memTotal);
      const rxBps = Math.max(200_000, Math.round(d.rxBase * (0.72 + 0.48 * Math.sin(this.tick * 0.4 + idx))));
      const txBps = Math.max(200_000, Math.round(d.txBase * (0.72 + 0.48 * Math.cos(this.tick * 0.35 + idx))));

      const hist = this.serverHistories.get(d.config.id) ?? [];
      const nextHist = [
        ...hist.slice(-49),
        { timestamp: now, cpuPercent, memPercent, netRxBps: rxBps, netTxBps: txBps },
      ];
      this.serverHistories.set(d.config.id, nextHist);

      const cpuTemp = this.wave(idx + 9, d.tempBase, 3.5, 28, 86);
      const load1 = Math.round(((cpuPercent / 100) * d.cpuCores * 0.65) * 100) / 100;

      const metrics: SshServerMetrics = {
        serverId: d.config.id,
        status: 'online',
        collectedAt: now,
        hostname: d.hostname,
        osPrettyName: d.osPrettyName,
        kernel: d.kernel,
        arch: d.arch,
        ipAddress: d.config.host,
        uptimeSeconds: d.uptimeBase + elapsedSec,
        cpuModel: d.cpuModel,
        cpuCores: d.cpuCores,
        cpuPercent,
        loadAvg: [load1, Math.round(load1 * 0.92 * 100) / 100, Math.round(load1 * 0.85 * 100) / 100],
        memTotalBytes: d.memTotal,
        memUsedBytes,
        memAvailableBytes: d.memTotal - memUsedBytes,
        memPercent,
        swapTotalBytes: d.swapTotal,
        swapUsedBytes: d.swapUsed,
        swapPercent: d.swapTotal > 0 ? Math.round((d.swapUsed / d.swapTotal) * 1000) / 10 : 0,
        disks: d.disks.map((dk) => ({
          ...dk,
          availBytes: dk.totalBytes - dk.usedBytes,
          usedPercent: Math.round((dk.usedBytes / dk.totalBytes) * 1000) / 10,
        })),
        network: [
          {
            iface: d.iface,
            rxBytesPerSec: rxBps,
            txBytesPerSec: txBps,
            rxTotalBytes: 2.4 * TB + elapsedSec * rxBps,
            txTotalBytes: 3.1 * TB + elapsedSec * txBps,
          },
        ],
        netTotalRxBps: rxBps,
        netTotalTxBps: txBps,
        temperatures: [
          { label: 'CPU Package', tempC: cpuTemp },
          { label: 'NVMe Drive 0', tempC: Math.round((cpuTemp - 6.5) * 10) / 10 },
          { label: 'Chassis Intake', tempC: Math.round((cpuTemp - 14) * 10) / 10 },
        ],
        maxTempC: cpuTemp,
        topProcesses: d.procs,
        services: d.services,
        history: nextHist,
      };

      return { config: d.config, metrics };
    });
  }

  getProxmoxSnapshot(): ProxmoxClusterSnapshot {
    const now = Date.now();
    const elapsedSec = Math.floor((now - this.startedAt) / 1000);

    const node1Cpu = this.wave(1.1, 35, 9, 8, 92);
    const node1Mem = this.wave(2.3, 64.5, 1.8, 30, 92);
    const node2Cpu = this.wave(3.4, 28, 8, 6, 90);
    const node2Mem = this.wave(4.5, 51.8, 1.6, 25, 90);

    const n1Hist = [...(this.pveNodeHistories.get('pve-node-01') ?? []).slice(-49), {
      timestamp: now,
      cpuPercent: node1Cpu,
      memPercent: node1Mem,
      netRxBps: 0,
      netTxBps: 0,
    }];
    this.pveNodeHistories.set('pve-node-01', n1Hist);

    const n2Hist = [...(this.pveNodeHistories.get('pve-node-02') ?? []).slice(-49), {
      timestamp: now,
      cpuPercent: node2Cpu,
      memPercent: node2Mem,
      netRxBps: 0,
      netTxBps: 0,
    }];
    this.pveNodeHistories.set('pve-node-02', n2Hist);

    const guests: ProxmoxGuest[] = this.demoGuests.map((g, idx) => {
      if (g.status !== 'running') {
        return { ...g, cpuPercent: 0, memUsedBytes: 0, memPercent: 0, uptimeSeconds: 0 };
      }
      const cpuPercent = this.wave(idx * 1.9, g.baseCpu, Math.max(1.5, g.baseCpu * 0.25), 0.4, 98);
      const memRatio = Math.min(0.95, Math.max(0.15, g.baseMemRatio + Math.sin(this.tick * 0.2 + idx) * 0.02));
      const memUsedBytes = Math.round(g.memMaxBytes * memRatio);
      return {
        ...g,
        cpuPercent,
        memUsedBytes,
        memPercent: Math.round(memRatio * 1000) / 10,
        uptimeSeconds: g.uptimeSeconds + elapsedSec,
      };
    });

    return {
      configId: 'demo-pve-cluster',
      name: 'HOMELAB-PVE (Demo)',
      host: '10.10.20.10',
      status: 'online',
      collectedAt: now,
      clusterName: 'rack-cluster-01',
      quorate: true,
      isDemo: true,
      nodes: [
        {
          node: 'pve-node-01',
          status: 'online',
          cpuPercent: node1Cpu,
          maxCpu: 16,
          cpuModel: 'AMD EPYC 4344P 8-Core (16 Threads)',
          memUsedBytes: Math.round((node1Mem / 100) * 64 * GB),
          memTotalBytes: 64 * GB,
          memPercent: node1Mem,
          swapUsedBytes: 0.3 * GB,
          swapTotalBytes: 8 * GB,
          rootfsUsedBytes: 42 * GB,
          rootfsTotalBytes: 128 * GB,
          rootfsPercent: 32.8,
          loadAvg: [2.14, 1.98, 1.85],
          uptimeSeconds: 4128900 + elapsedSec,
          pveVersion: '8.3.1',
          kernelVersion: '6.8.12-4-pve',
          history: n1Hist,
        },
        {
          node: 'pve-node-02',
          status: 'online',
          cpuPercent: node2Cpu,
          maxCpu: 16,
          cpuModel: 'AMD EPYC 4344P 8-Core (16 Threads)',
          memUsedBytes: Math.round((node2Mem / 100) * 64 * GB),
          memTotalBytes: 64 * GB,
          memPercent: node2Mem,
          swapUsedBytes: 0.1 * GB,
          swapTotalBytes: 8 * GB,
          rootfsUsedBytes: 38 * GB,
          rootfsTotalBytes: 128 * GB,
          rootfsPercent: 29.7,
          loadAvg: [1.62, 1.54, 1.48],
          uptimeSeconds: 3882400 + elapsedSec,
          pveVersion: '8.3.1',
          kernelVersion: '6.8.12-4-pve',
          history: n2Hist,
        },
      ],
      guests,
      storage: [
        {
          storage: 'zfs-nvme-fast',
          node: 'pve-node-01',
          type: 'zfspool',
          content: 'images,rootdir',
          active: true,
          enabled: true,
          shared: false,
          usedBytes: 1.28 * TB,
          availBytes: 0.72 * TB,
          totalBytes: 2 * TB,
          usedPercent: 64.0,
        },
        {
          storage: 'local-lvm',
          node: 'pve-node-01',
          type: 'lvmthin',
          content: 'images,rootdir',
          active: true,
          enabled: true,
          shared: false,
          usedBytes: 312 * GB,
          availBytes: 688 * GB,
          totalBytes: 1000 * GB,
          usedPercent: 31.2,
        },
        {
          storage: 'zfs-nvme-fast',
          node: 'pve-node-02',
          type: 'zfspool',
          content: 'images,rootdir',
          active: true,
          enabled: true,
          shared: false,
          usedBytes: 0.94 * TB,
          availBytes: 1.06 * TB,
          totalBytes: 2 * TB,
          usedPercent: 47.0,
        },
        {
          storage: 'nas-nfs-iso',
          node: 'pve-node-01',
          type: 'nfs',
          content: 'iso,vztmpl,backup',
          active: true,
          enabled: true,
          shared: true,
          usedBytes: 4.8 * TB,
          availBytes: 3.2 * TB,
          totalBytes: 8 * TB,
          usedPercent: 60.0,
        },
        {
          storage: 'pbs-vault',
          node: 'pve-node-02',
          type: 'pbs',
          content: 'backup',
          active: true,
          enabled: true,
          shared: true,
          usedBytes: 3.1 * TB,
          availBytes: 8.9 * TB,
          totalBytes: 12 * TB,
          usedPercent: 25.8,
        },
      ],
      tasks: this.demoTasks.slice(0, 15),
    };
  }

  executeDemoGuestAction(node: string, type: 'qemu' | 'lxc', vmid: number, action: GuestPowerAction): { upid: string } {
    const guest = this.demoGuests.find((g) => g.vmid === vmid && g.node === node && g.type === type);
    if (!guest) throw new Error(`Demo guest ${vmid} not found`);

    if (action === 'start' || action === 'reboot') {
      guest.status = 'running';
      guest.uptimeSeconds = 1;
    } else if (action === 'shutdown' || action === 'stop') {
      guest.status = 'stopped';
      guest.uptimeSeconds = 0;
    }

    const prefix = type === 'qemu' ? 'qm' : 'vz';
    const taskType = `${prefix}${action}`;
    const upid = `UPID:${node}:0002${Math.floor(Math.random() * 9000 + 1000)}:DEMO:${Date.now().toString(16)}:${taskType}:${vmid}:root@pam:`;
    this.demoTasks.unshift({
      upid,
      node,
      type: taskType,
      id: String(vmid),
      user: 'root@pam',
      status: 'OK',
      startTime: Date.now(),
      endTime: Date.now() + 900,
    });
    return { upid };
  }

  runDemoCommand(serverId: string, command: string): CommandResult {
    const srv = this.servers.find((s) => s.id === serverId);
    const name = srv?.name ?? serverId;
    const cmd = command.trim();
    let stdout = '';

    if (cmd.startsWith('uptime')) {
      stdout = ` 20:54:12 up 42 days,  6:18,  1 user,  load average: 1.42, 1.31, 1.18\n`;
    } else if (cmd.startsWith('df')) {
      stdout = `Filesystem       Size  Used Avail Use% Mounted on\n/dev/nvme0n1p2   256G   61G  195G  24% /\ntank/media        24T   18T  6.2T  74% /mnt/tank/media\ntank/backups      12T  7.4T  4.6T  62% /mnt/tank/backups\n`;
    } else if (cmd.startsWith('free')) {
      stdout = `               total        used        free      shared  buff/cache   available\nMem:            62Gi        42Gi       4.2Gi       512Mi        16Gi        20Gi\nSwap:          8.0Gi       412Mi       7.6Gi\n`;
    } else if (cmd.includes('docker')) {
      stdout = `NAMES               STATUS              PORTS\ntraefik             Up 19 days          0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp\npostgres-prod       Up 19 days          5432/tcp\nredis-cache         Up 19 days          6379/tcp\ngrafana             Up 12 days          0.0.0.0:3001->3000/tcp\n`;
    } else if (cmd.includes('systemctl')) {
      stdout = `  UNIT LOAD ACTIVE SUB DESCRIPTION\n0 loaded units listed.\n(All systemd services healthy on ${name})\n`;
    } else {
      stdout = `[DEMO SHELL @ ${name}] Executed: ${cmd}\nOK — connect a real SSH server in Settings/Servers for live remote execution.\n`;
    }
    return { stdout, stderr: '', exitCode: 0, durationMs: 38 };
  }

  getTailscaleSnapshot(): TailscaleSnapshot {
    const now = Date.now();
    return {
      configId: 'demo-tailscale',
      name: 'HOMELAB-TAILNET (Demo)',
      mode: 'local',
      tailnetName: 'rack-lab.ts.net',
      status: 'online',
      collectedAt: now,
      selfHostname: 'rack-panel-host',
      isDemo: true,
      devices: [
        {
          id: 'demo-ts-1',
          hostname: 'pve-node-01',
          dnsName: 'pve-node-01.rack-lab.ts.net',
          ipv4: '100.64.10.10',
          ipv6: 'fd7a:115c:a1e0::10',
          addresses: ['100.64.10.10', 'fd7a:115c:a1e0::10'],
          os: 'linux',
          online: true,
          active: true,
          isSelf: false,
          lastSeen: now,
          clientVersion: '1.78.1',
          tags: ['proxmox', 'rack'],
          exitNode: false,
          exitNodeOption: true,
          advertisedRoutes: ['10.10.20.0/24'],
          enabledRoutes: ['10.10.20.0/24'],
          relay: 'ord',
          curAddr: '10.10.20.10:41641',
          rxBytes: 18 * GB,
          txBytes: 42 * GB,
          authorized: true,
          updateAvailable: false,
          sshEnabled: true,
        },
        {
          id: 'demo-ts-2',
          hostname: 'nas-vault-01',
          dnsName: 'nas-vault-01.rack-lab.ts.net',
          ipv4: '100.64.10.11',
          ipv6: 'fd7a:115c:a1e0::11',
          addresses: ['100.64.10.11', 'fd7a:115c:a1e0::11'],
          os: 'linux',
          online: true,
          active: true,
          isSelf: false,
          lastSeen: now,
          clientVersion: '1.78.1',
          tags: ['storage', 'nas'],
          exitNode: false,
          exitNodeOption: false,
          advertisedRoutes: [],
          enabledRoutes: [],
          relay: 'ord',
          curAddr: '10.10.20.11:41641',
          rxBytes: 120 * GB,
          txBytes: 310 * GB,
          authorized: true,
          updateAvailable: false,
        },
        {
          id: 'demo-ts-3',
          hostname: 'docker-core-02',
          dnsName: 'docker-core-02.rack-lab.ts.net',
          ipv4: '100.64.10.12',
          ipv6: 'fd7a:115c:a1e0::12',
          addresses: ['100.64.10.12', 'fd7a:115c:a1e0::12'],
          os: 'linux',
          online: true,
          active: true,
          isSelf: false,
          lastSeen: now,
          clientVersion: '1.76.6',
          tags: ['docker', 'prod'],
          exitNode: false,
          exitNodeOption: false,
          advertisedRoutes: [],
          enabledRoutes: [],
          relay: 'iad',
          curAddr: '10.10.20.12:41641',
          rxBytes: 8.4 * GB,
          txBytes: 11.2 * GB,
          authorized: true,
          updateAvailable: true,
        },
        {
          id: 'demo-ts-4',
          hostname: 'edge-router-01',
          dnsName: 'edge-router-01.rack-lab.ts.net',
          ipv4: '100.64.10.1',
          ipv6: 'fd7a:115c:a1e0::1',
          addresses: ['100.64.10.1', 'fd7a:115c:a1e0::1'],
          os: 'linux',
          online: true,
          active: true,
          isSelf: false,
          lastSeen: now,
          clientVersion: '1.78.1',
          tags: ['gateway', 'exit-node'],
          exitNode: true,
          exitNodeOption: true,
          advertisedRoutes: ['10.10.0.0/16'],
          enabledRoutes: ['10.10.0.0/16'],
          relay: 'ord',
          curAddr: '10.10.20.1:41641',
          rxBytes: 64 * GB,
          txBytes: 58 * GB,
          authorized: true,
          updateAvailable: false,
        },
        {
          id: 'demo-ts-5',
          hostname: 'offsite-backup-pi',
          dnsName: 'offsite-backup-pi.rack-lab.ts.net',
          ipv4: '100.64.10.44',
          ipv6: 'fd7a:115c:a1e0::44',
          addresses: ['100.64.10.44', 'fd7a:115c:a1e0::44'],
          os: 'linux',
          online: false,
          active: false,
          isSelf: false,
          lastSeen: now - 3 * 3600 * 1000,
          clientVersion: '1.74.0',
          tags: ['backup', 'remote'],
          exitNode: false,
          exitNodeOption: false,
          advertisedRoutes: [],
          enabledRoutes: [],
          relay: 'nyc',
          curAddr: '',
          rxBytes: 2.1 * GB,
          txBytes: 420 * 1024 * 1024,
          authorized: true,
          updateAvailable: true,
        },
      ],
    };
  }

  getOpnsenseSnapshot(): OpnsenseSnapshot {
    const now = Date.now();
    const elapsedSec = Math.floor((now - this.startedAt) / 1000);
    const cpuPercent = this.wave(6.2, 16, 7, 4, 85);
    const memTotalBytes = 8 * GB;
    const memPercent = this.wave(3.8, 34.5, 2.1, 18, 90);
    const memUsedBytes = Math.round((memPercent / 100) * memTotalBytes);
    const wanRx = Math.max(500_000, Math.round(46_000_000 * (0.72 + 0.45 * Math.sin(this.tick * 0.32))));
    const wanTx = Math.max(250_000, Math.round(19_000_000 * (0.72 + 0.45 * Math.cos(this.tick * 0.28))));
    const pfStatesCurrent = Math.round(14200 + Math.sin(this.tick * 0.25) * 1800);
    const pfStatesMax = 1600000;

    this.opnsenseHistory = [
      ...this.opnsenseHistory.slice(-49),
      { timestamp: now, cpuPercent, memPercent, netRxBps: wanRx, netTxBps: wanTx },
    ];

    const timeStr = new Date(now).toTimeString().slice(0, 8);
    return {
      configId: 'demo-opnsense',
      name: 'OPNSENSE-EDGE (Demo)',
      host: '10.10.20.1',
      status: 'online',
      collectedAt: now,
      hostname: 'fw-edge-01.rack.lan',
      version: '25.1.3',
      uptimeSeconds: 4921200 + elapsedSec,
      cpuPercent,
      cpuCores: 4,
      cpuModel: 'Intel Processor N100 (4 cores, 4 threads)',
      loadAvg: [0.48, 0.42, 0.39],
      memUsedBytes,
      memTotalBytes,
      memPercent,
      diskUsedBytes: 18.4 * GB,
      diskTotalBytes: 120 * GB,
      diskPercent: 15.3,
      tempC: this.wave(7.1, 43, 2.5, 32, 72),
      pfStatesCurrent,
      pfStatesMax,
      pfStatesPercent: Math.round((pfStatesCurrent / pfStatesMax) * 1000) / 10,
      totalRxBps: wanRx,
      totalTxBps: wanTx,
      firmwareUpdateAvailable: false,
      isDemo: true,
      gateways: [
        {
          name: 'WAN_FIBER_DHCP',
          address: '1.1.1.1',
          status: 'online',
          statusText: 'Online',
          delayMs: Math.round((4.1 + Math.sin(this.tick * 0.3) * 0.6) * 10) / 10,
          stddevMs: 0.4,
          lossPercent: 0,
          isDefault: true,
        },
        {
          name: 'WAN2_5G_FAILOVER',
          address: '8.8.8.8',
          status: 'online',
          statusText: 'Online',
          delayMs: Math.round((27.4 + Math.cos(this.tick * 0.25) * 3.1) * 10) / 10,
          stddevMs: 2.3,
          lossPercent: 0,
          isDefault: false,
        },
      ],
      interfaces: [
        {
          device: 'igc0',
          name: 'WAN',
          description: 'WAN Fiber 2.5GbE',
          ip4: '203.0.113.42',
          status: 'up',
          inBytesPerSec: wanRx,
          outBytesPerSec: wanTx,
          inBytesTotal: 14.2 * TB + elapsedSec * wanRx,
          outBytesTotal: 4.8 * TB + elapsedSec * wanTx,
          inErrors: 0,
          outErrors: 0,
        },
        {
          device: 'igc1',
          name: 'LAN',
          description: 'LAN Core',
          ip4: '10.10.20.1',
          status: 'up',
          inBytesPerSec: wanTx,
          outBytesPerSec: wanRx,
          inBytesTotal: 6.1 * TB,
          outBytesTotal: 15.4 * TB,
          inErrors: 0,
          outErrors: 0,
        },
        {
          device: 'igc1_vlan10',
          name: 'SERVERS',
          description: 'VLAN 10 Servers',
          ip4: '10.10.10.1',
          status: 'up',
          inBytesPerSec: Math.round(wanRx * 0.4),
          outBytesPerSec: Math.round(wanTx * 0.6),
          inBytesTotal: 8.9 * TB,
          outBytesTotal: 9.2 * TB,
          inErrors: 0,
          outErrors: 0,
        },
        {
          device: 'wg0',
          name: 'WireGuard',
          description: 'WireGuard Site-to-Site',
          ip4: '10.200.0.1',
          status: 'up',
          inBytesPerSec: Math.round(wanRx * 0.12),
          outBytesPerSec: Math.round(wanTx * 0.15),
          inBytesTotal: 412 * GB,
          outBytesTotal: 389 * GB,
          inErrors: 0,
          outErrors: 0,
        },
      ],
      services: this.demoOpnServices.map((s) => ({ ...s })),
      wireguardPeers: [
        {
          name: 'remote-office-gw',
          interface: 'wg0',
          endpoint: '198.51.100.18:51820',
          latestHandshake: now - 32_000,
          rxBytes: 184 * GB,
          txBytes: 162 * GB,
          online: true,
        },
        {
          name: 'mobile-admin-phone',
          interface: 'wg0',
          endpoint: '198.51.100.91:49210',
          latestHandshake: now - 54_000,
          rxBytes: 12.4 * GB,
          txBytes: 4.1 * GB,
          online: true,
        },
      ],
      firewallLogs: [
        {
          id: 'log-1',
          timestamp: timeStr,
          action: 'block',
          interface: 'WAN',
          proto: 'TCP',
          src: '185.220.101.44',
          srcPort: '51902',
          dst: '203.0.113.42',
          dstPort: '22',
          label: 'Default deny / state violation rule',
        },
        {
          id: 'log-2',
          timestamp: timeStr,
          action: 'pass',
          interface: 'LAN',
          proto: 'TCP',
          src: '10.10.20.12',
          srcPort: '48210',
          dst: '1.1.1.1',
          dstPort: '443',
          label: 'Allow LAN outbound HTTPS',
        },
        {
          id: 'log-3',
          timestamp: timeStr,
          action: 'block',
          interface: 'WAN',
          proto: 'UDP',
          src: '45.155.205.91',
          srcPort: '39104',
          dst: '203.0.113.42',
          dstPort: '5060',
          label: 'CrowdSec Blocklist',
        },
        {
          id: 'log-4',
          timestamp: timeStr,
          action: 'pass',
          interface: 'SERVERS',
          proto: 'UDP',
          src: '10.10.10.11',
          srcPort: '51820',
          dst: '198.51.100.18',
          dstPort: '51820',
          label: 'Allow WireGuard Tunnel',
        },
      ],
      history: this.opnsenseHistory,
    };
  }

  executeDemoOpnsenseService(serviceId: string, action: OpnsenseServiceAction): { ok: boolean; message: string } {
    const svc = this.demoOpnServices.find((s) => s.id === serviceId);
    if (!svc) return { ok: false, message: `Demo service ${serviceId} not found` };
    if (action === 'start' || action === 'restart') svc.running = true;
    if (action === 'stop') svc.running = false;
    return { ok: true, message: `[Demo] ${svc.description}: ${action} succeeded` };
  }

  getHikvisionSnapshot(): HikvisionSnapshot {
    const now = Date.now();
    const elapsedSec = Math.floor((now - this.startedAt) / 1000);
    const cpuPercent = Math.round((18.5 + Math.sin(this.tick * 0.28) * 4.2) * 10) / 10;
    const memPercent = 41.8;

    const point: TelemetryPoint = {
      timestamp: now,
      cpuPercent,
      memPercent,
      netRxBps: 5_420_000,
      netTxBps: 980_000,
    };
    this.hikvisionHistory = [...this.hikvisionHistory.slice(-49), point];

    const hddCap = 8 * TB;
    const hdds = [
      {
        id: 1,
        name: 'HDD 1 (SATA-1)',
        type: 'SATA',
        status: 'ok' as const,
        statusText: 'OK',
        capacityBytes: hddCap,
        freeBytes: Math.round(1.12 * TB),
        usedBytes: Math.round(6.88 * TB),
        usedPercent: 86.0,
        property: 'RW',
      },
      {
        id: 2,
        name: 'HDD 2 (SATA-2)',
        type: 'SATA',
        status: 'ok' as const,
        statusText: 'OK',
        capacityBytes: hddCap,
        freeBytes: Math.round(1.64 * TB),
        usedBytes: Math.round(6.36 * TB),
        usedPercent: 79.5,
        property: 'RW',
      },
      {
        id: 3,
        name: 'HDD 3 (SATA-3)',
        type: 'SATA',
        status: 'ok' as const,
        statusText: 'OK',
        capacityBytes: hddCap,
        freeBytes: Math.round(2.96 * TB),
        usedBytes: Math.round(5.04 * TB),
        usedPercent: 63.0,
        property: 'RW',
      },
      {
        id: 4,
        name: 'HDD 4 (SATA-4)',
        type: 'SATA',
        status: 'sleeping' as const,
        statusText: 'SLEEPING',
        capacityBytes: hddCap,
        freeBytes: Math.round(7.4 * TB),
        usedBytes: Math.round(0.6 * TB),
        usedPercent: 7.5,
        property: 'RW',
      },
    ];

    const storageTotalBytes = hdds.reduce((a, h) => a + h.capacityBytes, 0);
    const storageFreeBytes = hdds.reduce((a, h) => a + h.freeBytes, 0);
    const storageUsedBytes = storageTotalBytes - storageFreeBytes;

    const channels = [
      { id: 1, name: 'Front Driveway 4K', res: '3840x2160', fps: 25, kbps: 8192, poe: 1, ptz: false, online: true },
      { id: 2, name: 'Main Entrance Porch', res: '2688x1520', fps: 25, kbps: 6144, poe: 2, ptz: false, online: true },
      { id: 3, name: 'Server Rack Room', res: '2560x1440', fps: 30, kbps: 4096, poe: 3, ptz: false, online: true },
      { id: 4, name: 'Rear Garden PTZ', res: '3840x2160', fps: 25, kbps: 8192, poe: 4, ptz: true, online: true },
      { id: 5, name: 'Side Gate North', res: '2688x1520', fps: 25, kbps: 5120, poe: 5, ptz: false, online: true },
      { id: 6, name: 'Garage Interior', res: '1920x1080', fps: 25, kbps: 3072, poe: 6, ptz: false, online: true },
      { id: 7, name: 'Perimeter East Wall', res: '2688x1520', fps: 25, kbps: 5120, poe: 7, ptz: false, online: true },
      { id: 8, name: 'Workshop Bay', res: '1920x1080', fps: 25, kbps: 2048, poe: 8, ptz: false, online: false },
    ].map((c) => ({
      id: c.id,
      name: c.name,
      sourceType: 'ip' as const,
      online: c.online,
      recording: c.online,
      ipAddress: `192.168.254.${c.id + 1}`,
      model: c.ptz ? 'DS-2DE4A425IWG-E' : 'DS-2CD2387G2-LU',
      protocol: 'HIKVISION',
      poePort: c.poe,
      mainStreamId: c.id * 100 + 1,
      subStreamId: c.id * 100 + 2,
      codec: 'H.265',
      resolution: c.res,
      fps: c.fps,
      bitrateKbps: c.kbps,
      ptzSupported: c.ptz,
    }));

    return {
      configId: 'demo-hikvision-nvr',
      name: 'NVR-CCTV-01',
      host: '192.168.0.64',
      status: 'online',
      collectedAt: now,
      deviceName: 'DS-7732NI-I4/16P',
      deviceType: 'NVR',
      model: 'DS-7732NI-I4 / 16P(B)',
      serialNumber: 'DS-7732NI-I4 / 16P(B)1620200309CCRRE20951682WCVU',
      firmwareVersion: 'V4.61.025',
      firmwareBuild: 'build 220905',
      macAddress: 'c0:56:e3:9a:41:12',
      uptimeSeconds: 3_624_900 + elapsedSec,
      cpuPercent,
      memPercent,
      totalChannels: channels.length,
      onlineChannels: channels.filter((c) => c.online).length,
      recordingChannels: channels.filter((c) => c.recording).length,
      storageTotalBytes,
      storageUsedBytes,
      storageFreeBytes,
      storagePercent: Math.round((storageUsedBytes / storageTotalBytes) * 1000) / 10,
      channels,
      hdds,
      history: this.hikvisionHistory,
      isDemo: true,
    };
  }

  renderDemoCameraSvg(channelId: number): Buffer {
    const snap = this.getHikvisionSnapshot();
    const ch = snap.channels.find((c) => c.id === channelId) || snap.channels[0];
    const now = new Date();
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const scanY = (now.getTime() / 22) % 360;
    const hue = (channelId * 47) % 360;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#09111f"/>
          <stop offset="50%" stop-color="hsl(${hue}, 38%, 12%)"/>
          <stop offset="100%" stop-color="#05080f"/>
        </linearGradient>
      </defs>
      <rect width="640" height="360" fill="url(#bg)"/>
      <g stroke="rgba(34,211,238,0.11)" stroke-width="1">
        <line x1="0" y1="90" x2="640" y2="90"/>
        <line x1="0" y1="180" x2="640" y2="180"/>
        <line x1="0" y1="270" x2="640" y2="270"/>
        <line x1="160" y1="0" x2="160" y2="360"/>
        <line x1="320" y1="0" x2="320" y2="360"/>
        <line x1="480" y1="0" x2="480" y2="360"/>
      </g>
      <rect x="0" y="${scanY.toFixed(1)}" width="640" height="3" fill="rgba(34,211,238,0.22)"/>
      <circle cx="320" cy="180" r="56" fill="none" stroke="rgba(34,211,238,0.22)" stroke-width="1.5"/>
      <line x1="295" y1="180" x2="345" y2="180" stroke="rgba(34,211,238,0.35)" stroke-width="1.5"/>
      <line x1="320" y1="155" x2="320" y2="205" stroke="rgba(34,211,238,0.35)" stroke-width="1.5"/>
      <rect x="14" y="12" width="250" height="28" rx="3" fill="rgba(5,8,15,0.72)"/>
      <circle cx="28" cy="26" r="5" fill="${ch.online ? '#ef4444' : '#64748b'}"/>
      <text x="40" y="31" fill="#f8fafc" font-family="monospace" font-size="13" font-weight="bold">CH${pad(ch.id)} · ${ch.name}</text>
      <rect x="424" y="12" width="202" height="28" rx="3" fill="rgba(5,8,15,0.72)"/>
      <text x="434" y="30" fill="#22d3ee" font-family="monospace" font-size="12" font-weight="bold">${ts}</text>
      <text x="320" y="185" text-anchor="middle" fill="rgba(226,232,240,0.45)" font-family="monospace" font-size="13" font-weight="bold">DEMO ISAPI FEED · ${ch.model}</text>
      <rect x="14" y="320" width="612" height="26" rx="3" fill="rgba(5,8,15,0.72)"/>
      <text x="24" y="337" fill="#94a3b8" font-family="monospace" font-size="11">${ch.codec} · ${ch.resolution} @ ${ch.fps}fps · ${ch.bitrateKbps} kbps · ${ch.ipAddress}${ch.poePort ? ` (PoE #${ch.poePort})` : ''}</text>
    </svg>`;
    return Buffer.from(svg, 'utf8');
  }
}
