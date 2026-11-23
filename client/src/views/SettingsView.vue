<template>
  <div>
    <div class="section-bar">
      <div>
        <h2 class="section-heading">Connections &amp; Rack Settings</h2>
        <div class="panel-subtitle">
          Manage SSH servers, Proxmox VE hosts, polling cadence, and touchscreen kiosk options
        </div>
      </div>
    </div>

    <div class="rack-row">
      <!-- Left Stacked Column: Tightly Packed Panels (Zero Vertical Gaps) -->
      <div class="col-6 stack-col">
        <!-- SSH Servers Manager -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">SSH Servers ({{ realServers.length }})</span>
            <button class="btn btn-sm btn-primary" type="button" @click="$emit('add-server')">
              + Add Server
            </button>
          </div>
          <div v-if="realServers.length === 0" class="panel-subtitle" style="padding: 12px 0;">
            No custom SSH servers added yet. Tap <strong>+ Add Server</strong> to monitor any Linux or macOS server by IP &amp; SSH login.
          </div>
          <div v-for="s in realServers" :key="s.id" class="conn-row">
            <div>
              <div class="conn-name">
                {{ s.name }}
                <span v-if="s.rackUnit" class="pill pill-muted" style="margin-left: 6px; font-size: 10px;">
                  {{ s.rackUnit }}
                </span>
              </div>
              <div class="conn-sub mono">
                <template v-if="s.username">{{ s.username }}@</template>{{ s.host }}:{{ s.port }} ({{ s.authMethod === 'tailscale' ? 'tailscale ssh' : s.authMethod }})
              </div>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm" type="button" @click="$emit('edit-server', s)">Edit</button>
              <button class="btn btn-sm btn-danger" type="button" @click="$emit('delete-server', s)">Delete</button>
            </div>
          </div>
        </div>

        <!-- Tailscale Networks Manager -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Tailscale Networks ({{ realTailscale.length }})</span>
            <button class="btn btn-sm btn-primary" type="button" @click="$emit('add-tailscale')">
              + Connect Tailnet
            </button>
          </div>
          <div v-if="realTailscale.length === 0" class="panel-subtitle" style="padding: 12px 0;">
            No Tailscale network configured yet. Tap <strong>+ Connect Tailnet</strong> to grab devices via Local Daemon, API Key, or OAuth.
          </div>
          <div v-for="t in realTailscale" :key="t.id" class="conn-row">
            <div>
              <div class="conn-name">{{ t.name }}</div>
              <div class="conn-sub mono">
                Mode: {{ t.mode }} &middot; Tailnet: {{ t.tailnet }}
              </div>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm" type="button" @click="$emit('edit-tailscale', t)">Edit</button>
              <button class="btn btn-sm btn-danger" type="button" @click="$emit('delete-tailscale', t)">Delete</button>
            </div>
          </div>
        </div>

        <!-- Account & Users Management -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Account &amp; Users ({{ users.length }})</span>
            <div class="btn-group">
              <button
                v-if="currentUser && currentUser.role === 'admin'"
                class="btn btn-sm btn-primary"
                type="button"
                @click="addingUser = !addingUser"
              >
                {{ addingUser ? 'Cancel' : '+ Add User' }}
              </button>
              <button class="btn btn-sm btn-danger" type="button" @click="$emit('logout')">
                Sign Out
              </button>
            </div>
          </div>

          <div v-if="currentUser" class="user-self-bar">
            <div>
              <div class="conn-name">
                {{ currentUser.displayName }}
                <span class="pill pill-cyan mono" style="margin-left: 6px; font-size: 10px;">
                  {{ currentUser.role.toUpperCase() }}
                </span>
                <span class="pill pill-ok mono" style="margin-left: 6px; font-size: 10px;">
                  PERSISTENT LOGIN
                </span>
              </div>
              <div class="conn-sub mono">@{{ currentUser.username }}</div>
            </div>
            <button class="btn btn-sm" type="button" @click="startPasswordChange(currentUser)">
              Change Password
            </button>
          </div>

          <!-- Add New User Form (Admin Only) -->
          <div v-if="addingUser && currentUser && currentUser.role === 'admin'" class="pin-editor-box" style="margin-bottom: 12px;">
            <div class="field-label" style="margin-bottom: 8px;">New User Account</div>
            <div class="rack-row" style="margin-bottom: 8px;">
              <div class="col-6" style="margin-bottom: 8px;">
                <input
                  v-model="newUser.username"
                  class="input mono"
                  type="text"
                  placeholder="username (e.g. operator)"
                  autocapitalize="off"
                />
              </div>
              <div class="col-6" style="margin-bottom: 8px;">
                <input
                  v-model="newUser.displayName"
                  class="input"
                  type="text"
                  placeholder="Display Name"
                />
              </div>
              <div class="col-6" style="margin-bottom: 8px;">
                <input
                  v-model="newUser.password"
                  class="input"
                  type="password"
                  placeholder="Password (min 4 chars)"
                />
              </div>
              <div class="col-6" style="margin-bottom: 8px;">
                <select v-model="newUser.role" class="input">
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm btn-primary" type="button" @click="submitCreateUser">
                Create User
              </button>
              <button class="btn btn-sm" type="button" @click="addingUser = false">Cancel</button>
            </div>
          </div>

          <!-- Inline Password Change Box -->
          <div v-if="passwordTarget" class="pin-editor-box" style="margin-bottom: 12px;">
            <div class="field-label" style="margin-bottom: 8px;">
              Change Password for @{{ passwordTarget.username }}
            </div>
            <div class="inline-save">
              <input
                v-model="newPassword"
                class="input"
                type="password"
                placeholder="New password (min 4 chars)"
                @keyup.enter="submitPasswordChange"
              />
              <button class="btn btn-sm btn-primary" style="margin-left: 8px;" type="button" @click="submitPasswordChange">
                Save
              </button>
              <button class="btn btn-sm" style="margin-left: 6px;" type="button" @click="passwordTarget = null">
                Cancel
              </button>
            </div>
          </div>

          <!-- Users List -->
          <div v-for="u in users" :key="u.id" class="conn-row">
            <div>
              <div class="conn-name">
                {{ u.displayName }}
                <span class="pill mono" :class="u.role === 'admin' ? 'pill-cyan' : 'pill-muted'" style="margin-left: 6px; font-size: 10px;">
                  {{ u.role.toUpperCase() }}
                </span>
              </div>
              <div class="conn-sub mono">@{{ u.username }}</div>
            </div>
            <div class="btn-group">
              <button
                v-if="currentUser && (currentUser.role === 'admin' || currentUser.id === u.id)"
                class="btn btn-sm"
                type="button"
                @click="startPasswordChange(u)"
              >
                Password
              </button>
              <button
                v-if="currentUser && currentUser.role === 'admin' && currentUser.id !== u.id"
                class="btn btn-sm btn-danger"
                type="button"
                @click="removeUser(u)"
              >
                Delete
              </button>
            </div>
          </div>
        </div>

        <!-- Android 4.4 Rack Kiosk Guide -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Android 4.4 Rack Display Tips</span>
            <span class="pill pill-ok">KITKAT READY</span>
          </div>
          <ul class="tips-list">
            <li>
              Built with <strong>Vue 2.7 + Legacy ES5 Polyfills</strong> and pure Flexbox CSS — runs natively on Android 4.4 WebView (Chromium 30+) without requiring ES6 Proxy or CSS Grid.
            </li>
            <li>
              <strong>Encrypted Secrets:</strong> SSH passwords, keys, and Proxmox tokens are stored encrypted (AES-256-GCM) on the TypeScript backend and never exposed to the tablet browser.
            </li>
            <li>
              <strong>Self-Signed Proxmox TLS:</strong> The TypeScript server proxies all Proxmox HTTPS (port 8006) requests so your Android 4.4 device never hits outdated CA certificate errors.
            </li>
            <li>
              For 24/7 kiosk display in your rack, tap <strong>Fullscreen</strong> on the left rail or use <em>Fully Kiosk Browser</em> pointing to <span class="mono">http://&lt;server-ip&gt;:3840</span>.
            </li>
          </ul>
          <button class="btn btn-primary" type="button" @click="$emit('toggle-fullscreen')">
            Toggle Fullscreen Kiosk Mode
          </button>
        </div>
      </div>

      <!-- Right Stacked Column: Tightly Packed Panels (Zero Vertical Gaps) -->
      <div class="col-6 stack-col">
        <!-- Proxmox VE Manager -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Proxmox VE Hosts ({{ realProxmox.length }})</span>
            <button class="btn btn-sm btn-primary" type="button" @click="$emit('add-proxmox')">
              + Add Proxmox
            </button>
          </div>
          <div v-if="realProxmox.length === 0" class="panel-subtitle" style="padding: 12px 0;">
            No Proxmox VE hosts added yet. Tap <strong>+ Add Proxmox</strong> to connect your cluster or standalone node.
          </div>
          <div v-for="p in realProxmox" :key="p.id" class="conn-row">
            <div>
              <div class="conn-name">{{ p.name }}</div>
              <div class="conn-sub mono">
                https://{{ p.host }}:{{ p.port }} &middot;
                {{ p.authType === 'token' ? p.tokenId : p.username }}
              </div>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm" type="button" @click="$emit('edit-proxmox', p)">Edit</button>
              <button class="btn btn-sm btn-danger" type="button" @click="$emit('delete-proxmox', p)">Delete</button>
            </div>
          </div>
        </div>

        <!-- OPNsense Firewalls Manager -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">OPNsense Firewalls ({{ realOpnsense.length }})</span>
            <button class="btn btn-sm btn-primary" type="button" @click="$emit('add-opnsense')">
              + Add OPNsense
            </button>
          </div>
          <div v-if="realOpnsense.length === 0" class="panel-subtitle" style="padding: 12px 0;">
            No OPNsense firewall added yet. Tap <strong>+ Add OPNsense</strong> to monitor gateways, interfaces, services, and firewall logs.
          </div>
          <div v-for="o in realOpnsense" :key="o.id" class="conn-row">
            <div>
              <div class="conn-name">{{ o.name }}</div>
              <div class="conn-sub mono">
                {{ o.protocol }}://{{ o.host }}:{{ o.port }}
              </div>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm" type="button" @click="$emit('edit-opnsense', o)">Edit</button>
              <button class="btn btn-sm btn-danger" type="button" @click="$emit('delete-opnsense', o)">Delete</button>
            </div>
          </div>
        </div>

        <!-- Hikvision NVRs, DVRs & Cameras Manager -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Hikvision NVRs, DVRs &amp; Cameras ({{ realHikvision.length }})</span>
            <button class="btn btn-sm btn-primary" type="button" @click="$emit('add-hikvision')">
              + Add Hikvision
            </button>
          </div>
          <div v-if="realHikvision.length === 0" class="panel-subtitle" style="padding: 12px 0;">
            No Hikvision NVR, DVR, or camera added yet. Tap <strong>+ Add Hikvision</strong> to connect your
            <span class="mono">DS-7732NI-I4 / 16P(B)</span> or IP cameras for live CCTV streams &amp; HDD health.
          </div>
          <div v-for="h in realHikvision" :key="h.id" class="conn-row">
            <div>
              <div class="conn-name">
                {{ h.name }}
                <span class="pill pill-cyan mono" style="margin-left: 6px; font-size: 10px;">
                  {{ h.deviceKind.toUpperCase() }}
                </span>
              </div>
              <div class="conn-sub mono">
                {{ h.protocol }}://{{ h.username }}@{{ h.host }}:{{ h.port }} &middot; RTSP :{{ h.rtspPort }}
              </div>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm" type="button" @click="$emit('edit-hikvision', h)">Edit</button>
              <button class="btn btn-sm btn-danger" type="button" @click="$emit('delete-hikvision', h)">Delete</button>
            </div>
          </div>
        </div>

        <!-- UniFi Network Controllers Manager -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">UniFi Network Controllers ({{ realUnifi.length }})</span>
            <button class="btn btn-sm btn-primary" type="button" @click="$emit('add-unifi')">
              + Add UniFi
            </button>
          </div>
          <div v-if="realUnifi.length === 0" class="panel-subtitle" style="padding: 12px 0;">
            No UniFi controller added yet. Tap <strong>+ Add UniFi</strong> to connect your UniFi OS gateway or
            Classic UniFi Network Server.
          </div>
          <div v-for="u in realUnifi" :key="u.id" class="conn-row">
            <div>
              <div class="conn-name">
                {{ u.name }}
                <span class="pill pill-cyan mono" style="margin-left: 6px; font-size: 10px;">
                  {{ u.controllerType.toUpperCase() }}
                </span>
              </div>
              <div class="conn-sub mono">
                https://{{ u.host }}:{{ u.port }} &middot; site:{{ u.site }}
                <span v-if="u.username"> &middot; {{ u.username }}</span>
              </div>
            </div>
            <div class="btn-group">
              <button class="btn btn-sm" type="button" @click="$emit('edit-unifi', u)">Edit</button>
              <button class="btn btn-sm btn-danger" type="button" @click="$emit('delete-unifi', u)">Delete</button>
            </div>
          </div>
        </div>

        <!-- Panel Preferences -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Display &amp; Polling Preferences</span>
          </div>

          <div class="field">
            <label class="field-label">Rack Console Title</label>
            <div class="inline-save">
              <input v-model="rackTitle" class="input mono" type="text" placeholder="RACK//PANEL" />
              <button class="btn btn-primary" style="margin-left: 8px;" type="button" @click="saveTitle">
                Save
              </button>
            </div>
          </div>

          <div class="field">
            <label class="field-label">Telemetry Refresh Interval</label>
            <div class="btn-group">
              <button
                v-for="ms in [2000, 4000, 8000, 15000]"
                :key="ms"
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': settings.pollIntervalMs === ms }"
                @click="patch({ pollIntervalMs: ms })"
              >
                {{ ms / 1000 }}s
              </button>
            </div>
          </div>

          <div class="field">
            <label class="field-label">Temperature Units</label>
            <div class="btn-group">
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': settings.temperatureUnit === 'C' }"
                @click="patch({ temperatureUnit: 'C' })"
              >
                Celsius (&deg;C)
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': settings.temperatureUnit === 'F' }"
                @click="patch({ temperatureUnit: 'F' })"
              >
                Fahrenheit (&deg;F)
              </button>
            </div>
          </div>

          <div class="field">
            <label class="field-label">Idle Metrics Splash Screen</label>
            <div class="btn-group">
              <button
                v-for="opt in [
                  { label: 'Off', sec: 0 },
                  { label: '30s', sec: 30 },
                  { label: '1 min', sec: 60 },
                  { label: '2 min', sec: 120 },
                  { label: '5 min', sec: 300 },
                ]"
                :key="opt.sec"
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': settings.idleSplashSeconds === opt.sec }"
                @click="patch({ idleSplashSeconds: opt.sec })"
              >
                {{ opt.label }}
              </button>
              <button
                type="button"
                class="btn btn-sm"
                @click="$emit('preview-splash')"
              >
                {{ settings.splashPinEnabled && settings.hasSplashPin ? 'Lock & Preview' : 'Preview Now' }}
              </button>
            </div>
          </div>

          <div class="field">
            <div class="pin-setting-head">
              <label class="field-label" style="margin-bottom: 0;">Splash Quick 4-Digit PIN Unlock</label>
              <span
                class="pill mono"
                :class="settings.splashPinEnabled && settings.hasSplashPin ? 'pill-cyan' : 'pill-muted'"
                style="font-size: 10px; padding: 2px 8px;"
              >
                {{ settings.splashPinEnabled && settings.hasSplashPin ? 'ENABLED' : 'DISABLED' }}
              </span>
            </div>

            <div class="btn-group" style="margin-top: 8px;">
              <button
                type="button"
                class="btn btn-sm"
                :class="settings.splashPinEnabled && settings.hasSplashPin ? 'btn-warn' : 'btn-primary'"
                @click="toggleSplashPin"
              >
                {{ settings.splashPinEnabled && settings.hasSplashPin ? 'Disable PIN Unlock' : 'Enable PIN Unlock' }}
              </button>
              <button
                v-if="settings.hasSplashPin && !editingPin"
                type="button"
                class="btn btn-sm"
                @click="startEditPin(false)"
              >
                Change PIN
              </button>
            </div>

            <div v-if="editingPin" class="pin-editor-box">
              <div class="inline-save">
                <input
                  v-model="pinInput"
                  class="input mono pin-input-field"
                  type="password"
                  inputmode="numeric"
                  maxlength="4"
                  autocomplete="off"
                  placeholder="4-digit PIN (e.g. 1234)"
                  @input="sanitizePinInput"
                  @keyup.enter="savePin"
                />
                <button
                  class="btn btn-sm btn-primary"
                  style="margin-left: 8px;"
                  type="button"
                  :disabled="pinInput.length !== 4"
                  @click="savePin"
                >
                  {{ enableOnPinSave ? 'Save & Enable' : 'Save PIN' }}
                </button>
                <button
                  class="btn btn-sm"
                  style="margin-left: 6px;"
                  type="button"
                  @click="cancelEditPin"
                >
                  Cancel
                </button>
              </div>
              <div class="panel-subtitle" style="margin-top: 6px;">
                Enter exactly 4 digits (0–9). Stored AES-256-GCM encrypted on the server.
              </div>
            </div>
            <div v-else class="panel-subtitle" style="margin-top: 6px;">
              {{
                settings.splashPinEnabled && settings.hasSplashPin
                  ? 'Waking from the idle metrics splash screen requires a quick 4-digit PIN.'
                  : settings.hasSplashPin
                    ? 'A 4-digit PIN is saved. Enable to require PIN unlock from the splash screen.'
                    : 'Require a quick 4-digit PIN keypad to unlock the control panel from the splash screen.'
              }}
            </div>
          </div>

          <div class="field" style="margin-bottom: 0;">
            <label class="field-label">Demo Homelab Simulation</label>
            <div class="btn-group">
              <button
                type="button"
                class="btn"
                :class="settings.demoMode ? 'btn-warn' : 'btn-success'"
                @click="patch({ demoMode: !settings.demoMode })"
              >
                {{ settings.demoMode ? 'Disable Demo Hosts' : 'Enable Demo Hosts' }}
              </button>
            </div>
            <div class="panel-subtitle" style="margin-top: 6px;">
              Keep Demo Mode on to preview live SSH &amp; Proxmox telemetry, or turn it off once your real hosts are added.
            </div>
          </div>
        </div>

        <!-- Factory Reset (Preserves Users) -->
        <div class="panel" style="border-color: rgba(239, 68, 68, 0.35);">
          <div class="panel-header">
            <span class="panel-title" style="color: #fca5a5;">Factory Reset</span>
          </div>
          <p class="panel-subtitle" style="margin: 0 0 12px 0; line-height: 1.5;">
            Reset all configured connections (SSH, Proxmox, Tailscale, OPNsense, Hikvision, UniFi), topology
            canvases, racks, wires, docs, and display preferences back to initial install defaults.
            <strong>Your user account(s) and active session will be preserved.</strong>
          </p>
          <button type="button" class="btn btn-danger" @click="factoryResetOpen = true">
            Reset Rack//Panel to Factory Defaults
          </button>
        </div>
      </div>
    </div>

    <UiDialog
      :open="factoryResetOpen"
      title="Reset Rack//Panel to Factory Defaults"
      @close="factoryResetOpen = false"
    >
      <p style="color: #cbd5e1; font-size: 14px; line-height: 1.55; margin: 0;">
        This will permanently remove all saved servers, Proxmox clusters, Tailscale integrations, OPNsense firewalls,
        Hikvision NVRs/cameras, UniFi controllers/devices, topology canvases, racks, wires, and settings back to when
        Rack//Panel was first installed.
      </p>
      <p style="color: #a7f3d0; font-size: 13px; line-height: 1.5; margin: 10px 0 0 0;">
        Your user account(s) and current login session will <strong>not</strong> be removed.
      </p>
      <template #footer>
        <UiButton :disabled="factoryResetting" @click="factoryResetOpen = false">Cancel</UiButton>
        <UiButton variant="danger" :disabled="factoryResetting" @click="confirmFactoryReset">
          {{ factoryResetting ? 'Resetting...' : 'Yes, Reset Rack//Panel' }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch, onMounted } from 'vue';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';
