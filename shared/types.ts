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

export type DeviceSourceKind = 'ssh' | 'proxmox' | 'tailscale' | 'opnsense' | 'hikvision' | 'unifi';

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

export type HikvisionDeviceKind = 'auto' | 'nvr' | 'dvr' | 'camera';

export interface HikvisionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  rtspPort: number;
  username: string;
  password?: string;
  deviceKind: HikvisionDeviceKind;
  allowInsecureTls: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface HikvisionConfigPublic extends Omit<HikvisionConfig, 'password'> {
  hasPassword: boolean;
  isDemo?: boolean;
}

export interface HikvisionChannel {
  id: number;
  name: string;
  sourceType: 'ip' | 'analog' | 'local';
  online: boolean;
  recording: boolean;
  ipAddress: string;
  model: string;
  protocol: string;
  poePort: number | null;
  mainStreamId: number;
  subStreamId: number;
  codec: string;
  resolution: string;
  fps: number;
  bitrateKbps: number;
  ptzSupported: boolean;
}

export interface HikvisionHdd {
  id: number;
  name: string;
  type: string;
  status: 'ok' | 'sleeping' | 'error' | 'unformatted' | 'unknown';
  statusText: string;
  capacityBytes: number;
  freeBytes: number;
  usedBytes: number;
  usedPercent: number;
  property: string;
}

export interface HikvisionSnapshot {
  configId: string;
  name: string;
  host: string;
  status: 'online' | 'offline' | 'connecting' | 'error';
  errorMessage?: string;
  collectedAt: number;
  deviceName: string;
  deviceType: 'NVR' | 'DVR' | 'IPCamera';
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  firmwareBuild: string;
  macAddress: string;
  uptimeSeconds: number;
  cpuPercent: number;
  memPercent: number;
  totalChannels: number;
  onlineChannels: number;
  recordingChannels: number;
  storageTotalBytes: number;
  storageUsedBytes: number;
  storageFreeBytes: number;
  storagePercent: number;
  channels: HikvisionChannel[];
  hdds: HikvisionHdd[];
  history: TelemetryPoint[];
  canonicalDeviceId?: string;
  linkedSources?: DeviceSourceKind[];
  deduplicatedFrom?: string;
  isDemo?: boolean;
}

export type UnifiControllerType = 'auto' | 'unifi-os' | 'classic' | 'standalone';

export interface UnifiConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  controllerType: UnifiControllerType;
  site: string;
  username?: string;
  password?: string;
  apiKey?: string;
  allowInsecureTls: boolean;
  enabled: boolean;
  createdAt: string;
}

export interface UnifiConfigPublic extends Omit<UnifiConfig, 'password' | 'apiKey'> {
  hasPassword: boolean;
  hasApiKey: boolean;
  isDemo?: boolean;
}

export interface UnifiDevicePort {
  portIdx: number;
  name: string;
  up: boolean;
  speedMbps: number;
  fullDuplex: boolean;
  poeEnable: boolean;
  poeWatts: number;
  media: string;
}

export interface UnifiDeviceRadio {
  name: string;
  radio: string;
  channel: number;
  txPower: number;
  satisfaction: number | null;
  numClients: number;
}

export interface UnifiDevice {
  id: string;
  mac: string;
  name: string;
  model: string;
  modelName: string;
  type: 'uap' | 'usw' | 'ugw' | 'udm' | 'uxg' | 'other';
  ip: string;
  version: string;
  adopted: boolean;
  state: 'online' | 'offline' | 'upgrading' | 'adopting';
  uptimeSeconds: number;
  cpuPercent: number;
  memPercent: number;
  loadAvg1: number | null;
  numClients: number;
  numUserClients: number;
  numGuestClients: number;
  txBytes: number;
  rxBytes: number;
  satisfaction: number | null;
  poeWatts: number;
  portCount: number;
  ports: UnifiDevicePort[];
  radios: UnifiDeviceRadio[];
}

export interface UnifiClientInfo {
  mac: string;
  name: string;
  hostname: string;
  ip: string;
  isWired: boolean;
  network: string;
  essid: string;
  channel: number | null;
  rssi: number | null;
  txRateMbps: number | null;
  rxRateMbps: number | null;
  txBytes: number;
  rxBytes: number;
  uptimeSeconds: number;
  apMac: string;
  swMac: string;
  swPort: number | null;
  oui: string;
}

export interface UnifiWlanInfo {
  id: string;
  name: string;
  enabled: boolean;
  security: string;
  wpaMode: string;
  isGuest: boolean;
  vlan: number | null;
  numClients: number;
}

