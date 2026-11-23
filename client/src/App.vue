<template>
  <div v-if="authChecking" class="auth-boot-screen">
    <div class="mono" style="font-size: 15px; color: #22d3ee;">Checking Rack Panel session...</div>
  </div>

  <AuthGate
    v-else-if="!authAuthenticated"
    :setup-required="setupRequired"
    :rack-title="authRackTitle"
    @authenticated="handleAuthenticated"
  />

  <div v-else class="rack-shell">
    <!-- Persistent Touch Navigation Rail (Left on Landscape, Bottom on Narrow) -->
    <aside class="nav-rail" :class="{ 'rail-compact': sidebarCompact }">
      <div class="rail-brand-row">
        <router-link to="/overview" class="rail-brand-link" title="RACK//PANEL">
          <div class="rail-brand">
            <img src="/logo.jpg" alt="RACK//PANEL" class="rail-brand-logo" />
          </div>
          <div class="rail-brand-meta">
            <span class="rail-brand-name mono">RACK<span style="color: #22d3ee;">//</span>PANEL</span>
            <span class="rail-brand-tag mono">INFRASTRUCTURE</span>
          </div>
        </router-link>
        <button
          type="button"
          class="rail-collapse-btn"
          :title="sidebarCompact ? 'Expand sidebar' : 'Compact icon-only sidebar'"
          @click="toggleSidebarCompact"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline v-if="sidebarCompact" points="9 18 15 12 9 6" />
            <polyline v-else points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      <nav class="rail-nav-list">
        <router-link to="/overview" class="rail-btn" active-class="active" title="Overview">
          <svg class="rail-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
          <span class="rail-btn-label">Overview</span>
        </router-link>

        <div class="rail-devices-group">
          <button
            type="button"
            class="rail-btn rail-btn-group"
            title="Devices"
            :class="{ active: isDevicesRoute || devicesMenuOpen }"
            @click="devicesMenuOpen = !devicesMenuOpen"
          >
            <span class="rail-btn-inner">
              <svg class="rail-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="7" rx="1.5" />
                <rect x="2" y="14" width="20" height="7" rx="1.5" />
                <circle cx="6" cy="6.5" r="1" fill="currentColor" />
                <circle cx="6" cy="17.5" r="1" fill="currentColor" />
              </svg>
              <span class="rail-btn-label">Devices</span>
            </span>
            <span class="rail-chevron mono">{{ devicesMenuOpen ? '▾' : '▸' }}</span>
          </button>

          <div v-if="devicesMenuOpen" class="rail-submenu">
            <router-link to="/servers" class="rail-sub-btn" active-class="active" title="Servers">
              <svg class="rail-sub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="6" rx="1.5" />
                <rect x="3" y="14" width="18" height="6" rx="1.5" />
                <circle cx="7" cy="7" r="1" fill="currentColor" />
                <circle cx="7" cy="17" r="1" fill="currentColor" />
              </svg>
              <span class="rail-sub-label">Servers</span>
            </router-link>

            <router-link to="/proxmox" class="rail-sub-btn" active-class="active" title="Proxmox">
              <svg class="rail-sub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2" />
                <line x1="12" y1="22" x2="12" y2="12" />
                <polyline points="21 7 12 12 3 7" />
              </svg>
              <span class="rail-sub-label">Proxmox</span>
            </router-link>

            <router-link to="/docker" class="rail-sub-btn" active-class="active" title="Docker">
              <svg class="rail-sub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="10" width="5" height="5" rx="0.8" />
                <rect x="9.5" y="10" width="5" height="5" rx="0.8" />
                <rect x="16" y="10" width="5" height="5" rx="0.8" />
                <rect x="9.5" y="4" width="5" height="5" rx="0.8" />
                <path d="M2 16h20c-.8 3.2-3.5 5-8 5H9c-4.5 0-6.8-1.8-7-5z" />
              </svg>
              <span class="rail-sub-label">Docker</span>
            </router-link>

            <router-link to="/opnsense" class="rail-sub-btn" active-class="active" title="OPNsense">
              <svg class="rail-sub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <polyline points="9 12 11 14 15 10" />
              </svg>
              <span class="rail-sub-label">OPNsense</span>
            </router-link>

            <router-link to="/switches" class="rail-sub-btn" active-class="active" title="Switches">
              <svg class="rail-sub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <circle cx="6" cy="10" r="1" fill="currentColor" />
                <circle cx="10" cy="10" r="1" fill="currentColor" />
                <circle cx="14" cy="10" r="1" fill="currentColor" />
                <circle cx="18" cy="10" r="1" fill="currentColor" />
                <line x1="6" y1="14" x2="8" y2="14" />
                <line x1="11" y1="14" x2="13" y2="14" />
                <line x1="16" y1="14" x2="18" y2="14" />
              </svg>
              <span class="rail-sub-label">Switches</span>
            </router-link>

            <router-link to="/hikvision" class="rail-sub-btn" active-class="active" title="Cameras">
              <svg class="rail-sub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 7l-7 5 7 5V7z" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
              <span class="rail-sub-label">Cameras</span>
            </router-link>

            <router-link to="/unifi" class="rail-sub-btn" active-class="active" title="UniFi">
              <svg class="rail-sub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <circle cx="12" cy="20" r="1" />
              </svg>
              <span class="rail-sub-label">UniFi</span>
            </router-link>

            <router-link to="/ups" class="rail-sub-btn" active-class="active" title="UPS">
              <svg class="rail-sub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M13 8l-3 5h4l-1 4" />
              </svg>
              <span class="rail-sub-label">UPS</span>
            </router-link>
          </div>
        </div>

        <router-link to="/topology" class="rail-btn" active-class="active" title="Topology">
          <svg class="rail-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="12" cy="18" r="3" />
            <line x1="8.6" y1="7.5" x2="15.4" y2="7.5" />
            <line x1="7.5" y1="8.6" x2="10.8" y2="15.4" />
            <line x1="16.5" y1="8.6" x2="13.2" y2="15.4" />
          </svg>
          <span class="rail-btn-label">Topology</span>
        </router-link>

        <router-link to="/tailscale" class="rail-btn" active-class="active" title="Tailscale">
          <svg class="rail-btn-icon" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="5" r="2.1" opacity="0.4" />
            <circle cx="12" cy="5" r="2.1" opacity="0.4" />
            <circle cx="19" cy="5" r="2.1" opacity="0.4" />
            <circle cx="5" cy="12" r="2.1" />
            <circle cx="12" cy="12" r="2.1" />
            <circle cx="19" cy="12" r="2.1" />
            <circle cx="5" cy="19" r="2.1" opacity="0.4" />
            <circle cx="12" cy="19" r="2.1" />
            <circle cx="19" cy="19" r="2.1" opacity="0.4" />
          </svg>
          <span class="rail-btn-label">Tailscale</span>
        </router-link>

        <router-link to="/settings" class="rail-btn" active-class="active" title="Settings">
          <svg class="rail-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span class="rail-btn-label">Settings</span>
        </router-link>
      </nav>

      <div class="rail-footer">
        <button
          type="button"
          class="rail-footer-btn"
          :title="effectiveSettings.splashPinEnabled && effectiveSettings.hasSplashPin ? 'Lock' : 'Splash'"
          @click="enterIdleSplash"
        >
          <svg class="rail-footer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
          <span class="rail-footer-label">{{ effectiveSettings.splashPinEnabled && effectiveSettings.hasSplashPin ? 'Lock' : 'Splash' }}</span>
        </button>
        <button type="button" class="rail-footer-btn" title="Kiosk" @click="toggleFullscreen">
          <svg class="rail-footer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
          <span class="rail-footer-label">Kiosk</span>
        </button>
      </div>
    </aside>

    <!-- Main Content Area -->
    <div class="rack-main">
      <!-- Top Telemetry Status Bar -->
      <header class="topbar">
        <div class="topbar-left">
          <span class="topbar-title mono">{{ overview ? overview.settings.rackTitle : 'RACK//PANEL' }}</span>
          <span
            class="pill"
            :class="
              streamState === 'live'
                ? 'pill-ok'
                : streamState === 'connecting' || streamState === 'reconnecting'
                  ? 'pill-warn'
                  : 'pill-crit'
            "
            style="margin-right: 8px;"
          >
            <span
              class="dot"
              :class="
                streamState === 'live'
                  ? 'dot-ok pulse'
                  : streamState === 'connecting' || streamState === 'reconnecting'
                    ? 'dot-warn pulse'
                    : 'dot-crit'
              "
            ></span>
            {{
              streamState === 'live'
                ? 'WS LIVE'
                : streamState === 'reconnecting'
                  ? 'RECONNECTING'
                  : streamState === 'connecting'
                    ? 'CONNECTING'
                    : 'OFFLINE'
            }}
          </span>
          <span
            v-if="overview && overview.settings.demoMode"
            class="pill pill-warn"
            style="cursor: pointer;"
            @click="navigateToTab('settings')"
          >
            DEMO MODE
          </span>
        </div>

        <div class="topbar-right">
          <button
            v-if="currentUser"
            type="button"
            class="pill pill-muted mono"
            style="margin-right: 10px; cursor: pointer;"
            title="Account & Settings"
            @click="navigateToTab('settings')"
          >
            @{{ currentUser.username }}
          </button>
          <div class="topbar-clock">{{ clockStr }}</div>
          <button
            class="btn btn-sm"
            type="button"
            :disabled="refreshing"
            @click="forceRefresh"
          >
            {{ refreshing ? 'Syncing...' : 'Refresh' }}
          </button>
        </div>
      </header>

      <!-- Scrollable Workspace -->
      <main ref="workspaceScrollEl" class="workspace-scroll">
        <transition name="slide-down">
          <div v-if="backendError && activeTab !== 'settings'" class="alert-row alert-critical" style="margin-bottom: 14px;">
            <div>
              <strong>Backend API Unreachable:</strong> {{ backendError }}
            </div>
            <button class="btn btn-sm" type="button" @click="forceRefresh">Retry</button>
          </div>
        </transition>

        <transition name="view-fade" mode="out-in" @before-enter="scrollWorkspaceTop">
          <div
            v-if="!overview && activeTab !== 'settings'"
            key="loading"
            class="panel"
            style="text-align: center; padding: 48px 20px;"
          >
            <div class="mono" style="font-size: 16px; color: #22d3ee; margin-bottom: 12px;">
              {{ backendError ? 'Unable to reach Rack Telemetry Engine' : 'Connecting to Rack Telemetry Engine...' }}
            </div>
            <div v-if="backendError" style="color: #94a3b8; font-size: 13px; margin-bottom: 16px;">
              {{ backendError }}
            </div>
            <button class="btn btn-primary" type="button" @click="forceRefresh">Retry Connection</button>
          </div>

          <router-view
            v-else
            :key="activeTab"
            v-bind="routeProps"
            @navigate="navigateToTab"
            @select-server="openServerDetail"
            @change-sub-tab="onSubTabChange"
            @open-terminal="terminalTarget = $event"
            @open-vnc="vncTarget = $event"
            @add-server="openAddServer"
            @edit-server="openEditServer"
            @delete-server="confirmDeleteServer"
            @add-proxmox="openAddProxmox"
            @edit-proxmox="openEditProxmox"
            @delete-proxmox="confirmDeleteProxmox"
            @add-tailscale="openAddTailscale"
            @edit-tailscale="openEditTailscale"
            @delete-tailscale="confirmDeleteTailscale"
            @add-opnsense="openAddOpnsense"
            @edit-opnsense="openEditOpnsense"
            @delete-opnsense="confirmDeleteOpnsense"
            @add-hikvision="openAddHikvision"
            @edit-hikvision="openEditHikvision"
            @delete-hikvision="confirmDeleteHikvision"
            @add-unifi="openAddUnifi"
            @edit-unifi="openEditUnifi"
            @delete-unifi="confirmDeleteUnifi"
            @add-ups="openAddUps"
            @edit-ups="openEditUps"
            @import-ssh="importTailscaleAsSsh"
            @import-proxmox="importTailscaleAsProxmox"
            @refresh="loadData"
            @toggle-fullscreen="toggleFullscreen"
            @preview-splash="enterIdleSplash"
            @logout="handleLogout"
            @toast="showToast"
          />
        </transition>
      </main>
    </div>

    <!-- Modals -->
    <ServerModal
      :open="serverModalOpen"
      :initial-server="editingServer"
      :prefill="serverPrefill"
      @close="serverModalOpen = false"
      @saved="onConnectionSaved('SSH server saved')"
    />

    <ProxmoxModal
      :open="proxmoxModalOpen"
      :initial-config="editingProxmox"
      :prefill="proxmoxPrefill"
      @close="proxmoxModalOpen = false"
      @saved="onConnectionSaved('Proxmox VE host saved')"
    />

    <TailscaleModal
      :open="tailscaleModalOpen"
      :initial-config="editingTailscale"
      @close="tailscaleModalOpen = false"
      @saved="onConnectionSaved('Tailscale network saved')"
    />

    <OpnsenseModal
      :open="opnsenseModalOpen"
      :initial-config="editingOpnsense"
      @close="opnsenseModalOpen = false"
      @saved="onConnectionSaved('OPNsense firewall saved')"
    />

    <HikvisionModal
      :open="hikvisionModalOpen"
      :initial-config="editingHikvision"
      @close="hikvisionModalOpen = false"
      @saved="onConnectionSaved('Hikvision device saved')"
    />

    <UnifiModal
      :open="unifiModalOpen"
      :initial-config="editingUnifi"
      @close="unifiModalOpen = false"
      @saved="onConnectionSaved('UniFi controller saved')"
    />

    <UpsModal
      :open="upsModalOpen"
      :edit-config="editingUps"
      @close="upsModalOpen = false"
      @saved="onConnectionSaved('UPS configuration saved')"
      @open-settings="upsModalOpen = false; navigateToTab('settings')"
      @toast="showToast"
    />

    <ConfirmModal
      :open="Boolean(deleteTarget)"
      :title="deleteTarget ? `Remove ${deleteTarget.name}` : ''"
      :message="deleteTarget ? `Remove ${deleteTarget.name} from Rack Panel? Credentials will be deleted.` : ''"
      confirm-label="Remove"
      :danger="true"
      @cancel="deleteTarget = null"
      @confirm="executeDelete"
    />

    <TerminalModal
      :target="terminalTarget"
      @close="terminalTarget = null"
    />

    <VncModal
      :target="vncTarget"
      @close="vncTarget = null"
    />

    <IdleSplashScreen
      :visible="idleSplashActive"
      :overview="overview"
      :stream-state="streamState"
      :clock-str="clockStr"
      @dismiss="dismissIdleSplash"
    />

    <!-- Toast Banner -->
    <transition name="toast-slide">
      <div v-if="toast" class="toast-banner" :class="{ 'toast-error': toast.error }">
        {{ toast.message }}
      </div>
    </transition>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, getCurrentInstance, onMounted, onBeforeUnmount } from 'vue';
