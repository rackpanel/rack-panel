<template>
  <div>
    <!-- Header Bar -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">Rack Command Center</h2>
        <div class="panel-subtitle">
          Unified real-time telemetry across compute, power, containers, network, and security
        </div>
      </div>
      <div class="btn-group">
        <button
          class="btn"
          :class="layout.editMode.value ? 'btn-primary' : ''"
          type="button"
          @click="layout.toggleEditMode()"
        >
          {{ layout.editMode.value ? 'Done Customizing' : 'Customize Layout' }}
        </button>
        <button
          v-if="layout.editMode.value"
          class="btn"
          type="button"
          @click="layout.resetLayout()"
        >
          Reset Layout
        </button>
        <button class="btn btn-primary" type="button" @click="$emit('add-server')">
          + SSH
        </button>
        <button class="btn" type="button" @click="$emit('add-proxmox')">
          + Proxmox
        </button>
        <button class="btn" type="button" @click="$emit('add-ups')">
          + Power / UPS
        </button>
        <button class="btn" type="button" @click="$emit('add-unifi')">
          + UniFi
        </button>
        <button class="btn" type="button" @click="$emit('add-opnsense')">
          + OPNsense
        </button>
        <button class="btn" type="button" @click="$emit('add-hikvision')">
          + Hikvision
        </button>
        <button class="btn" type="button" @click="$emit('add-tailscale')">
          + Tailscale
        </button>
      </div>
    </div>

    <!-- Customize Mode Hint & Hidden Panels Bar -->
    <div v-if="layout.editMode.value" class="panel customize-banner">
      <div class="customize-banner-row">
        <span class="mono" style="color: #67e8f9; font-size: 12px; font-weight: 700;">
          CUSTOMIZE MODE: Drag panels to reorder, use 1/4–Full width pills or S/M/L height pills, or hide panels. Changes save automatically.
        </span>
      </div>
      <div v-if="layout.hiddenPanels.value.length > 0" class="customize-hidden-row">
        <span class="mono" style="font-size: 11px; color: #94a3b8;">Hidden Panels:</span>
        <button
          v-for="hp in layout.hiddenPanels.value"
          :key="hp.id"
          class="btn btn-sm"
          type="button"
          @click="layout.showPanel(hp.id)"
        >
          + {{ hp.title }}
        </button>
      </div>
    </div>

    <!-- Customizable Bento Dashboard Grid -->
    <div class="rack-row">
      <CustomizablePanel
        v-for="panelId in layout.visibleIds.value"
        :key="panelId"
        :panel-id="panelId"
        :title="panelTitle(panelId)"
        :col-span="layout.getColSpan(panelId)"
        :height="layout.getHeight(panelId)"
        :edit-mode="layout.editMode.value"
        :is-dragging="layout.draggedId.value === panelId"
        :is-drag-over="layout.dragOverId.value === panelId"
        @drag-start="layout.onDragStart(panelId, $event)"
        @drag-over="layout.onDragOver(panelId, $event)"
        @drag-leave="layout.onDragLeave(panelId)"
        @drop="layout.onDrop(panelId, $event)"
        @drag-end="layout.onDragEnd()"
        @resize="layout.setColSpan(panelId, $event)"
        @cycle-size="layout.cycleColSpan(panelId)"
        @set-height="layout.setHeight(panelId, $event)"
        @move-step="layout.moveStep(panelId, $event)"
        @hide="layout.toggleHide(panelId)"
      >
        <!-- 1. Fleet CPU Gauge -->
        <div v-if="panelId === 'cpu_gauge'" class="panel gauge-tile">
          <RadialGauge :value="summary.avgCpuPercent" :size="98" :stroke-width="10" label="CPU" />
          <div class="gauge-meta">
            <div class="panel-title">Fleet CPU</div>
            <div class="meta-big mono">{{ summary.onlineServers }} / {{ summary.totalServers }}</div>
            <div class="panel-subtitle">SSH Hosts Online</div>
            <div class="panel-subtitle" style="margin-top: 2px;">
              {{ summary.onlineProxmoxNodes }} / {{ summary.totalProxmoxNodes }} PVE Nodes
            </div>
          </div>
        </div>

        <!-- 2. Fleet Memory Gauge -->
        <div v-else-if="panelId === 'ram_gauge'" class="panel gauge-tile">
          <RadialGauge
            :value="fleetMemPercent"
            :size="98"
            :stroke-width="10"
            label="RAM"
            color="#a78bfa"
          />
          <div class="gauge-meta">
            <div class="panel-title">Fleet Memory</div>
            <div class="meta-big mono">{{ formatBytes(summary.totalMemUsedBytes) }}</div>
            <div class="panel-subtitle">of {{ formatBytes(summary.totalMemBytes) }}</div>
          </div>
        </div>

        <!-- 3. Fleet Storage Gauge -->
        <div v-else-if="panelId === 'storage_gauge'" class="panel gauge-tile">
          <RadialGauge
            :value="fleetStoragePercent"
            :size="98"
            :stroke-width="10"
            label="DISK"
            color="#34d399"
          />
          <div class="gauge-meta">
            <div class="panel-title">Storage Pool</div>
            <div class="meta-big mono">{{ formatBytes(summary.totalStorageUsedBytes) }}</div>
            <div class="panel-subtitle">of {{ formatBytes(summary.totalStorageBytes) }}</div>
          </div>
        </div>

        <!-- 4. Workloads & Network Throughput -->
        <div v-else-if="panelId === 'net_workload'" class="panel">
          <div class="panel-header" style="margin-bottom: 8px;">
            <span class="panel-title">Workloads &amp; Network</span>
            <span class="pill pill-cyan">LIVE</span>
          </div>
          <div class="guest-pills">
            <span class="pill pill-ok" style="margin-right: 6px; margin-bottom: 6px;">
              {{ summary.runningVms }}/{{ summary.totalVms }} VMs
            </span>
            <span class="pill pill-cyan" style="margin-bottom: 6px;">
              {{ summary.runningLxcs }}/{{ summary.totalLxcs }} LXCs
            </span>
          </div>
          <div class="net-readout mono">
            <span class="net-rx">&darr; {{ formatBps(summary.totalNetRxBps) }}</span>
            <span class="net-tx">&uarr; {{ formatBps(summary.totalNetTxBps) }}</span>
          </div>
        </div>

        <!-- 5. Power & UPS / Tesla Powerwall -->
        <div v-else-if="panelId === 'power_ups'" class="panel panel-clickable" @click="$emit('navigate', 'ups')">
          <div class="panel-header">
            <div>
              <span class="panel-title">Power &amp; Energy (UPS / Powerwall)</span>
              <div class="panel-subtitle">{{ upsList.length }} configured power unit{{ upsList.length === 1 ? '' : 's' }}</div>
            </div>
            <span class="pill" :class="powerSummary.onBattery ? 'pill-warn' : upsList.length ? 'pill-ok' : 'pill-muted'">
              {{ upsList.length === 0 ? 'NONE' : powerSummary.onBattery ? 'ON BATTERY' : 'LINE OK' }}
            </span>
          </div>
          <div v-if="upsList.length === 0" class="nominal-msg">
            No UPS or Tesla Powerwall added yet. Click + Power / UPS or click here to open Power Monitor.
          </div>
          <div v-else class="subsys-grid">
            <div class="subsys-kpi">
              <div class="subsys-kpi-label">AVG BATTERY</div>
              <div class="subsys-kpi-val mono" style="color: #34d399;">
                {{ powerSummary.avgBattery !== null ? `${Math.round(powerSummary.avgBattery)}%` : '—' }}
              </div>
            </div>
            <div class="subsys-kpi">
              <div class="subsys-kpi-label">TOTAL LOAD</div>
              <div class="subsys-kpi-val mono" style="color: #22d3ee;">
                {{ powerSummary.totalLoadW !== null ? `${Math.round(powerSummary.totalLoadW)}W` : '—' }}
              </div>
            </div>
            <div v-if="powerSummary.totalSolarW !== null" class="subsys-kpi">
              <div class="subsys-kpi-label">SOLAR GEN</div>
              <div class="subsys-kpi-val mono" style="color: #fbbf24;">
                {{ Math.round(powerSummary.totalSolarW) }}W
              </div>
            </div>
          </div>
          <div v-if="upsList.length > 0" class="mini-chip-list">
            <span v-for="u in upsList.slice(0, 4)" :key="u.configId" class="mini-chip mono">
              <span class="dot" :class="u.status === 'online' ? 'dot-ok' : 'dot-crit'"></span>
              {{ u.name }}
              <template v-if="u.batteryChargePercent !== null"> ({{ Math.round(u.batteryChargePercent) }}%)</template>
            </span>
          </div>
        </div>

        <!-- 6. Docker Fleet -->
        <div v-else-if="panelId === 'docker_fleet'" class="panel panel-clickable" @click="$emit('navigate', 'docker')">
          <div class="panel-header">
            <div>
              <span class="panel-title">Docker &amp; Containers</span>
              <div class="panel-subtitle">{{ dockerHosts.length }} Docker host{{ dockerHosts.length === 1 ? '' : 's' }}</div>
            </div>
            <span class="pill" :class="dockerStats.running > 0 ? 'pill-ok' : 'pill-muted'">
              {{ dockerStats.running }}/{{ dockerStats.total }} RUNNING
            </span>
          </div>
          <div v-if="dockerHosts.length === 0" class="nominal-msg">
            No Docker hosts connected yet. Open Docker Console to inspect containers across SSH hosts.
          </div>
          <div v-else class="subsys-grid">
            <div class="subsys-kpi">
              <div class="subsys-kpi-label">HOSTS ONLINE</div>
              <div class="subsys-kpi-val mono" style="color: #38bdf8;">
                {{ dockerStats.onlineHosts }}/{{ dockerHosts.length }}
              </div>
            </div>
            <div class="subsys-kpi">
              <div class="subsys-kpi-label">CONTAINERS</div>
              <div class="subsys-kpi-val mono" style="color: #34d399;">
                {{ dockerStats.running }}/{{ dockerStats.total }}
              </div>
            </div>
            <div class="subsys-kpi">
              <div class="subsys-kpi-label">IMAGES</div>
              <div class="subsys-kpi-val mono" style="color: #a78bfa;">
                {{ dockerStats.images }}
              </div>
            </div>
          </div>
        </div>

        <!-- 7. Network, UniFi, OPNsense & Tailscale -->
        <div v-else-if="panelId === 'network_security'" class="panel">
          <div class="panel-header">
            <div>
              <span class="panel-title">Network, Firewall &amp; Mesh</span>
              <div class="panel-subtitle">UniFi, OPNsense &amp; Tailscale live status</div>
            </div>
            <button class="btn btn-sm" type="button" @click="$emit('navigate', 'topology')">
              Topology &rarr;
            </button>
          </div>
          <div class="subsys-grid">
            <div class="subsys-kpi subsys-click" @click="$emit('navigate', 'unifi')">
              <div class="subsys-kpi-label">UNIFI DEVICES</div>
              <div class="subsys-kpi-val mono" style="color: #38bdf8;">
                {{ unifiStats.devicesOnline }}/{{ unifiStats.devicesTotal }}
              </div>
              <div class="panel-subtitle">{{ unifiStats.clients }} clients</div>
            </div>
            <div class="subsys-kpi subsys-click" @click="$emit('navigate', 'opnsense')">
              <div class="subsys-kpi-label">OPNSENSE GW</div>
              <div class="subsys-kpi-val mono" style="color: #fb923c;">
                {{ summary.opnsenseGatewaysOnline }}/{{ summary.opnsenseGatewaysTotal }}
              </div>
              <div class="panel-subtitle">{{ summary.opnsenseOnline }}/{{ summary.opnsenseTotal }} nodes</div>
            </div>
            <div class="subsys-kpi subsys-click" @click="$emit('navigate', 'tailscale')">
              <div class="subsys-kpi-label">TAILNET</div>
              <div class="subsys-kpi-val mono" style="color: #34d399;">
                {{ summary.tailscaleOnlineDevices }}/{{ summary.tailscaleTotalDevices }}
              </div>
              <div class="panel-subtitle">peers online</div>
            </div>
          </div>
        </div>

        <!-- 8. Hikvision CCTV -->
        <div v-else-if="panelId === 'cctv_hikvision'" class="panel panel-clickable" @click="$emit('navigate', 'hikvision')">
          <div class="panel-header">
            <div>
              <span class="panel-title">Hikvision CCTV &amp; NVR</span>
              <div class="panel-subtitle">{{ summary.hikvisionOnline }}/{{ summary.hikvisionTotal }} NVR online</div>
            </div>
            <span class="pill" :class="summary.hikvisionCamerasOnline > 0 ? 'pill-ok' : 'pill-muted'">
              {{ summary.hikvisionCamerasOnline }}/{{ summary.hikvisionCamerasTotal }} CAMS
            </span>
          </div>
          <div v-if="hikvisionList.length === 0" class="nominal-msg">
            No Hikvision NVRs configured yet. Click + Hikvision to monitor IP cameras and storage.
          </div>
          <div v-else class="mini-chip-list">
            <span v-for="hv in hikvisionList" :key="hv.configId" class="mini-chip mono">
              <span class="dot" :class="hv.status === 'online' ? 'dot-ok' : 'dot-crit'"></span>
              {{ hv.name }} &middot; {{ hv.onlineChannels }}/{{ hv.totalChannels }} cams
            </span>
          </div>
        </div>

        <!-- 9. Alerts Panel -->
        <div v-else-if="panelId === 'alerts_panel'" class="panel">
          <div class="panel-header">
            <div>
              <span class="panel-title">Rack Health &amp; Telemetry Alerts</span>
              <div class="panel-subtitle">Threshold checks across CPU, RAM, Temperature, and Power</div>
            </div>
            <span class="pill" :class="alerts.length === 0 ? 'pill-ok' : 'pill-crit'">
              {{ alerts.length === 0 ? 'ALL SYSTEMS NOMINAL' : `${alerts.length} ACTIVE` }}
            </span>
          </div>
          <div v-if="alerts.length === 0" class="nominal-msg">
            No threshold breaches detected across connected hosts, clusters, or power hardware.
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

        <!-- 10. SSH Servers Fleet Panel -->
        <div v-else-if="panelId === 'ssh_servers'" class="panel">
          <div class="panel-header">
            <div>
              <span class="panel-title">SSH Managed Servers ({{ servers.length }})</span>
              <div class="panel-subtitle">Real-time CPU, RAM, temperature, and quick terminal</div>
            </div>
            <button class="btn btn-sm" type="button" @click="$emit('navigate', 'servers')">
              Open Servers Console &rarr;
            </button>
          </div>

          <div v-if="servers.length === 0" class="empty-card">
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
        </div>

        <!-- 11. Proxmox VE Clusters Panel -->
        <div v-else-if="panelId === 'proxmox_clusters'" class="panel">
          <div class="panel-header">
            <div>
              <span class="panel-title">Proxmox VE Clusters ({{ proxmox.length }})</span>
              <div class="panel-subtitle">Hypervisor nodes, CPU &amp; RAM allocation</div>
            </div>
            <button class="btn btn-sm" type="button" @click="$emit('navigate', 'proxmox')">
              Open Proxmox Control &rarr;
            </button>
          </div>

          <div v-if="proxmox.length === 0" class="empty-card">
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
      </CustomizablePanel>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onMounted } from 'vue';