import type {
  AuthUserPublic,
  HikvisionConfigPublic,
  OpnsenseConfigPublic,
  PanelSettings,
  ProxmoxConfigPublic,
  SshServerPublic,
  TailscaleConfigPublic,
  UnifiConfigPublic,
  UserRole,
} from '@shared/types';
import { api } from '@/api/client';

export default defineComponent({
  name: 'SettingsView',
  components: { UiDialog, UiButton },
  props: {
    settings: { type: Object as () => PanelSettings, required: true },
    currentUser: { type: Object as () => AuthUserPublic | null, default: null },
    realServers: { type: Array as () => SshServerPublic[], required: true },
    realProxmox: { type: Array as () => ProxmoxConfigPublic[], required: true },
    realTailscale: { type: Array as () => TailscaleConfigPublic[], required: true },
    realOpnsense: { type: Array as () => OpnsenseConfigPublic[], required: true },
    realHikvision: { type: Array as () => HikvisionConfigPublic[], default: () => [] },
    realUnifi: { type: Array as () => UnifiConfigPublic[], default: () => [] },
  },
  setup(props, { emit }) {
    const rackTitle = ref(props.settings.rackTitle || 'RACK//PANEL');
    const editingPin = ref(false);
    const pinInput = ref('');
    const enableOnPinSave = ref(false);

    const users = ref<AuthUserPublic[]>([]);
    const addingUser = ref(false);
    const newUser = ref<{ username: string; displayName: string; password: string; role: UserRole }>({
      username: '',
      displayName: '',
      password: '',
      role: 'operator',
    });
    const passwordTarget = ref<AuthUserPublic | null>(null);
    const newPassword = ref('');

    async function loadUsers() {
      try {
        users.value = await api.listUsers();
      } catch {
        // ignore if locked/unavailable
      }
    }

    onMounted(() => {
      void loadUsers();
    });

    function startPasswordChange(u: AuthUserPublic) {
      passwordTarget.value = u;
      newPassword.value = '';
    }

    async function submitPasswordChange() {
      if (!passwordTarget.value) return;
      if (newPassword.value.length < 4) {
        emit('toast', { message: 'Password must be at least 4 characters', error: true });
        return;
      }
      try {
        await api.changeUserPassword(passwordTarget.value.id, newPassword.value);
        emit('toast', { message: `Password updated for @${passwordTarget.value.username}`, error: false });
        passwordTarget.value = null;
        newPassword.value = '';
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to update password',
          error: true,
        });
      }
    }

    async function submitCreateUser() {
      try {
        await api.createUser({
          username: newUser.value.username.trim(),
          displayName: newUser.value.displayName.trim() || undefined,
          password: newUser.value.password,
          role: newUser.value.role,
        });
        emit('toast', { message: `Created user @${newUser.value.username.trim().toLowerCase()}`, error: false });
        newUser.value = { username: '', displayName: '', password: '', role: 'operator' };
        addingUser.value = false;
        await loadUsers();
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to create user',
          error: true,
        });
      }
    }

    async function removeUser(u: AuthUserPublic) {
      try {
        await api.deleteUser(u.id);
        emit('toast', { message: `Removed user @${u.username}`, error: false });
        await loadUsers();
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to delete user',
          error: true,
        });
      }
    }

    watch(
      () => props.settings.rackTitle,
      (v) => {
        if (v) rackTitle.value = v;
      },
    );

    async function patch(data: Partial<PanelSettings> & { splashPin?: string }, customMessage?: string) {
      try {
        await api.updateSettings(data);
        emit('toast', { message: customMessage || 'Settings updated', error: false });
        emit('refresh');
        return true;
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to update settings',
          error: true,
        });
        return false;
      }
    }

    function saveTitle() {
      void patch({ rackTitle: rackTitle.value.trim() || 'RACK//PANEL' });
    }

    function startEditPin(shouldEnable: boolean) {
      pinInput.value = '';
      enableOnPinSave.value = shouldEnable;
      editingPin.value = true;
    }

    function cancelEditPin() {
      pinInput.value = '';
      enableOnPinSave.value = false;
      editingPin.value = false;
    }

    function sanitizePinInput() {
      pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 4);
    }

    function toggleSplashPin() {
      if (props.settings.splashPinEnabled && props.settings.hasSplashPin) {
        editingPin.value = false;
        void patch({ splashPinEnabled: false }, 'Splash PIN unlock disabled');
        return;
      }
      if (props.settings.hasSplashPin) {
        void patch({ splashPinEnabled: true }, 'Splash PIN unlock enabled');
        return;
      }
      startEditPin(true);
    }

    async function savePin() {
      const cleaned = pinInput.value.replace(/\D/g, '').slice(0, 4);
      if (cleaned.length !== 4) {
        emit('toast', { message: 'PIN must be exactly 4 digits', error: true });
        return;
      }
      const payload: Partial<PanelSettings> & { splashPin?: string } = { splashPin: cleaned };
      if (enableOnPinSave.value) {
        payload.splashPinEnabled = true;
      }
      const ok = await patch(
        payload,
        enableOnPinSave.value ? '4-digit PIN saved & unlock enabled' : '4-digit splash PIN updated',
      );
      if (ok) {
        cancelEditPin();
      }
    }

    const factoryResetOpen = ref(false);
    const factoryResetting = ref(false);

    async function confirmFactoryReset() {
      factoryResetting.value = true;
      try {
        await api.factoryResetPanel();
        factoryResetOpen.value = false;
        emit('toast', {
          message: 'Rack//Panel reset to factory defaults (user accounts preserved)',
          error: false,
        });
        emit('refresh');
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Factory reset failed',
          error: true,
        });
      } finally {
        factoryResetting.value = false;
      }
    }

    return {
      rackTitle,
      editingPin,
      pinInput,
      enableOnPinSave,
      users,
      addingUser,
      newUser,
      passwordTarget,
      newPassword,
      patch,
      saveTitle,
      startEditPin,
      cancelEditPin,
      sanitizePinInput,
      toggleSplashPin,
      savePin,
      startPasswordChange,
      submitPasswordChange,
      submitCreateUser,
      removeUser,
      factoryResetOpen,
      factoryResetting,
      confirmFactoryReset,
    };
  },
});
</script>

<style scoped lang="scss">
.conn-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 12px 0;
  border-bottom: 1px solid #1f2a40;

  &:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }
}

.conn-name {
  font-size: 15px;
  font-weight: 700;
  color: #f8fafc;
}

.conn-sub {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 3px;
}

.inline-save {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.pin-setting-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.pin-editor-box {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 4px;
  background: #0a0f1a;
  border: 1px solid #1f2d47;
}

.pin-input-field {
  max-width: 190px;
  letter-spacing: 4px;
  font-weight: 700;
}

.user-self-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 10px 12px;
  margin-bottom: 10px;
  border-radius: 4px;
  background: #0a0f1a;
  border: 1px solid #1f2d47;
}

.tips-list {
  margin: 0 0 16px 0;
  padding-left: 18px;
  color: #cbd5e1;
  font-size: 13px;
  line-height: 1.65;

  li {
    margin-bottom: 8px;
  }
}
</style>
