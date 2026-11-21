<template>
  <div>
    <!-- Top Section Bar -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">OPNsense Firewall &amp; Routing</h2>
        <div class="panel-subtitle">
          WAN gateways, RTT latency, PF states, live interface throughput, WireGuard peers, services, and firewall logs
        </div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" type="button" @click="$emit('add-opnsense')">
          + Connect OPNsense
        </button>
      </div>
    </div>

    <div v-if="firewalls.length === 0" class="panel empty-state">
      <h3>No OPNsense Firewall Connected</h3>
      <p>Connect your OPNsense router/firewall using an API Key &amp; Secret to monitor gateways, interfaces, services, WireGuard, and live packet filter logs.</p>
      <button class="btn btn-primary btn-lg" type="button" @click="$emit('add-opnsense')">
        + Connect OPNsense Firewall
      </button>
    </div>

    <template v-else>
      <!-- Firewall Selector Strip -->
      <div class="opn-strip">
        <button
          v-for="fw in firewalls"
          :key="fw.configId"
          type="button"
          class="opn-chip"
          :class="{ active: activeId === fw.configId }"
          @click="selectedId = fw.configId"
        >
          <span class="dot" :class="fw.status === 'online' ? 'dot-ok' : 'dot-crit'"></span>
          <span style="margin-right: 8px;">{{ fw.name }}</span>
          <span class="pill pill-muted mono" style="font-size: 10px; padding: 2px 6px;">
            {{ fw.version }}
          </span>
        </button>
      </div>

      <div v-if="activeFw">
        <div v-if="activeFw.status === 'error'" class="alert-row alert-critical" style="margin-bottom: 16px;">
          <div>
            <strong>OPNsense API Error ({{ activeFw.host }}):</strong>
            {{ activeFw.errorMessage }}
          </div>
        </div>

        <!-- Identity & System Control Bar -->
        <div class="panel" style="margin-bottom: 16px;">
          <div class="opn-id-row">
            <div>
              <div class="opn-title-line">
                <span class="dot" :class="activeFw.status === 'online' ? 'dot-ok pulse' : 'dot-crit'"></span>
                <h3 class="opn-name">{{ activeFw.hostname || activeFw.name }}</h3>
                <span class="pill pill-cyan mono" style="margin-left: 8px;">OPNsense {{ activeFw.version }}</span>
                <span v-if="activeFw.firmwareUpdateAvailable" class="pill pill-warn" style="margin-left: 6px;">
                  UPDATE AVAILABLE
                </span>
                <span v-if="activeFw.isDemo" class="pill pill-muted" style="margin-left: 6px;">DEMO</span>
              </div>
              <div class="opn-meta mono">
                {{ activeFw.host }} &middot; {{ activeFw.cpuModel }} &middot;
                Uptime: <strong>{{ formatUptime(activeFw.uptimeSeconds) }}</strong>
                <template v-if="activeFw.tempC !== null">
                  &middot; Temp: <strong>{{ formatTemp(activeFw.tempC, tempUnit) }}</strong>
                </template>
              </div>
            </div>

            <div class="btn-group">
              <button
                class="btn btn-sm"
                type="button"
                :disabled="sysBusy"
                @click="runSystemAction('firmware-check')"
              >
                Check Updates
              </button>
              <button
                class="btn btn-sm btn-warn"
                type="button"
                :disabled="sysBusy"
                @click="pendingSysAction = 'reboot'"
              >
                Reboot
              </button>
              <button
                class="btn btn-sm btn-danger"
                type="button"
                :disabled="sysBusy"
                @click="pendingSysAction = 'halt'"
              >
                Shutdown
              </button>
            </div>
          </div>
        </div>

        <!-- Sub-view Touch Tabs -->
        <div class="tab-strip">
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'overview' }"
            @click="subTab = 'overview'"
          >
            Overview &amp; Gateways ({{ activeFw.gateways.length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'interfaces' }"
            @click="subTab = 'interfaces'"
          >
            Interfaces ({{ activeFw.interfaces.length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'services' }"
            @click="subTab = 'services'"
          >
            Services ({{ runningServiceCount }}/{{ activeFw.services.length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'firewall' }"
            @click="subTab = 'firewall'"
          >
            Firewall Log ({{ activeFw.firewallLogs.length }})
          </button>
        </div>

        <transition name="view-fade" mode="out-in">
          <!-- SUB-TAB 1: OVERVIEW & GATEWAYS -->
          <div v-if="subTab === 'overview'" key="opn-overview">
            <div class="rack-row">
              <div class="col-3">
                <div class="panel opn-gauge-tile">
                  <RadialGauge :value="activeFw.cpuPercent" :size="104" label="CPU" />
                  <div class="opn-gauge-meta">
                    <div class="kpi-label">CPU Usage</div>
                    <div class="mono opn-big">{{ activeFw.cpuPercent.toFixed(1) }}%</div>
                    <div class="kpi-sub mono">
                      Load {{ activeFw.loadAvg.map((v) => v.toFixed(2)).join('/') }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="col-3">
                <div class="panel opn-gauge-tile">
                  <RadialGauge :value="activeFw.memPercent" :size="104" label="RAM" color="#a78bfa" />
                  <div class="opn-gauge-meta">
                    <div class="kpi-label">Memory</div>
                    <div class="mono opn-big">{{ formatBytes(activeFw.memUsedBytes) }}</div>
                    <div class="kpi-sub">of {{ formatBytes(activeFw.memTotalBytes) }}</div>
                  </div>
                </div>
              </div>

              <div class="col-3">
                <div class="panel opn-gauge-tile">
                  <RadialGauge :value="activeFw.pfStatesPercent" :size="104" label="PF STATES" color="#34d399" />
                  <div class="opn-gauge-meta">
                    <div class="kpi-label">Firewall States</div>
                    <div class="mono opn-big">{{ activeFw.pfStatesCurrent.toLocaleString() }}</div>
                    <div class="kpi-sub">max {{ activeFw.pfStatesMax.toLocaleString() }}</div>
                  </div>
                </div>
              </div>

              <div class="col-3">
                <div class="panel opn-gauge-tile">
                  <RadialGauge :value="activeFw.diskPercent" :size="104" label="DISK" color="#fbbf24" />
                  <div class="opn-gauge-meta">
                    <div class="kpi-label">WAN Traffic</div>
                    <div class="mono" style="font-size: 14px; font-weight: 800; color: #34d399; margin-top: 4px;">
                      &darr; {{ formatBps(activeFw.totalRxBps) }}
                    </div>
                    <div class="mono" style="font-size: 14px; font-weight: 800; color: #22d3ee;">
                      &uarr; {{ formatBps(activeFw.totalTxBps) }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Sparklines -->
            <div class="rack-row">
              <div class="col-6">
                <div class="panel">
                  <div class="panel-header">
                    <span class="panel-title">CPU History</span>
                    <span class="mono" style="color: #22d3ee; font-weight: 700;">{{ activeFw.cpuPercent.toFixed(1) }}%</span>
                  </div>
                  <SparklineChart
                    :values="activeFw.history.map((h) => h.cpuPercent)"
                    :height="62"
                    stroke-color="#22d3ee"
                    fill-color="rgba(34, 211, 238, 0.16)"
                  />
                </div>
              </div>
              <div class="col-6">
                <div class="panel">
                  <div class="panel-header">
                    <span class="panel-title">Memory History</span>
                    <span class="mono" style="color: #a78bfa; font-weight: 700;">{{ activeFw.memPercent.toFixed(1) }}%</span>
                  </div>
                  <SparklineChart
                    :values="activeFw.history.map((h) => h.memPercent)"
                    :height="62"
                    stroke-color="#a78bfa"
                    fill-color="rgba(167, 139, 250, 0.16)"
                  />
                </div>
              </div>
            </div>

            <!-- WAN Gateways -->
            <div class="panel" style="margin-bottom: 16px;">
              <div class="panel-header">
                <span class="panel-title">WAN Gateways &amp; Latency Monitors</span>
                <span class="panel-subtitle">{{ activeFw.gateways.length }} configured</span>
              </div>
              <div v-if="activeFw.gateways.length === 0" class="panel-subtitle">
                No gateway monitor data returned by OPNsense.
              </div>
              <div v-else class="rack-row" style="margin-bottom: -16px;">
                <div v-for="gw in activeFw.gateways" :key="gw.name" class="col-6">
                  <div class="gw-box">
                    <div class="panel-header" style="margin-bottom: 8px;">
                      <div class="opn-title-line">
                        <span
                          class="dot"
                          :class="
                            gw.status === 'online'
                              ? 'dot-ok'
                              : gw.status === 'down'
                                ? 'dot-crit pulse'
                                : 'dot-warn'
                          "
                        ></span>
                        <span class="mono" style="font-weight: 800; color: #f8fafc;">{{ gw.name }}</span>
                        <span v-if="gw.isDefault" class="pill pill-cyan" style="margin-left: 6px; font-size: 10px;">
                          DEFAULT
                        </span>
                      </div>
                      <span
                        class="pill"
                        :class="
                          gw.status === 'online'
                            ? 'pill-ok'
                            : gw.status === 'down'
                              ? 'pill-crit'
                              : 'pill-warn'
                        "
                      >
                        {{ gw.statusText.toUpperCase() }}
                      </span>
                    </div>
                    <div class="gw-metrics mono">
                      <span>Monitor: {{ gw.address }}</span>
                      <span>RTT: <strong>{{ gw.delayMs !== null ? `${gw.delayMs} ms` : '--' }}</strong></span>
                      <span>Jitter: {{ gw.stddevMs !== null ? `${gw.stddevMs} ms` : '--' }}</span>
                      <span>Loss: <strong>{{ gw.lossPercent !== null ? `${gw.lossPercent}%` : '--' }}</strong></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- WireGuard Peers (if any) -->
            <div v-if="activeFw.wireguardPeers.length > 0" class="panel">
              <div class="panel-header">
                <span class="panel-title">WireGuard VPN Peers</span>
                <span class="panel-subtitle">{{ activeFw.wireguardPeers.length }} peers</span>
              </div>
              <table class="rack-table">
                <thead>
                  <tr>
                    <th>Peer</th>
                    <th>Interface</th>
                    <th>Endpoint</th>
                    <th>Handshake</th>
                    <th>Transfer RX / TX</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="peer in activeFw.wireguardPeers" :key="peer.name">
                    <td class="mono" style="font-weight: 700;">
                      <span class="dot" :class="peer.online ? 'dot-ok' : 'dot-muted'"></span>
                      {{ peer.name }}
                    </td>
                    <td class="mono">{{ peer.interface }}</td>
                    <td class="mono" style="color: #94a3b8;">{{ peer.endpoint }}</td>
                    <td class="mono" style="color: #94a3b8;">
                      {{ peer.latestHandshake ? formatRelativeTime(peer.latestHandshake) : 'Never' }}
                    </td>
                    <td class="mono" style="color: #22d3ee;">
                      &darr;{{ formatBytes(peer.rxBytes) }} &uarr;{{ formatBytes(peer.txBytes) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- SUB-TAB 2: INTERFACES & TRAFFIC -->
          <div v-else-if="subTab === 'interfaces'" key="opn-interfaces" class="rack-row">
            <div v-for="nic in activeFw.interfaces" :key="nic.device" class="col-6">
              <div class="panel">
                <div class="panel-header">
                  <div>
                    <div class="opn-title-line">
                      <span class="dot dot-ok"></span>
                      <span class="opn-name" style="font-size: 16px;">{{ nic.name }}</span>
                      <span class="pill pill-muted mono" style="margin-left: 8px; font-size: 10px;">
                        {{ nic.device }}
                      </span>
                    </div>
                    <div class="panel-subtitle mono" style="margin-top: 3px;">
                      {{ nic.ip4 || nic.description }}
                    </div>
                  </div>
                  <span class="pill pill-ok mono">{{ nic.status.toUpperCase() }}</span>
                </div>

                <div class="iface-rate-row">
                  <div class="iface-rate-box">
                    <div class="kpi-label">RX In</div>
                    <div class="mono iface-rate-val" style="color: #34d399;">
                      &darr; {{ formatBps(nic.inBytesPerSec) }}
                    </div>
                    <div class="kpi-sub mono">Total {{ formatBytes(nic.inBytesTotal) }}</div>
                  </div>
                  <div class="iface-rate-box">
                    <div class="kpi-label">TX Out</div>
                    <div class="mono iface-rate-val" style="color: #22d3ee;">
                      &uarr; {{ formatBps(nic.outBytesPerSec) }}
                    </div>
                    <div class="kpi-sub mono">Total {{ formatBytes(nic.outBytesTotal) }}</div>
                  </div>
                </div>

                <div class="panel-subtitle mono" style="margin-top: 8px;">
                  Errors: {{ nic.inErrors }} in / {{ nic.outErrors }} out
                </div>
              </div>
            </div>
          </div>

          <!-- SUB-TAB 3: SERVICES CONTROL -->
          <div v-else-if="subTab === 'services'" key="opn-services">
            <div class="btn-group" style="margin-bottom: 12px;">
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': svcFilter === 'all' }"
                @click="svcFilter = 'all'"
              >
                All ({{ activeFw.services.length }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-success': svcFilter === 'running' }"
                @click="svcFilter = 'running'"
              >
                Running ({{ runningServiceCount }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': svcFilter === 'stopped' }"
                @click="svcFilter = 'stopped'"
              >
                Stopped ({{ activeFw.services.length - runningServiceCount }})
              </button>
            </div>

            <div class="rack-row">
              <div v-for="svc in filteredServices" :key="svc.id" class="col-6">
                <div class="panel svc-card">
                  <div class="svc-info">
                    <div class="opn-title-line">
                      <span class="dot" :class="svc.running ? 'dot-ok' : 'dot-muted'"></span>
                      <span style="font-weight: 700; color: #f8fafc;">{{ svc.description }}</span>
                    </div>
                    <div class="panel-subtitle mono" style="margin-top: 2px;">{{ svc.name }}</div>
                  </div>
                  <div class="btn-group" style="margin-bottom: 0;">
                    <button
                      v-if="!svc.running"
                      class="btn btn-sm btn-success"
                      type="button"
                      :disabled="busySvc === svc.id"
                      @click="runServiceAction(svc.id, 'start')"
                    >
                      Start
                    </button>
                    <template v-else>
                      <button
                        class="btn btn-sm btn-warn"
                        type="button"
                        :disabled="busySvc === svc.id"
                        @click="runServiceAction(svc.id, 'restart')"
                      >
                        Restart
                      </button>
                      <button
                        class="btn btn-sm btn-danger"
                        type="button"
                        :disabled="busySvc === svc.id"
                        @click="runServiceAction(svc.id, 'stop')"
                      >
                        Stop
                      </button>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- SUB-TAB 4: FIREWALL LIVE LOG -->
          <div v-else key="opn-firewall" class="panel">
            <div class="panel-header">
              <span class="panel-title">Packet Filter Live Log</span>
              <div class="btn-group" style="margin-bottom: 0;">
                <button
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'btn-primary': logFilter === 'all' }"
                  @click="logFilter = 'all'"
                >
                  All
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'btn-danger': logFilter === 'block' }"
                  @click="logFilter = 'block'"
                >
                  Blocked
                </button>
                <button
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'btn-success': logFilter === 'pass' }"
                  @click="logFilter = 'pass'"
                >
                  Passed
                </button>
              </div>
            </div>

            <table class="rack-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Iface</th>
                  <th>Proto</th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>Rule / Label</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="log in filteredLogs" :key="log.id">
                  <td>
                    <span
                      class="pill"
                      :class="
                        log.action === 'pass'
                          ? 'pill-ok'
                          : log.action === 'block'
                            ? 'pill-crit'
                            : 'pill-cyan'
                      "
                    >
                      {{ log.action.toUpperCase() }}
                    </span>
                  </td>
                  <td class="mono">{{ log.interface }}</td>
                  <td class="mono" style="color: #94a3b8;">{{ log.proto }}</td>
                  <td class="mono">{{ log.src }}{{ log.srcPort ? `:${log.srcPort}` : '' }}</td>
                  <td class="mono" style="color: #22d3ee;">{{ log.dst }}{{ log.dstPort ? `:${log.dstPort}` : '' }}</td>
                  <td style="color: #94a3b8;">{{ log.label || '-' }}</td>
                  <td class="mono" style="color: #64748b;">{{ log.timestamp }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </transition>
      </div>
    </template>

    <!-- Confirm Reboot / Shutdown -->
    <ConfirmModal
      :open="Boolean(pendingSysAction)"
      :title="pendingSysAction === 'reboot' ? 'Reboot OPNsense Firewall' : 'Shutdown OPNsense Firewall'"
      :message="
        activeFw
          ? `Are you sure you want to ${pendingSysAction} ${activeFw.name} (${activeFw.host})? Network routing will be interrupted.`
          : ''
      "
      :confirm-label="pendingSysAction === 'reboot' ? 'Reboot Now' : 'Shutdown Now'"
      :danger="true"
      @cancel="pendingSysAction = null"
      @confirm="confirmSystemAction"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch } from 'vue';
import type { OpnsenseServiceAction, OverviewResponse } from '@shared/types';
import RadialGauge from '@/components/RadialGauge.vue';
import SparklineChart from '@/components/SparklineChart.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import { api } from '@/api/client';
import { formatBps, formatBytes, formatRelativeTime, formatTemp, formatUptime } from '@/utils/format';

export default defineComponent({
  name: 'OpnsenseView',
  components: { RadialGauge, SparklineChart, ConfirmModal },
  props: {
    overview: { type: Object as () => OverviewResponse, required: true },
    initialSubTab: {
      type: String as () => 'overview' | 'interfaces' | 'services' | 'firewall',
      default: 'overview',
    },
  },
  setup(props, { emit }) {
    const firewalls = computed(() => props.overview.opnsense || []);
    const tempUnit = computed(() => props.overview.settings.temperatureUnit);
    const selectedId = ref('');
    const subTab = ref<'overview' | 'interfaces' | 'services' | 'firewall'>(
      props.initialSubTab || 'overview',
    );
    const svcFilter = ref<'all' | 'running' | 'stopped'>('all');
    const logFilter = ref<'all' | 'block' | 'pass'>('all');
    const busySvc = ref('');
    const sysBusy = ref(false);
    const pendingSysAction = ref<'reboot' | 'halt' | null>(null);

    watch(
      () => props.initialSubTab,
      (val) => {
        if (val && val !== subTab.value) subTab.value = val;
      },
    );

    watch(subTab, (val) => {
      emit('change-sub-tab', val);
    });

    const activeId = computed(() => {
      if (selectedId.value && firewalls.value.some((f) => f.configId === selectedId.value)) {
        return selectedId.value;
      }
      return firewalls.value[0] ? firewalls.value[0].configId : '';
    });

    const activeFw = computed(
      () => firewalls.value.find((f) => f.configId === activeId.value) || null,
    );

    const runningServiceCount = computed(() =>
      activeFw.value ? activeFw.value.services.filter((s) => s.running).length : 0,
    );

    const filteredServices = computed(() => {
      if (!activeFw.value) return [];
      return activeFw.value.services.filter((s) => {
        if (svcFilter.value === 'running') return s.running;
        if (svcFilter.value === 'stopped') return !s.running;
        return true;
      });
    });

    const filteredLogs = computed(() => {
      if (!activeFw.value) return [];
      return activeFw.value.firewallLogs.filter((l) => {
        if (logFilter.value === 'all') return true;
        return l.action === logFilter.value;
      });
    });

    async function runServiceAction(serviceId: string, action: OpnsenseServiceAction) {
      if (!activeFw.value) return;
      busySvc.value = serviceId;
      try {
        const res = await api.opnsenseServiceAction(activeFw.value.configId, serviceId, action);
        emit('toast', { message: res.message, error: !res.ok });
        emit('refresh');
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Service action failed',
          error: true,
        });
      } finally {
        busySvc.value = '';
      }
    }

    async function runSystemAction(action: 'reboot' | 'halt' | 'firmware-check') {
      if (!activeFw.value) return;
      sysBusy.value = true;
      try {
        const res = await api.opnsenseSystemAction(activeFw.value.configId, action);
        emit('toast', { message: res.message, error: !res.ok });
        emit('refresh');
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'OPNsense system action failed',
          error: true,
        });
      } finally {
        sysBusy.value = false;
      }
    }

    async function confirmSystemAction() {
      if (!pendingSysAction.value) return;
      const action = pendingSysAction.value;
      pendingSysAction.value = null;
      await runSystemAction(action);
    }

    return {
      firewalls,
      tempUnit,
      selectedId,
      activeId,
      activeFw,
      subTab,
      svcFilter,
      logFilter,
      busySvc,
      sysBusy,
      pendingSysAction,
      runningServiceCount,
      filteredServices,
      filteredLogs,
      runServiceAction,
      runSystemAction,
      confirmSystemAction,
      formatBytes,
      formatBps,
      formatUptime,
      formatTemp,
      formatRelativeTime,
    };
  },
});
</script>

<style scoped lang="scss">
.opn-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.opn-chip {
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

  &.active {
    background: linear-gradient(180deg, rgba(34, 211, 238, 0.2) 0%, rgba(8, 145, 178, 0.12) 100%);
    border-color: #22d3ee;
    color: #ffffff;
  }
}

.opn-id-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
}

.opn-title-line {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.opn-name {
  margin: 0;
  font-size: 19px;
  font-weight: 800;
  color: #f8fafc;
}

.opn-meta {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 6px;
}

.opn-gauge-tile {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 132px;
}

.opn-gauge-meta {
  margin-left: 14px;
  min-width: 0;
}

.opn-big {
  font-size: 19px;
  font-weight: 800;
  color: #f8fafc;
  margin: 4px 0;
}

.gw-box {
  background: #0b1019;
  border: 1px solid #1f2a40;
  border-radius: 4px;
  padding: 12px 14px;
}

.gw-metrics {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: space-between;
  font-size: 12px;
  color: #94a3b8;
}

.iface-rate-row {
  display: flex;
  flex-direction: row;
}

.iface-rate-box {
  flex: 1;
  background: #0b1019;
  border: 1px solid #1f2a40;
  border-radius: 4px;
  padding: 10px 12px;
  margin-right: 8px;

  &:last-child {
    margin-right: 0;
  }
}

.iface-rate-val {
  font-size: 16px;
  font-weight: 800;
  margin: 4px 0;
}

.svc-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.svc-info {
  margin-right: 10px;
}

.empty-state {
  text-align: center;
  padding: 36px 20px;
  color: #94a3b8;
}
</style>
