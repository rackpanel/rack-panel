export type AuthMethod = 'tailscale' | 'password' | 'privateKey';

export interface SshServerConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  rackUnit?: string;
  tags: string[];
  enabled: boolean;
  createdAt: string;
}

export interface SshServerPublic extends Omit<SshServerConfig, 'password' | 'privateKey' | 'passphrase'> {
  hasPassword: boolean;
  hasPrivateKey: boolean;
  hasPassphrase: boolean;
  isDemo?: boolean;
}

export interface DiskMetric {
  filesystem: string;
  mount: string;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  usedPercent: number;
}

export interface NetworkInterfaceMetric {
  iface: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
  rxTotalBytes: number;
  txTotalBytes: number;
}

export interface ProcessMetric {
  pid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  command: string;
}

export interface ServiceStatus {
  name: string;
  state: 'active' | 'inactive' | 'failed' | 'unknown';
  subState: string;
}

export interface ThermalSensor {
  label: string;
  tempC: number;
}

export interface TelemetryPoint {
  timestamp: number;
  cpuPercent: number;
  memPercent: number;
  netRxBps: number;
  netTxBps: number;
}

export type DeviceSourceKind = 'ssh' | 'proxmox' | 'tailscale' | 'opnsense';

export interface SshServerMetrics {
  serverId: string;
  status: 'online' | 'offline' | 'connecting' | 'error';
  errorMessage?: string;
  collectedAt: number;
  hostname: string;
  osPrettyName: string;
  kernel: string;
  arch: string;
  ipAddress: string;
  allIps?: string[];
  machineId?: string;
  canonicalDeviceId?: string;
  linkedSources?: DeviceSourceKind[];
  deduplicatedFrom?: string;
  uptimeSeconds: number;
  cpuModel: string;
  cpuCores: number;
  cpuPercent: number;
  loadAvg: [number, number, number];
  memTotalBytes: number;
  memUsedBytes: number;
  memAvailableBytes: number;
  memPercent: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  swapPercent: number;
  disks: DiskMetric[];
  network: NetworkInterfaceMetric[];
  netTotalRxBps: number;
  netTotalTxBps: number;
  temperatures: ThermalSensor[];
  maxTempC: number | null;
  topProcesses: ProcessMetric[];
  services: ServiceStatus[];
  history: TelemetryPoint[];
  tailscale?: {
    installed: boolean;
    running: boolean;
    sshEnabled: boolean;
    ip: string;
  };
}

export type ProxmoxAuthType = 'token' | 'password';

export interface ProxmoxConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  authType: ProxmoxAuthType;
  username: string; // e.g. root@pam
  password?: string;
  tokenId?: string; // e.g. root@pam!rackpanel
  tokenSecret?: string;
  allowInsecureTls: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface ProxmoxConfigPublic extends Omit<ProxmoxConfig, 'password' | 'tokenSecret'> {
  hasPassword: boolean;
  hasTokenSecret: boolean;
  isDemo?: boolean;
}

export interface ProxmoxNodeMetrics {
  node: string;
  status: 'online' | 'offline' | 'unknown';
  ipAddress?: string;
  canonicalDeviceId?: string;
  linkedSources?: DeviceSourceKind[];
  deduplicatedFrom?: string;
  cpuPercent: number;
  maxCpu: number;
  cpuModel: string;
  memUsedBytes: number;
  memTotalBytes: number;
  memPercent: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
  rootfsUsedBytes: number;
  rootfsTotalBytes: number;
  rootfsPercent: number;
  loadAvg: [number, number, number];
  uptimeSeconds: number;
  pveVersion: string;
  kernelVersion: string;
  history: TelemetryPoint[];
}

export interface ProxmoxGuest {
  vmid: number;
  name: string;
  node: string;
  type: 'qemu' | 'lxc';
  status: 'running' | 'stopped' | 'paused' | 'unknown';
  cpuPercent: number;
  cpus: number;
  memUsedBytes: number;
  memMaxBytes: number;
  memPercent: number;
  diskUsedBytes: number;
  diskMaxBytes: number;
  netInBytes: number;
  netOutBytes: number;
  uptimeSeconds: number;
  tags: string[];
  template: boolean;
}

