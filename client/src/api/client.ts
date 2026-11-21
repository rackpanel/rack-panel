import type {
  AuthLoginResponse,
  AuthStatusResponse,
  AuthUserPublic,
  CommandResult,
  ConnectionTestResult,
  GuestPowerAction,
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
};
