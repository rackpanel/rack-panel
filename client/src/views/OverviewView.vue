<template>
  <div>
    <!-- Header Bar -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">Rack Command Center</h2>
        <div class="panel-subtitle">
          Unified real-time telemetry across SSH hosts and Proxmox VE clusters
        </div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" type="button" @click="$emit('add-server')">
          + Add SSH Server
        </button>
        <button class="btn" type="button" @click="$emit('add-proxmox')">
          + Add Proxmox VE
        </button>
        <button class="btn" type="button" @click="$emit('add-opnsense')">
          + OPNsense
        </button>
        <button class="btn" type="button" @click="$emit('add-tailscale')">
          + Tailscale
        </button>
      </div>
    </div>

    <!-- Top Fleet Gauges & KPIs -->
    <div class="rack-row">
      <div class="col-3">
        <div class="panel gauge-tile">
          <RadialGauge :value="summary.avgCpuPercent" :size="108" label="Fleet CPU" />
          <div class="gauge-meta">
            <div class="kpi-label">Compute Load</div>
            <div class="mono meta-big">{{ summary.avgCpuPercent.toFixed(1) }}%</div>
            <div class="kpi-sub">
              {{ summary.onlineServers }}/{{ summary.totalServers }} SSH &middot;
              {{ summary.onlineProxmoxNodes }}/{{ summary.totalProxmoxNodes }} PVE
            </div>
          </div>
        </div>
      </div>

      <div class="col-3">
        <div class="panel gauge-tile">
          <RadialGauge
            :value="fleetMemPercent"
            :size="108"
            label="Fleet RAM"
            color="#a78bfa"
          />
          <div class="gauge-meta">
            <div class="kpi-label">Memory Used</div>
            <div class="mono meta-big">{{ formatBytes(summary.totalMemUsedBytes) }}</div>
            <div class="kpi-sub">of {{ formatBytes(summary.totalMemBytes) }} total</div>
          </div>
        </div>
      </div>

      <div class="col-3">
        <div class="panel gauge-tile">
          <RadialGauge
            :value="fleetStoragePercent"
            :size="108"
            label="Storage"
            color="#34d399"
          />
          <div class="gauge-meta">
            <div class="kpi-label">Disk Capacity</div>
            <div class="mono meta-big">{{ formatBytes(summary.totalStorageUsedBytes) }}</div>
            <div class="kpi-sub">of {{ formatBytes(summary.totalStorageBytes) }} mounted</div>
          </div>
        </div>
      </div>

      <div class="col-3">
        <div class="panel kpi-card">
          <div>
            <div class="kpi-label">Proxmox Guests &amp; Net I/O</div>
            <div class="guest-pills">
              <span class="pill pill-cyan" style="margin-right: 6px; margin-bottom: 4px;">
                VMs {{ summary.runningVms }}/{{ summary.totalVms }}
              </span>
              <span class="pill pill-violet" style="margin-right: 6px; margin-bottom: 4px;">
                LXC {{ summary.runningLxcs }}/{{ summary.totalLxcs }}
              </span>
              <span
                v-if="summary.tailscaleTotalDevices > 0"
                class="pill pill-ok"
                style="margin-right: 6px; margin-bottom: 4px; cursor: pointer;"
                @click="$emit('navigate', 'tailscale')"
              >
                TS {{ summary.tailscaleOnlineDevices }}/{{ summary.tailscaleTotalDevices }}
              </span>
              <span
                v-if="summary.opnsenseGatewaysTotal > 0"
                class="pill"
                :class="summary.opnsenseGatewaysOnline === summary.opnsenseGatewaysTotal ? 'pill-ok' : 'pill-crit'"
                style="margin-bottom: 4px; cursor: pointer;"
                @click="$emit('navigate', 'opnsense')"
              >
                GW {{ summary.opnsenseGatewaysOnline }}/{{ summary.opnsenseGatewaysTotal }}
              </span>
            </div>
          </div>
          <div class="net-readout mono">
            <span class="net-rx">&darr; {{ formatBps(summary.totalNetRxBps) }}</span>
            <span class="net-tx">&uarr; {{ formatBps(summary.totalNetTxBps) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- System Health / Alerts Strip -->
    <div class="panel" style="margin-bottom: 16px;">
      <div class="panel-header" style="margin-bottom: 8px;">
        <span class="panel-title">Rack Health &amp; Telemetry Alerts</span>
        <span class="pill" :class="alerts.length === 0 ? 'pill-ok' : 'pill-warn'">
          <span class="dot" :class="alerts.length === 0 ? 'dot-ok pulse' : 'dot-warn pulse'"></span>
          {{ alerts.length === 0 ? 'ALL SYSTEMS NOMINAL' : `${alerts.length} ACTIVE ALERT${alerts.length === 1 ? '' : 'S'}` }}
        </span>
      </div>
      <div v-if="alerts.length === 0" class="nominal-msg">
        Every monitored SSH host and Proxmox VE node is operating within normal thermal, CPU, RAM, and disk thresholds.
      </div>
      <div v-else>
        <div
          v-for="a in alerts.slice(0, 5)"
          :key="a.id"
          class="alert-row"
          :class="a.severity === 'critical' ? 'alert-critical' : 'alert-warning'"
        >
          <div>
            <strong>[{{ a.source }}]</strong> {{ a.message }}
          </div>
          <span class="mono" style="font-size: 11px;">{{ a.severity.toUpperCase() }}</span>
        </div>
      </div>
    </div>

    <!-- SSH Servers Fleet Grid -->
    <div class="section-bar" style="margin-top: 6px;">
      <h3 class="sub-heading">SSH Managed Servers ({{ servers.length }})</h3>
      <button class="btn btn-sm" type="button" @click="$emit('navigate', 'servers')">
        Open Servers Console &rarr;
      </button>
    </div>

    <div v-if="servers.length === 0" class="panel empty-card" style="margin-bottom: 18px;">
      <p>No SSH servers configured yet. Tap below to add any Linux server by IP address and SSH login.</p>
      <button class="btn btn-primary" type="button" @click="$emit('add-server')">+ Add First SSH Server</button>
    </div>

    <div v-else class="rack-row">
      <div v-for="item in servers" :key="item.config.id" class="col-4">
        <div
          class="panel panel-clickable host-card"
          @click="$emit('select-server', item.config.id)"
        >
          <div class="panel-header">
            <div class="host-title-block">
              <div class="host-name-row">
                <span
                  class="dot"
                  :class="
                    item.metrics.status === 'online'
                      ? 'dot-ok'
                      : item.metrics.status === 'error'
                        ? 'dot-crit'
                        : 'dot-warn'
                  "
                ></span>
                <span class="host-name">{{ item.config.name }}</span>
                <span v-if="item.config.rackUnit" class="pill pill-muted rack-u-badge">
                  {{ item.config.rackUnit }}
                </span>
              </div>
              <div class="host-ip mono">
                <template v-if="item.config.username">{{ item.config.username }}@</template>{{ item.config.host }}:{{ item.config.port }}
                <span v-if="item.config.authMethod === 'tailscale'" style="color: #22d3ee;"> &middot; TS-SSH</span>
              </div>
            </div>
            <span v-if="item.metrics.maxTempC !== null" class="pill pill-cyan mono">
              {{ formatTemp(item.metrics.maxTempC, tempUnit) }}
            </span>
          </div>

          <div v-if="item.metrics.status === 'error'" class="error-inline">
            {{ item.metrics.errorMessage || 'SSH connection failed' }}
          </div>
          <template v-else>
            <div style="margin-bottom: 10px;">
              <ProgressBar
                :percent="item.metrics.cpuPercent"
                label="CPU"
                :right-text="`${item.metrics.cpuPercent.toFixed(1)}% (${item.metrics.cpuCores}c)`"
              />
            </div>
            <div style="margin-bottom: 10px;">
              <ProgressBar
                :percent="item.metrics.memPercent"
                label="RAM"
                :right-text="`${formatBytes(item.metrics.memUsedBytes)} / ${formatBytes(item.metrics.memTotalBytes)}`"
                tone="violet"
              />
            </div>
            <SparklineChart
              :values="item.metrics.history.map((h) => h.cpuPercent)"
              :height="44"
              stroke-color="#22d3ee"
              fill-color="rgba(34, 211, 238, 0.14)"
            />
            <div class="host-footer mono">
              <span>UP {{ formatUptime(item.metrics.uptimeSeconds) }}</span>
              <span>
                &darr;{{ formatBps(item.metrics.netTotalRxBps) }} &uarr;{{ formatBps(item.metrics.netTotalTxBps) }}
              </span>
            </div>
            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #1f2a40;">
              <button
                class="btn btn-sm"
                type="button"
                @click.stop="$emit('open-terminal', { kind: 'ssh', serverId: item.config.id, title: `${item.config.name} (${item.config.host})` })"
              >
                &gt;_ Terminal
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Proxmox VE Clusters Grid -->
    <div class="section-bar" style="margin-top: 6px;">
      <h3 class="sub-heading">Proxmox VE Clusters ({{ proxmox.length }})</h3>
      <button class="btn btn-sm" type="button" @click="$emit('navigate', 'proxmox')">
        Open Proxmox Control &rarr;
      </button>
    </div>

    <div v-if="proxmox.length === 0" class="panel empty-card">
      <p>No Proxmox VE host connected yet. Connect via API Token or Username/Password.</p>
      <button class="btn btn-primary" type="button" @click="$emit('add-proxmox')">+ Connect Proxmox VE</button>
    </div>

    <div v-else class="rack-row">
      <div v-for="cluster in proxmox" :key="cluster.configId" class="col-6">
        <div class="panel panel-clickable" @click="$emit('navigate', 'proxmox')">
          <div class="panel-header">
            <div>
              <div class="host-name-row">
                <span
                  class="dot"
                  :class="cluster.status === 'online' ? 'dot-ok' : 'dot-crit'"
                ></span>
                <span class="host-name">{{ cluster.clusterName }}</span>
                <span v-if="cluster.isDemo" class="pill pill-muted" style="margin-left: 8px;">DEMO</span>
              </div>
              <div class="host-ip mono">{{ cluster.host }} &middot; {{ cluster.nodes.length }} Nodes</div>
            </div>
            <span class="pill" :class="cluster.quorate ? 'pill-ok' : 'pill-warn'">
              {{ cluster.quorate ? 'QUORATE' : 'STANDALONE' }}
            </span>
          </div>

          <div v-if="cluster.status === 'error'" class="error-inline">
            {{ cluster.errorMessage || 'Unable to reach Proxmox API' }}
          </div>
          <div v-else class="rack-row" style="margin-bottom: -12px;">
            <div v-for="node in cluster.nodes" :key="node.node" class="col-6" style="margin-bottom: 12px;">
              <div class="pve-mini-node">
                <div class="pve-mini-head">
                  <span class="mono" style="font-weight: 700;">{{ node.node }}</span>
                  <span class="pill pill-ok" style="font-size: 11px; padding: 2px 8px;">
                    PVE {{ node.pveVersion }}
                  </span>
                </div>
                <div style="margin-bottom: 8px;">
                  <ProgressBar
                    :percent="node.cpuPercent"
                    label="CPU"
                    :right-text="`${node.cpuPercent.toFixed(1)}%`"
                  />
                </div>
                <ProgressBar
                  :percent="node.memPercent"
                  label="RAM"
                  :right-text="`${formatBytes(node.memUsedBytes)} / ${formatBytes(node.memTotalBytes)}`"
                  tone="violet"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';
import type { OverviewResponse } from '@shared/types';
import RadialGauge from '@/components/RadialGauge.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import SparklineChart from '@/components/SparklineChart.vue';
import { formatBps, formatBytes, formatTemp, formatUptime } from '@/utils/format';

export default defineComponent({
  name: 'OverviewView',
  components: { RadialGauge, ProgressBar, SparklineChart },
  props: {
    overview: { type: Object as () => OverviewResponse, required: true },
  },
  setup(props) {
    const summary = computed(() => props.overview.summary);
    const servers = computed(() => props.overview.servers);
    const proxmox = computed(() => props.overview.proxmox);
    const alerts = computed(() => props.overview.alerts);
    const tempUnit = computed(() => props.overview.settings.temperatureUnit);

    const fleetMemPercent = computed(() => {
      if (!summary.value.totalMemBytes) return 0;
      return Math.round((summary.value.totalMemUsedBytes / summary.value.totalMemBytes) * 1000) / 10;
    });

    const fleetStoragePercent = computed(() => {
      if (!summary.value.totalStorageBytes) return 0;
      return Math.round((summary.value.totalStorageUsedBytes / summary.value.totalStorageBytes) * 1000) / 10;
    });

    return {
      summary,
      servers,
      proxmox,
      alerts,
      tempUnit,
      fleetMemPercent,
      fleetStoragePercent,
      formatBytes,
      formatBps,
      formatUptime,
      formatTemp,
    };
  },
});
</script>

<style scoped lang="scss">
.gauge-tile {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 136px;
}

.gauge-meta {
  margin-left: 14px;
  min-width: 0;
}

.meta-big {
  font-size: 20px;
  font-weight: 800;
  color: #f8fafc;
  margin: 4px 0;
}

.guest-pills {
  margin-top: 10px;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.net-readout {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid #1f2a40;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
}

.net-rx {
  color: #34d399;
}

.net-tx {
  color: #22d3ee;
}

.nominal-msg {
  font-size: 13px;
  color: #94a3b8;
}

.sub-heading {
  font-size: 16px;
  font-weight: 700;
  color: #e2e8f0;
  margin: 0;
}

.host-title-block {
  min-width: 0;
}

.host-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.host-name {
  font-size: 16px;
  font-weight: 700;
  color: #f8fafc;
}

.rack-u-badge {
  margin-left: 8px;
  font-size: 10px;
  padding: 2px 7px;
}

.host-ip {
  font-size: 12px;
  color: #64748b;
  margin-top: 3px;
}

.host-footer {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 12px;
  color: #94a3b8;
}

.pve-mini-node {
  background: #0d1320;
  border: 1px solid #1f2a40;
  border-radius: 4px;
  padding: 12px;
}

.pve-mini-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.error-inline {
  padding: 10px 12px;
  border-radius: 4px;
  background: rgba(220, 38, 38, 0.14);
  border: 1px solid rgba(248, 113, 113, 0.35);
  color: #fecaca;
  font-size: 13px;
}

.empty-card {
  text-align: center;
  padding: 28px 18px;
  color: #94a3b8;
}
</style>