export interface UnifiSnapshot {
  configId: string;
  name: string;
  host: string;
  controllerType: UnifiControllerType;
  site: string;
  status: 'online' | 'offline' | 'connecting' | 'error';
  errorMessage?: string;
  collectedAt: number;
  controllerVersion: string;
  totalDevices: number;
  onlineDevices: number;
  totalClients: number;
  wiredClients: number;
  wirelessClients: number;
  guestClients: number;
  wanIp: string;
  ispName: string;
  wanLatencyMs: number | null;
  wanRxBps: number;
  wanTxBps: number;
  devices: UnifiDevice[];
  clients: UnifiClientInfo[];
  wlans: UnifiWlanInfo[];
  history: TelemetryPoint[];
  isDemo?: boolean;
}

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
  hikvision: HikvisionSnapshot[];
  unifi: UnifiSnapshot[];
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
    hikvisionOnline: number;
    hikvisionTotal: number;
    hikvisionCamerasOnline: number;
    hikvisionCamerasTotal: number;
    unifiOnline?: number;
    unifiTotal?: number;
    unifiDevicesOnline?: number;
    unifiDevicesTotal?: number;
    unifiClientsTotal?: number;
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

// ---- Topology Complete Infrastructure Topology, Rack Builder, Scanner, Healthchecks & Wiki Suite ----

export type TopologyNodeKind =
  | 'isp'
  | 'router'
  | 'firewall'
  | 'switch'
  | 'ap'
  | 'server'
  | 'proxmox'
  | 'vm'
  | 'lxc'
  | 'docker'
  | 'nas'
  | 'nvr'
  | 'camera'
  | 'ai'
  | 'iot'
  | 'zigbee'
  | 'zwave'
  | 'electric'
  | 'rack'
  | 'generic';

export type TopologyHealthCheckMethod = 'auto' | 'ping' | 'tcp' | 'http' | 'https' | 'ssh' | 'telnet' | 'prometheus' | 'none';

export type SwitchModelPreset =
  | 'auto'
  | 'T1600G-28TS'
  | 'T1600G-28PS'
  | 'T2600G-28TS'
  | 'TL-SG3428'
  | 'TL-SG2428P'
  | 'CISCO-28P'
  | 'UBIQUITI-24P'
  | 'MIKROTIK-CRS326'
  | 'GENERIC-24P-4SFP'
  | 'GENERIC-16P'
  | 'GENERIC-8P';

export interface TopologySwitchPortState {
  portNumber: number; // 1..28
  name: string; // e.g. "Gi1/0/1" or "SFP 25"
  media: 'rj45' | 'sfp';
  linkStatus: 'up' | 'down' | 'disabled';
  speed: string; // "1000M", "100M", "10M", "10G", "Down"
  duplex?: string;
  poeSupported?: boolean;
  poeActive?: boolean;
  poeWatts?: number;
  vlan?: number | null;
  connectedMac?: string;
  connectedMacs?: string[];
  connectedDeviceName?: string;
}

export interface TopologySwitchMetadata {
  model: string; // e.g. "T1600G-28TS" or "T1600G-28PS"
  vendor: string; // e.g. "TP-Link JetStream"
  managementProtocol?: 'ssh' | 'telnet' | 'http' | 'snmp' | 'auto';
  managementPort?: number;
  username?: string;
  hasPassword?: boolean;
  firmwareVersion?: string;
  hardwareVersion?: string;
  serialOrMac?: string;
  uptimeStr?: string;
  poeSupported: boolean;
  poeBudgetWatts?: number;
  poeUsedWatts?: number;
  rj45PortCount: number; // 24 for T1600G-28TS / T1600G-28PS
  sfpPortCount: number; // 4 for T1600G-28TS / T1600G-28PS
  ports: TopologySwitchPortState[];
  lldpNeighbors?: Array<{
    localPort: number;
    remoteName: string;
    remoteMac?: string;
    remoteIp?: string;
  }>;
  lastPolledAt?: number;
}

export interface TopologyServicePort {
  port: number;
  protocol: 'tcp' | 'udp';
  serviceName: string;
  url?: string;
  status?: 'online' | 'offline' | 'unknown';
}

export interface TopologyCanvas {
  id: string;
  name: string;
  description: string;
  isDefault?: boolean;
  createdAt: string;
}

export interface TopologyNode {
  id: string;
  canvasId: string;
  name: string;
  kind: TopologyNodeKind;
  x: number;
  y: number;
  ipAddress: string;
  macAddress: string;
  hostname: string;
  vlan?: number | null;
  subnet?: string;
  manufacturer?: string;
  osOrFirmware?: string;
  parentId?: string; // e.g., Proxmox host node ID or Zigbee/Z-Wave coordinator ID
  linkedSourceKind?: DeviceSourceKind;
  linkedSourceId?: string;
  customIconUrl?: string;
  tags: string[];
  services: TopologyServicePort[];
  healthCheck: {
    method: TopologyHealthCheckMethod;
    target?: string; // Port number or URL or path
    intervalSec: number;
  };
  status: 'online' | 'offline' | 'warning' | 'unknown';
  latencyMs: number | null;
  lastCheckedAt: number | null;
  statusDetail?: string;
  rackPlacement?: {
    rackId: string;
    startU: number;
    heightU: number;
    face: 'front' | 'rear';
  };
  meshInfo?: {
    protocol: 'zigbee' | 'zwave';
    ieeeOrNodeId: string;
    role: 'coordinator' | 'router' | 'end-device';
    lqi?: number;
    batteryPercent?: number | null;
  };
  switchMeta?: TopologySwitchMetadata;
  docId?: string;
  createdAt: string;
}