import type {
  AuthLoginResponse,
  AuthUserPublic,
  HikvisionConfigPublic,
  OpnsenseConfigPublic,
  OverviewResponse,
  PanelSettings,
  ProxmoxConfigPublic,
  SshServerPublic,
  TailscaleConfigPublic,
  TailscaleDevice,
  UnifiConfigPublic,
  UpsConfigPublic,
} from '@shared/types';
import router, { getSavedLastRoute } from '@/router';
import { api } from '@/api/client';
import { clearAuthToken, onPinLocked, onUnauthorized, setAuthToken } from '@/api/auth';
import { TelemetryStream, type StreamState } from '@/api/stream';
import AuthGate from '@/components/AuthGate.vue';
import ServerModal from '@/components/ServerModal.vue';
import ProxmoxModal from '@/components/ProxmoxModal.vue';
import TailscaleModal from '@/components/TailscaleModal.vue';
import OpnsenseModal from '@/components/OpnsenseModal.vue';
import HikvisionModal from '@/components/HikvisionModal.vue';
import UnifiModal from '@/components/UnifiModal.vue';
import UpsModal from '@/components/UpsModal.vue';
import TerminalModal, { type TerminalTarget } from '@/components/TerminalModal.vue';
import VncModal, { type VncTarget } from '@/components/VncModal.vue';
import IdleSplashScreen from '@/components/IdleSplashScreen.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';

