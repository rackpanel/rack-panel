import type {
  AuthLoginResponse,
  AuthStatusResponse,
  AuthUserPublic,
  CommandResult,
  ConnectionTestResult,
  DockerContainerAction,
  DockerHostSnapshot,
  GuestPowerAction,
  HikvisionConfig,
  HikvisionConfigPublic,
  TopologyCanvas,
  TopologyDocPage,
  TopologyGitSyncConfig,
  TopologyLink,
  TopologyNode,
  TopologyPatchCable,
  TopologyRack,
  TopologyRackSlotItem,
  TopologyState,
  LocalTailscaleHostStatus,
  OpnsenseConfig,
  OpnsenseConfigPublic,
  OpnsenseServiceAction,
  OverviewResponse,
  PanelSettings,
  ProxmoxConfig,
  ProxmoxConfigPublic,
  SshServerConfig,
  SshServerPublic,
  UnifiConfig,
  UnifiConfigPublic,
  UpsConfig,
  UpsConfigPublic,
  TailscaleActionResult,
  TailscaleConfig,
  TailscaleConfigPublic,
  TailscaleSnapshot,
  UserRole,
} from '@shared/types';
import { clearAuthToken, getAuthToken, notifyPinLocked, notifyUnauthorized } from '@/api/auth';

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const mergedHeaders = options && options.headers ? { ...headers, ...(options.headers as Record<string, string>) } : headers;

  const res = await fetch(url, {
    ...options,
    headers: mergedHeaders,
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const isAuthRoute = url.indexOf('/api/auth/') === 0;
    if (res.status === 401 && !isAuthRoute) {
      clearAuthToken();
      notifyUnauthorized();
    } else if (res.status === 423) {
      notifyPinLocked();
    }
    const msg = (parsed && (parsed.error || parsed.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (parsed === null) {
    throw new Error('Backend returned non-JSON response (check that the Rack Panel API server is running)');
  }
  return parsed as T;
}

export const api = {
  // Authentication & Persistent Sessions
  getAuthStatus(): Promise<AuthStatusResponse> {
    return requestJson<AuthStatusResponse>('/api/auth/status');
  },

  setupAdmin(payload: {
    username: string;
    displayName?: string;
    password: string;
  }): Promise<AuthLoginResponse> {
    return requestJson<AuthLoginResponse>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  login(username: string, password: string): Promise<AuthLoginResponse> {
    return requestJson<AuthLoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  logout(): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
  },

  // Users
  listUsers(): Promise<AuthUserPublic[]> {
    return requestJson<AuthUserPublic[]>('/api/users');
  },

  createUser(payload: {
    username: string;
    displayName?: string;
    password: string;
    role: UserRole;
  }): Promise<AuthUserPublic> {
    return requestJson<AuthUserPublic>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  changeUserPassword(userId: string, password: string): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>(`/api/users/${encodeURIComponent(userId)}/password`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
  },

  deleteUser(userId: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  },

  getOverview(): Promise<OverviewResponse> {
    return requestJson<OverviewResponse>('/api/overview');
  },

  triggerPoll(): Promise<OverviewResponse> {
    return requestJson<OverviewResponse>('/api/poll', { method: 'POST' });
  },

  getSettings(): Promise<PanelSettings> {
    return requestJson<PanelSettings>('/api/settings');
  },

  updateSettings(patch: Partial<PanelSettings> & { splashPin?: string }): Promise<PanelSettings> {
    return requestJson<PanelSettings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },

  lockSplash(): Promise<{ ok: boolean; pinLocked: boolean }> {
    return requestJson<{ ok: boolean; pinLocked: boolean }>('/api/settings/lock', {
      method: 'POST',
    });
  },

  verifySplashPin(pin: string): Promise<{ ok: boolean; pinLocked?: boolean; message?: string }> {
    return requestJson<{ ok: boolean; pinLocked?: boolean; message?: string }>('/api/settings/verify-pin', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  factoryResetPanel(): Promise<{ ok: boolean; settings: PanelSettings }> {
    return requestJson<{ ok: boolean; settings: PanelSettings }>('/api/settings/factory-reset', {
      method: 'POST',
    });
  },

  // SSH Servers
  listServers(): Promise<SshServerPublic[]> {
    return requestJson<SshServerPublic[]>('/api/servers');
  },

  testServer(payload: Partial<SshServerConfig>): Promise<ConnectionTestResult> {
    return requestJson<ConnectionTestResult>('/api/servers/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  createServer(payload: Partial<SshServerConfig>): Promise<SshServerPublic> {
    return requestJson<SshServerPublic>('/api/servers', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateServer(id: string, payload: Partial<SshServerConfig>): Promise<SshServerPublic> {
    return requestJson<SshServerPublic>(`/api/servers/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteServer(id: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/servers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  execServerCommand(id: string, command: string): Promise<CommandResult> {
    return requestJson<CommandResult>(`/api/servers/${encodeURIComponent(id)}/exec`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    });
  },

  installRemoteTailscale(
    id: string,
    payload: { authKey?: string; enableSsh?: boolean; switchToTailscaleSsh?: boolean },
  ): Promise<TailscaleActionResult> {
    return requestJson<TailscaleActionResult>(`/api/servers/${encodeURIComponent(id)}/install-tailscale`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Proxmox VE
  listProxmox(): Promise<ProxmoxConfigPublic[]> {
    return requestJson<ProxmoxConfigPublic[]>('/api/proxmox');
  },

  testProxmox(payload: Partial<ProxmoxConfig>): Promise<ConnectionTestResult> {
    return requestJson<ConnectionTestResult>('/api/proxmox/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  createProxmox(payload: Partial<ProxmoxConfig>): Promise<ProxmoxConfigPublic> {
    return requestJson<ProxmoxConfigPublic>('/api/proxmox', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateProxmox(id: string, payload: Partial<ProxmoxConfig>): Promise<ProxmoxConfigPublic> {
    return requestJson<ProxmoxConfigPublic>(`/api/proxmox/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteProxmox(id: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/proxmox/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  guestPowerAction(
    configId: string,
    node: string,
    type: 'qemu' | 'lxc',
    vmid: number,
    action: GuestPowerAction,
  ): Promise<{ ok: boolean; upid: string }> {
    return requestJson<{ ok: boolean; upid: string }>(
      `/api/proxmox/${encodeURIComponent(configId)}/nodes/${encodeURIComponent(node)}/${type}/${vmid}/action`,
      {
        method: 'POST',
        body: JSON.stringify({ action }),
      },
    );
  },

  createProxmoxVnc(
    configId: string,
    node: string,
    type: 'qemu' | 'lxc',
    vmid: number,
  ): Promise<{ ok: boolean; demo: boolean; token: string; password: string; label: string }> {
    return requestJson<{ ok: boolean; demo: boolean; token: string; password: string; label: string }>(
      `/api/proxmox/${encodeURIComponent(configId)}/nodes/${encodeURIComponent(node)}/${type}/${vmid}/vnc`,
      {
        method: 'POST',
      },
    );
  },

  // Docker
  getDockerHosts(serverId?: string): Promise<DockerHostSnapshot[]> {
    const qs = serverId ? `?serverId=${encodeURIComponent(serverId)}` : '';
    return requestJson<DockerHostSnapshot[]>(`/api/docker${qs}`);
  },

  dockerContainerAction(
    serverId: string,
    containerId: string,
    action: DockerContainerAction,
  ): Promise<{ ok: boolean; message: string }> {
    return requestJson<{ ok: boolean; message: string }>(
      `/api/docker/${encodeURIComponent(serverId)}/containers/${encodeURIComponent(containerId)}/action`,
      {
        method: 'POST',
        body: JSON.stringify({ action }),
      },
    );
  },

  getDockerContainerLogs(serverId: string, containerId: string, tail = 200): Promise<{ logs: string }> {
    return requestJson<{ logs: string }>(
      `/api/docker/${encodeURIComponent(serverId)}/containers/${encodeURIComponent(containerId)}/logs?tail=${tail}`,
    );
  },

  execDockerContainer(serverId: string, containerId: string, command: string): Promise<CommandResult> {
    return requestJson<CommandResult>(
      `/api/docker/${encodeURIComponent(serverId)}/containers/${encodeURIComponent(containerId)}/exec`,
      {
        method: 'POST',
        body: JSON.stringify({ command }),
      },
    );
  },

  pruneDockerHost(serverId: string, target: 'containers' | 'images' | 'all'): Promise<{ ok: boolean; output: string }> {
    return requestJson<{ ok: boolean; output: string }>(`/api/docker/${encodeURIComponent(serverId)}/prune`, {
      method: 'POST',
      body: JSON.stringify({ target }),
    });
  },

  // UPS / Power
  listUps(): Promise<UpsConfigPublic[]> {
    return requestJson<UpsConfigPublic[]>('/api/ups');
  },

  testUps(payload: Partial<UpsConfig>): Promise<ConnectionTestResult> {
    return requestJson<ConnectionTestResult>('/api/ups/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  createUps(payload: Partial<UpsConfig> & { name: string; host: string }): Promise<UpsConfigPublic> {
    return requestJson<UpsConfigPublic>('/api/ups', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateUps(id: string, payload: Partial<UpsConfig> & { name: string; host: string }): Promise<UpsConfigPublic> {
    return requestJson<UpsConfigPublic>('/api/ups', {
      method: 'POST',
      body: JSON.stringify({ ...payload, id }),
    });
  },

  deleteUps(id: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/ups/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  startTeslaPowerwallAuth(clientId?: string, redirectUri?: string): Promise<{ authUrl: string; state: string }> {
    return requestJson<{ authUrl: string; state: string }>('/api/ups/tesla-auth/start', {
      method: 'POST',
      body: JSON.stringify({ clientId, redirectUri }),
    });
  },

  exchangeTeslaPowerwallAuth(
    callbackUrl: string,
    state?: string,
  ): Promise<{ ok: boolean; accessToken: string; refreshToken: string; expiresIn: number; isFleetApi?: boolean }> {
    return requestJson<{ ok: boolean; accessToken: string; refreshToken: string; expiresIn: number; isFleetApi?: boolean }>(
      '/api/ups/tesla-auth/exchange',
      {
        method: 'POST',
        body: JSON.stringify({ callbackUrl, state }),
      },
    );
  },

  getTeslaPartnerPublicKey(): Promise<{ publicKeyPem: string }> {
    return requestJson<{ publicKeyPem: string }>('/api/ups/tesla-auth/public-key');
  },

  registerTeslaPartnerAccount(payload: {
    clientId: string;
    clientSecret: string;
    domain: string;
    regionHost?: string;
  }): Promise<{ ok: boolean; message: string; publicKeyPem: string }> {
    return requestJson<{ ok: boolean; message: string; publicKeyPem: string }>(
      '/api/ups/tesla-auth/register-partner',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    );
  },

  // Tailscale
  listTailscale(): Promise<TailscaleConfigPublic[]> {
    return requestJson<TailscaleConfigPublic[]>('/api/tailscale');
  },

  testTailscale(payload: Partial<TailscaleConfig>): Promise<ConnectionTestResult> {
    return requestJson<ConnectionTestResult>('/api/tailscale/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  createTailscale(payload: Partial<TailscaleConfig>): Promise<TailscaleConfigPublic> {
    return requestJson<TailscaleConfigPublic>('/api/tailscale', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateTailscale(id: string, payload: Partial<TailscaleConfig>): Promise<TailscaleConfigPublic> {
    return requestJson<TailscaleConfigPublic>(`/api/tailscale/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteTailscale(id: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/tailscale/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  syncTailscale(id: string): Promise<TailscaleSnapshot> {
    return requestJson<TailscaleSnapshot>(`/api/tailscale/${encodeURIComponent(id)}/sync`, {
      method: 'POST',
    });
  },

  getLocalTailscaleStatus(): Promise<LocalTailscaleHostStatus> {
    return requestJson<LocalTailscaleHostStatus>('/api/tailscale/local-status');
  },

  installLocalTailscale(): Promise<TailscaleActionResult> {
    return requestJson<TailscaleActionResult>('/api/tailscale/local-install', {
      method: 'POST',
    });
  },

  bringUpLocalTailscale(payload: {
    authKey?: string;
    hostname?: string;
    enableSsh?: boolean;
  }): Promise<TailscaleActionResult> {
    return requestJson<TailscaleActionResult>('/api/tailscale/local-up', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // OPNsense
  listOpnsense(): Promise<OpnsenseConfigPublic[]> {
    return requestJson<OpnsenseConfigPublic[]>('/api/opnsense');
  },

  testOpnsense(payload: Partial<OpnsenseConfig>): Promise<ConnectionTestResult> {
    return requestJson<ConnectionTestResult>('/api/opnsense/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  createOpnsense(payload: Partial<OpnsenseConfig>): Promise<OpnsenseConfigPublic> {
    return requestJson<OpnsenseConfigPublic>('/api/opnsense', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateOpnsense(id: string, payload: Partial<OpnsenseConfig>): Promise<OpnsenseConfigPublic> {
    return requestJson<OpnsenseConfigPublic>(`/api/opnsense/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteOpnsense(id: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/opnsense/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  opnsenseServiceAction(
    configId: string,
    serviceId: string,
    action: OpnsenseServiceAction,
  ): Promise<{ ok: boolean; message: string }> {
    return requestJson<{ ok: boolean; message: string }>(
      `/api/opnsense/${encodeURIComponent(configId)}/services/${encodeURIComponent(serviceId)}/${action}`,
      { method: 'POST' },
    );
  },

  opnsenseSystemAction(
    configId: string,
    action: 'reboot' | 'halt' | 'firmware-check',
  ): Promise<{ ok: boolean; message: string }> {
    return requestJson<{ ok: boolean; message: string }>(
      `/api/opnsense/${encodeURIComponent(configId)}/system/${action}`,
      { method: 'POST' },
    );
  },

  // Hikvision NVRs / DVRs / IP Cameras
  listHikvision(): Promise<HikvisionConfigPublic[]> {
    return requestJson<HikvisionConfigPublic[]>('/api/hikvision');
  },

  testHikvision(payload: Partial<HikvisionConfig>): Promise<ConnectionTestResult> {
    return requestJson<ConnectionTestResult>('/api/hikvision/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  createHikvision(payload: Partial<HikvisionConfig>): Promise<HikvisionConfigPublic> {
    return requestJson<HikvisionConfigPublic>('/api/hikvision', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateHikvision(id: string, payload: Partial<HikvisionConfig>): Promise<HikvisionConfigPublic> {
    return requestJson<HikvisionConfigPublic>(`/api/hikvision/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteHikvision(id: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/hikvision/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  hikvisionPtz(
    configId: string,
    channelId: number,
    pan: number,
    tilt: number,
    zoom: number,
  ): Promise<{ ok: boolean; message: string }> {
    return requestJson<{ ok: boolean; message: string }>(
      `/api/hikvision/${encodeURIComponent(configId)}/channels/${channelId}/ptz`,
      {
        method: 'POST',
        body: JSON.stringify({ pan, tilt, zoom }),
      },
    );
  },

  getHikvisionSnapshotUrl(
    configId: string,
    channelId: number,
    streamKind: 'main' | 'sub' = 'sub',
    cacheBust?: number,
  ): string {
    const token = getAuthToken();
    const t = cacheBust !== undefined ? cacheBust : Date.now();
    return `/api/hikvision/${encodeURIComponent(configId)}/channels/${channelId}/snapshot?stream=${streamKind}&token=${encodeURIComponent(token)}&_t=${t}`;
  },

  getHikvisionMjpegUrl(
    configId: string,
    channelId: number,
    streamKind: 'main' | 'sub' = 'sub',
    mode: 'auto' | 'rtsp' | 'isapi' = 'auto',
    fps = 5,
    cacheBust?: number,
  ): string {
    const token = getAuthToken();
    const t = cacheBust !== undefined ? cacheBust : Date.now();
    return `/api/hikvision/${encodeURIComponent(configId)}/channels/${channelId}/mjpeg?stream=${streamKind}&mode=${mode}&fps=${fps}&token=${encodeURIComponent(token)}&_t=${t}`;
  },

  // Topology Complete Infrastructure Topology, Rack Builder, Scanner, Healthchecks & Wiki Suite
  getTopologyState(): Promise<TopologyState> {
    return requestJson<TopologyState>('/api/topology/state');
  },

  resetTopologyState(
    scope: 'all' | 'canvas' | 'racks' = 'all',
    options?: {
      resetWires?: boolean;
      resetCustomNodes?: boolean;
      resetAllNodes?: boolean;
      resetDiscovery?: boolean;
      canvasId?: string;
    },
  ): Promise<{ ok: boolean; scope: string; state: TopologyState }> {
    return requestJson<{ ok: boolean; scope: string; state: TopologyState }>('/api/topology/reset', {
      method: 'POST',
      body: JSON.stringify({ scope, ...(options || {}) }),
    });
  },

  createTopologyCanvas(payload: { name: string; description?: string }): Promise<TopologyCanvas> {
    return requestJson<TopologyCanvas>('/api/topology/canvases', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteTopologyCanvas(canvasId: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/topology/canvases/${encodeURIComponent(canvasId)}`, {
      method: 'DELETE',
    });
  },

  upsertTopologyNode(payload: Partial<TopologyNode> & { name: string }): Promise<TopologyNode> {
    return requestJson<TopologyNode>('/api/topology/nodes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateTopologyNodePositions(positions: Array<{ id: string; x: number; y: number }>): Promise<{ ok: boolean }> {
    return requestJson<{ ok: boolean }>('/api/topology/nodes/positions', {
      method: 'PUT',
      body: JSON.stringify({ positions }),
    });
  },

  deleteTopologyNode(nodeId: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/topology/nodes/${encodeURIComponent(nodeId)}`, {
      method: 'DELETE',
    });
  },

  upsertTopologyLink(payload: Partial<TopologyLink> & { sourceId: string; targetId: string }): Promise<TopologyLink> {
    return requestJson<TopologyLink>('/api/topology/links', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteTopologyLink(linkId: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/topology/links/${encodeURIComponent(linkId)}`, {
      method: 'DELETE',
    });
  },

  autoLayoutTopologyCanvas(
    canvasId: string,
    options?: {
      cleanLayout?: boolean;
      autoRouteWires?: boolean;
      pullDiscovered?: boolean;
      deduplicateNodes?: boolean;
      all?: boolean;
      subnet?: string;
    },
  ): Promise<{
    ok: boolean;
    nodes: TopologyNode[];
    addedNodes?: number;
    addedLinks?: number;
    wiredLinks?: number;
    state?: TopologyState;
  }> {
    return requestJson<{
      ok: boolean;
      nodes: TopologyNode[];
      addedNodes?: number;
      addedLinks?: number;
      wiredLinks?: number;
      state?: TopologyState;
    }>(`/api/topology/canvases/${encodeURIComponent(canvasId)}/auto-layout`, {
      method: 'POST',
      body: JSON.stringify(options || {}),
    });
  },

  getTopologySvgExportUrl(canvasId: string): string {
    const token = getAuthToken();
    return `/api/topology/canvases/${encodeURIComponent(canvasId)}/export.svg?token=${encodeURIComponent(token)}`;
  },

  upsertTopologyRack(payload: Partial<TopologyRack> & { name: string }): Promise<TopologyRack> {
    return requestJson<TopologyRack>('/api/topology/racks', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteTopologyRack(rackId: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/topology/racks/${encodeURIComponent(rackId)}`, {
      method: 'DELETE',
    });
  },

  upsertTopologyRackItem(
    rackId: string,
    payload: Partial<TopologyRackSlotItem> & { name: string; startU: number },
  ): Promise<TopologyRack> {
    return requestJson<TopologyRack>(`/api/topology/racks/${encodeURIComponent(rackId)}/items`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  moveTopologyRackItem(payload: {
    fromRackId: string;
    toRackId: string;
    itemId: string;
    startU: number;
    slotIndex?: number;
    face?: 'front' | 'rear';
  }): Promise<{ ok: boolean; state: TopologyState }> {
    return requestJson<{ ok: boolean; state: TopologyState }>('/api/topology/racks/move-item', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  autoLayoutTopologyRacks(
    rackId?: string,
  ): Promise<{ ok: boolean; state: TopologyState; racksArranged: number; itemsMoved: number }> {
    return requestJson<{ ok: boolean; state: TopologyState; racksArranged: number; itemsMoved: number }>(
      '/api/topology/racks/auto-layout',
      {
        method: 'POST',
        body: JSON.stringify(rackId ? { rackId } : {}),
      },
    );
  },

  deleteTopologyRackItem(rackId: string, itemId: string): Promise<TopologyRack> {
    return requestJson<TopologyRack>(
      `/api/topology/racks/${encodeURIComponent(rackId)}/items/${encodeURIComponent(itemId)}`,
      { method: 'DELETE' },
    );
  },

  upsertTopologyRackPatch(
    rackId: string,
    payload: Partial<TopologyPatchCable> & { fromItemId: string; toItemId: string },
  ): Promise<TopologyRack> {
    return requestJson<TopologyRack>(`/api/topology/racks/${encodeURIComponent(rackId)}/patches`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteTopologyRackPatch(rackId: string, patchId: string): Promise<TopologyRack> {
    return requestJson<TopologyRack>(
      `/api/topology/racks/${encodeURIComponent(rackId)}/patches/${encodeURIComponent(patchId)}`,
      { method: 'DELETE' },
    );
  },

  upsertTopologyDoc(
    payload: Partial<TopologyDocPage> & { title: string; content: string; revisionSummary?: string },
  ): Promise<TopologyDocPage> {
    return requestJson<TopologyDocPage>('/api/topology/docs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteTopologyDoc(docId: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/topology/docs/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
    });
  },

  runTopologyHealthChecks(): Promise<{ ok: boolean; nodes: TopologyNode[]; state: TopologyState }> {
    return requestJson<{ ok: boolean; nodes: TopologyNode[]; state: TopologyState }>(
      '/api/topology/healthcheck',
      { method: 'POST' },
    );
  },

  scanTopologySubnet(subnet: string): Promise<{ ok: boolean; state: TopologyState }> {
    return requestJson<{ ok: boolean; state: TopologyState }>('/api/topology/scan', {
      method: 'POST',
      body: JSON.stringify({ subnet }),
    });
  },

  autoScanDevices(
    kind: 'server' | 'proxmox' | 'opnsense' | 'switch' | 'hikvision' | 'unifi' | 'ups',
    subnet?: string,
  ): Promise<{
    ok: boolean;
    kind: string;
    subnet: string;
    scannedIps: number;
    devices: Array<{
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
    }>;
  }> {
    return requestJson('/api/devices/autoscan', {
      method: 'POST',
      body: JSON.stringify({ kind, subnet }),
    });
  },

  // UniFi Network Controllers
  listUnifi(): Promise<UnifiConfigPublic[]> {
    return requestJson<UnifiConfigPublic[]>('/api/unifi');
  },

  testUnifi(payload: Partial<UnifiConfig>): Promise<ConnectionTestResult> {
    return requestJson<ConnectionTestResult>('/api/unifi/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  saveUnifi(payload: Partial<UnifiConfig>): Promise<UnifiConfigPublic> {
    return requestJson<UnifiConfigPublic>('/api/unifi', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  deleteUnifi(id: string): Promise<{ deleted: boolean }> {
    return requestJson<{ deleted: boolean }>(`/api/unifi/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  unifiDeviceAction(
    configId: string,
    mac: string,
    action: 'restart' | 'locate' | 'unlocate' | 'poe-cycle',
    portIdx?: number,
  ): Promise<{ ok: boolean; message: string }> {
    return requestJson<{ ok: boolean; message: string }>(
      `/api/unifi/${encodeURIComponent(configId)}/devices/${encodeURIComponent(mac)}/action`,
      {
        method: 'POST',
        body: JSON.stringify({ action, portIdx }),
      },
    );
  },

  unifiReconnectClient(configId: string, mac: string): Promise<{ ok: boolean; message: string }> {
    return requestJson<{ ok: boolean; message: string }>(
      `/api/unifi/${encodeURIComponent(configId)}/clients/${encodeURIComponent(mac)}/reconnect`,
      { method: 'POST' },
    );
  },

  listSwitches(): Promise<{
    switches: TopologyNode[];
    racks: TopologyRack[];
    links: TopologyLink[];
  }> {
    return requestJson('/api/switches');
  },

  deleteSwitch(nodeId: string): Promise<{ ok: boolean }> {
    return requestJson(`/api/switches/${encodeURIComponent(nodeId)}`, {
      method: 'DELETE',
    });
  },

  probeTopologySwitch(payload: {
    host: string;
    name?: string;
    protocol?: 'auto' | 'ssh' | 'telnet' | 'http' | 'snmp';
    port?: number;
    username?: string;
    password?: string;
    enablePassword?: string;
    snmpCommunity?: string;
    modelPreset?: string;
    nodeId?: string;
    canvasId?: string;
    rackId?: string;
    rackItemId?: string;
    startU?: number;
    face?: 'front' | 'rear';
    mountInRack?: boolean;
  }): Promise<{
    ok: boolean;
    probe: {
      ok: boolean;
      reachable: boolean;
      protocolUsed: string;
      message: string;
      switchMeta: NonNullable<TopologyNode['switchMeta']>;
    };
    node: TopologyNode;
    rackItem?: TopologyRackSlotItem;
    state: TopologyState;
  }> {
    return requestJson('/api/topology/switches/probe', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  analyzeTopologyRouting(payload: {
    nodeId?: string;
    canvasId?: string;
    rawConfigOrRoutes: string;
  }): Promise<{
    ok: boolean;
    analysis: { summaryText: string };
    addedNodes: number;
    addedLinks: number;
    state: TopologyState;
  }> {
    return requestJson('/api/topology/analyze-routing', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  approveTopologyDiscovery(discoveryId: string, canvasId?: string): Promise<{ ok: boolean; state: TopologyState }> {
    return requestJson<{ ok: boolean; state: TopologyState }>(
      `/api/topology/discovery/${encodeURIComponent(discoveryId)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ canvasId }),
      },
    );
  },

  syncTopologyFromOverview(
    canvasId?: string,
  ): Promise<{ ok: boolean; addedNodes: number; addedLinks: number; state: TopologyState }> {
    return requestJson<{ ok: boolean; addedNodes: number; addedLinks: number; state: TopologyState }>(
      '/api/topology/sync-overview',
      {
        method: 'POST',
        body: JSON.stringify({ canvasId }),
      },
    );
  },

  importTopologyMesh(payload: {
    kind: 'zigbee2mqtt' | 'zwave-js' | 'unraid';
    canvasId?: string;
    rawJson?: string;
  }): Promise<{ ok: boolean; importedNodes: number; importedLinks: number; canvasId: string; state: TopologyState }> {
    return requestJson<{
      ok: boolean;
      importedNodes: number;
      importedLinks: number;
      canvasId: string;
      state: TopologyState;
    }>('/api/topology/import-mesh', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  syncTopologyGit(
    payload?: Partial<TopologyGitSyncConfig>,
  ): Promise<{ ok: boolean; message: string; exportDir: string; state: TopologyState }> {
    return requestJson<{ ok: boolean; message: string; exportDir: string; state: TopologyState }>(
      '/api/topology/git-sync',
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      },
    );
  },
};