export type TopologyLinkKind =
  | 'ethernet'
  | 'fiber'
  | 'dac'
  | 'poe'
  | 'wifi'
  | 'vlan'
  | 'virtual'
  | 'vpn'
  | 'zigbee'
  | 'zwave'
  | 'power';

export interface TopologyLink {
  id: string;
  canvasId: string;
  sourceId: string;
  targetId: string;
  kind: TopologyLinkKind;
  label: string;
  speedGbps?: string;
  sourcePort?: string;
  targetPort?: string;
  vlan?: number | null;
  lqi?: number | null;
  animated?: boolean;
  linkedRackPatchId?: string;
}

export interface TopologyRackSlotItem {
  id: string;
  nodeId?: string;
  name: string;
  kind:
    | TopologyNodeKind
    | 'patch-panel'
    | 'fiber-patch'
    | 'cable-manager'
    | 'ups'
    | 'pdu'
    | 'shelf'
    | 'mini-pc'
    | 'blank';
  startU: number;
  heightU: number;
  face: 'front' | 'rear';
  slotIndex?: number; // 0..(slotsTotal-1) for half/third/quarter-width shelf items (NUC, Raspberry Pi)
  slotsTotal?: number; // 1 = full 19" width, 2 = half-width (2x NUC), 3 = 3x Pi/Mini-PC
  status?: 'online' | 'offline' | 'warning';
  ipAddress?: string;
  portCount?: number;
  sfpPortCount?: number;
  driveBays?: number;
  outletCount?: number;
  color?: string;
  switchMeta?: TopologySwitchMetadata;
}

export interface TopologyPatchCable {
  id: string;
  rackId: string;
  fromRackId?: string;
  fromItemId: string;
  fromPort: string;
  toRackId?: string;
  toItemId: string;
  toPort: string;
  label: string;
  cableKind: 'cat6' | 'cat6a' | 'fiber-om4' | 'dac-sfp+' | 'poe' | 'power' | 'coax';
  color: string;
  linkedTopologyLinkId?: string;
}

export interface TopologyRack {
  id: string;
  name: string;
  widthInches: 19 | 10;
  totalU: number;
  location: string;
  x?: number;
  y?: number;
  items: TopologyRackSlotItem[];
  patches: TopologyPatchCable[];
  createdAt: string;
}

export interface TopologyDiscoveredDevice {
  id: string;
  ipAddress: string;
  hostname: string;
  macAddress: string;
  vendor: string;
  guessedKind: TopologyNodeKind;
  openPorts: TopologyServicePort[];
  latencyMs: number | null;
  source: 'subnet-scan' | 'arp' | 'proxmox' | 'tailscale' | 'opnsense' | 'hikvision' | 'zigbee2mqtt' | 'zwave-js' | 'unraid' | 'switch-probe';
  switchModel?: string;
  discoveredAt: number;
  approved: boolean;
}

export interface TopologyDocRevision {
  id: string;
  timestamp: number;
  summary: string;
  content: string;
}

export interface TopologyDocPage {
  id: string;
  title: string;
  slug: string;
  icon: string;
  nodeId?: string;
  canvasId?: string;
  isHome?: boolean;
  content: string;
  tags: string[];
  updatedAt: number;
  revisions: TopologyDocRevision[];
}

export interface TopologyGitSyncConfig {
  repoPathOrUrl: string;
  branch: string;
  autoCommit: boolean;
  lastSyncedAt?: number | null;
  lastSyncMessage?: string;
}

export interface TopologyState {
  canvases: TopologyCanvas[];
  nodes: TopologyNode[];
  links: TopologyLink[];
  racks: TopologyRack[];
  discoveryQueue: TopologyDiscoveredDevice[];
  docs: TopologyDocPage[];
  gitSync: TopologyGitSyncConfig;
  shareEnabled: boolean;
  sharePasswordProtected: boolean;
}

export type DockerContainerAction = 'start' | 'stop' | 'restart' | 'pause' | 'unpause' | 'remove';

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string;
  createdAt: string;
  composeProject?: string;
  composeService?: string;
  cpuPercent?: string;
  memUsage?: string;
  memPercent?: string;
  netIO?: string;
  pids?: string;
}

export interface DockerImageInfo {
  id: string;
  repository: string;
  tag: string;
  size: string;
  createdSince: string;
}

export interface DockerVolumeInfo {
  name: string;
  driver: string;
  mountpoint: string;
}

export interface DockerNetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface DockerHostSnapshot {
  serverId: string;
  serverName: string;
  host: string;
  status: 'online' | 'offline' | 'no-docker' | 'error';
  dockerVersion?: string;
  errorMessage?: string;
  isDemo?: boolean;
  containers: DockerContainerInfo[];
  images: DockerImageInfo[];
  volumes: DockerVolumeInfo[];
  networks: DockerNetworkInfo[];
  collectedAt: number;
}

