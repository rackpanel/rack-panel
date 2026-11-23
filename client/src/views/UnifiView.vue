<template>
  <div>
    <!-- Section Header Bar -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">UniFi Network &amp; Devices</h2>
        <div class="panel-subtitle">
          UniFi OS &amp; Classic Network controllers, PoE switches, WiFi access points, clients, and WAN telemetry
        </div>
      </div>
      <div class="btn-group">
        <button class="btn" type="button" @click="$emit('refresh')">
          Sync UniFi
        </button>
        <button class="btn" type="button" @click="openScanModal">
          Scan Network
        </button>
        <button class="btn btn-primary" type="button" @click="$emit('add-unifi')">
          + Add UniFi
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="controllers.length === 0" class="panel empty-card">
      <h3 style="margin: 0 0 8px 0; color: #f8fafc;">No UniFi Controller or Device Connected</h3>
      <p style="max-width: 580px; margin: 0 auto 18px auto;">
        Connect a <strong>UniFi OS / Classic Controller</strong> or scan your local network to add
        <strong>Standalone UniFi APs, Switches &amp; Gateways</strong> even without a controller.
      </p>
      <div class="btn-group" style="justify-content: center;">
        <button class="btn btn-primary" type="button" @click="openScanModal">
          Scan &amp; Add UniFi Devices
        </button>
        <button class="btn" type="button" @click="$emit('add-unifi')">
          + Connect Manually
        </button>
      </div>
    </div>

    <template v-else>
      <!-- Controller Selector Strip -->
      <div v-if="controllers.length > 1" class="unifi-ctrl-tabs">
        <button
          v-for="c in controllers"
          :key="c.configId"
          type="button"
          class="btn btn-sm unifi-ctrl-tab"
          :class="{ 'btn-primary': activeCtrl && activeCtrl.configId === c.configId }"
          @click="selectedConfigId = c.configId"
        >
          <span
            class="dot"
            :class="c.status === 'online' ? 'dot-ok' : c.status === 'error' ? 'dot-crit' : 'dot-warn'"
          ></span>
          <span>{{ c.name }}</span>
          <span class="mono" style="margin-left: 6px; opacity: 0.8;">
            ({{ c.onlineDevices }}/{{ c.totalDevices }})
          </span>
        </button>
      </div>

      <template v-if="activeCtrl">
        <!-- Controller Summary Banner -->
        <div class="panel" style="margin-bottom: 14px;">
          <div class="panel-header" style="margin-bottom: 10px;">
            <div class="unifi-identity-head">
              <span
                class="dot"
                :class="
                  activeCtrl.status === 'online'
                    ? 'dot-ok pulse'
                    : activeCtrl.status === 'error'
                      ? 'dot-crit'
                      : 'dot-warn'
                "
              ></span>
              <span class="unifi-ctrl-title">{{ activeCtrl.name }}</span>
              <span class="pill pill-cyan mono" style="margin-left: 8px;">
                {{ activeCtrl.controllerType.toUpperCase() }}
              </span>
              <span v-if="activeCtrl.controllerVersion && activeCtrl.controllerVersion !== '-'" class="pill pill-violet mono" style="margin-left: 6px;">
                v{{ activeCtrl.controllerVersion }}
              </span>
              <span v-if="activeCtrl.isDemo" class="pill pill-warn mono" style="margin-left: 6px;">
                DEMO
              </span>
            </div>

            <div class="btn-group">
              <span
                class="pill mono"
                :class="activeCtrl.onlineDevices === activeCtrl.totalDevices && activeCtrl.totalDevices > 0 ? 'pill-ok' : 'pill-warn'"
              >
                DEVICES {{ activeCtrl.onlineDevices }}/{{ activeCtrl.totalDevices }} ONLINE
              </span>
              <span class="pill pill-cyan mono" style="margin-left: 6px;">
                CLIENTS {{ activeCtrl.totalClients }} ({{ activeCtrl.wiredClients }}W / {{ activeCtrl.wirelessClients }}WL)
              </span>
            </div>
          </div>

          <div v-if="activeCtrl.errorMessage" class="unifi-error-banner mono">
            {{ activeCtrl.errorMessage }}
          </div>

          <div class="unifi-meta-strip mono">
            <div class="unifi-meta-cell">
              <span class="unifi-meta-k">HOST / SITE</span>
              <span class="unifi-meta-v">{{ activeCtrl.host }} &middot; site:{{ activeCtrl.site }}</span>
            </div>
            <div class="unifi-meta-cell">
              <span class="unifi-meta-k">WAN IP / ISP</span>
              <span class="unifi-meta-v">{{ activeCtrl.wanIp || '-' }} &middot; {{ activeCtrl.ispName || '-' }}</span>
            </div>
            <div class="unifi-meta-cell">
              <span class="unifi-meta-k">WAN LATENCY</span>
              <span class="unifi-meta-v">
                {{ activeCtrl.wanLatencyMs !== null ? activeCtrl.wanLatencyMs + ' ms' : '-' }}
              </span>
            </div>
            <div class="unifi-meta-cell">
              <span class="unifi-meta-k">WAN THROUGHPUT</span>
              <span class="unifi-meta-v">
                &darr; {{ formatBps(activeCtrl.wanRxBps) }} / &uarr; {{ formatBps(activeCtrl.wanTxBps) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Sub-Navigation Bar -->
        <div class="unifi-subnav">
          <button
            type="button"
            class="btn btn-sm unifi-subnav-btn"
            :class="{ 'btn-primary': subTab === 'devices' }"
            @click="setSubTab('devices')"
          >
            Devices ({{ activeCtrl.devices.length }})
          </button>
          <button
            type="button"
            class="btn btn-sm unifi-subnav-btn"
            :class="{ 'btn-primary': subTab === 'clients' }"
            @click="setSubTab('clients')"
          >
            Clients ({{ activeCtrl.clients.length }})
          </button>
          <button
            type="button"
            class="btn btn-sm unifi-subnav-btn"
            :class="{ 'btn-primary': subTab === 'wlans' }"
            @click="setSubTab('wlans')"
          >
            WiFi SSIDs ({{ activeCtrl.wlans.length }})
          </button>
          <button
            type="button"
            class="btn btn-sm unifi-subnav-btn"
            :class="{ 'btn-primary': subTab === 'health' }"
            @click="setSubTab('health')"
          >
            WAN &amp; Health
          </button>
        </div>

        <!-- TAB 1: DEVICES -->
        <div v-if="subTab === 'devices'">
          <div class="unifi-filter-bar">
            <button
              v-for="f in deviceFilters"
              :key="f.id"
              type="button"
              class="btn btn-sm unifi-filter-btn"
              :class="{ 'btn-primary': deviceFilter === f.id }"
              @click="deviceFilter = f.id"
            >
              {{ f.label }}
            </button>
          </div>

          <div v-if="filteredDevices.length === 0" class="panel" style="padding: 18px; color: #94a3b8;">
            No UniFi devices match this filter.
          </div>

          <div v-else class="rack-row">
            <div v-for="dev in filteredDevices" :key="dev.id" class="col-6">
              <div class="panel unifi-device-card">
                <div class="unifi-dev-head">
                  <div class="unifi-dev-title-wrap">
                    <span
                      class="dot"
                      :class="dev.state === 'online' ? 'dot-ok' : dev.state === 'upgrading' ? 'dot-warn' : 'dot-crit'"
                    ></span>
                    <span class="unifi-dev-name">{{ dev.name }}</span>
                    <span class="pill pill-cyan mono" style="margin-left: 8px; font-size: 10px;">
                      {{ typeBadge(dev.type) }}
                    </span>
                  </div>
                  <div class="btn-group">
                    <button
                      class="btn btn-sm"
                      type="button"
                      :disabled="busyKey === dev.mac + ':locate'"
                      @click="triggerDeviceAction(dev, 'locate')"
                    >
                      Locate LED
                    </button>
                    <button
                      class="btn btn-sm"
                      type="button"
                      :disabled="busyKey === dev.mac + ':unlocate'"
                      @click="triggerDeviceAction(dev, 'unlocate')"
                    >
                      Off
                    </button>
                    <button
                      class="btn btn-sm btn-danger"
                      type="button"
                      :disabled="busyKey === dev.mac + ':restart'"
                      @click="triggerDeviceAction(dev, 'restart')"
                    >
                      Restart
                    </button>
                  </div>
                </div>

                <div class="unifi-dev-sub mono">
                  {{ dev.modelName || dev.model }} &middot; {{ dev.ip || '-' }} &middot; {{ dev.mac }} &middot; v{{ dev.version || '-' }}
                </div>

                <div class="unifi-dev-metrics mono">
                  <div class="unifi-metric-pill">
                    <span class="unifi-meta-k">CPU</span>
                    <span>{{ Math.round(dev.cpuPercent) }}%</span>
                  </div>
                  <div class="unifi-metric-pill">
                    <span class="unifi-meta-k">RAM</span>
                    <span>{{ Math.round(dev.memPercent) }}%</span>
                  </div>
                  <div class="unifi-metric-pill">
                    <span class="unifi-meta-k">CLIENTS</span>
                    <span>{{ dev.numClients }}</span>
                  </div>
                  <div class="unifi-metric-pill">
                    <span class="unifi-meta-k">UPTIME</span>
                    <span>{{ formatUptime(dev.uptimeSeconds) }}</span>
                  </div>
                  <div v-if="dev.poeWatts > 0" class="unifi-metric-pill">
                    <span class="unifi-meta-k">PoE</span>
                    <span>{{ dev.poeWatts.toFixed(1) }}W</span>
                  </div>
                  <div v-if="dev.satisfaction !== null" class="unifi-metric-pill">
                    <span class="unifi-meta-k">EXP</span>
                    <span>{{ dev.satisfaction }}%</span>
                  </div>
                </div>

                <!-- Radios (APs) -->
                <div v-if="dev.radios && dev.radios.length > 0" class="unifi-radios-row mono">
                  <span v-for="r in dev.radios" :key="r.name" class="unifi-radio-chip">
                    {{ r.radio.toUpperCase() }} Ch{{ r.channel }} &middot; {{ r.txPower }}dBm &middot; {{ r.numClients }} cli
                  </span>
                </div>

                <!-- Ports (Switches / Gateways) -->
                <div v-if="dev.ports && dev.ports.length > 0" class="unifi-ports-section">
                  <div class="unifi-ports-label mono">
                    Ports ({{ dev.ports.filter((p) => p.up).length }}/{{ dev.ports.length }} up &mdash; tap PoE port to cycle)
                  </div>
                  <div class="unifi-ports-strip">
                    <button
                      v-for="p in dev.ports"
                      :key="p.portIdx"
                      type="button"
                      class="unifi-port-tile mono"
                      :class="{
                        'port-up': p.up,
                        'port-poe': p.poeEnable && p.poeWatts > 0,
                      }"
                      :title="
                        'Port ' +
                        p.portIdx +
                        (p.name ? ' (' + p.name + ')' : '') +
                        (p.up ? ' UP ' + p.speedMbps + 'M' : ' DOWN') +
                        (p.poeEnable ? ' PoE ' + p.poeWatts.toFixed(1) + 'W' : '')
                      "
                      :disabled="!p.poeEnable || busyKey === dev.mac + ':poe:' + p.portIdx"
                      @click="p.poeEnable ? triggerDeviceAction(dev, 'poe-cycle', p.portIdx) : null"
                    >
                      <span class="port-idx">{{ p.portIdx }}</span>
                      <span v-if="p.poeEnable && p.poeWatts > 0" class="port-poe-w">
                        {{ Math.round(p.poeWatts) }}W
                      </span>
                      <span v-else-if="p.up" class="port-spd">
                        {{ p.speedMbps >= 1000 ? Math.round(p.speedMbps / 1000) + 'G' : p.speedMbps }}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: CLIENTS -->
        <div v-else-if="subTab === 'clients'" class="panel">
          <div class="unifi-clients-toolbar">
            <input
              v-model="clientSearch"
              class="input unifi-search-input"
              type="text"
              placeholder="Search client name, IP, MAC, SSID, or vendor..."
            />
            <div class="btn-group">
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': clientFilter === 'all' }"
                @click="clientFilter = 'all'"
              >
                All ({{ activeCtrl.clients.length }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': clientFilter === 'wired' }"
                @click="clientFilter = 'wired'"
              >
                Wired ({{ activeCtrl.wiredClients }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': clientFilter === 'wireless' }"
                @click="clientFilter = 'wireless'"
              >
                Wireless ({{ activeCtrl.wirelessClients }})
              </button>
            </div>
          </div>

          <div v-if="filteredClients.length === 0" style="padding: 16px 0; color: #94a3b8;">
            No active clients match your filter.
          </div>

          <div v-else class="unifi-table-wrap">
            <table class="unifi-table mono">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>IP / MAC</th>
                  <th>Connection</th>
                  <th>Signal / Rate</th>
                  <th>Traffic</th>
                  <th>Uptime</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="c in filteredClients" :key="c.mac">
                  <td>
                    <div class="unifi-cli-name">{{ c.name || c.hostname || c.mac }}</div>
                    <div v-if="c.oui" class="unifi-cli-sub">{{ c.oui }}</div>
                  </td>
                  <td>
                    <div>{{ c.ip || '-' }}</div>
                    <div class="unifi-cli-sub">{{ c.mac }}</div>
                  </td>
                  <td>
                    <span class="pill" :class="c.isWired ? 'pill-cyan' : 'pill-violet'" style="font-size: 10px;">
                      {{ c.isWired ? 'WIRED' : 'WIFI' }}
                    </span>
                    <span style="margin-left: 6px;">
                      {{ c.isWired ? (c.swPort ? 'Port ' + c.swPort : c.network || 'LAN') : c.essid || '-' }}
                    </span>
                  </td>
                  <td>
                    <template v-if="!c.isWired">
                      {{ c.rssi !== null ? c.rssi + ' dBm' : '-' }}
                      <span v-if="c.channel"> &middot; Ch{{ c.channel }}</span>
                      <div v-if="c.txRateMbps" class="unifi-cli-sub">
                        {{ c.txRateMbps }}/{{ c.rxRateMbps || c.txRateMbps }} Mbps
                      </div>
                    </template>
                    <template v-else>1000 Mbps</template>
                  </td>
                  <td>
                    <div>&darr; {{ formatBytes(c.rxBytes) }}</div>
                    <div class="unifi-cli-sub">&uarr; {{ formatBytes(c.txBytes) }}</div>
                  </td>
                  <td>{{ formatUptime(c.uptimeSeconds) }}</td>
                  <td style="text-align: right;">
                    <button
                      class="btn btn-sm"
                      type="button"
                      :disabled="busyKey === 'kick:' + c.mac"
                      @click="reconnectClient(c)"
                    >
                      Reconnect
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- TAB 3: WIFI SSIDS -->
        <div v-else-if="subTab === 'wlans'" class="rack-row">
          <div v-if="activeCtrl.wlans.length === 0" class="col-12">
            <div class="panel" style="padding: 18px; color: #94a3b8;">
              No WiFi SSIDs reported by this controller.
            </div>
          </div>
          <div v-for="w in activeCtrl.wlans" :key="w.id" class="col-4">
            <div class="panel unifi-wlan-card">
              <div class="unifi-dev-head">
                <div class="unifi-dev-title-wrap">
                  <span class="dot" :class="w.enabled ? 'dot-ok' : 'dot-crit'"></span>
                  <span class="unifi-dev-name">{{ w.name }}</span>
                </div>
                <span class="pill mono" :class="w.enabled ? 'pill-ok' : 'pill-warn'">
                  {{ w.enabled ? 'ENABLED' : 'DISABLED' }}
                </span>
              </div>
              <div class="unifi-dev-metrics mono" style="margin-top: 10px;">
                <div class="unifi-metric-pill">
                  <span class="unifi-meta-k">SECURITY</span>
                  <span>{{ (w.wpaMode || w.security || 'open').toUpperCase() }}</span>
                </div>
                <div class="unifi-metric-pill">
                  <span class="unifi-meta-k">VLAN</span>
                  <span>{{ w.vlan !== null ? w.vlan : 'Native' }}</span>
                </div>
                <div class="unifi-metric-pill">
                  <span class="unifi-meta-k">CLIENTS</span>
                  <span>{{ w.numClients }}</span>
                </div>
                <div v-if="w.isGuest" class="unifi-metric-pill">
                  <span class="unifi-meta-k">GUEST</span>
                  <span>YES</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 4: WAN & HEALTH -->
        <div v-else class="rack-row">
          <div class="col-6">
            <div class="panel">
              <div class="panel-header">
                <span class="panel-title">Controller &amp; Site Telemetry</span>
              </div>
              <div class="unifi-kv-list mono">
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">Controller Name</span>
                  <span>{{ activeCtrl.name }}</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">Endpoint</span>
                  <span>{{ activeCtrl.host }} ({{ activeCtrl.controllerType }})</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">Site</span>
                  <span>{{ activeCtrl.site }}</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">Version</span>
                  <span>{{ activeCtrl.controllerVersion || '-' }}</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">UniFi Devices</span>
                  <span>{{ activeCtrl.onlineDevices }} / {{ activeCtrl.totalDevices }} online</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">Active Clients</span>
                  <span>
                    {{ activeCtrl.totalClients }} ({{ activeCtrl.wiredClients }} wired, {{ activeCtrl.wirelessClients }}
                    wireless, {{ activeCtrl.guestClients }} guest)
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="col-6">
            <div class="panel">
              <div class="panel-header">
                <span class="panel-title">WAN Uplink &amp; ISP Health</span>
              </div>
              <div class="unifi-kv-list mono">
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">Public WAN IP</span>
                  <span>{{ activeCtrl.wanIp || '-' }}</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">ISP Provider</span>
                  <span>{{ activeCtrl.ispName || '-' }}</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">WAN Latency</span>
                  <span>{{ activeCtrl.wanLatencyMs !== null ? activeCtrl.wanLatencyMs + ' ms' : '-' }}</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">Download Rate</span>
                  <span>&darr; {{ formatBps(activeCtrl.wanRxBps) }}</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">Upload Rate</span>
                  <span>&uarr; {{ formatBps(activeCtrl.wanTxBps) }}</span>
                </div>
                <div class="unifi-kv-row">
                  <span class="unifi-meta-k">Last Polled</span>
                  <span>{{ new Date(activeCtrl.collectedAt).toLocaleTimeString() }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Scan & Add Standalone UniFi Devices / Controllers Modal -->
    <UiDialog
      :open="scanModalOpen"
      title="Scan &amp; Add UniFi Devices"
      @close="scanModalOpen = false"
    >
      <p style="margin: 0 0 12px 0; color: #94a3b8; font-size: 13px; line-height: 1.5;">
        Scans your subnet via Ubiquiti Discovery (UDP :10001), MAC OUI, SNMP, and HTTPS for both
        <strong>Standalone UniFi Devices</strong> (no controller required) and <strong>UniFi Controllers</strong>.
      </p>
      <div class="unifi-scan-bar">
        <input
          v-model="scanSubnet"
          class="input mono unifi-scan-input"
          type="text"
          placeholder="Subnet (auto: 192.168.1.0/24, 192.168.0.0/24, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)"
        />
        <UiButton variant="primary" :disabled="scanning" @click="runUnifiScan">
          {{ scanning ? 'Scanning...' : 'Scan Network' }}
        </UiButton>
      </div>

      <div v-if="scanError" class="unifi-error-banner mono">{{ scanError }}</div>

      <div v-if="hasScanned && scanResults.length === 0 && !scanning" style="padding: 14px 0; color: #94a3b8; font-size: 13px;">
        No UniFi devices found on <span class="mono">{{ lastScannedSubnet }}</span> ({{ lastScannedIps }} IPs checked).
      </div>

      <div v-if="scanResults.length > 0" class="unifi-scan-list">
        <div v-for="d in scanResults" :key="d.host + ':' + d.port" class="unifi-scan-row">
          <div class="unifi-scan-info">
            <div class="unifi-scan-name">
              <span>{{ d.name }}</span>
              <span
                class="pill mono"
                :class="d.controllerType === 'standalone' ? 'pill-violet' : 'pill-cyan'"
                style="margin-left: 8px; font-size: 10px;"
              >
                {{ d.controllerType === 'standalone' ? 'STANDALONE' : (d.controllerType || 'CONTROLLER').toUpperCase() }}
              </span>
            </div>
            <div class="unifi-cli-sub mono">
              {{ d.host }} &middot; {{ d.detail }}
            </div>
          </div>
          <div>
            <UiButton
              v-if="d.controllerType === 'standalone'"
              size="sm"
              variant="primary"
              :disabled="addingHost === d.host || addedHosts[d.host]"
              @click="addScannedDevice(d)"
            >
              {{ addedHosts[d.host] ? 'Added' : addingHost === d.host ? 'Adding...' : '+ Add Device' }}
            </UiButton>
            <UiButton
              v-else
              size="sm"
              @click="openManualFromScan"
            >
              Connect Controller
            </UiButton>
          </div>
        </div>
      </div>

      <template #footer>
        <UiButton @click="scanModalOpen = false">Close</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue';
import type {
  OverviewResponse,
  UnifiClientInfo,
  UnifiDevice,
  UnifiSnapshot,
} from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';

type UnifiSubTab = 'devices' | 'clients' | 'wlans' | 'health';
type DeviceFilter = 'all' | 'gateway' | 'switch' | 'ap';
type ClientFilter = 'all' | 'wired' | 'wireless';

interface ScannedUnifiItem {
  host: string;
  port: number;
  protocol: string;
  name: string;
  detail: string;
  mac?: string;
  controllerType?: 'unifi-os' | 'classic' | 'standalone';
  unifiDeviceType?: 'uap' | 'usw' | 'ugw' | 'udm' | 'uxg' | 'other';
}

export default defineComponent({
  name: 'UnifiView',
  components: { UiDialog, UiButton },
  props: {
    overview: { type: Object as () => OverviewResponse | null, default: null },
    initialSubTab: { type: String as () => UnifiSubTab, default: 'devices' },
  },
  setup(props, { emit }) {
    const subTab = ref<UnifiSubTab>(props.initialSubTab || 'devices');
    const selectedConfigId = ref('');
    const deviceFilter = ref<DeviceFilter>('all');
    const clientFilter = ref<ClientFilter>('all');
    const clientSearch = ref('');
    const busyKey = ref('');

    const scanModalOpen = ref(false);
    const scanSubnet = ref('');
    const scanning = ref(false);
    const hasScanned = ref(false);
    const scanError = ref('');
    const lastScannedSubnet = ref('');
    const lastScannedIps = ref(0);
    const scanResults = ref<ScannedUnifiItem[]>([]);
    const addingHost = ref('');
    const addedHosts = ref<Record<string, boolean>>({});

    function openScanModal() {
      scanModalOpen.value = true;
      scanError.value = '';
    }

    async function runUnifiScan() {
      scanning.value = true;
      scanError.value = '';
      try {
        const res = await api.autoScanDevices('unifi', scanSubnet.value.trim() || undefined);
        scanResults.value = res.devices || [];
        lastScannedSubnet.value = res.subnet || '';
        lastScannedIps.value = res.scannedIps || 0;
        hasScanned.value = true;
      } catch (err) {
        scanError.value = err instanceof Error ? err.message : 'Scan failed';
      } finally {
        scanning.value = false;
      }
    }

    async function addScannedDevice(d: ScannedUnifiItem) {
      addingHost.value = d.host;
      try {
        await api.saveUnifi({
          name: d.name,
          host: d.host,
          port: d.port || 22,
          controllerType: 'standalone',
          site: d.unifiDeviceType || 'uap',
          allowInsecureTls: true,
          enabled: true,
        });
        addedHosts.value = { ...addedHosts.value, [d.host]: true };
        emit('toast', { message: `Added standalone UniFi device ${d.name}`, error: false });
        emit('refresh');
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Failed to add UniFi device',
          error: true,
        });
      } finally {
        addingHost.value = '';
      }
    }

    function openManualFromScan() {
      scanModalOpen.value = false;
      emit('add-unifi');
    }

    const deviceFilters: Array<{ id: DeviceFilter; label: string }> = [
      { id: 'all', label: 'All Devices' },
      { id: 'gateway', label: 'Gateways' },
      { id: 'switch', label: 'Switches' },
      { id: 'ap', label: 'Access Points' },
    ];

    watch(
      () => props.initialSubTab,
      (val) => {
        if (val) subTab.value = val;
      },
    );

    function setSubTab(next: UnifiSubTab) {
      subTab.value = next;
      emit('sub-tab-change', next);
    }

    const controllers = computed<UnifiSnapshot[]>(() =>
      props.overview && Array.isArray(props.overview.unifi) ? props.overview.unifi : [],
    );

    const activeCtrl = computed<UnifiSnapshot | null>(() => {
      if (controllers.value.length === 0) return null;
      const found = controllers.value.find((c) => c.configId === selectedConfigId.value);
      return found || controllers.value[0];
    });

    const filteredDevices = computed<UnifiDevice[]>(() => {
      if (!activeCtrl.value) return [];
      const list = activeCtrl.value.devices || [];
      if (deviceFilter.value === 'all') return list;
      if (deviceFilter.value === 'gateway') {
        return list.filter((d) => d.type === 'udm' || d.type === 'ugw' || d.type === 'uxg');
      }
      if (deviceFilter.value === 'switch') {
        return list.filter((d) => d.type === 'usw');
      }
      return list.filter((d) => d.type === 'uap');
    });

    const filteredClients = computed<UnifiClientInfo[]>(() => {
      if (!activeCtrl.value) return [];
      const q = clientSearch.value.trim().toLowerCase();
      return (activeCtrl.value.clients || []).filter((c) => {
        if (clientFilter.value === 'wired' && !c.isWired) return false;
        if (clientFilter.value === 'wireless' && c.isWired) return false;
        if (!q) return true;
        return (
          (c.name || '').toLowerCase().indexOf(q) !== -1 ||
          (c.hostname || '').toLowerCase().indexOf(q) !== -1 ||
          (c.ip || '').toLowerCase().indexOf(q) !== -1 ||
          (c.mac || '').toLowerCase().indexOf(q) !== -1 ||
          (c.essid || '').toLowerCase().indexOf(q) !== -1 ||
          (c.oui || '').toLowerCase().indexOf(q) !== -1
        );
      });
    });

    function typeBadge(t: UnifiDevice['type']): string {
      if (t === 'usw') return 'SWITCH';
      if (t === 'uap') return 'AP';
      if (t === 'udm' || t === 'ugw' || t === 'uxg') return 'GATEWAY';
      return 'UNIFI';
    }

    function formatUptime(seconds: number): string {
      if (!seconds || seconds <= 0) return '-';
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      if (d > 0) return `${d}d ${h}h`;
      if (h > 0) return `${h}h ${m}m`;
      return `${m}m`;
    }

    function formatBytes(bytes: number): string {
      if (!bytes || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let val = bytes;
      let idx = 0;
      while (val >= 1024 && idx < units.length - 1) {
        val /= 1024;
        idx++;
      }
      return `${val >= 100 ? Math.round(val) : val.toFixed(1)} ${units[idx]}`;
    }

    function formatBps(bps: number): string {
      if (!bps || bps <= 0) return '0 B/s';
      return `${formatBytes(bps)}/s`;
    }

    async function triggerDeviceAction(
      dev: UnifiDevice,
      action: 'restart' | 'locate' | 'unlocate' | 'poe-cycle',
      portIdx?: number,
    ) {
      if (!activeCtrl.value) return;
      const key =
        action === 'poe-cycle' ? `${dev.mac}:poe:${portIdx}` : `${dev.mac}:${action}`;
      busyKey.value = key;
      try {
        const res = await api.unifiDeviceAction(activeCtrl.value.configId, dev.mac, action, portIdx);
        emit('toast', { message: res.message || `${action} sent to ${dev.name}`, error: !res.ok });
        if (action === 'restart' || action === 'poe-cycle') {
          emit('refresh');
        }
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'UniFi device action failed',
          error: true,
        });
      } finally {
        busyKey.value = '';
      }
    }

    async function reconnectClient(c: UnifiClientInfo) {
      if (!activeCtrl.value) return;
      busyKey.value = `kick:${c.mac}`;
      try {
        const res = await api.unifiReconnectClient(activeCtrl.value.configId, c.mac);
        emit('toast', {
          message: res.message || `Reconnect requested for ${c.name || c.mac}`,
          error: !res.ok,
        });
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Reconnect failed',
          error: true,
        });
      } finally {
        busyKey.value = '';
      }
    }

    return {
      subTab,
      setSubTab,
      selectedConfigId,
      controllers,
      activeCtrl,
      deviceFilter,
      deviceFilters,
      filteredDevices,
      clientFilter,
      clientSearch,
      filteredClients,
      busyKey,
      scanModalOpen,
      scanSubnet,
      scanning,
      hasScanned,
      scanError,
      lastScannedSubnet,
      lastScannedIps,
      scanResults,
      addingHost,
      addedHosts,
      openScanModal,
      runUnifiScan,
      addScannedDevice,
      openManualFromScan,
      typeBadge,
      formatUptime,
      formatBytes,
      formatBps,
      triggerDeviceAction,
      reconnectClient,
    };
  },
});
</script>

<style scoped lang="scss">
.unifi-ctrl-tabs {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.unifi-ctrl-tab {
  margin-right: 8px;
  margin-bottom: 6px;
}

.unifi-identity-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.unifi-ctrl-title {
  font-size: 16px;
  font-weight: 700;
  color: #f8fafc;
  margin-left: 8px;
}

.unifi-error-banner {
  padding: 8px 12px;
  border-radius: 4px;
  background: rgba(220, 38, 38, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.4);
  color: #fecaca;
  font-size: 12px;
  margin-bottom: 10px;
}

.unifi-meta-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  border-top: 1px solid #1f2a40;
  padding-top: 10px;
}

.unifi-meta-cell {
  flex: 1 1 180px;
  margin-right: 12px;
  margin-bottom: 6px;
}

.unifi-meta-k {
  display: block;
  font-size: 10px;
  color: #64748b;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.unifi-meta-v {
  font-size: 12px;
  color: #e2e8f0;
}

.unifi-subnav {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.unifi-subnav-btn {
  margin-right: 8px;
  margin-bottom: 6px;
}

.unifi-filter-bar {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.unifi-filter-btn {
  margin-right: 8px;
  margin-bottom: 6px;
}

.unifi-device-card,
.unifi-wlan-card {
  margin-bottom: 14px;
}

.unifi-dev-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.unifi-dev-title-wrap {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 6px;
}

.unifi-dev-name {
  font-size: 15px;
  font-weight: 600;
  color: #f8fafc;
  margin-left: 8px;
}

.unifi-dev-sub {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 2px;
  margin-bottom: 10px;
}

.unifi-dev-metrics {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.unifi-metric-pill {
  background: #0b1019;
  border: 1px solid #1f2a40;
  border-radius: 4px;
  padding: 5px 9px;
  margin-right: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #e2e8f0;
}

.unifi-radios-row {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 4px;
}

.unifi-radio-chip {
  font-size: 11px;
  color: #bae6fd;
  background: rgba(14, 165, 233, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.3);
  border-radius: 4px;
  padding: 3px 8px;
  margin-right: 6px;
  margin-bottom: 6px;
}

.unifi-ports-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #1f2a40;
}

.unifi-ports-label {
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 6px;
}

.unifi-ports-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.unifi-port-tile {
  width: 34px;
  height: 36px;
  border-radius: 4px;
  border: 1px solid #263248;
  background: #0b1019;
  color: #64748b;
  font-size: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin-right: 4px;
  margin-bottom: 4px;
  padding: 2px;
  cursor: default;
}

.unifi-port-tile.port-up {
  border-color: rgba(16, 185, 129, 0.55);
  background: rgba(16, 185, 129, 0.14);
  color: #a7f3d0;
}

.unifi-port-tile.port-poe {
  border-color: rgba(245, 158, 11, 0.65);
  background: rgba(245, 158, 11, 0.14);
  color: #fde68a;
  cursor: pointer;
}

.port-idx {
  font-weight: 700;
  line-height: 1.1;
}

.port-poe-w,
.port-spd {
  font-size: 9px;
  line-height: 1;
}

.unifi-clients-toolbar {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.unifi-search-input {
  flex: 1 1 260px;
  margin-right: 12px;
  margin-bottom: 8px;
}

.unifi-table-wrap {
  overflow-x: auto;
}

.unifi-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.unifi-table th {
  text-align: left;
  color: #64748b;
  font-weight: 600;
  padding: 8px 10px;
  border-bottom: 1px solid #1f2a40;
  font-size: 11px;
  text-transform: uppercase;
}

.unifi-table td {
  padding: 9px 10px;
  border-bottom: 1px solid rgba(31, 42, 64, 0.6);
  color: #e2e8f0;
  vertical-align: middle;
}

.unifi-cli-name {
  font-weight: 600;
  color: #f8fafc;
}

.unifi-cli-sub {
  font-size: 11px;
  color: #64748b;
}

.unifi-kv-list {
  display: flex;
  flex-direction: column;
}

.unifi-kv-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid rgba(31, 42, 64, 0.6);
  font-size: 12px;
  color: #e2e8f0;
}

.unifi-scan-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 12px;
}

.unifi-scan-input {
  flex: 1 1 auto;
  margin-right: 10px;
}

.unifi-scan-list {
  max-height: 340px;
  overflow-y: auto;
  border-top: 1px solid #1f2a40;
}

.unifi-scan-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px solid rgba(31, 42, 64, 0.7);
}

.unifi-scan-info {
  margin-right: 12px;
}

.unifi-scan-name {
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}
</style>
