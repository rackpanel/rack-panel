<template>
  <transition name="splash-fade">
    <div
      v-if="visible && overview"
      class="splash-overlay"
      @click="handleSurfaceWake"
      @touchstart.prevent="handleSurfaceWake"
    >
      <div class="splash-inner" :class="{ 'splash-dimmed': pinPadOpen }" :style="nudgeStyle">
        <!-- Top Header: Brand, Status, Oversized Digital Clock -->
        <div class="splash-top">
          <div class="splash-brand-row">
            <div class="splash-badge mono">{{ overview.settings.rackTitle || 'RACK//PANEL' }}</div>
            <span
              class="pill"
              style="margin-left: 10px;"
              :class="streamState === 'live' ? 'pill-ok' : 'pill-warn'"
            >
              <span class="dot" :class="streamState === 'live' ? 'dot-ok pulse' : 'dot-warn pulse'"></span>
              {{ streamState === 'live' ? 'WS LIVE' : streamState.toUpperCase() }}
            </span>
            <span
              class="pill"
              style="margin-left: 8px;"
              :class="overview.alerts.length === 0 ? 'pill-ok' : 'pill-crit'"
            >
              {{
                overview.alerts.length === 0
                  ? 'ALL SYSTEMS NOMINAL'
                  : `${overview.alerts.length} ALERT${overview.alerts.length === 1 ? '' : 'S'}`
              }}
            </span>
            <span v-if="pinRequired" class="pill pill-cyan mono" style="margin-left: 8px;">
              PIN LOCKED
            </span>
          </div>

          <div class="splash-time-block">
            <div class="splash-clock mono">{{ clockStr }}</div>
            <div class="splash-date mono">{{ dateStr }}</div>
          </div>
        </div>

        <!-- Critical Alert Strip (if any) -->
        <div v-if="overview.alerts.length > 0" class="splash-alert-strip">
          <span class="dot dot-crit pulse"></span>
          <strong>[{{ overview.alerts[0].source }}]</strong>&nbsp;{{ overview.alerts[0].message }}
          <span v-if="overview.alerts.length > 1" class="mono splash-alert-more">
            +{{ overview.alerts.length - 1 }} MORE
          </span>
        </div>

        <!-- Bento Main Telemetry Grid -->
        <div class="splash-bento">
          <!-- Compute / Memory / Storage Gauges -->
          <div class="splash-panel splash-gauges-panel">
            <div class="splash-panel-head mono">COMPUTE &amp; STORAGE TELEMETRY</div>
            <div class="splash-gauges-row">
              <div class="splash-gauge-card">
                <RadialGauge :value="summary.avgCpuPercent" :size="126" :stroke-width="11" label="FLEET CPU" />
                <div class="splash-gauge-caption mono">
                  {{ summary.onlineServers }}/{{ summary.totalServers }} SSH &middot;
                  {{ summary.onlineProxmoxNodes }}/{{ summary.totalProxmoxNodes }} PVE
                </div>
              </div>

              <div class="splash-gauge-card">
                <RadialGauge
                  :value="fleetMemPercent"
                  :size="126"
                  :stroke-width="11"
                  label="FLEET RAM"
                  color="#a78bfa"
                />
                <div class="splash-gauge-caption mono">
                  {{ formatBytes(summary.totalMemUsedBytes) }} / {{ formatBytes(summary.totalMemBytes) }}
                </div>
              </div>

              <div class="splash-gauge-card">
                <RadialGauge
                  :value="fleetStoragePercent"
                  :size="126"
                  :stroke-width="11"
                  label="STORAGE"
                  color="#34d399"
                />
                <div class="splash-gauge-caption mono">
                  {{ formatBytes(summary.totalStorageUsedBytes) }} / {{ formatBytes(summary.totalStorageBytes) }}
                </div>
              </div>
            </div>
          </div>

          <!-- Power & UPS / Tesla Powerwall Telemetry -->
          <div class="splash-panel splash-power-panel">
            <div class="splash-panel-head mono">
              <span>POWER &amp; ENERGY</span>
              <span class="pill" :class="powerSummary.onBattery ? 'pill-warn' : 'pill-ok'">
                {{ powerSummary.count === 0 ? 'NO UPS' : powerSummary.onBattery ? 'ON BATTERY' : 'LINE OK' }}
              </span>
            </div>
            <div v-if="powerSummary.count === 0" class="splash-power-empty mono">
              Add a UPS or Tesla Powerwall to monitor live load, battery SoC, and solar flow.
            </div>
            <div v-else class="splash-power-body">
              <div class="splash-power-stats">
                <div class="splash-power-stat">
                  <div class="splash-kpi-label">BATTERY SoC</div>
                  <div class="splash-kpi-val mono" style="color: #34d399;">
                    {{ powerSummary.avgBattery !== null ? `${Math.round(powerSummary.avgBattery)}%` : '—' }}
                  </div>
                </div>
                <div class="splash-power-stat">
                  <div class="splash-kpi-label">TOTAL LOAD</div>
                  <div class="splash-kpi-val mono" style="color: #22d3ee;">
                    {{ powerSummary.totalLoadW !== null ? `${Math.round(powerSummary.totalLoadW)}W` : '—' }}
                  </div>
                </div>
                <div v-if="powerSummary.totalSolarW !== null" class="splash-power-stat">
                  <div class="splash-kpi-label">SOLAR GEN</div>
                  <div class="splash-kpi-val mono" style="color: #fbbf24;">
                    {{ Math.round(powerSummary.totalSolarW) }}W
                  </div>
                </div>
              </div>
              <div class="splash-power-list">
                <div v-for="u in powerSummary.items" :key="u.id" class="splash-power-item mono">
                  <span class="dot" :class="u.online ? 'dot-ok' : 'dot-crit'"></span>
                  <span class="splash-power-name">{{ u.name }}</span>
                  <span class="splash-power-meta">
                    {{ u.battery !== null ? `${Math.round(u.battery)}%` : '' }}
                    <template v-if="u.loadW !== null">&middot; {{ Math.round(u.loadW) }}W</template>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Secondary Subsystem KPI Tiles -->
        <div class="splash-kpis">
          <div class="splash-kpi-tile">
            <div class="splash-kpi-label">NETWORK RX / TX</div>
            <div class="splash-kpi-val mono" style="font-size: 16px;">
              <span style="color: #34d399;">&darr; {{ formatBps(summary.totalNetRxBps) }}</span>
              <span class="splash-kpi-dim"> / </span>
              <span style="color: #22d3ee;">&uarr; {{ formatBps(summary.totalNetTxBps) }}</span>
            </div>
          </div>
          <div class="splash-kpi-tile">
            <div class="splash-kpi-label">PROXMOX VMs / LXCs</div>
            <div class="splash-kpi-val mono">
              <span style="color: #22d3ee;">{{ summary.runningVms }}</span><span class="splash-kpi-dim">/{{ summary.totalVms }}</span>
              <span class="splash-kpi-dim"> &middot; </span>
              <span style="color: #a78bfa;">{{ summary.runningLxcs }}</span><span class="splash-kpi-dim">/{{ summary.totalLxcs }}</span>
            </div>
          </div>
          <div v-if="unifiStats.total > 0" class="splash-kpi-tile">
            <div class="splash-kpi-label">UNIFI NETWORK</div>
            <div class="splash-kpi-val mono" style="color: #38bdf8;">
              {{ unifiStats.devicesOnline }}/{{ unifiStats.devicesTotal }} DEV
              <span class="splash-kpi-dim">&middot; {{ unifiStats.clients }} CLI</span>
            </div>
          </div>
          <div v-if="summary.opnsenseTotal > 0" class="splash-kpi-tile">
            <div class="splash-kpi-label">OPNSENSE GATEWAYS</div>
            <div class="splash-kpi-val mono" style="color: #fb923c;">
              {{ summary.opnsenseGatewaysOnline }} <span class="splash-kpi-dim">/ {{ summary.opnsenseGatewaysTotal }}</span>
            </div>
          </div>
          <div v-if="summary.hikvisionTotal > 0" class="splash-kpi-tile">
            <div class="splash-kpi-label">HIKVISION CAMERAS</div>
            <div class="splash-kpi-val mono" style="color: #f472b6;">
              {{ summary.hikvisionCamerasOnline }} <span class="splash-kpi-dim">/ {{ summary.hikvisionCamerasTotal }}</span>
            </div>
          </div>
          <div v-if="summary.tailscaleTotalDevices > 0" class="splash-kpi-tile">
            <div class="splash-kpi-label">TAILNET ONLINE</div>
            <div class="splash-kpi-val mono" style="color: #34d399;">
              {{ summary.tailscaleOnlineDevices }} <span class="splash-kpi-dim">/ {{ summary.tailscaleTotalDevices }}</span>
            </div>
          </div>
        </div>

        <!-- Compact Live Host Pulse Strip -->
        <div v-if="hostPills.length > 0" class="splash-hosts">
          <div v-for="h in hostPills" :key="h.key" class="splash-host-chip">
            <div class="splash-host-top">
              <span class="dot" :class="h.online ? 'dot-ok' : 'dot-crit'"></span>
              <span class="splash-host-name">{{ h.name }}</span>
              <span class="splash-host-kind mono">{{ h.kind }}</span>
            </div>
            <div class="splash-host-stats mono">
              <span>CPU {{ Math.round(h.cpu) }}%</span>
              <span>RAM {{ Math.round(h.mem) }}%</span>
              <span v-if="h.temp !== null">{{ formatTemp(h.temp, tempUnit) }}</span>
            </div>
          </div>
        </div>

        <!-- Wake Hint -->
        <div class="splash-wake-hint mono">
          {{ pinRequired ? 'TAP ANYWHERE TO ENTER 4-DIGIT UNLOCK PIN' : 'TAP ANYWHERE TO WAKE CONTROL PANEL' }}
        </div>
      </div>

      <!-- Quick 4-Digit PIN Unlock Pad Overlay -->
      <transition name="modal-fade">
        <div
          v-if="pinRequired && pinPadOpen"
          class="pin-backdrop"
          @click.stop="closePinPad"
          @touchstart.stop.prevent="closePinPad"
        >
          <div
            class="pin-card"
            :class="{ 'pin-shake': pinError }"
            @click.stop
            @touchstart.stop
          >
            <div class="pin-header">
              <div class="pin-title mono">UNLOCK CONSOLE</div>
              <div class="pin-sub">
                {{ pinError ? pinErrorMsg : pinUnlocked ? 'ACCESS GRANTED' : verifying ? 'VERIFYING...' : 'Enter 4-digit PIN' }}
              </div>
            </div>

            <!-- 4-Digit PIN Dots -->
            <div class="pin-dots">
              <div
                v-for="idx in 4"
                :key="idx"
                class="pin-dot"
                :class="{
                  filled: pinDigits.length >= idx,
                  error: pinError,
                  success: pinUnlocked,
                }"
              ></div>
            </div>

            <!-- 3x4 Touch Numeric Keypad (Flexbox, Android 4.4 Safe) -->
            <div class="pin-pad">
              <div v-for="(row, rIdx) in keypadRows" :key="rIdx" class="pin-row">
                <button
                  v-for="key in row"
                  :key="key.label"
                  type="button"
                  class="pin-key mono"
                  :class="{ 'pin-key-fn': key.kind !== 'digit' }"
                  :disabled="verifying || pinUnlocked"
                  @click.stop="onKeyPress(key)"
                  @touchstart.stop.prevent="onKeyPress(key)"
                >
                  {{ key.label }}
                </button>
              </div>
            </div>

            <button
              type="button"
              class="btn btn-sm pin-cancel-btn"
              @click.stop="closePinPad"
              @touchstart.stop.prevent="closePinPad"
            >
              Back to Metrics Splash
            </button>
          </div>
        </div>
      </transition>
    </div>
  </transition>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import type { OverviewResponse } from '@shared/types';