export interface ProxmoxStorage {
  storage: string;
  node: string;
  type: string;
  content: string;
  active: boolean;
  enabled: boolean;
  shared: boolean;
  usedBytes: number;
  availBytes: number;
  totalBytes: number;
  usedPercent: number;
}

export interface ProxmoxTask {
  upid: string;
  node: string;
  type: string;
  id: string;
  user: string;
  status: string;
  startTime: number;
  endTime?: number;
}

export interface ProxmoxClusterSnapshot {
  configId: string;
  name: string;
  host: string;
  status: 'online' | 'offline' | 'connecting' | 'error';
  errorMessage?: string;
  collectedAt: number;
  clusterName: string;
  quorate: boolean;
  nodes: ProxmoxNodeMetrics[];
  guests: ProxmoxGuest[];
  storage: ProxmoxStorage[];
  tasks: ProxmoxTask[];
  isDemo?: boolean;
}

export type GuestPowerAction = 'start' | 'shutdown' | 'reboot' | 'stop';

export type TailscaleAuthMode = 'local' | 'apiKey' | 'oauth';

export interface TailscaleConfig {
  id: string;
  name: string;
  mode: TailscaleAuthMode;
  tailnet: string; // e.g. '-' or 'example.com' or 'tail1234.ts.net'
  apiKey?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  enabled: boolean;
  createdAt: string;
}

export interface TailscaleConfigPublic
  extends Omit<TailscaleConfig, 'apiKey' | 'oauthClientSecret'> {
  hasApiKey: boolean;
  hasOauthSecret: boolean;
  isDemo?: boolean;
}

export interface TailscaleDevice {
  id: string;
  hostname: string;
  dnsName: string;
  ipv4: string;
  ipv6: string;
  addresses: string[];
  os: string;
  online: boolean;
  active: boolean;
  isSelf: boolean;
  lastSeen: number | null;
  clientVersion: string;
  tags: string[];
  exitNode: boolean;
  exitNodeOption: boolean;
  advertisedRoutes: string[];
  enabledRoutes: string[];
  relay: string;
  curAddr: string;
  rxBytes: number;
  txBytes: number;
  authorized: boolean;
  updateAvailable: boolean;
  sshEnabled?: boolean;
  canonicalDeviceId?: string;
  linkedSources?: DeviceSourceKind[];
}

export interface TailscaleSnapshot {
  configId: string;
  name: string;
  mode: TailscaleAuthMode;
  tailnetName: string;
  status: 'online' | 'offline' | 'connecting' | 'error';
  errorMessage?: string;
  collectedAt: number;
  selfHostname?: string;
  devices: TailscaleDevice[];
  isDemo?: boolean;
}

export interface LocalTailscaleHostStatus {
  platform: string;
  installed: boolean;
  binaryPath: string;
  backendState: string; // Running | NeedsLogin | Stopped | Starting | NotInstalled | Unknown
  running: boolean;
  selfIp: string;
  selfHostname: string;
  tailnetName: string;
  authUrl: string;
  canAutoInstall: boolean;
  installHint: string;
}

export interface TailscaleActionResult {
  ok: boolean;
  message: string;
  output: string;
  authUrl?: string;
  tailscaleIp?: string;
  status?: LocalTailscaleHostStatus;
}

export interface OpnsenseConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: 'https' | 'http';
  apiKey?: string;
  apiSecret?: string;
  allowInsecureTls: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface OpnsenseConfigPublic extends Omit<OpnsenseConfig, 'apiKey' | 'apiSecret'> {
  hasApiKey: boolean;
  hasApiSecret: boolean;
  isDemo?: boolean;
}

export interface OpnsenseGateway {
  name: string;
  address: string;
  status: 'online' | 'down' | 'loss' | 'delay' | 'unknown';
  statusText: string;
  delayMs: number | null;
  stddevMs: number | null;
  lossPercent: number | null;
  isDefault: boolean;
}