export default defineComponent({
  name: 'App',
  components: {
    AuthGate,
    ServerModal,
    ProxmoxModal,
    TailscaleModal,
    OpnsenseModal,
    HikvisionModal,
    UnifiModal,
    UpsModal,
    TerminalModal,
    VncModal,
    IdleSplashScreen,
    ConfirmModal,
  },
  setup() {
    type MainTab = 'overview' | 'servers' | 'proxmox' | 'docker' | 'opnsense' | 'switches' | 'hikvision' | 'unifi' | 'ups' | 'topology' | 'tailscale' | 'settings';
    type PveSubTab = 'nodes' | 'guests' | 'storage' | 'tasks';
    type OpnSubTab = 'overview' | 'interfaces' | 'services' | 'firewall';
    type SwSubTab = 'overview' | 'ports' | 'neighbors' | 'services';
    type HikSubTab = 'live' | 'channels' | 'storage';
    type UnifiSubTab = 'devices' | 'clients' | 'wlans' | 'health';
    type TopoSubTab = 'canvas' | 'racks' | 'scanner' | 'ipam' | 'docs';
    const VALID_TABS: MainTab[] = [
      'overview',
      'servers',
      'proxmox',
      'docker',
      'opnsense',
      'switches',
      'hikvision',
      'unifi',
      'ups',
      'topology',
      'tailscale',
      'settings',
    ];
    const VALID_PVE_TABS: PveSubTab[] = ['nodes', 'guests', 'storage', 'tasks'];
    const VALID_OPN_TABS: OpnSubTab[] = ['overview', 'interfaces', 'services', 'firewall'];
    const VALID_SW_TABS: SwSubTab[] = ['overview', 'ports', 'neighbors', 'services'];
    const VALID_HIK_TABS: HikSubTab[] = ['live', 'channels', 'storage'];
    const VALID_UNIFI_TABS: UnifiSubTab[] = ['devices', 'clients', 'wlans', 'health'];
    const VALID_TOPO_TABS: TopoSubTab[] = ['canvas', 'racks', 'scanner', 'ipam', 'docs'];

    const vm = getCurrentInstance()!.proxy;

    const authChecking = ref(true);
    const authAuthenticated = ref(false);
    const setupRequired = ref(false);
    const authRackTitle = ref('RACK//PANEL');
    const currentUser = ref<AuthUserPublic | null>(null);

    const activeTab = computed<MainTab>(() => {
      const name = String(vm.$route.name || 'overview') as MainTab;
      return VALID_TABS.indexOf(name) !== -1 ? name : 'overview';
    });

    const DEVICE_TABS: MainTab[] = ['servers', 'proxmox', 'docker', 'opnsense', 'switches', 'hikvision', 'unifi', 'ups'];
    const isDevicesRoute = computed<boolean>(() => DEVICE_TABS.indexOf(activeTab.value) !== -1);
    const devicesMenuOpen = ref<boolean>(isDevicesRoute.value);
    const sidebarCompact = ref<boolean>(
      typeof window !== 'undefined' && window.localStorage.getItem('rackpanel:sidebarCompact') === '1',
    );
    function toggleSidebarCompact() {
      sidebarCompact.value = !sidebarCompact.value;
      try {
        window.localStorage.setItem('rackpanel:sidebarCompact', sidebarCompact.value ? '1' : '0');
      } catch {
        // ignore storage errors
      }
    }
    watch(isDevicesRoute, (inDevices) => {
      if (inDevices) devicesMenuOpen.value = true;
    });

    const selectedServerId = computed<string>(() => {
      if (vm.$route.name === 'servers' && vm.$route.params.serverId) {
        return decodeURIComponent(String(vm.$route.params.serverId));
      }
      return '';
    });

    const proxmoxSubTab = computed<PveSubTab>(() => {
      const sub = String(vm.$route.params.subTab || 'nodes') as PveSubTab;
      return vm.$route.name === 'proxmox' && VALID_PVE_TABS.indexOf(sub) !== -1 ? sub : 'nodes';
    });

    const opnsenseSubTab = computed<OpnSubTab>(() => {
      const sub = String(vm.$route.params.subTab || 'overview') as OpnSubTab;
      return vm.$route.name === 'opnsense' && VALID_OPN_TABS.indexOf(sub) !== -1 ? sub : 'overview';
    });

    const switchesSubTab = computed<SwSubTab>(() => {
      const sub = String(vm.$route.params.subTab || 'overview') as SwSubTab;
      return vm.$route.name === 'switches' && VALID_SW_TABS.indexOf(sub) !== -1 ? sub : 'overview';
    });

    const hikvisionSubTab = computed<HikSubTab>(() => {
      const sub = String(vm.$route.params.subTab || 'live') as HikSubTab;
      return vm.$route.name === 'hikvision' && VALID_HIK_TABS.indexOf(sub) !== -1 ? sub : 'live';
    });

    const unifiSubTab = computed<UnifiSubTab>(() => {
      const sub = String(vm.$route.params.subTab || 'devices') as UnifiSubTab;
      return vm.$route.name === 'unifi' && VALID_UNIFI_TABS.indexOf(sub) !== -1 ? sub : 'devices';
    });

    const topologySubTab = computed<TopoSubTab>(() => {
      const sub = String(vm.$route.params.subTab || 'canvas') as TopoSubTab;
      return vm.$route.name === 'topology' && VALID_TOPO_TABS.indexOf(sub) !== -1 ? sub : 'canvas';
    });

    const overview = ref<OverviewResponse | null>(null);
    const realServers = ref<SshServerPublic[]>([]);
    const realProxmox = ref<ProxmoxConfigPublic[]>([]);
    const realTailscale = ref<TailscaleConfigPublic[]>([]);
    const realOpnsense = ref<OpnsenseConfigPublic[]>([]);
    const realHikvision = ref<HikvisionConfigPublic[]>([]);
    const realUnifi = ref<UnifiConfigPublic[]>([]);
    const streamState = ref<StreamState>('connecting');
    const backendError = ref('');
    const refreshing = ref(false);
    const clockStr = ref('');
    const workspaceScrollEl = ref<HTMLElement | null>(null);

    function scrollWorkspaceTop() {
      if (workspaceScrollEl.value) {
        workspaceScrollEl.value.scrollTop = 0;
      }
      window.scrollTo(0, 0);
    }

    watch(
      () => vm.$route.fullPath,
      () => {
        scrollWorkspaceTop();
      },
    );

    function navigateToTab(tab: string) {
      const t = (VALID_TABS.indexOf(tab as MainTab) !== -1 ? tab : 'overview') as MainTab;
      void router.push({ name: t });
    }

    function onSubTabChange(sub: string) {
      if (activeTab.value === 'proxmox') {
        void router.replace(sub === 'nodes' ? { name: 'proxmox' } : { name: 'proxmox', params: { subTab: sub } });
      } else if (activeTab.value === 'opnsense') {
        void router.replace(sub === 'overview' ? { name: 'opnsense' } : { name: 'opnsense', params: { subTab: sub } });
      } else if (activeTab.value === 'switches') {
        void router.replace(sub === 'overview' ? { name: 'switches' } : { name: 'switches', params: { subTab: sub } });
      } else if (activeTab.value === 'hikvision') {
        void router.replace(sub === 'live' ? { name: 'hikvision' } : { name: 'hikvision', params: { subTab: sub } });
      } else if (activeTab.value === 'unifi') {
        void router.replace(sub === 'devices' ? { name: 'unifi' } : { name: 'unifi', params: { subTab: sub } });
      } else if (activeTab.value === 'topology') {
        void router.replace(sub === 'racks' ? { name: 'topology' } : { name: 'topology', params: { subTab: sub } });
      }
    }

    const fallbackSettings: PanelSettings = {
      pollIntervalMs: 4000,
      temperatureUnit: 'C',
      demoMode: true,
      rackTitle: 'RACK//PANEL',
      screenDimSeconds: 0,
      idleSplashSeconds: 60,
      splashPinEnabled: false,
      hasSplashPin: false,
    };

    const effectiveSettings = computed<PanelSettings>(() =>
      overview.value && overview.value.settings
        ? { ...fallbackSettings, ...overview.value.settings }
        : fallbackSettings,
    );

    const routeProps = computed<Record<string, unknown>>(() => {
      const tab = activeTab.value;
      if (tab === 'settings') {
        return {
          settings: effectiveSettings.value,
          currentUser: currentUser.value,
          realServers: realServers.value,
          realProxmox: realProxmox.value,
          realTailscale: realTailscale.value,
          realOpnsense: realOpnsense.value,
          realHikvision: realHikvision.value,
          realUnifi: realUnifi.value,
        };
      }
      if (tab === 'servers') {
        return {
          overview: overview.value,
          selectedServerId: selectedServerId.value,
        };
      }
      if (tab === 'proxmox') {
        return {
          overview: overview.value,
          initialSubTab: proxmoxSubTab.value,
        };
      }
      if (tab === 'opnsense') {
        return {
          overview: overview.value,
          initialSubTab: opnsenseSubTab.value,
        };
      }
      if (tab === 'switches') {
        return {
          overview: overview.value,
          initialSubTab: switchesSubTab.value,
        };
      }
      if (tab === 'hikvision') {
        return {
          overview: overview.value,
          initialSubTab: hikvisionSubTab.value,
        };
      }
      if (tab === 'unifi') {
        return {
          overview: overview.value,
          initialSubTab: unifiSubTab.value,
        };
      }
      if (tab === 'topology') {
        return {
          overview: overview.value,
          initialSubTab: topologySubTab.value,
        };
      }
      return {
        overview: overview.value,
      };
    });

    const idleSplashActive = ref(false);
    let idleTimer: number | null = null;
    const IDLE_EVENTS = ['touchstart', 'mousedown', 'mousemove', 'keydown', 'scroll'];

    function hasOpenModal(): boolean {
      return Boolean(
        terminalTarget.value ||
          vncTarget.value ||
          serverModalOpen.value ||
          proxmoxModalOpen.value ||
          tailscaleModalOpen.value ||
          opnsenseModalOpen.value ||
          hikvisionModalOpen.value ||
          deleteTarget.value,
      );
    }

    function enterIdleSplash() {
      idleSplashActive.value = true;
      if (authAuthenticated.value && effectiveSettings.value.splashPinEnabled && effectiveSettings.value.hasSplashPin) {
        void api.lockSplash().catch(() => {
          // ignore network hiccup on lock
        });
      }
    }

    function resetIdleTimer() {
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (!authAuthenticated.value) return;
      const secs = Number(effectiveSettings.value.idleSplashSeconds);
      if (!secs || secs <= 0) return;
      idleTimer = window.setTimeout(() => {
        if (!hasOpenModal() && overview.value) {
          enterIdleSplash();
        } else {
          resetIdleTimer();
        }
      }, secs * 1000);
    }

    function onUserActivity(evt?: Event) {
      if (idleSplashActive.value) {
        if (effectiveSettings.value.splashPinEnabled && effectiveSettings.value.hasSplashPin) {
          return;
        }
        if (evt && evt.type === 'mousemove') return;
        idleSplashActive.value = false;
      }
      resetIdleTimer();
    }

    function dismissIdleSplash() {
      idleSplashActive.value = false;
      resetIdleTimer();
    }

    watch(
      () => effectiveSettings.value.idleSplashSeconds,
      () => {
        resetIdleTimer();
      },
    );

    const serverModalOpen = ref(false);
    const editingServer = ref<SshServerPublic | null>(null);
    const serverPrefill = ref<{
      name?: string;
      host?: string;
      tags?: string[];
      authMethod?: 'tailscale' | 'password' | 'privateKey';
    } | null>(null);
    const proxmoxModalOpen = ref(false);
    const editingProxmox = ref<ProxmoxConfigPublic | null>(null);
    const proxmoxPrefill = ref<{ name?: string; host?: string } | null>(null);
    const tailscaleModalOpen = ref(false);
    const editingTailscale = ref<TailscaleConfigPublic | null>(null);
    const opnsenseModalOpen = ref(false);
    const editingOpnsense = ref<OpnsenseConfigPublic | null>(null);
    const hikvisionModalOpen = ref(false);
    const editingHikvision = ref<HikvisionConfigPublic | null>(null);
    const unifiModalOpen = ref(false);
    const editingUnifi = ref<UnifiConfigPublic | null>(null);
    const upsModalOpen = ref(false);
    const editingUps = ref<UpsConfigPublic | null>(null);
    const terminalTarget = ref<TerminalTarget | null>(null);
    const vncTarget = ref<VncTarget | null>(null);
    const deleteTarget = ref<{
      kind: 'server' | 'proxmox' | 'tailscale' | 'opnsense' | 'hikvision' | 'unifi';
      id: string;
      name: string;
    } | null>(null);
    const toast = ref<{ message: string; error: boolean } | null>(null);

    let stream: TelemetryStream | null = null;
    let clockTimer: number | null = null;
    let toastTimer: number | null = null;
    let offUnauthorized: (() => void) | null = null;
    let offPinLocked: (() => void) | null = null;

    function startTelemetryStream() {
      if (stream) {
        stream.disconnect();
        stream = null;
      }
      stream = new TelemetryStream({
        onSnapshot(msg) {
          overview.value = msg.overview;
          realServers.value = Array.isArray(msg.servers) ? msg.servers : [];
          realProxmox.value = Array.isArray(msg.proxmox) ? msg.proxmox : [];
          realTailscale.value = Array.isArray(msg.tailscale) ? msg.tailscale : [];
          realOpnsense.value = Array.isArray(msg.opnsense) ? msg.opnsense : [];
          realHikvision.value = Array.isArray(msg.hikvision) ? msg.hikvision : [];
          realUnifi.value = Array.isArray(msg.unifi) ? msg.unifi : [];
          backendError.value = '';
          refreshing.value = false;
        },
        onStateChange(state, errMsg) {
          streamState.value = state;
          if (state === 'live') {
            backendError.value = '';
          } else if (errMsg) {
            backendError.value = errMsg;
          }
        },
      });
      stream.connect();
    }

    function stopTelemetryStream() {
      if (stream) {
        stream.disconnect();
        stream = null;
      }
      streamState.value = 'offline';
    }

    function handleAuthenticated(res: AuthLoginResponse) {
      setAuthToken(res.token);
      currentUser.value = res.user;
      setupRequired.value = false;
      authAuthenticated.value = true;
      idleSplashActive.value = Boolean(res.pinLocked);
      startTelemetryStream();
      resetIdleTimer();
      const redirectParam = typeof vm.$route.query.redirect === 'string' ? vm.$route.query.redirect : '';
      if (vm.$route.name === 'login' || vm.$route.path === '/') {
        void router.replace(redirectParam || getSavedLastRoute());
      }
    }

    async function handleLogout() {
      try {
        await api.logout();
      } catch {
        // ignore network errors on logout
      }
      clearAuthToken();
      stopTelemetryStream();
      authAuthenticated.value = false;
      currentUser.value = null;
      overview.value = null;
      idleSplashActive.value = false;
      terminalTarget.value = null;
      vncTarget.value = null;
      if (idleTimer !== null) {
        window.clearTimeout(idleTimer);
        idleTimer = null;
      }
      void router.replace({ name: 'login' });
      try {
        const status = await api.getAuthStatus();
        setupRequired.value = status.setupRequired;
        authRackTitle.value = status.rackTitle || 'RACK//PANEL';
      } catch {
        // ignore
      }
    }

    async function checkSessionOnBoot() {
      authChecking.value = true;
      try {
        const status = await api.getAuthStatus();
        setupRequired.value = status.setupRequired;
        authRackTitle.value = status.rackTitle || 'RACK//PANEL';
        if (status.authenticated && status.user) {
          currentUser.value = status.user;
          authAuthenticated.value = true;
          idleSplashActive.value = Boolean(status.pinLocked);
          startTelemetryStream();
          resetIdleTimer();
          if (vm.$route.name === 'login' || vm.$route.path === '/') {
            const redirectParam = typeof vm.$route.query.redirect === 'string' ? vm.$route.query.redirect : '';
            void router.replace(redirectParam || getSavedLastRoute());
          }
        } else {
          clearAuthToken();
          authAuthenticated.value = false;
          currentUser.value = null;
          if (vm.$route.name !== 'login') {
            void router.replace({
              name: 'login',
              query: vm.$route.fullPath && vm.$route.fullPath !== '/overview' ? { redirect: vm.$route.fullPath } : undefined,
            });
          }
        }
      } catch (err) {
        backendError.value = err instanceof Error ? err.message : 'Unable to reach Rack Panel backend';
        authAuthenticated.value = false;
      } finally {
        authChecking.value = false;
      }
    }

    function updateClock() {
      const d = new Date();
      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
      clockStr.value = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function showToast(payload: { message: string; error: boolean }) {
      toast.value = payload;
      if (toastTimer !== null) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toast.value = null;
      }, 3200);
    }

    async function loadData() {
      // If WebSocket is live, request an immediate server push; otherwise fall back to HTTP
      if (stream && stream.requestPoll()) {
        return;
      }
      try {
        const [ov, srvs, pves, tss, opns, hiks, unifis] = await Promise.all([
          api.getOverview(),
          api.listServers(),
          api.listProxmox(),
          api.listTailscale(),
          api.listOpnsense(),
          api.listHikvision(),
          api.listUnifi(),
        ]);
        overview.value = ov;
        realServers.value = Array.isArray(srvs) ? srvs : [];
        realProxmox.value = Array.isArray(pves) ? pves : [];
        realTailscale.value = Array.isArray(tss) ? tss : [];
        realOpnsense.value = Array.isArray(opns) ? opns : [];
        realHikvision.value = Array.isArray(hiks) ? hiks : [];
        realUnifi.value = Array.isArray(unifis) ? unifis : [];
        backendError.value = '';
      } catch (err) {
        backendError.value = err instanceof Error ? err.message : 'Unable to reach backend API';
      }
    }

    async function forceRefresh() {
      refreshing.value = true;
      try {
        if (stream && stream.requestPoll()) {
          window.setTimeout(() => {
            refreshing.value = false;
          }, 500);
          return;
        }
        overview.value = await api.triggerPoll();
        const [srvs, pves, tss, opns, hiks, unifis] = await Promise.all([
          api.listServers(),
          api.listProxmox(),
          api.listTailscale(),
          api.listOpnsense(),
          api.listHikvision(),
          api.listUnifi(),
        ]);
        realServers.value = Array.isArray(srvs) ? srvs : [];
        realProxmox.value = Array.isArray(pves) ? pves : [];
        realTailscale.value = Array.isArray(tss) ? tss : [];
        realOpnsense.value = Array.isArray(opns) ? opns : [];
        realHikvision.value = Array.isArray(hiks) ? hiks : [];
        realUnifi.value = Array.isArray(unifis) ? unifis : [];
        backendError.value = '';
      } catch (err) {
        backendError.value = err instanceof Error ? err.message : 'Unable to reach backend API';
        showToast({ message: backendError.value, error: true });
      } finally {
        refreshing.value = false;
      }
    }

    function openServerDetail(id: string) {
      void router.push({ name: 'servers', params: { serverId: id } });
    }

    function openAddServer() {
      editingServer.value = null;
      serverPrefill.value = null;
      serverModalOpen.value = true;
    }

    function openEditServer(srv: SshServerPublic) {
      editingServer.value = srv;
      serverPrefill.value = null;
      serverModalOpen.value = true;
    }

    function openAddProxmox() {
      editingProxmox.value = null;
      proxmoxPrefill.value = null;
      proxmoxModalOpen.value = true;
    }

    function openEditProxmox(pve: ProxmoxConfigPublic) {
      editingProxmox.value = pve;
      proxmoxPrefill.value = null;
      proxmoxModalOpen.value = true;
    }

    function openAddTailscale() {
      editingTailscale.value = null;
      tailscaleModalOpen.value = true;
    }

    function openEditTailscale(ts: TailscaleConfigPublic) {
      editingTailscale.value = ts;
      tailscaleModalOpen.value = true;
    }

    function openAddOpnsense() {
      editingOpnsense.value = null;
      opnsenseModalOpen.value = true;
    }

    function openEditOpnsense(opn: OpnsenseConfigPublic) {
      editingOpnsense.value = opn;
      opnsenseModalOpen.value = true;
    }

    function openAddHikvision() {
      editingHikvision.value = null;
      hikvisionModalOpen.value = true;
    }

    function openEditHikvision(hik: HikvisionConfigPublic) {
      editingHikvision.value = hik;
      hikvisionModalOpen.value = true;
    }

    function openAddUnifi() {
      editingUnifi.value = null;
      unifiModalOpen.value = true;
    }

    function openEditUnifi(u: UnifiConfigPublic) {
      editingUnifi.value = u;
      unifiModalOpen.value = true;
    }

    function openAddUps() {
      editingUps.value = null;
      upsModalOpen.value = true;
    }

    function openEditUps(u: UpsConfigPublic) {
      editingUps.value = u;
      upsModalOpen.value = true;
    }

    function importTailscaleAsSsh(device: TailscaleDevice) {
      editingServer.value = null;
      serverPrefill.value = {
        name: device.hostname,
        host: device.ipv4 || device.dnsName,
        tags: ['tailscale', ...device.tags].filter(Boolean),
        authMethod: device.sshEnabled === false ? 'password' : 'tailscale',
      };
      serverModalOpen.value = true;
    }

    function importTailscaleAsProxmox(device: TailscaleDevice) {
      editingProxmox.value = null;
      proxmoxPrefill.value = {
        name: device.hostname,
        host: device.ipv4 || device.dnsName,
      };
      proxmoxModalOpen.value = true;
    }

    function confirmDeleteServer(srv: SshServerPublic) {
      deleteTarget.value = { kind: 'server', id: srv.id, name: srv.name };
    }

    function confirmDeleteProxmox(pve: ProxmoxConfigPublic) {
      deleteTarget.value = { kind: 'proxmox', id: pve.id, name: pve.name };
    }

    function confirmDeleteTailscale(ts: TailscaleConfigPublic) {
      deleteTarget.value = { kind: 'tailscale', id: ts.id, name: ts.name };
    }

    function confirmDeleteOpnsense(opn: OpnsenseConfigPublic) {
      deleteTarget.value = { kind: 'opnsense', id: opn.id, name: opn.name };
    }

    function confirmDeleteHikvision(hik: HikvisionConfigPublic) {
      deleteTarget.value = { kind: 'hikvision', id: hik.id, name: hik.name };
    }

    function confirmDeleteUnifi(u: UnifiConfigPublic) {
      deleteTarget.value = { kind: 'unifi', id: u.id, name: u.name };
    }

    async function executeDelete() {
      if (!deleteTarget.value) return;
      const t = deleteTarget.value;
      deleteTarget.value = null;
      try {
        if (t.kind === 'server') {
          await api.deleteServer(t.id);
        } else if (t.kind === 'proxmox') {
          await api.deleteProxmox(t.id);
        } else if (t.kind === 'tailscale') {
          await api.deleteTailscale(t.id);
        } else if (t.kind === 'hikvision') {
          await api.deleteHikvision(t.id);
        } else if (t.kind === 'unifi') {
          await api.deleteUnifi(t.id);
        } else {
          await api.deleteOpnsense(t.id);
        }
        showToast({ message: `Removed ${t.name}`, error: false });
        await loadData();
      } catch (err) {
        showToast({
          message: err instanceof Error ? err.message : 'Delete failed',
          error: true,
        });
      }
    }

    async function onConnectionSaved(msg: string) {
      showToast({ message: msg, error: false });
      await forceRefresh();
    }

    function toggleFullscreen() {
      const doc: any = document;
      const el: any = document.documentElement;
      const isFs = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (!isFs) {
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      } else {
        if (doc.exitFullscreen) doc.exitFullscreen();
        else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
      }
    }

    onMounted(() => {
      for (const evt of IDLE_EVENTS) {
        window.addEventListener(evt, onUserActivity, true);
      }
      updateClock();
      clockTimer = window.setInterval(updateClock, 1000);

      offUnauthorized = onUnauthorized(() => {
        stopTelemetryStream();
        authAuthenticated.value = false;
        currentUser.value = null;
        overview.value = null;
        idleSplashActive.value = false;
        if (vm.$route.name !== 'login') {
          void router.replace({ name: 'login' });
        }
      });
      offPinLocked = onPinLocked(() => {
        if (authAuthenticated.value) {
          idleSplashActive.value = true;
        }
      });

      void checkSessionOnBoot();
    });

    onBeforeUnmount(() => {
      for (const evt of IDLE_EVENTS) {
        window.removeEventListener(evt, onUserActivity, true);
      }
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      stopTelemetryStream();
      if (offUnauthorized) offUnauthorized();
      if (offPinLocked) offPinLocked();
      if (clockTimer !== null) window.clearInterval(clockTimer);
      if (toastTimer !== null) window.clearTimeout(toastTimer);
    });

    return {
      authChecking,
      authAuthenticated,
      setupRequired,
      authRackTitle,
      currentUser,
      handleAuthenticated,
      handleLogout,
      enterIdleSplash,
      activeTab,
      isDevicesRoute,
      devicesMenuOpen,
      sidebarCompact,
      toggleSidebarCompact,
      routeProps,
      navigateToTab,
      onSubTabChange,
      proxmoxSubTab,
      opnsenseSubTab,
      hikvisionSubTab,
      unifiSubTab,
      overview,
      realServers,
      realProxmox,
      realTailscale,
      realOpnsense,
      realHikvision,
      realUnifi,
      streamState,
      backendError,
      effectiveSettings,
      idleSplashActive,
      dismissIdleSplash,
      refreshing,
      selectedServerId,
      clockStr,
      workspaceScrollEl,
      scrollWorkspaceTop,
      serverModalOpen,
      editingServer,
      serverPrefill,
      proxmoxModalOpen,
      editingProxmox,
      proxmoxPrefill,
      tailscaleModalOpen,
      editingTailscale,
      opnsenseModalOpen,
      editingOpnsense,
      hikvisionModalOpen,
      editingHikvision,
      unifiModalOpen,
      editingUnifi,
      upsModalOpen,
      editingUps,
      terminalTarget,
      vncTarget,
      deleteTarget,
      toast,
      loadData,
      forceRefresh,
      openServerDetail,
      openAddServer,
      openEditServer,
      openAddProxmox,
      openEditProxmox,
      openAddTailscale,
      openEditTailscale,
      openAddOpnsense,
      openEditOpnsense,
      openAddHikvision,
      openEditHikvision,
      openAddUnifi,
      openEditUnifi,
      openAddUps,
      openEditUps,
      importTailscaleAsSsh,
      importTailscaleAsProxmox,
      confirmDeleteServer,
      confirmDeleteProxmox,
      confirmDeleteTailscale,
      confirmDeleteOpnsense,
      confirmDeleteHikvision,
      confirmDeleteUnifi,
      executeDelete,
      onConnectionSaved,
      toggleFullscreen,
      showToast,
    };
  },
});
</script>

<style scoped lang="scss">
.auth-boot-screen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #060911;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
</style>