import type { StreamState } from '@/api/stream';
import { api } from '@/api/client';
import RadialGauge from '@/components/RadialGauge.vue';
import { formatBps, formatBytes, formatTemp } from '@/utils/format';

interface KeypadKey {
  label: string;
  kind: 'digit' | 'clear' | 'back';
  value?: string;
}

export default defineComponent({
  name: 'IdleSplashScreen',
  components: { RadialGauge },
  props: {
    visible: { type: Boolean, default: false },
    overview: { type: Object as () => OverviewResponse | null, default: null },
    streamState: { type: String as () => StreamState, default: 'live' },
    clockStr: { type: String, default: '' },
  },
  setup(props, { emit }) {
    const nudgeStep = ref(0);
    const dateStr = ref('');
    const pinPadOpen = ref(false);
    const pinDigits = ref('');
    const verifying = ref(false);
    const pinError = ref(false);
    const pinErrorMsg = ref('INCORRECT PIN');
    const pinUnlocked = ref(false);

    let nudgeTimer: number | null = null;
    let pinAutoHideTimer: number | null = null;
    let errorResetTimer: number | null = null;
    let lastTouchTs = 0;

    const keypadRows: KeypadKey[][] = [
      [
        { label: '1', kind: 'digit', value: '1' },
        { label: '2', kind: 'digit', value: '2' },
        { label: '3', kind: 'digit', value: '3' },
      ],
      [
        { label: '4', kind: 'digit', value: '4' },
        { label: '5', kind: 'digit', value: '5' },
        { label: '6', kind: 'digit', value: '6' },
      ],
      [
        { label: '7', kind: 'digit', value: '7' },
        { label: '8', kind: 'digit', value: '8' },
        { label: '9', kind: 'digit', value: '9' },
      ],
      [
        { label: 'CLR', kind: 'clear' },
        { label: '0', kind: 'digit', value: '0' },
        { label: 'DEL', kind: 'back' },
      ],
    ];

    const pinRequired = computed(() =>
      Boolean(props.overview && props.overview.settings.splashPinEnabled && props.overview.settings.hasSplashPin),
    );

    function clearPinTimers() {
      if (pinAutoHideTimer !== null) {
        window.clearTimeout(pinAutoHideTimer);
        pinAutoHideTimer = null;
      }
      if (errorResetTimer !== null) {
        window.clearTimeout(errorResetTimer);
        errorResetTimer = null;
      }
    }

    function resetPinState() {
      clearPinTimers();
      pinPadOpen.value = false;
      pinDigits.value = '';
      verifying.value = false;
      pinError.value = false;
      pinUnlocked.value = false;
    }

    function bumpPinAutoHide() {
      if (pinAutoHideTimer !== null) window.clearTimeout(pinAutoHideTimer);
      pinAutoHideTimer = window.setTimeout(() => {
        if (!verifying.value && !pinUnlocked.value) {
          closePinPad();
        }
      }, 15000);
    }

    function openPinPad() {
      pinPadOpen.value = true;
      pinError.value = false;
      bumpPinAutoHide();
    }

    function closePinPad() {
      resetPinState();
    }

    function handleSurfaceWake(evt?: Event) {
      if (evt && evt.type === 'touchstart') {
        lastTouchTs = Date.now();
      } else if (evt && evt.type === 'click' && Date.now() - lastTouchTs < 400) {
        return;
      }

      if (!pinRequired.value) {
        emit('dismiss');
        return;
      }
      if (!pinPadOpen.value) {
        openPinPad();
      }
    }

    async function submitPin(code: string) {
      if (verifying.value) return;
      verifying.value = true;
      pinError.value = false;
      try {
        const res = await api.verifySplashPin(code);
        if (res.ok) {
          pinUnlocked.value = true;
          clearPinTimers();
          window.setTimeout(() => {
            resetPinState();
            emit('dismiss');
          }, 160);
          return;
        }
        triggerPinError('INCORRECT PIN');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'INCORRECT PIN';
        triggerPinError(msg.toUpperCase());
      } finally {
        verifying.value = false;
      }
    }

    function triggerPinError(message: string) {
      pinErrorMsg.value = message || 'INCORRECT PIN';
      pinError.value = true;
      bumpPinAutoHide();
      if (errorResetTimer !== null) window.clearTimeout(errorResetTimer);
      errorResetTimer = window.setTimeout(() => {
        pinDigits.value = '';
        pinError.value = false;
      }, 550);
    }

    function appendDigit(digit: string) {
      if (verifying.value || pinUnlocked.value) return;
      if (pinError.value) {
        pinDigits.value = '';
        pinError.value = false;
      }
      if (pinDigits.value.length >= 4) return;
      pinDigits.value += digit;
      bumpPinAutoHide();
      if (pinDigits.value.length === 4) {
        void submitPin(pinDigits.value);
      }
    }

    function onKeyPress(key: KeypadKey) {
      if (verifying.value || pinUnlocked.value) return;
      if (key.kind === 'digit' && key.value) {
        appendDigit(key.value);
      } else if (key.kind === 'clear') {
        pinDigits.value = '';
        pinError.value = false;
        bumpPinAutoHide();
      } else if (key.kind === 'back') {
        pinDigits.value = pinDigits.value.slice(0, -1);
        pinError.value = false;
        bumpPinAutoHide();
      }
    }

    function onWindowKeydown(evt: KeyboardEvent) {
      if (!props.visible || !props.overview) return;
      if (!pinRequired.value) return;

      if (evt.key >= '0' && evt.key <= '9') {
        evt.preventDefault();
        if (!pinPadOpen.value) openPinPad();
        appendDigit(evt.key);
      } else if (evt.key === 'Backspace' && pinPadOpen.value) {
        evt.preventDefault();
        pinDigits.value = pinDigits.value.slice(0, -1);
        pinError.value = false;
        bumpPinAutoHide();
      } else if (evt.key === 'Escape' && pinPadOpen.value) {
        evt.preventDefault();
        closePinPad();
      }
    }

    watch(
      () => props.visible,
      (v) => {
        if (!v) resetPinState();
      },
    );

    function updateDate() {
      const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
      const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const d = new Date();
      dateStr.value = `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
    }

    onMounted(() => {
      updateDate();
      nudgeTimer = window.setInterval(() => {
        nudgeStep.value = (nudgeStep.value + 1) % 4;
        updateDate();
      }, 30000);
      window.addEventListener('keydown', onWindowKeydown);
    });

    onBeforeUnmount(() => {
      if (nudgeTimer !== null) window.clearInterval(nudgeTimer);
      clearPinTimers();
      window.removeEventListener('keydown', onWindowKeydown);
    });

    // Gentle 2px burn-in protection shift every 30s
    const nudgeStyle = computed(() => {
      const offsets = [
        { x: 0, y: 0 },
        { x: 2, y: 1 },
        { x: 0, y: 2 },
        { x: -2, y: 1 },
      ];
      const o = offsets[nudgeStep.value];
      return {
        transform: `translate(${o.x}px, ${o.y}px)`,
      };
    });

    const summary = computed(() => {
      if (props.overview) return props.overview.summary;
      return {
        totalServers: 0,
        onlineServers: 0,
        totalProxmoxNodes: 0,
        onlineProxmoxNodes: 0,
        runningVms: 0,
        totalVms: 0,
        runningLxcs: 0,
        totalLxcs: 0,
        tailscaleOnlineDevices: 0,
        tailscaleTotalDevices: 0,
        opnsenseOnline: 0,
        opnsenseTotal: 0,
        opnsenseGatewaysOnline: 0,
        opnsenseGatewaysTotal: 0,
        hikvisionOnline: 0,
        hikvisionTotal: 0,
        hikvisionCamerasOnline: 0,
        hikvisionCamerasTotal: 0,
        avgCpuPercent: 0,
        totalMemUsedBytes: 0,
        totalMemBytes: 0,
        totalStorageUsedBytes: 0,
        totalStorageBytes: 0,
        totalNetRxBps: 0,
        totalNetTxBps: 0,
      };
    });

    const tempUnit = computed(() => (props.overview ? props.overview.settings.temperatureUnit : 'C'));

    const fleetMemPercent = computed(() => {
      if (!summary.value.totalMemBytes) return 0;
      return Math.round((summary.value.totalMemUsedBytes / summary.value.totalMemBytes) * 1000) / 10;
    });

    const fleetStoragePercent = computed(() => {
      if (!summary.value.totalStorageBytes) return 0;
      return Math.round((summary.value.totalStorageUsedBytes / summary.value.totalStorageBytes) * 1000) / 10;
    });

    const hostPills = computed(() => {
      if (!props.overview) return [];
      const list: Array<{
        key: string;
        name: string;
        kind: string;
        online: boolean;
        cpu: number;
        mem: number;
        temp: number | null;
      }> = [];
      for (const s of props.overview.servers) {
        list.push({
          key: `ssh-${s.config.id}`,
          name: s.config.name,
          kind: 'SSH',
          online: s.metrics.status === 'online',
          cpu: s.metrics.cpuPercent,
          mem: s.metrics.memPercent,
          temp: s.metrics.maxTempC,
        });
      }
      for (const c of props.overview.proxmox) {
        for (const n of c.nodes) {
          list.push({
            key: `pve-${c.configId}-${n.node}`,
            name: n.node,
            kind: 'PVE',
            online: n.status === 'online',
            cpu: n.cpuPercent,
            mem: n.memPercent,
            temp: null,
          });
        }
      }
      return list.slice(0, 6);
    });

    const powerSummary = computed(() => {
      const upsList = props.overview?.ups || [];
      let batterySum = 0;
      let batteryCount = 0;
      let loadSum = 0;
      let loadCount = 0;
      let solarSum = 0;
      let solarCount = 0;
      let onBattery = false;

      const items = upsList.slice(0, 3).map((u) => {
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
        return {
          id: u.configId,
          name: u.name,
          online: u.status === 'online',
          battery: u.batteryChargePercent,
          loadW: u.outputWatts,
        };
      });

      return {
        count: upsList.length,
        onBattery,
        avgBattery: batteryCount > 0 ? batterySum / batteryCount : null,
        totalLoadW: loadCount > 0 ? loadSum : null,
        totalSolarW: solarCount > 0 ? solarSum : null,
        items,
      };
    });

    const unifiStats = computed(() => {
      const list = props.overview?.unifi || [];
      let devicesOnline = 0;
      let devicesTotal = 0;
      let clients = 0;
      for (const u of list) {
        devicesOnline += u.onlineDevices;
        devicesTotal += u.totalDevices;
        clients += u.totalClients;
      }
      return {
        total: list.length,
        devicesOnline,
        devicesTotal,
        clients,
      };
    });

    return {
      nudgeStyle,
      dateStr,
      summary,
      tempUnit,
      fleetMemPercent,
      fleetStoragePercent,
      hostPills,
      powerSummary,
      unifiStats,
      pinRequired,
      pinPadOpen,
      pinDigits,
      verifying,
      pinError,
      pinErrorMsg,
      pinUnlocked,
      keypadRows,
      handleSurfaceWake,
      closePinPad,
      onKeyPress,
      formatBytes,
      formatBps,
      formatTemp,
    };
  },
});
</script>

<style scoped lang="scss">
.splash-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 300;
  background: #05070c;
  display: flex;
  flex-direction: column;
  padding: 20px 24px;
  cursor: pointer;
  overflow: hidden;
}

.splash-inner {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border: 1px solid #1a2438;
  border-radius: 6px;
  background: linear-gradient(180deg, #0b101b 0%, #06090f 100%);
  padding: 20px 24px;
  transition: transform 0.6s ease, opacity 0.22s ease;

  &.splash-dimmed {
    opacity: 0.28;
  }
}

.splash-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  border-bottom: 1px solid #182235;
  padding-bottom: 14px;
}

.splash-brand-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.splash-badge {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 1.4px;
  color: #f8fafc;
}

.splash-time-block {
  text-align: right;
}

.splash-clock {
  font-size: 38px;
  font-weight: 800;
  line-height: 1;
  color: #22d3ee;
  letter-spacing: 1.5px;
}

.splash-date {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
  color: #64748b;
  margin-top: 4px;
}

.splash-alert-strip {
  margin-top: 12px;
  padding: 9px 14px;
  border-radius: 4px;
  background: rgba(220, 38, 38, 0.18);
  border: 1px solid rgba(248, 113, 113, 0.45);
  color: #fecaca;
  font-size: 13px;
  display: flex;
  flex-direction: row;
  align-items: center;
}

.splash-alert-more {
  margin-left: auto;
  font-size: 11px;
  color: #fca5a5;
}

.splash-bento {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 14px;
  margin-top: 12px;
}

.splash-panel {
  border-radius: 8px;
  background: rgba(13, 19, 32, 0.85);
  border: 1px solid #1d283d;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
}

.splash-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.9px;
  color: #64748b;
  margin-bottom: 8px;
}

.splash-power-empty {
  font-size: 12px;
  color: #64748b;
  padding: 18px 0;
}

.splash-power-body {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 1;
}

.splash-power-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 10px;
}

.splash-power-stat {
  flex: 1;
  min-width: 78px;
}

.splash-power-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.splash-power-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #cbd5e1;
  padding: 5px 8px;
  border-radius: 5px;
  background: #0a0f1a;
  border: 1px solid #1a2438;
}

.splash-power-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.splash-power-meta {
  color: #94a3b8;
  font-size: 11px;
}

@media (max-width: 900px) {
  .splash-bento {
    grid-template-columns: 1fr;
  }
}

.splash-gauges-row {
  display: flex;
  flex-direction: row;
  justify-content: space-around;
  align-items: center;
  flex-wrap: wrap;
  padding: 6px 0;
}

.splash-gauge-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 14px;
}

.splash-gauge-caption {
  margin-top: 10px;
  font-size: 13px;
  font-weight: 700;
  color: #94a3b8;
}

.splash-kpis {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-left: -6px;
  margin-right: -6px;
}

.splash-kpi-tile {
  flex: 1;
  min-width: 145px;
  margin: 0 6px 10px 6px;
  padding: 12px 14px;
  border-radius: 4px;
  background: #0d1320;
  border: 1px solid #1d283d;
}

.splash-kpi-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.9px;
  color: #64748b;
}

.splash-kpi-val {
  font-size: 20px;
  font-weight: 800;
  margin-top: 4px;
}

.splash-kpi-dim {
  font-size: 14px;
  color: #64748b;
}

.splash-hosts {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-left: -5px;
  margin-right: -5px;
  margin-top: 4px;
}

.splash-host-chip {
  flex: 1;
  min-width: 165px;
  margin: 0 5px 8px 5px;
  padding: 9px 12px;
  border-radius: 4px;
  background: #0a0f1a;
  border: 1px solid #1a2438;
}

.splash-host-top {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 4px;
}

.splash-host-name {
  font-size: 13px;
  font-weight: 700;
  color: #e2e8f0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.splash-host-kind {
  font-size: 10px;
  color: #64748b;
  margin-left: 6px;
}

.splash-host-stats {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  font-size: 12px;
  color: #94a3b8;
}

.splash-wake-hint {
  text-align: center;
  font-size: 11px;
  letter-spacing: 1.6px;
  color: #475569;
  padding-top: 6px;
}

/* Quick 4-Digit PIN Overlay */
.pin-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 320;
  background: rgba(5, 7, 12, 0.72);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;
  cursor: default;
}

.pin-card {
  width: 100%;
  max-width: 316px;
  background: #0e1422;
  border: 1px solid #263554;
  border-radius: 6px;
  padding: 20px 20px 16px 20px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.pin-header {
  text-align: center;
  margin-bottom: 14px;
}

.pin-title {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 1.4px;
  color: #f8fafc;
}

.pin-sub {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
  min-height: 16px;
}

.pin-dots {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-bottom: 18px;
}

.pin-dot {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 2px solid #334569;
  background: #0a0f1a;
  margin: 0 9px;
  transition: background-color 0.14s ease, border-color 0.14s ease, transform 0.14s ease;

  &.filled {
    background: #22d3ee;
    border-color: #22d3ee;
    transform: scale(1.1);
  }

  &.error {
    background: #ef4444;
    border-color: #f87171;
  }

  &.success {
    background: #34d399;
    border-color: #34d399;
    transform: scale(1.15);
  }
}

.pin-pad {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.pin-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  margin-bottom: 8px;
}

.pin-key {
  flex: 1;
  height: 54px;
  margin: 0 4px;
  border-radius: 4px;
  border: 1px solid #24324d;
  background: #141d2f;
  color: #f8fafc;
  font-size: 20px;
  font-weight: 800;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease, transform 0.08s ease;

  &:hover {
    background: #1a263e;
    border-color: #36507d;
  }

  &:active {
    background: #0e7490;
    border-color: #22d3ee;
    transform: scale(0.96);
  }

  &.pin-key-fn {
    font-size: 13px;
    letter-spacing: 0.8px;
    color: #94a3b8;
    background: #0f1625;
  }
}

.pin-cancel-btn {
  margin-top: 8px;
  width: 100%;
}

.pin-shake {
  animation: pin-shake-kf 0.36s ease;
}

@keyframes pin-shake-kf {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-10px);
  }
  40% {
    transform: translateX(10px);
  }
  60% {
    transform: translateX(-7px);
  }
  80% {
    transform: translateX(7px);
  }
}
</style>
