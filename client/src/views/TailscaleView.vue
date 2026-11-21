<template>
  <div>
    <!-- Section Bar -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">Tailscale Mesh Network</h2>
        <div class="panel-subtitle">
          Discover devices across your Tailnet via Local Daemon or Tailscale API and add them to SSH or Proxmox in one tap
        </div>
      </div>
      <div class="btn-group">
        <button
          v-if="activeTailnet && !activeTailnet.isDemo"
          class="btn"
          type="button"
          :disabled="syncing"
          @click="syncNow"
        >
          {{ syncing ? 'Syncing...' : 'Sync Devices' }}
        </button>
        <button class="btn btn-primary" type="button" @click="$emit('add-tailscale')">
          + Connect Tailnet
        </button>
      </div>
    </div>

    <!-- Host Tailscale Auto-Install & Status Bar -->
    <div v-if="hostStatus" class="panel" style="margin-bottom: 16px;">
      <div class="host-ts-bar">
        <div style="min-width: 0;">
          <div class="dev-title-row">
            <span
              class="dot"
              :class="
                hostStatus.running
                  ? 'dot-ok pulse'
                  : hostStatus.installed
                    ? 'dot-warn'
                    : 'dot-crit'
              "
            ></span>
            <span class="panel-title" style="color: #f8fafc;">
              Rack Panel Host Tailscale ({{ hostStatus.platform }})
            </span>
            <span
              class="pill"
              style="margin-left: 8px;"
              :class="
                hostStatus.running
                  ? 'pill-ok'
                  : hostStatus.installed
                    ? 'pill-warn'
                    : 'pill-crit'
              "
            >
              {{
                hostStatus.running
                  ? `ONLINE · ${hostStatus.selfIp}`
                  : hostStatus.installed
                    ? hostStatus.backendState.toUpperCase()
                    : 'NOT INSTALLED'
              }}
            </span>
          </div>
          <div class="panel-subtitle" style="margin-top: 4px;">
            <template v-if="!hostStatus.installed">
              {{ hostStatus.installHint }}
            </template>
            <template v-else-if="!hostStatus.running">
              Tailscale is installed at <span class="mono">{{ hostStatus.binaryPath }}</span>, but not connected to your Tailnet yet.
            </template>
            <template v-else>
              Host <span class="mono">{{ hostStatus.selfHostname }}</span> is joined to
              <span class="mono">{{ hostStatus.tailnetName || 'Tailnet' }}</span>.
            </template>
          </div>
        </div>

        <div class="btn-group" style="margin-bottom: 0;">
          <button
            v-if="!hostStatus.installed && hostStatus.canAutoInstall"
            class="btn btn-primary"
            type="button"
            :disabled="installingHost"
            @click="installHostTailscale"
          >
            {{ installingHost ? 'Installing Tailscale...' : 'Install Tailscale Now' }}
          </button>
          <button
            v-if="hostStatus.installed && !hostStatus.running"
            class="btn btn-primary"
            type="button"
            @click="showJoinPanel = !showJoinPanel"
          >
            {{ showJoinPanel ? 'Hide Join Form' : 'Join Tailnet' }}
          </button>
          <button
            class="btn btn-sm btn-ghost"
            type="button"
            :disabled="loadingHostStatus"
            @click="refreshHostStatus"
          >
            Check Host
          </button>
        </div>
      </div>

      <!-- Inline Join Tailnet Form when installed but NeedsLogin / Stopped -->
      <transition name="slide-down">
      <div v-if="showJoinPanel && hostStatus.installed && !hostStatus.running" class="join-box">
        <div class="rack-row" style="margin-bottom: -10px;">
          <div class="col-8" style="margin-bottom: 10px;">
            <label class="field-label">Tailscale Auth Key (Optional — leave blank to get interactive login URL)</label>
            <input
              v-model="joinAuthKey"
              class="input mono"
              type="password"
              placeholder="tskey-auth-... (optional)"
            />
          </div>
          <div class="col-4" style="margin-bottom: 10px; display: flex; align-items: flex-end;">
            <button
              class="btn btn-success"
              style="width: 100%;"
              type="button"
              :disabled="joiningHost"
              @click="joinHostTailnet"
            >
              {{ joiningHost ? 'Connecting...' : 'Connect Host' }}
            </button>
          </div>
        </div>
      </div>
      </transition>

      <div v-if="hostAuthUrl" class="alert-row alert-warning" style="margin-top: 12px; margin-bottom: 0;">
        <div>
          <strong>Approve Login:</strong>
          <a :href="hostAuthUrl" target="_blank" rel="noopener noreferrer" class="mono auth-link">
            {{ hostAuthUrl }}
          </a>
        </div>
      </div>

      <pre v-if="hostActionOutput" class="terminal-box" style="margin-top: 10px; max-height: 150px;">{{ hostActionOutput }}</pre>
    </div>

    <div v-if="tailnets.length === 0" class="panel empty-state">
      <h3>No Tailscale Network Connected</h3>
      <p>
        Connect using your host's local Tailscale daemon (zero config) or a Tailscale API key / OAuth client to discover all tailnet devices and import them into Rack Panel.
      </p>
      <button class="btn btn-primary btn-lg" type="button" @click="$emit('add-tailscale')">
        + Connect Tailscale Network
      </button>
    </div>

    <template v-else>
      <!-- Tailnet Selector Strip -->
      <div class="ts-strip">
        <button
          v-for="t in tailnets"
          :key="t.configId"
          type="button"
          class="ts-chip"
          :class="{ active: activeId === t.configId }"
          @click="selectedId = t.configId"
        >
          <span class="dot" :class="t.status === 'online' ? 'dot-ok' : 'dot-crit'"></span>
          <span style="margin-right: 8px;">{{ t.name }}</span>
          <span class="pill pill-muted mono" style="font-size: 10px; padding: 2px 6px;">
            {{ t.mode === 'local' ? 'LOCAL' : t.mode === 'oauth' ? 'OAUTH' : 'API' }}
          </span>
        </button>
      </div>

      <div v-if="activeTailnet">
        <div v-if="activeTailnet.status === 'error'" class="alert-row alert-critical" style="margin-bottom: 16px;">
          <div>
            <strong>Tailscale Error ({{ activeTailnet.name }}):</strong>
            {{ activeTailnet.errorMessage }}
          </div>
        </div>

        <!-- KPI Row -->
        <div class="rack-row">
          <div class="col-3">
            <div class="panel kpi-card">
              <div class="kpi-label">Tailnet Domain</div>
              <div class="kpi-value mono" style="font-size: 18px; word-break: break-all;">
                {{ activeTailnet.tailnetName }}
              </div>
              <div class="kpi-sub">
                Mode: {{ activeTailnet.mode === 'local' ? 'Local Tailscale CLI' : activeTailnet.mode === 'oauth' ? 'OAuth Cloud API' : 'API Key Cloud API' }}
              </div>
            </div>
          </div>
          <div class="col-3">
            <div class="panel kpi-card">
              <div class="kpi-label">Online Devices</div>
              <div class="kpi-value mono" style="color: #34d399;">
                {{ onlineCount }} <span style="font-size: 16px; color: #64748b;">/ {{ activeTailnet.devices.length }}</span>
              </div>
              <div class="kpi-sub">{{ offlineCount }} offline</div>
            </div>
          </div>
          <div class="col-3">
            <div class="panel kpi-card">
              <div class="kpi-label">Exit &amp; Subnet Routers</div>
              <div class="kpi-value mono" style="color: #22d3ee;">{{ routerCount }}</div>
              <div class="kpi-sub">Advertising routes or exit nodes</div>
            </div>
          </div>
          <div class="col-3">
            <div class="panel kpi-card">
              <div class="kpi-label">Monitored in Rack Panel</div>
              <div class="kpi-value mono" style="color: #a78bfa;">{{ monitoredCount }}</div>
              <div class="kpi-sub">Linked to SSH or Proxmox</div>
            </div>
          </div>
        </div>

        <!-- Filter & Search Bar -->
        <div class="panel" style="margin-bottom: 16px; padding: 12px 14px;">
          <div class="filter-controls">
            <div class="btn-group" style="margin-bottom: 0;">
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': filterMode === 'all' }"
                @click="filterMode = 'all'"
              >
                All ({{ activeTailnet.devices.length }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-success': filterMode === 'online' }"
                @click="filterMode = 'online'"
              >
                Online ({{ onlineCount }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': filterMode === 'offline' }"
                @click="filterMode = 'offline'"
              >
                Offline ({{ offlineCount }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': filterMode === 'linux' }"
                @click="filterMode = 'linux'"
              >
                Linux
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': filterMode === 'routers' }"
                @click="filterMode = 'routers'"
              >
                Routers / Exit
              </button>
            </div>
            <div class="search-wrap">
              <input
                v-model="searchQuery"
                class="input mono"
                style="min-height: 40px;"
                type="text"
                placeholder="Filter by name, 100.x IP, OS, or tag..."
              />
            </div>
          </div>
        </div>

        <!-- Devices Grid -->
        <div v-if="filteredDevices.length === 0" class="panel empty-state">
          <p>No Tailscale devices match your current filter.</p>
        </div>

        <div v-else class="rack-row">
          <div v-for="d in filteredDevices" :key="d.id" class="col-6">
            <div class="panel device-card">
              <div class="panel-header" style="margin-bottom: 10px;">
                <div style="min-width: 0;">
                  <div class="dev-title-row">
                    <span class="dot" :class="d.online ? 'dot-ok' : 'dot-muted'"></span>
                    <span class="dev-name">{{ d.hostname }}</span>
                    <span v-if="d.isSelf" class="pill pill-cyan" style="margin-left: 6px; font-size: 10px;">
                      THIS HOST
                    </span>
                    <span
                      v-if="isMonitored(d)"
                      class="pill pill-ok"
                      style="margin-left: 6px; font-size: 10px;"
                    >
                      MONITORED
                    </span>
                  </div>
                  <div class="dev-fqdn mono">{{ d.dnsName || d.hostname }}</div>
                </div>
                <span class="pill pill-muted mono">{{ (d.os || 'unknown').toUpperCase() }}</span>
              </div>

              <!-- IP & Peer Info -->
              <div class="dev-ip-bar">
                <div class="mono dev-ip">{{ d.ipv4 || d.ipv6 || 'No IP' }}</div>
                <div class="dev-meta mono">
                  <span v-if="d.curAddr" class="pill pill-ok" style="font-size: 10px; padding: 2px 6px;">
                    DIRECT
                  </span>
                  <span v-else-if="d.relay" class="pill pill-cyan" style="font-size: 10px; padding: 2px 6px;">
                    DERP {{ d.relay.toUpperCase() }}
                  </span>
                  <span v-if="d.clientVersion" style="margin-left: 8px;">v{{ d.clientVersion }}</span>
                </div>
              </div>

              <!-- Tags / Routes / Traffic -->
              <div class="dev-badges">
                <span v-if="d.sshEnabled" class="pill pill-ok badge-item">TS-SSH READY</span>
                <span v-if="d.exitNode" class="pill pill-warn badge-item">ACTIVE EXIT NODE</span>
                <span v-else-if="d.exitNodeOption" class="pill pill-cyan badge-item">EXIT NODE</span>
                <span
                  v-for="r in d.enabledRoutes.slice(0, 3)"
                  :key="r"
                  class="pill pill-violet badge-item mono"
                >
                  {{ r }}
                </span>
                <span
                  v-for="tag in d.tags.slice(0, 4)"
                  :key="tag"
                  class="pill pill-muted badge-item mono"
                >
                  #{{ tag }}
                </span>
                <span v-if="d.updateAvailable" class="pill pill-warn badge-item">UPDATE AVAIL</span>
              </div>

              <div class="dev-footer mono">
                <span v-if="d.online">Status: Online</span>
                <span v-else>Last seen: {{ d.lastSeen ? formatRelativeTime(d.lastSeen) : 'Unknown' }}</span>
                <span v-if="d.rxBytes > 0 || d.txBytes > 0">
                  &darr;{{ formatBytes(d.rxBytes) }} &uarr;{{ formatBytes(d.txBytes) }}
                </span>
              </div>

              <!-- One-Tap Import Actions -->
              <div class="dev-actions">
                <button
                  v-if="d.sshEnabled !== false"
                  class="btn btn-sm btn-primary"
                  type="button"
                  :disabled="(!d.ipv4 && !d.dnsName) || addingDeviceId === d.id"
                  @click="quickAddTailscaleSsh(d)"
                >
                  {{ addingDeviceId === d.id ? 'Adding...' : '+ Tailscale SSH' }}
                </button>
                <button
                  class="btn btn-sm"
                  :class="{ 'btn-primary': d.sshEnabled === false }"
                  type="button"
                  :disabled="!d.ipv4 && !d.dnsName"
                  @click="$emit('import-ssh', d)"
                >
                  {{ d.sshEnabled === false ? '+ Add SSH (Password/Key)' : 'Custom SSH' }}
                </button>
                <button
                  class="btn btn-sm"
                  type="button"
                  :disabled="!d.ipv4 && !d.dnsName"
                  @click="$emit('import-proxmox', d)"
                >
                  + Proxmox
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onMounted } from 'vue';
import type { LocalTailscaleHostStatus, OverviewResponse, TailscaleDevice } from '@shared/types';
import { api } from '@/api/client';
import { formatBytes, formatRelativeTime } from '@/utils/format';

export default defineComponent({
  name: 'TailscaleView',
  props: {
    overview: { type: Object as () => OverviewResponse, required: true },
  },
  setup(props, { emit }) {
    const tailnets = computed(() => props.overview.tailscale || []);
    const selectedId = ref('');
    const filterMode = ref<'all' | 'online' | 'offline' | 'linux' | 'routers'>('all');
    const searchQuery = ref('');
    const syncing = ref(false);
    const addingDeviceId = ref('');

    const hostStatus = ref<LocalTailscaleHostStatus | null>(null);
    const loadingHostStatus = ref(false);
    const installingHost = ref(false);
    const joiningHost = ref(false);
    const showJoinPanel = ref(false);
    const joinAuthKey = ref('');
    const hostAuthUrl = ref('');
    const hostActionOutput = ref('');

    async function refreshHostStatus() {
      loadingHostStatus.value = true;
      try {
        hostStatus.value = await api.getLocalTailscaleStatus();
        if (hostStatus.value.authUrl) hostAuthUrl.value = hostStatus.value.authUrl;
      } catch {
        // ignore
      } finally {
        loadingHostStatus.value = false;
      }
    }

    async function installHostTailscale() {
      installingHost.value = true;
      hostActionOutput.value = 'Installing Tailscale on Rack Panel host...';
      try {
        const res = await api.installLocalTailscale();
        hostActionOutput.value = res.output || res.message;
        if (res.status) hostStatus.value = res.status;
        emit('toast', { message: res.message, error: !res.ok });
        if (res.ok && res.status && !res.status.running) {
          showJoinPanel.value = true;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Tailscale install failed';
        hostActionOutput.value = msg;
        emit('toast', { message: msg, error: true });
      } finally {
        installingHost.value = false;
      }
    }

    async function joinHostTailnet() {
      joiningHost.value = true;
      hostActionOutput.value = 'Connecting host to Tailscale...';
      try {
        const res = await api.bringUpLocalTailscale({
          authKey: joinAuthKey.value.trim() || undefined,
          enableSsh: true,
        });
        hostActionOutput.value = res.output || res.message;
        if (res.authUrl) hostAuthUrl.value = res.authUrl;
        if (res.status) hostStatus.value = res.status;
        emit('toast', { message: res.message, error: !res.ok });
        if (res.ok && res.status && res.status.running) {
          showJoinPanel.value = false;
          joinAuthKey.value = '';
          emit('refresh');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Tailscale up failed';
        hostActionOutput.value = msg;
        emit('toast', { message: msg, error: true });
      } finally {
        joiningHost.value = false;
      }
    }

    onMounted(() => {
      void refreshHostStatus();
    });

    const activeId = computed(() => {
      if (selectedId.value && tailnets.value.some((t) => t.configId === selectedId.value)) {
        return selectedId.value;
      }
      return tailnets.value[0] ? tailnets.value[0].configId : '';
    });

    const activeTailnet = computed(
      () => tailnets.value.find((t) => t.configId === activeId.value) || null,
    );

    const monitoredHosts = computed(() => {
      const set = new Set<string>();
      for (const s of props.overview.servers) {
        if (!s.config.isDemo) set.add(s.config.host.toLowerCase());
      }
      for (const p of props.overview.proxmox) {
        if (!p.isDemo) set.add(p.host.toLowerCase());
      }
      return set;
    });

    function isMonitored(d: TailscaleDevice): boolean {
      const hosts = monitoredHosts.value;
      return (
        (Boolean(d.ipv4) && hosts.has(d.ipv4.toLowerCase())) ||
        (Boolean(d.dnsName) && hosts.has(d.dnsName.toLowerCase())) ||
        (Boolean(d.hostname) && hosts.has(d.hostname.toLowerCase()))
      );
    }

    const onlineCount = computed(() =>
      activeTailnet.value ? activeTailnet.value.devices.filter((d) => d.online).length : 0,
    );
    const offlineCount = computed(() =>
      activeTailnet.value ? activeTailnet.value.devices.length - onlineCount.value : 0,
    );
    const routerCount = computed(() =>
      activeTailnet.value
        ? activeTailnet.value.devices.filter(
            (d) => d.exitNode || d.exitNodeOption || d.enabledRoutes.length > 0,
          ).length
        : 0,
    );
    const monitoredCount = computed(() =>
      activeTailnet.value ? activeTailnet.value.devices.filter((d) => isMonitored(d)).length : 0,
    );

    const filteredDevices = computed(() => {
      if (!activeTailnet.value) return [];
      const q = searchQuery.value.trim().toLowerCase();
      return activeTailnet.value.devices.filter((d) => {
        if (filterMode.value === 'online' && !d.online) return false;
        if (filterMode.value === 'offline' && d.online) return false;
        if (filterMode.value === 'linux' && d.os.toLowerCase() !== 'linux') return false;
        if (
          filterMode.value === 'routers' &&
          !d.exitNode &&
          !d.exitNodeOption &&
          d.enabledRoutes.length === 0
        ) {
          return false;
        }
        if (q) {
          const hay = [d.hostname, d.dnsName, d.ipv4, d.os, ...d.tags].join(' ').toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      });
    });

    async function syncNow() {
      if (!activeTailnet.value || activeTailnet.value.isDemo) return;
      syncing.value = true;
      try {
        await api.syncTailscale(activeTailnet.value.configId);
        emit('toast', { message: 'Tailnet devices synced', error: false });
        emit('refresh');
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Tailscale sync failed',
          error: true,
        });
      } finally {
        syncing.value = false;
      }
    }

    async function quickAddTailscaleSsh(d: TailscaleDevice) {
      addingDeviceId.value = d.id;
      try {
        await api.createServer({
          name: d.hostname,
          host: d.ipv4 || d.dnsName,
          port: 22,
          username: '',
          authMethod: 'tailscale',
          tags: ['tailscale', ...d.tags].filter(Boolean),
          enabled: true,
        });
        emit('toast', {
          message: `Connected ${d.hostname} via Tailscale SSH`,
          error: false,
        });
        emit('refresh');
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to add Tailscale SSH host',
          error: true,
        });
      } finally {
        addingDeviceId.value = '';
      }
    }

    return {
      tailnets,
      selectedId,
      activeId,
      activeTailnet,
      filterMode,
      searchQuery,
      syncing,
      addingDeviceId,
      hostStatus,
      loadingHostStatus,
      installingHost,
      joiningHost,
      showJoinPanel,
      joinAuthKey,
      hostAuthUrl,
      hostActionOutput,
      refreshHostStatus,
      installHostTailscale,
      joinHostTailnet,
      onlineCount,
      offlineCount,
      routerCount,
      monitoredCount,
      filteredDevices,
      isMonitored,
      syncNow,
      quickAddTailscaleSsh,
      formatBytes,
      formatRelativeTime,
    };
  },
});
</script>

<style scoped lang="scss">
.ts-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.ts-chip {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  min-height: 46px;
  padding: 0 14px;
  margin-right: 10px;
  margin-bottom: 8px;
  border-radius: 4px;
  border: 1px solid #243047;
  background: #121826;
  color: #cbd5e1;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  outline: none;
  transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.1s ease;

  &:hover {
    border-color: #2d3d5c;
    color: #f8fafc;
  }

  &:active {
    transform: scale(0.97);
  }

  &.active {
    background: linear-gradient(180deg, rgba(34, 211, 238, 0.2) 0%, rgba(8, 145, 178, 0.12) 100%);
    border-color: #22d3ee;
    color: #ffffff;
  }
}

.filter-controls {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}

.search-wrap {
  min-width: 240px;
  flex: 1;
  max-width: 340px;
  margin-left: 8px;
}

.dev-title-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.dev-name {
  font-size: 17px;
  font-weight: 700;
  color: #f8fafc;
}

.dev-fqdn {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
  word-break: break-all;
}

.dev-ip-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-radius: 4px;
  background: #0b1019;
  border: 1px solid #1f2a40;
  margin-bottom: 10px;
}

.dev-ip {
  font-size: 15px;
  font-weight: 800;
  color: #22d3ee;
}

.dev-meta {
  display: flex;
  flex-direction: row;
  align-items: center;
  font-size: 12px;
  color: #94a3b8;
}

.dev-badges {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  min-height: 24px;
  margin-bottom: 8px;
}

.badge-item {
  font-size: 11px;
  padding: 2px 8px;
  margin-right: 6px;
  margin-bottom: 5px;
}

.dev-footer {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  font-size: 12px;
  color: #94a3b8;
  margin-bottom: 10px;
}

.dev-actions {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  padding-top: 10px;
  border-top: 1px solid #1f2a40;

  > .btn {
    margin-right: 8px;
    margin-bottom: 4px;
  }
}

.empty-state {
  text-align: center;
  padding: 36px 20px;
  color: #94a3b8;
}

.host-ts-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.join-box {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #1f2a40;
}

.auth-link {
  color: #22d3ee;
  text-decoration: underline;
  word-break: break-all;
}
</style>
