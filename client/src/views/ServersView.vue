<template>
  <div>
    <!-- Top Section Bar -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">SSH Server Telemetry</h2>
        <div class="panel-subtitle">
          Connect any Linux or macOS server via IP address &amp; SSH credentials for live stats and touch diagnostics
        </div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" type="button" @click="$emit('add-server')">
          + Add SSH Server
        </button>
      </div>
    </div>

    <!-- Server Selector Touch Strip -->
    <div v-if="servers.length === 0" class="panel empty-state">
      <h3>No SSH Servers Configured</h3>
      <p>Enter any server IP address and SSH username/password (or private key) to stream live CPU, RAM, Disk, Network, Thermal, and Process telemetry.</p>
      <button class="btn btn-primary btn-lg" type="button" @click="$emit('add-server')">
        + Connect Your First Server
      </button>
    </div>

    <template v-else>
      <div class="server-strip">
        <button
          v-for="item in servers"
          :key="item.config.id"
          type="button"
          class="server-chip"
          :class="{ active: activeId === item.config.id }"
          @click="$emit('select-server', item.config.id)"
        >
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
          <span class="chip-name">{{ item.config.name }}</span>
          <span v-if="item.config.rackUnit" class="chip-u mono">{{ item.config.rackUnit }}</span>
          <span class="chip-cpu mono">{{ Math.round(item.metrics.cpuPercent) }}%</span>
        </button>
      </div>

      <!-- Active Server Detailed View -->
      <transition name="view-fade" mode="out-in">
      <div v-if="activeServer" :key="activeServer.config.id">
        <!-- Identity Header Card -->
        <div class="panel" style="margin-bottom: 16px;">
          <div class="identity-row">
            <div>
              <div class="id-title-line">
                <span
                  class="dot"
                  :class="activeServer.metrics.status === 'online' ? 'dot-ok pulse' : 'dot-crit'"
                ></span>
                <h3 class="id-name">{{ activeServer.config.name }}</h3>
                <span v-if="activeServer.config.rackUnit" class="pill pill-cyan" style="margin-left: 8px;">
                  {{ activeServer.config.rackUnit }}
                </span>
                <span v-if="activeServer.config.isDemo" class="pill pill-muted" style="margin-left: 8px;">
                  DEMO HOST
                </span>
                <span
                  v-if="activeServer.metrics.linkedSources && activeServer.metrics.linkedSources.length > 1"
                  class="pill pill-violet mono"
                  style="margin-left: 8px; font-size: 10px;"
                  :title="`Unified physical device (${activeServer.metrics.canonicalDeviceId})`"
                >
                  LINKED &middot; {{ activeServer.metrics.linkedSources.map((s) => s.toUpperCase()).join(' + ') }}
                </span>
                <span
                  v-if="activeServer.metrics.deduplicatedFrom"
                  class="pill pill-ok mono"
                  style="margin-left: 6px; font-size: 10px;"
                  :title="`Telemetry reused from ${activeServer.metrics.deduplicatedFrom} (single poll)`"
                >
                  SHARED POLL
                </span>
              </div>
              <div class="id-meta mono">
                <template v-if="activeServer.config.username">{{ activeServer.config.username }}@</template>{{ activeServer.config.host }}:{{ activeServer.config.port }}
                <template v-if="activeServer.config.authMethod === 'tailscale'"> (Tailscale SSH)</template>
                &middot; {{ activeServer.metrics.osPrettyName }}
                &middot; Kernel {{ activeServer.metrics.kernel }} ({{ activeServer.metrics.arch }})
              </div>
              <div class="id-cpu-line">
                {{ activeServer.metrics.cpuModel }} &middot; {{ activeServer.metrics.cpuCores }} Threads &middot;
                Uptime: <strong class="mono">{{ formatUptime(activeServer.metrics.uptimeSeconds) }}</strong>
              </div>
            </div>

            <div class="btn-group">
              <button
                class="btn btn-sm btn-success"
                type="button"
                @click="$emit('open-terminal', { kind: 'ssh', serverId: activeServer.config.id, title: `${activeServer.config.name} (${activeServer.config.host})` })"
              >
                &gt;_ Open Terminal
              </button>
              <span
                v-if="
                  activeServer.metrics.tailscale &&
                  activeServer.metrics.tailscale.installed &&
                  activeServer.metrics.tailscale.running &&
                  activeServer.metrics.tailscale.sshEnabled
                "
                class="pill pill-ok mono"
                style="margin-right: 8px; margin-bottom: 6px; min-height: 40px;"
              >
                TS-SSH ACTIVE{{ activeServer.metrics.tailscale.ip ? ` · ${activeServer.metrics.tailscale.ip}` : '' }}
              </span>
              <button
                v-else-if="showTailscaleSetupButton"
                class="btn btn-sm btn-primary"
                type="button"
                @click="openRemoteTsModal"
              >
                {{ tailscaleSetupButtonLabel }}
              </button>
              <button
                v-if="!activeServer.config.isDemo"
                class="btn btn-sm"
                type="button"
                @click="$emit('edit-server', activeServer.config)"
              >
                Edit SSH
              </button>
              <button
                v-if="!activeServer.config.isDemo"
                class="btn btn-sm btn-danger"
                type="button"
                @click="$emit('delete-server', activeServer.config)"
              >
                Remove
              </button>
            </div>
          </div>

          <div v-if="activeServer.metrics.status === 'error'" class="alert-row alert-critical" style="margin-top: 12px; margin-bottom: 0;">
            <div><strong>SSH Error:</strong> {{ activeServer.metrics.errorMessage }}</div>
          </div>
        </div>

        <!-- Gauges + Sparklines Row -->
        <div class="rack-row">
          <div class="col-4">
            <div class="panel">
              <div class="panel-header">
                <span class="panel-title">CPU Telemetry</span>
                <span class="mono" style="color: #22d3ee; font-weight: 700;">
                  Load {{ activeServer.metrics.loadAvg.map((v) => v.toFixed(2)).join(' / ') }}
                </span>
              </div>
              <div class="metric-center-row">
                <RadialGauge :value="activeServer.metrics.cpuPercent" :size="112" label="CPU" />
                <div style="flex: 1; margin-left: 14px;">
                  <SparklineChart
                    :values="activeServer.metrics.history.map((h) => h.cpuPercent)"
                    :height="72"
                    stroke-color="#22d3ee"
                    fill-color="rgba(34, 211, 238, 0.16)"
                  />
                  <div class="panel-subtitle" style="margin-top: 6px;">
                    Rolling {{ activeServer.metrics.history.length }} samples
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="col-4">
            <div class="panel">
              <div class="panel-header">
                <span class="panel-title">Memory &amp; Swap</span>
                <span class="mono" style="color: #a78bfa; font-weight: 700;">
                  {{ formatBytes(activeServer.metrics.memUsedBytes) }} / {{ formatBytes(activeServer.metrics.memTotalBytes) }}
                </span>
              </div>
              <div class="metric-center-row">
                <RadialGauge
                  :value="activeServer.metrics.memPercent"
                  :size="112"
                  label="RAM"
                  color="#a78bfa"
                />
                <div style="flex: 1; margin-left: 14px;">
                  <SparklineChart
                    :values="activeServer.metrics.history.map((h) => h.memPercent)"
                    :height="56"
                    stroke-color="#a78bfa"
                    fill-color="rgba(167, 139, 250, 0.16)"
                  />
                  <div style="margin-top: 8px;">
                    <ProgressBar
                      :percent="activeServer.metrics.swapPercent"
                      label="Swap"
                      :right-text="`${formatBytes(activeServer.metrics.swapUsedBytes)} / ${formatBytes(activeServer.metrics.swapTotalBytes)}`"
                      tone="amber"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="col-4">
            <div class="panel">
              <div class="panel-header">
                <span class="panel-title">Network &amp; Thermals</span>
                <span v-if="activeServer.metrics.maxTempC !== null" class="pill pill-cyan mono">
                  Peak {{ formatTemp(activeServer.metrics.maxTempC, tempUnit) }}
                </span>
              </div>
              <div class="net-big-row">
                <div class="net-stat-box">
                  <div class="kpi-label">RX Download</div>
                  <div class="mono net-big-val" style="color: #34d399;">
                    &darr; {{ formatBps(activeServer.metrics.netTotalRxBps) }}
                  </div>
                </div>
                <div class="net-stat-box">
                  <div class="kpi-label">TX Upload</div>
                  <div class="mono net-big-val" style="color: #22d3ee;">
                    &uarr; {{ formatBps(activeServer.metrics.netTotalTxBps) }}
                  </div>
                </div>
              </div>
              <div v-if="activeServer.metrics.temperatures.length > 0" class="temp-list">
                <div
                  v-for="t in activeServer.metrics.temperatures.slice(0, 3)"
                  :key="t.label"
                  class="temp-row"
                >
                  <span>{{ t.label }}</span>
                  <span class="mono" style="font-weight: 700;">{{ formatTemp(t.tempC, tempUnit) }}</span>
                </div>
              </div>
              <div v-else class="panel-subtitle" style="margin-top: 10px;">
                No hardware thermal zones exposed by kernel.
              </div>
            </div>
          </div>
        </div>

        <!-- Storage Mounts + Network Interfaces -->
        <div class="rack-row">
          <div class="col-6">
            <div class="panel">
              <div class="panel-header">
                <span class="panel-title">Mounted Storage</span>
                <span class="panel-subtitle">{{ activeServer.metrics.disks.length }} volumes</span>
              </div>
              <div v-if="activeServer.metrics.disks.length === 0" class="panel-subtitle">
                No disk telemetry available.
              </div>
              <div
                v-for="d in activeServer.metrics.disks"
                :key="d.mount"
                style="margin-bottom: 12px;"
              >
                <ProgressBar
                  :percent="d.usedPercent"
                  :label="`${d.mount} (${d.filesystem})`"
                  :right-text="`${formatBytes(d.usedBytes)} / ${formatBytes(d.totalBytes)} (${d.usedPercent}%)`"
                />
              </div>
            </div>
          </div>

          <div class="col-6">
            <div class="panel">
              <div class="panel-header">
                <span class="panel-title">Network Interfaces &amp; Services</span>
                <span class="panel-subtitle">{{ activeServer.metrics.network.length }} active NICs</span>
              </div>
              <div class="nic-table-scroll">
                <table class="rack-table" style="margin-bottom: 12px;">
                  <thead>
                    <tr>
                      <th>Interface</th>
                      <th>RX Rate</th>
                      <th>TX Rate</th>
                      <th>Total RX / TX</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="nic in activeServer.metrics.network" :key="nic.iface">
                      <td class="mono" style="font-weight: 700;">{{ nic.iface }}</td>
                      <td class="mono" style="color: #34d399;">{{ formatBps(nic.rxBytesPerSec) }}</td>
                      <td class="mono" style="color: #22d3ee;">{{ formatBps(nic.txBytesPerSec) }}</td>
                      <td class="mono" style="color: #94a3b8;">
                        {{ formatBytes(nic.rxTotalBytes) }} / {{ formatBytes(nic.txTotalBytes) }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div v-if="activeServer.metrics.services.length > 0">
                <div class="panel-title" style="margin-bottom: 8px;">
                  {{ isMacServer ? 'Homebrew Services' : 'Systemd Services' }}
                </div>
                <div class="svc-pills">
                  <span
                    v-for="svc in activeServer.metrics.services.slice(0, 10)"
                    :key="svc.name"
                    class="pill svc-pill"
                    :class="
                      svc.state === 'active'
                        ? 'pill-ok'
                        : svc.state === 'failed'
                          ? 'pill-crit'
                          : 'pill-muted'
                    "
                  >
                    {{ svc.name }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Top Processes + Touch Quick SSH Console -->
        <div class="rack-row">
          <div class="col-6">
            <div class="panel">
              <div class="panel-header">
                <span class="panel-title">Top Processes (by CPU)</span>
              </div>
              <table class="rack-table">
                <thead>
                  <tr>
                    <th>PID</th>
                    <th>User</th>
                    <th>CPU</th>
                    <th>MEM</th>
                    <th>Command</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in activeServer.metrics.topProcesses" :key="p.pid">
                    <td class="mono">{{ p.pid }}</td>
                    <td class="mono" style="color: #94a3b8;">{{ p.user }}</td>
                    <td class="mono" style="color: #22d3ee; font-weight: 700;">{{ p.cpuPercent.toFixed(1) }}%</td>
                    <td class="mono" style="color: #a78bfa;">{{ p.memPercent.toFixed(1) }}%</td>
                    <td class="mono">{{ p.command }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="col-6">
            <div class="panel">
              <div class="panel-header">
                <span class="panel-title">Touch SSH Quick Console</span>
                <span class="pill pill-cyan mono">{{ activeServer.config.host }}</span>
              </div>

              <div class="btn-group" style="margin-bottom: 10px;">
                <button
                  v-for="preset in quickCommands"
                  :key="preset.cmd"
                  class="btn btn-sm"
                  type="button"
                  :disabled="cmdRunning"
                  @click="runCmd(preset.cmd)"
                >
                  {{ preset.label }}
                </button>
              </div>

              <div class="cmd-input-row">
                <input
                  v-model="customCmd"
                  class="input mono"
                  type="text"
                  placeholder="Enter SSH command (e.g. uname -a)"
                  @keyup.enter="runCmd(customCmd)"
                />
                <button
                  class="btn btn-primary"
                  style="margin-left: 8px;"
                  type="button"
                  :disabled="cmdRunning || !customCmd.trim()"
                  @click="runCmd(customCmd)"
                >
                  {{ cmdRunning ? 'Running...' : 'Run' }}
                </button>
              </div>

              <pre class="terminal-box">{{ terminalOutput }}</pre>
            </div>
          </div>
        </div>
      </div>
      </transition>
    </template>

    <!-- Remote Linux Tailscale Install / Enable Modal -->
    <UiDialog
      :open="Boolean(remoteTsOpen && activeServer)"
      :title="activeServer ? `Install / Enable Tailscale SSH — ${activeServer.config.name}` : ''"
      @close="remoteTsOpen = false"
    >
      <p class="mt-0 text-slate-400 text-xs leading-relaxed">
        Installs Tailscale via <span class="font-mono text-slate-200">tailscale.com/install.sh</span> if missing, starts <span class="font-mono text-slate-200">tailscaled</span>, and enables passwordless Tailscale SSH (<span class="font-mono text-slate-200">--ssh</span>) over your existing SSH session.
      </p>
      <div class="field">
        <label class="field-label">Tailscale Auth Key (Optional if already joined to Tailnet)</label>
        <input
          v-model="remoteTsAuthKey"
          class="input font-mono"
          type="password"
          placeholder="tskey-auth-... (leave blank if already logged in)"
        />
      </div>
      <label class="ts-check-row">
        <input v-model="remoteTsSwitch" type="checkbox" class="ts-check-box" />
        <span>Automatically switch this server in Rack Panel to passwordless Tailscale SSH</span>
      </label>
      <pre v-if="remoteTsOutput" class="terminal-box mt-3">{{ remoteTsOutput }}</pre>
      <template #footer>
        <UiButton variant="ghost" @click="remoteTsOpen = false">Close</UiButton>
        <UiButton variant="primary" :disabled="remoteTsRunning" @click="runRemoteTsInstall">
          {{ remoteTsRunning ? 'Installing...' : 'Run Tailscale Setup' }}
        </UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch } from 'vue';
import type { OverviewResponse } from '@shared/types';
import RadialGauge from '@/components/RadialGauge.vue';
import SparklineChart from '@/components/SparklineChart.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';
import { api } from '@/api/client';
import { formatBps, formatBytes, formatTemp, formatUptime } from '@/utils/format';

export default defineComponent({
  name: 'ServersView',
  components: { RadialGauge, SparklineChart, ProgressBar, UiDialog, UiButton },
  props: {
    overview: { type: Object as () => OverviewResponse, required: true },
    selectedServerId: { type: String, default: '' },
  },
  setup(props, { emit }) {
    const servers = computed(() => props.overview.servers);
    const tempUnit = computed(() => props.overview.settings.temperatureUnit);

    const activeId = computed(() => {
      if (props.selectedServerId && servers.value.some((s) => s.config.id === props.selectedServerId)) {
        return props.selectedServerId;
      }
      return servers.value[0] ? servers.value[0].config.id : '';
    });

    const activeServer = computed(() => servers.value.find((s) => s.config.id === activeId.value) || null);

    const customCmd = ref('');
    const cmdRunning = ref(false);
    const terminalOutput = ref('Tap a quick diagnostic preset or run any SSH command above.');
    const remoteTsOpen = ref(false);
    const remoteTsAuthKey = ref('');
    const remoteTsSwitch = ref(true);
    const remoteTsRunning = ref(false);
    const remoteTsOutput = ref('');

    function openRemoteTsModal() {
      remoteTsAuthKey.value = '';
      remoteTsOutput.value = '';
      remoteTsSwitch.value = true;
      remoteTsOpen.value = true;
    }

    async function runRemoteTsInstall() {
      if (!activeId.value) return;
      remoteTsRunning.value = true;
      remoteTsOutput.value = 'Connecting over SSH and configuring Tailscale...';
      try {
        const res = await api.installRemoteTailscale(activeId.value, {
          authKey: remoteTsAuthKey.value.trim() || undefined,
          enableSsh: true,
          switchToTailscaleSsh: remoteTsSwitch.value,
        });
        remoteTsOutput.value = res.output || res.message;
        emit('toast', { message: res.message, error: !res.ok });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Remote Tailscale setup failed';
        remoteTsOutput.value = msg;
        emit('toast', { message: msg, error: true });
      } finally {
        remoteTsRunning.value = false;
      }
    }

    const isMacServer = computed(() =>
      Boolean(
        activeServer.value &&
          /macos|darwin/i.test(activeServer.value.metrics.osPrettyName || ''),
      ),
    );

    const showTailscaleSetupButton = computed(() => {
      if (!activeServer.value || activeServer.value.config.isDemo || isMacServer.value) return false;
      if (activeServer.value.metrics.status !== 'online') return false;
      const ts = activeServer.value.metrics.tailscale;
      if (!ts) return false;
      return !(ts.installed && ts.running && ts.sshEnabled);
    });

    const tailscaleSetupButtonLabel = computed(() => {
      const ts = activeServer.value && activeServer.value.metrics.tailscale;
      if (!ts || !ts.installed) return 'Install Tailscale SSH';
      if (!ts.running) return 'Join Tailscale';
      return 'Enable Tailscale SSH';
    });

    const quickCommands = computed(() =>
      isMacServer.value
        ? [
            { label: 'uptime', cmd: 'uptime' },
            { label: 'df -h', cmd: 'df -h' },
            { label: 'vm_stat', cmd: 'vm_stat' },
            { label: 'sw_vers', cmd: 'sw_vers' },
            { label: 'brew services', cmd: 'brew services list' },
            { label: 'ifconfig', cmd: 'ifconfig | grep -E "^[a-z0-9]+:|inet "' },
          ]
        : [
            { label: 'uptime', cmd: 'uptime' },
            { label: 'df -h', cmd: 'df -h' },
            { label: 'free -h', cmd: 'free -h' },
            { label: 'docker ps', cmd: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"' },
            { label: 'failed units', cmd: 'systemctl --failed --no-pager' },
            { label: 'ip addr', cmd: 'ip -br a' },
          ],
    );

    watch(activeId, () => {
      terminalOutput.value = 'Ready. Tap a quick preset or type an SSH command.';
    });

    async function runCmd(cmd: string) {
      if (!activeId.value || !cmd.trim()) return;
      cmdRunning.value = true;
      terminalOutput.value = `$ ${cmd}\nExecuting over SSH...`;
      try {
        const res = await api.execServerCommand(activeId.value, cmd);
        const combined = [res.stdout, res.stderr ? `[stderr]\n${res.stderr}` : ''].filter(Boolean).join('\n');
        terminalOutput.value = `$ ${cmd}  (${res.durationMs}ms, exit ${res.exitCode ?? 0})\n${combined || '(no output)'}`;
      } catch (err) {
        terminalOutput.value = `$ ${cmd}\nERROR: ${err instanceof Error ? err.message : String(err)}`;
        emit('toast', { message: 'SSH command failed', error: true });
      } finally {
        cmdRunning.value = false;
      }
    }

    return {
      servers,
      tempUnit,
      activeId,
      activeServer,
      isMacServer,
      showTailscaleSetupButton,
      tailscaleSetupButtonLabel,
      customCmd,
      cmdRunning,
      terminalOutput,
      remoteTsOpen,
      remoteTsAuthKey,
      remoteTsSwitch,
      remoteTsRunning,
      remoteTsOutput,
      openRemoteTsModal,
      runRemoteTsInstall,
      quickCommands,
      runCmd,
      formatBytes,
      formatBps,
      formatUptime,
      formatTemp,
    };
  },
});
</script>

<style scoped lang="scss">
.server-strip {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.server-chip {
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
  touch-action: manipulation;
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

.chip-name {
  margin-right: 8px;
}

.chip-u {
  font-size: 11px;
  color: #94a3b8;
  margin-right: 8px;
}

.chip-cpu {
  font-size: 12px;
  color: #22d3ee;
}

.identity-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
}

.id-title-line {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.id-name {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  color: #f8fafc;
}

.id-meta {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 6px;
}

.id-cpu-line {
  font-size: 13px;
  color: #cbd5e1;
  margin-top: 4px;
}

.metric-center-row {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.net-big-row {
  display: flex;
  flex-direction: row;
  margin-bottom: 10px;
}

.net-stat-box {
  flex: 1;
  background: #0b1019;
  border: 1px solid #1f2a40;
  border-radius: 4px;
  padding: 10px;
  margin-right: 8px;

  &:last-child {
    margin-right: 0;
  }
}

.net-big-val {
  font-size: 16px;
  font-weight: 800;
  margin-top: 4px;
}

.temp-list {
  border-top: 1px solid #1f2a40;
  padding-top: 8px;
}

.temp-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  font-size: 13px;
  color: #cbd5e1;
  padding: 3px 0;
}

.nic-table-scroll {
  max-height: 260px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.svc-pills {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
}

.svc-pill {
  margin-right: 6px;
  margin-bottom: 6px;
  font-size: 11px;
}

.cmd-input-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 10px;
}

.empty-state {
  text-align: center;
  padding: 36px 20px;
  color: #94a3b8;
}

.ts-check-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 44px;
  cursor: pointer;
  color: #cbd5e1;
  font-size: 14px;
}

.ts-check-box {
  width: 22px;
  height: 22px;
  margin-right: 10px;
}
</style>