import type { DockerHostSnapshot, OverviewResponse } from '@shared/types';
import { api } from '@/api/client';
import RadialGauge from '@/components/RadialGauge.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import SparklineChart from '@/components/SparklineChart.vue';
import CustomizablePanel from '@/components/ui/CustomizablePanel.vue';
import { usePanelLayout, PanelDefaultConfig } from '@/composables/usePanelLayout';
import { formatBps, formatBytes, formatTemp, formatUptime } from '@/utils/format';

const OVERVIEW_PANELS: PanelDefaultConfig[] = [
  { id: 'cpu_gauge', title: 'Fleet CPU', colSpan: 3 },
  { id: 'ram_gauge', title: 'Fleet Memory', colSpan: 3 },
  { id: 'storage_gauge', title: 'Storage Pool', colSpan: 3 },
  { id: 'net_workload', title: 'Workloads & Network', colSpan: 3 },
  { id: 'power_ups', title: 'Power & Energy', colSpan: 6 },
  { id: 'docker_fleet', title: 'Docker & Containers', colSpan: 6 },
  { id: 'network_security', title: 'Network, Firewall & Mesh', colSpan: 6 },
  { id: 'cctv_hikvision', title: 'Hikvision CCTV', colSpan: 6 },
  { id: 'alerts_panel', title: 'Rack Health & Alerts', colSpan: 12 },
  { id: 'ssh_servers', title: 'SSH Managed Servers', colSpan: 12 },
  { id: 'proxmox_clusters', title: 'Proxmox VE Clusters', colSpan: 12 },
];