export interface OpnsenseInterface {
  device: string;
  name: string;
  description: string;
  ip4: string;
  status: string;
  inBytesPerSec: number;
  outBytesPerSec: number;
  inBytesTotal: number;
  outBytesTotal: number;
  inErrors: number;
  outErrors: number;
}

export interface OpnsenseService {
  id: string;
  name: string;
  description: string;
  running: boolean;
}

export interface OpnsenseWireGuardPeer {
  name: string;
  interface: string;
  endpoint: string;
  latestHandshake: number | null;
  rxBytes: number;
  txBytes: number;
  online: boolean;
}

export interface OpnsenseFirewallLog {
  id: string;
  timestamp: string;
  action: 'pass' | 'block' | 'rdr' | 'other';
  interface: string;
  proto: string;
  src: string;
  srcPort: string;
  dst: string;
  dstPort: string;
  label: string;
}

export interface OpnsenseSnapshot {
  configId: string;
  name: string;
  host: string;
  status: 'online' | 'offline' | 'connecting' | 'error';
  errorMessage?: string;
  collectedAt: number;
  hostname: string;
  canonicalDeviceId?: string;
  linkedSources?: DeviceSourceKind[];
  deduplicatedFrom?: string;
  version: string;
  uptimeSeconds: number;
  cpuPercent: number;
  cpuCores: number;
  cpuModel: string;
  loadAvg: [number, number, number];
  memUsedBytes: number;
  memTotalBytes: number;
  memPercent: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  diskPercent: number;
  tempC: number | null;
  pfStatesCurrent: number;
  pfStatesMax: number;
  pfStatesPercent: number;
  totalRxBps: number;
  totalTxBps: number;
  firmwareUpdateAvailable: boolean;
  gateways: OpnsenseGateway[];
  interfaces: OpnsenseInterface[];
  services: OpnsenseService[];
  wireguardPeers: OpnsenseWireGuardPeer[];
  firewallLogs: OpnsenseFirewallLog[];
  history: TelemetryPoint[];
  isDemo?: boolean;
}

export type OpnsenseServiceAction = 'start' | 'stop' | 'restart';

export type UserRole = 'admin' | 'operator';

export interface AuthUserPublic {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string;
}

export interface AuthStatusResponse {
  setupRequired: boolean;
  authenticated: boolean;
  pinLocked: boolean;
  splashPinEnabled: boolean;
  user: AuthUserPublic | null;
  rackTitle: string;
}

export interface AuthLoginResponse {
  token: string;
  user: AuthUserPublic;
  pinLocked: boolean;
}

export interface PanelSettings {
  pollIntervalMs: number;
  temperatureUnit: 'C' | 'F';
  demoMode: boolean;
  rackTitle: string;
  screenDimSeconds: number;
  idleSplashSeconds: number;
  splashPinEnabled: boolean;
  hasSplashPin?: boolean;
}

export interface AlertItem {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  source: string;
  message: string;
  timestamp: number;
}

export interface OverviewResponse {
  timestamp: number;
  settings: PanelSettings;
  servers: Array<{
    config: SshServerPublic;
    metrics: SshServerMetrics;
  }>;
  proxmox: ProxmoxClusterSnapshot[];
  tailscale: TailscaleSnapshot[];
  opnsense: OpnsenseSnapshot[];
  summary: {
    totalServers: number;
    onlineServers: number;
    totalProxmoxNodes: number;
    onlineProxmoxNodes: number;
    runningVms: number;
    totalVms: number;
    runningLxcs: number;
    totalLxcs: number;
    tailscaleOnlineDevices: number;
    tailscaleTotalDevices: number;
    opnsenseOnline: number;
    opnsenseTotal: number;
    opnsenseGatewaysOnline: number;
    opnsenseGatewaysTotal: number;
    avgCpuPercent: number;
    totalMemUsedBytes: number;
    totalMemBytes: number;
    totalStorageUsedBytes: number;
    totalStorageBytes: number;
    totalNetRxBps: number;
    totalNetTxBps: number;
    uniquePhysicalDevices?: number;
    deduplicatedSources?: number;
  };
  alerts: AlertItem[];
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, string | number>;
}
