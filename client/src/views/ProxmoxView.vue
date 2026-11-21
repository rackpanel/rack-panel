<template>
  <div>
    <!-- Section Header -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">Proxmox VE Cluster Control</h2>
        <div class="panel-subtitle">
          Hypervisor nodes, QEMU VMs, LXC containers, storage pools, live tasks, and power actions
        </div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" type="button" @click="$emit('add-proxmox')">
          + Connect Proxmox VE
        </button>
      </div>
    </div>

    <div v-if="clusters.length === 0" class="panel empty-state">
      <h3>No Proxmox VE Cluster Connected</h3>
      <p>Connect your Proxmox VE host (port 8006) using an API Token or username/password to view nodes, storage, tasks, and control VMs &amp; LXCs.</p>
      <button class="btn btn-primary btn-lg" type="button" @click="$emit('add-proxmox')">
        + Connect Proxmox VE
      </button>
    </div>

    <template v-else>
      <!-- Cluster Selector Strip -->
      <div class="cluster-strip">
        <button
          v-for="c in clusters"
          :key="c.configId"
          type="button"
          class="cluster-chip"
          :class="{ active: activeClusterId === c.configId }"
          @click="selectedClusterId = c.configId"
        >
          <span class="dot" :class="c.status === 'online' ? 'dot-ok' : 'dot-crit'"></span>
          <span style="margin-right: 8px;">{{ c.clusterName }}</span>
          <span class="pill" :class="c.quorate ? 'pill-ok' : 'pill-muted'" style="font-size: 10px; padding: 2px 7px;">
            {{ c.quorate ? 'QUORATE' : 'SINGLE' }}
          </span>
        </button>
      </div>

      <div v-if="activeCluster">
        <div v-if="activeCluster.status === 'error'" class="alert-row alert-critical" style="margin-bottom: 16px;">
          <div>
            <strong>Proxmox API Error ({{ activeCluster.host }}):</strong>
            {{ activeCluster.errorMessage }}
          </div>
        </div>

        <!-- Sub-view Touch Tabs -->
        <div class="tab-strip">
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'nodes' }"
            @click="subTab = 'nodes'"
          >
            Nodes ({{ activeCluster.nodes.length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'guests' }"
            @click="subTab = 'guests'"
          >
            VMs &amp; LXC ({{ nonTemplateGuests.length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'storage' }"
            @click="subTab = 'storage'"
          >
            Storage Pools ({{ activeCluster.storage.length }})
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'tasks' }"
            @click="subTab = 'tasks'"
          >
            Tasks ({{ activeCluster.tasks.length }})
          </button>
        </div>

        <!-- TAB 1: NODES -->
        <transition name="view-fade" mode="out-in">
        <div v-if="subTab === 'nodes'" key="pve-nodes" class="rack-row">
          <div v-for="node in activeCluster.nodes" :key="node.node" class="col-6">
            <div class="panel">
              <div class="panel-header">
                <div>
                  <div class="node-title-row">
                    <span class="dot" :class="node.status === 'online' ? 'dot-ok pulse' : 'dot-crit'"></span>
                    <span class="node-name mono">{{ node.node }}</span>
                    <span class="pill pill-cyan" style="margin-left: 8px;">PVE {{ node.pveVersion }}</span>
                    <span
                      v-if="node.linkedSources && node.linkedSources.length > 1"
                      class="pill pill-violet mono"
                      style="margin-left: 6px; font-size: 10px;"
                      :title="`Unified physical device (${node.canonicalDeviceId})`"
                    >
                      LINKED &middot; {{ node.linkedSources.map((s) => s.toUpperCase()).join(' + ') }}
                    </span>
                    <span
                      v-if="node.deduplicatedFrom"
                      class="pill pill-ok mono"
                      style="margin-left: 6px; font-size: 10px;"
                      :title="`Host OS metrics reused from ${node.deduplicatedFrom} — skipped redundant Proxmox status query`"
                    >
                      SHARED POLL
                    </span>
                  </div>
                  <div class="panel-subtitle mono" style="margin-top: 4px;">
                    {{ node.cpuModel }} &middot; {{ node.maxCpu }} Threads &middot; Kernel {{ node.kernelVersion }}
                  </div>
                </div>
                <span class="pill pill-muted mono">UP {{ formatUptime(node.uptimeSeconds) }}</span>
              </div>

              <div class="node-gauges">
                <RadialGauge :value="node.cpuPercent" :size="104" label="CPU" />
                <RadialGauge :value="node.memPercent" :size="104" label="RAM" color="#a78bfa" />
                <RadialGauge :value="node.rootfsPercent" :size="104" label="RootFS" color="#34d399" />
              </div>

              <div class="node-bars">
                <div style="margin-bottom: 10px;">
                  <ProgressBar
                    :percent="node.memPercent"
                    label="Memory"
                    :right-text="`${formatBytes(node.memUsedBytes)} / ${formatBytes(node.memTotalBytes)}`"
                    tone="violet"
                  />
                </div>
                <div style="margin-bottom: 10px;">
                  <ProgressBar
                    :percent="node.rootfsPercent"
                    label="Root Disk"
                    :right-text="`${formatBytes(node.rootfsUsedBytes)} / ${formatBytes(node.rootfsTotalBytes)}`"
                    tone="emerald"
                  />
                </div>
              </div>

              <div class="rack-row" style="margin-bottom: -12px;">
                <div class="col-6" style="margin-bottom: 12px;">
                  <div class="kpi-label" style="margin-bottom: 5px;">CPU Trend</div>
                  <SparklineChart
                    :values="node.history.map((h) => h.cpuPercent)"
                    :height="50"
                    stroke-color="#22d3ee"
                    fill-color="rgba(34, 211, 238, 0.14)"
                  />
                </div>
                <div class="col-6" style="margin-bottom: 12px;">
                  <div class="kpi-label" style="margin-bottom: 5px;">RAM Trend</div>
                  <SparklineChart
                    :values="node.history.map((h) => h.memPercent)"
                    :height="50"
                    stroke-color="#a78bfa"
                    fill-color="rgba(167, 139, 250, 0.14)"
                  />
                </div>
              </div>

              <div class="node-footer mono">
                <span>Load Avg: {{ node.loadAvg.map((v) => v.toFixed(2)).join(' / ') }}</span>
                <span>
                  Swap: {{ formatBytes(node.swapUsedBytes) }} / {{ formatBytes(node.swapTotalBytes) }}
                </span>
              </div>
              <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #1f2a40;">
                <button
                  class="btn btn-sm btn-primary"
                  type="button"
                  :disabled="node.status !== 'online'"
                  @click="
                    $emit('open-terminal', {
                      kind: 'proxmox-node',
                      configId: activeCluster.configId,
                      node: node.node,
                      title: `PVE Node ${node.node}`,
                    })
                  "
                >
                  &gt;_ Node Terminal
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: VMS & LXC CONTAINERS -->
        <div v-else-if="subTab === 'guests'" key="pve-guests">
          <div class="filter-bar">
            <div class="btn-group">
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': guestFilter === 'all' }"
                @click="guestFilter = 'all'"
              >
                All ({{ nonTemplateGuests.length }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': guestFilter === 'qemu' }"
                @click="guestFilter = 'qemu'"
              >
                QEMU VMs ({{ countByType('qemu') }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-primary': guestFilter === 'lxc' }"
                @click="guestFilter = 'lxc'"
              >
                LXC Containers ({{ countByType('lxc') }})
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="{ 'btn-success': statusFilter === 'running' }"
                @click="statusFilter = statusFilter === 'running' ? 'all' : 'running'"
              >
                Running Only
              </button>
            </div>
          </div>

          <div class="rack-row">
            <div v-for="g in filteredGuests" :key="`${g.node}-${g.type}-${g.vmid}`" class="col-6">
              <div class="panel guest-card">
                <div class="panel-header" style="margin-bottom: 10px;">
                  <div class="guest-id-block">
                    <div class="node-title-row">
                      <span
                        class="dot"
                        :class="g.status === 'running' ? 'dot-ok' : 'dot-muted'"
                      ></span>
                      <span class="mono guest-vmid">#{{ g.vmid }}</span>
                      <span class="guest-name">{{ g.name }}</span>
                    </div>
                    <div class="guest-sub mono">
                      Node: {{ g.node }} &middot; {{ g.cpus }} vCPU &middot;
                      <span v-if="g.status === 'running'">UP {{ formatUptime(g.uptimeSeconds) }}</span>
                      <span v-else>STOPPED</span>
                    </div>
                  </div>
                  <div>
                    <span class="pill" :class="g.type === 'qemu' ? 'pill-cyan' : 'pill-violet'">
                      {{ g.type === 'qemu' ? 'VM' : 'LXC' }}
                    </span>
                  </div>
                </div>

                <div class="rack-row" style="margin-bottom: -6px;">
                  <div class="col-6" style="margin-bottom: 10px;">
                    <ProgressBar
                      :percent="g.cpuPercent"
                      label="CPU"
                      :right-text="`${g.cpuPercent.toFixed(1)}%`"
                    />
                  </div>
                  <div class="col-6" style="margin-bottom: 10px;">
                    <ProgressBar
                      :percent="g.memPercent"
                      label="RAM"
                      :right-text="`${formatBytes(g.memUsedBytes)} / ${formatBytes(g.memMaxBytes)}`"
                      tone="violet"
                    />
                  </div>
                </div>

                <div class="guest-io mono">
                  <span>Disk: {{ formatBytes(g.diskMaxBytes) }}</span>
                  <span>Net: &darr;{{ formatBytes(g.netInBytes) }} &uarr;{{ formatBytes(g.netOutBytes) }}</span>
                </div>

                <!-- Touch-Friendly Guest Power Controls -->
                <div class="guest-actions">
                  <button
                    v-if="g.status !== 'running'"
                    class="btn btn-sm btn-success"
                    type="button"
                    :disabled="busyGuestKey === guestKey(g)"
                    @click="performGuestAction(g, 'start')"
                  >
                    Start
                  </button>
                  <template v-else>
                    <button
                      v-if="g.type === 'qemu'"
                      class="btn btn-sm btn-primary"
                      type="button"
                      @click="
                        $emit('open-vnc', {
                          configId: activeCluster.configId,
                          node: g.node,
                          type: g.type,
                          vmid: g.vmid,
                          title: `VM #${g.vmid} ${g.name}`,
                        })
                      "
                    >
                      VNC Console
                    </button>
                    <button
                      class="btn btn-sm"
                      :class="{ 'btn-primary': g.type === 'lxc' }"
                      type="button"
                      @click="
                        $emit('open-terminal', {
                          kind: g.type === 'lxc' ? 'proxmox-lxc' : 'proxmox-qemu',
                          configId: activeCluster.configId,
                          node: g.node,
                          vmid: g.vmid,
                          name: g.name,
                          title: `${g.type.toUpperCase()} #${g.vmid} ${g.name}`,
                        })
                      "
                    >
                      {{ g.type === 'qemu' ? '>_ Serial' : '>_ Terminal' }}
                    </button>
                    <button
                      class="btn btn-sm btn-warn"
                      type="button"
                      :disabled="busyGuestKey === guestKey(g)"
                      @click="askGuestAction(g, 'reboot')"
                    >
                      Reboot
                    </button>
                    <button
                      class="btn btn-sm"
                      type="button"
                      :disabled="busyGuestKey === guestKey(g)"
                      @click="askGuestAction(g, 'shutdown')"
                    >
                      Shutdown
                    </button>
                    <button
                      class="btn btn-sm btn-danger"
                      type="button"
                      :disabled="busyGuestKey === guestKey(g)"
                      @click="askGuestAction(g, 'stop')"
                    >
                      Force Stop
                    </button>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 3: STORAGE POOLS -->
        <div v-else-if="subTab === 'storage'" key="pve-storage" class="rack-row">
          <div
            v-for="s in activeCluster.storage"
            :key="`${s.node}-${s.storage}`"
            class="col-4"
          >
            <div class="panel">
              <div class="panel-header">
                <div>
                  <div class="node-title-row">
                    <span class="dot" :class="s.active ? 'dot-ok' : 'dot-crit'"></span>
                    <span class="guest-name mono">{{ s.storage }}</span>
                  </div>
                  <div class="panel-subtitle mono" style="margin-top: 3px;">
                    Node: {{ s.node }} &middot; {{ s.content || 'general' }}
                  </div>
                </div>
                <div>
                  <span class="pill pill-cyan" style="margin-right: 4px;">{{ s.type }}</span>
                  <span v-if="s.shared" class="pill pill-violet">SHARED</span>
                </div>
              </div>
              <ProgressBar
                :percent="s.usedPercent"
                :label="`${s.usedPercent.toFixed(1)}% Used`"
                :right-text="`${formatBytes(s.usedBytes)} / ${formatBytes(s.totalBytes)}`"
              />
              <div class="storage-avail mono">
                Available: {{ formatBytes(s.availBytes) }}
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 4: CLUSTER TASKS -->
        <div v-else key="pve-tasks" class="panel">
          <div class="panel-header">
            <span class="panel-title">Recent Proxmox Tasks</span>
            <span class="panel-subtitle">Latest {{ activeCluster.tasks.length }} operations</span>
          </div>
          <table class="rack-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Type</th>
                <th>Target</th>
                <th>Node</th>
                <th>User</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in activeCluster.tasks" :key="t.upid">
                <td>
                  <span
                    class="pill"
                    :class="
                      t.status === 'OK'
                        ? 'pill-ok'
                        : t.status === 'running'
                          ? 'pill-cyan'
                          : 'pill-crit'
                    "
                  >
                    {{ t.status }}
                  </span>
                </td>
                <td class="mono" style="font-weight: 700;">{{ t.type }}</td>
                <td class="mono">{{ t.id || '-' }}</td>
                <td class="mono">{{ t.node }}</td>
                <td class="mono" style="color: #94a3b8;">{{ t.user }}</td>
                <td class="mono" style="color: #94a3b8;">{{ formatRelativeTime(t.startTime) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        </transition>
      </div>
    </template>

    <!-- Touch-Safe Power Action Confirmation Modal -->
    <ConfirmModal
      :open="Boolean(pendingAction)"
      :title="pendingAction ? `${pendingAction.action.toUpperCase()} ${pendingAction.guest.name}` : ''"
      :message="
        pendingAction
          ? `Are you sure you want to ${pendingAction.action} ${pendingAction.guest.type.toUpperCase()} #${pendingAction.guest.vmid} (${pendingAction.guest.name}) on node ${pendingAction.guest.node}?`
          : ''
      "
      :confirm-label="pendingAction ? pendingAction.action.toUpperCase() : 'Confirm'"
      :danger="Boolean(pendingAction && (pendingAction.action === 'stop' || pendingAction.action === 'shutdown'))"
      @cancel="pendingAction = null"
      @confirm="confirmPendingAction"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch } from 'vue';
import type { GuestPowerAction, OverviewResponse, ProxmoxGuest } from '@shared/types';
import RadialGauge from '@/components/RadialGauge.vue';
import SparklineChart from '@/components/SparklineChart.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import { api } from '@/api/client';
import { formatBytes, formatRelativeTime, formatUptime } from '@/utils/format';

export default defineComponent({
  name: 'ProxmoxView',
  components: { RadialGauge, SparklineChart, ProgressBar, ConfirmModal },
  props: {
    overview: { type: Object as () => OverviewResponse, required: true },
    initialSubTab: {
      type: String as () => 'nodes' | 'guests' | 'storage' | 'tasks',
      default: 'nodes',
    },
  },
  setup(props, { emit }) {
    const clusters = computed(() => props.overview.proxmox);
    const selectedClusterId = ref('');
    const subTab = ref<'nodes' | 'guests' | 'storage' | 'tasks'>(props.initialSubTab || 'nodes');

    watch(
      () => props.initialSubTab,
      (val) => {
        if (val && val !== subTab.value) subTab.value = val;
      },
    );

    watch(subTab, (val) => {
      emit('change-sub-tab', val);
    });
    const guestFilter = ref<'all' | 'qemu' | 'lxc'>('all');
    const statusFilter = ref<'all' | 'running'>('all');
    const busyGuestKey = ref('');
    const pendingAction = ref<{ guest: ProxmoxGuest; action: GuestPowerAction } | null>(null);

    const activeClusterId = computed(() => {
      if (selectedClusterId.value && clusters.value.some((c) => c.configId === selectedClusterId.value)) {
        return selectedClusterId.value;
      }
      return clusters.value[0] ? clusters.value[0].configId : '';
    });

    const activeCluster = computed(
      () => clusters.value.find((c) => c.configId === activeClusterId.value) || null,
    );

    const nonTemplateGuests = computed(() =>
      activeCluster.value ? activeCluster.value.guests.filter((g) => !g.template) : [],
    );

    const filteredGuests = computed(() =>
      nonTemplateGuests.value.filter((g) => {
        if (guestFilter.value !== 'all' && g.type !== guestFilter.value) return false;
        if (statusFilter.value === 'running' && g.status !== 'running') return false;
        return true;
      }),
    );

    function countByType(type: 'qemu' | 'lxc'): number {
      return nonTemplateGuests.value.filter((g) => g.type === type).length;
    }

    function guestKey(g: ProxmoxGuest): string {
      return `${g.node}-${g.type}-${g.vmid}`;
    }

    function askGuestAction(guest: ProxmoxGuest, action: GuestPowerAction) {
      pendingAction.value = { guest, action };
    }

    async function confirmPendingAction() {
      if (!pendingAction.value) return;
      const { guest, action } = pendingAction.value;
      pendingAction.value = null;
      await performGuestAction(guest, action);
    }

    async function performGuestAction(guest: ProxmoxGuest, action: GuestPowerAction) {
      if (!activeCluster.value) return;
      const key = guestKey(guest);
      busyGuestKey.value = key;
      try {
        await api.guestPowerAction(
          activeCluster.value.configId,
          guest.node,
          guest.type,
          guest.vmid,
          action,
        );
        emit('toast', {
          message: `Sent ${action.toUpperCase()} to ${guest.name} (#${guest.vmid})`,
          error: false,
        });
        emit('refresh');
      } catch (err) {
        emit('toast', {
          message: err instanceof Error ? err.message : 'Proxmox action failed',
          error: true,
        });
      } finally {
        busyGuestKey.value = '';
      }
    }

    return {
      clusters,
      selectedClusterId,
      activeClusterId,
      activeCluster,
      subTab,
      guestFilter,
      statusFilter,
      nonTemplateGuests,
      filteredGuests,
      busyGuestKey,
      pendingAction,
      countByType,
      guestKey,
      askGuestAction,
      confirmPendingAction,
      performGuestAction,
      formatBytes,
      formatUptime,
      formatRelativeTime,
    };
  },
});
</script>

<style scoped lang="scss">
.cluster-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.cluster-chip {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  min-height: 48px;
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

.node-title-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.node-name {
  font-size: 18px;
  font-weight: 800;
  color: #f8fafc;
}

.node-gauges {
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  padding: 8px 0 16px 0;
}

.node-bars {
  margin-bottom: 8px;
}

.node-footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #1f2a40;
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  font-size: 12px;
  color: #94a3b8;
}

.filter-bar {
  margin-bottom: 12px;
}

.guest-id-block {
  min-width: 0;
}

.guest-vmid {
  font-size: 14px;
  font-weight: 800;
  color: #22d3ee;
  margin-right: 8px;
}

.guest-name {
  font-size: 16px;
  font-weight: 700;
  color: #f8fafc;
}

.guest-sub {
  font-size: 12px;
  color: #64748b;
  margin-top: 3px;
}

.guest-io {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
  margin-bottom: 12px;
}

.guest-actions {
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

.storage-avail {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 8px;
}

.empty-state {
  text-align: center;
  padding: 36px 20px;
  color: #94a3b8;
}
</style>