export default defineComponent({
  name: 'OverviewView',
  components: { RadialGauge, ProgressBar, SparklineChart, CustomizablePanel },
  props: {
    overview: { type: Object as () => OverviewResponse, required: true },
  },
  setup(props) {
    const layout = usePanelLayout('overview_v1', OVERVIEW_PANELS);
    const dockerHosts = ref<DockerHostSnapshot[]>([]);

    onMounted(async () => {
      try {
        dockerHosts.value = await api.getDockerHosts();
      } catch {
        // Docker hosts optional
      }
    });

    const summary = computed(() => props.overview.summary);
    const servers = computed(() => props.overview.servers);
    const proxmox = computed(() => props.overview.proxmox);
    const alerts = computed(() => props.overview.alerts);
    const upsList = computed(() => props.overview.ups || []);
    const hikvisionList = computed(() => props.overview.hikvision || []);
    const tempUnit = computed(() => props.overview.settings.temperatureUnit);

    const fleetMemPercent = computed(() => {
      if (!summary.value.totalMemBytes) return 0;
      return Math.round((summary.value.totalMemUsedBytes / summary.value.totalMemBytes) * 1000) / 10;
    });

    const fleetStoragePercent = computed(() => {
      if (!summary.value.totalStorageBytes) return 0;
      return Math.round((summary.value.totalStorageUsedBytes / summary.value.totalStorageBytes) * 1000) / 10;
    });

    const powerSummary = computed(() => {
      let batterySum = 0;
      let batteryCount = 0;
      let loadSum = 0;
      let loadCount = 0;
      let solarSum = 0;
      let solarCount = 0;
      let onBattery = false;

      for (const u of upsList.value) {
        if (u.batteryChargePercent !== null && u.batteryChargePercent !== undefined) {
          batterySum += u.batteryChargePercent;
          batteryCount += 1;
        }
        if (u.outputWatts !== null && u.outputWatts !== undefined) {
          loadSum += u.outputWatts;
          loadCount += 1;
        }
        if (u.solarWatts !== null && u.solarWatts !== undefined) {
          solarSum += u.solarWatts;
          solarCount += 1;
        }
        if (u.status === 'on-battery' || u.status === 'low-battery' || u.outputSource === 'battery') {
          onBattery = true;
        }
      }

      return {
        onBattery,
        avgBattery: batteryCount > 0 ? batterySum / batteryCount : null,
        totalLoadW: loadCount > 0 ? loadSum : null,
        totalSolarW: solarCount > 0 ? solarSum : null,
      };
    });

    const dockerStats = computed(() => {
      let onlineHosts = 0;
      let running = 0;
      let total = 0;
      let images = 0;
      for (const h of dockerHosts.value) {
        if (h.status === 'online') onlineHosts += 1;
        running += h.containers.filter((c) => c.state === 'running').length;
        total += h.containers.length;
        images += h.images.length;
      }
      return { onlineHosts, running, total, images };
    });

    const unifiStats = computed(() => {
      const list = props.overview.unifi || [];
      let devicesOnline = 0;
      let devicesTotal = 0;
      let clients = 0;
      for (const u of list) {
        devicesOnline += u.onlineDevices;
        devicesTotal += u.totalDevices;
        clients += u.totalClients;
      }
      return { devicesOnline, devicesTotal, clients };
    });

    function panelTitle(id: string): string {
      const found = OVERVIEW_PANELS.find((p) => p.id === id);
      return found ? found.title : id;
    }

    return {
      layout,
      panelTitle,
      summary,
      servers,
      proxmox,
      alerts,
      upsList,
      hikvisionList,
      dockerHosts,
      dockerStats,
      unifiStats,
      powerSummary,
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
.customize-banner {
  margin-bottom: 14px;
  border-color: rgba(34, 211, 238, 0.45);
  background: rgba(15, 23, 42, 0.85);
}

.customize-banner-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.customize-hidden-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #1f2a40;
}

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

.subsys-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 4px;
}

.subsys-kpi {
  flex: 1;
  min-width: 95px;
  background: #0d1320;
  border: 1px solid #1f2a40;
  border-radius: 6px;
  padding: 10px 12px;
}

.subsys-click {
  cursor: pointer;
}

.subsys-click:hover {
  border-color: rgba(34, 211, 238, 0.5);
}

.subsys-kpi-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #64748b;
}

.subsys-kpi-val {
  font-size: 20px;
  font-weight: 800;
  margin-top: 4px;
}

.mini-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.mini-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #cbd5e1;
  background: #0d1320;
  border: 1px solid #1f2a40;
  border-radius: 999px;
  padding: 4px 10px;
}

.nominal-msg {
  font-size: 13px;
  color: #94a3b8;
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
  padding: 24px 18px;
  color: #94a3b8;
}
</style>
