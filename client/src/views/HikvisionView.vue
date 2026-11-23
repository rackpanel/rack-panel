<template>
  <div>
    <!-- Section Header Bar -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">Hikvision CCTV &amp; NVR Matrix</h2>
        <div class="panel-subtitle">
          Live ISAPI / RTSP camera matrix, PoE channel telemetry, and SATA RAID/HDD bay health (Android 4.4+ compatible)
        </div>
      </div>
      <div class="btn-group">
        <button class="btn" type="button" @click="$emit('refresh')">
          Sync ISAPI
        </button>
        <button class="btn btn-primary" type="button" @click="$emit('add-hikvision')">
          + Add Hikvision NVR / Camera
        </button>
      </div>
    </div>

    <!-- Empty State -->
    <div v-if="devices.length === 0" class="panel empty-card">
      <h3 style="margin: 0 0 8px 0; color: #f8fafc;">No Hikvision NVR, DVR, or Camera Connected</h3>
      <p style="max-width: 580px; margin: 0 auto 18px auto;">
        Connect your Hikvision NVR (such as <span class="mono">DS-7732NI-I4 / 16P(B)</span>), TurboHD DVR, or standalone
        IP cameras to view live CCTV streams, built-in PoE port status, recording indicators, and SATA HDD health.
      </p>
      <button class="btn btn-primary" type="button" @click="$emit('add-hikvision')">
        + Connect First Hikvision Device
      </button>
    </div>

    <template v-else>
      <!-- Device Selector Strip (if multiple NVRs / DVRs / Cameras are configured) -->
      <div v-if="devices.length > 1" class="hik-device-tabs">
        <button
          v-for="d in devices"
          :key="d.configId"
          type="button"
          class="btn btn-sm hik-device-tab"
          :class="{ 'btn-primary': activeDevice && activeDevice.configId === d.configId }"
          @click="selectedConfigId = d.configId"
        >
          <span
            class="dot"
            :class="d.status === 'online' ? 'dot-ok' : d.status === 'error' ? 'dot-crit' : 'dot-warn'"
          ></span>
          <span>{{ d.name }}</span>
          <span class="mono" style="margin-left: 6px; opacity: 0.8;">
            ({{ d.onlineChannels }}/{{ d.totalChannels }})
          </span>
        </button>
      </div>

      <template v-if="activeDevice">
        <!-- Hardware Identity & Telemetry Banner -->
        <div class="panel" style="margin-bottom: 14px;">
          <div class="panel-header" style="margin-bottom: 10px;">
            <div class="hik-identity-head">
              <span
                class="dot"
                :class="
                  activeDevice.status === 'online'
                    ? 'dot-ok pulse'
                    : activeDevice.status === 'error'
                      ? 'dot-crit'
                      : 'dot-warn'
                "
              ></span>
              <span class="hik-device-title">{{ activeDevice.name }}</span>
              <span class="pill pill-cyan mono" style="margin-left: 8px;">
                {{ activeDevice.deviceType }}
              </span>
              <span v-if="activeDevice.model && activeDevice.model !== '-'" class="pill pill-violet mono" style="margin-left: 6px;">
                {{ activeDevice.model }}
              </span>
              <span v-if="activeDevice.isDemo" class="pill pill-warn mono" style="margin-left: 6px;">
                DEMO NVR
              </span>
              <span
                v-if="activeDevice.deduplicatedFrom"
                class="pill pill-cyan mono"
                style="margin-left: 6px;"
              >
                SHARED POLL &middot; {{ activeDevice.deduplicatedFrom }}
              </span>
            </div>

            <div class="btn-group">
              <span
                class="pill mono"
                :class="activeDevice.onlineChannels === activeDevice.totalChannels && activeDevice.totalChannels > 0 ? 'pill-ok' : 'pill-warn'"
              >
                CAMERAS {{ activeDevice.onlineChannels }}/{{ activeDevice.totalChannels }} ONLINE
              </span>
              <span v-if="recordingCount > 0" class="pill pill-crit mono" style="margin-left: 6px;">
                &bull; {{ recordingCount }} REC
              </span>
              <span v-if="poeCount > 0" class="pill pill-violet mono" style="margin-left: 6px;">
                {{ poeCount }} PoE PORTS ACTIVE
              </span>
            </div>
          </div>

          <div v-if="activeDevice.status === 'error'" class="error-inline" style="margin-bottom: 10px;">
            <strong>ISAPI Connection Error:</strong> {{ activeDevice.errorMessage || 'Unable to reach Hikvision device' }}
          </div>

          <!-- Hardware Specifications Strip (Model, Serial No., Firmware, Uptime, CPU/RAM/Storage) -->
          <div class="rack-row" style="margin-bottom: -10px;">
            <div class="col-3" style="margin-bottom: 10px;">
              <div class="hik-meta-tile">
                <div class="kpi-label">Model &amp; Host</div>
                <div class="mono hik-meta-val">{{ activeDevice.model !== '-' ? activeDevice.model : activeDevice.name }}</div>
                <div class="mono hik-meta-sub">
                  {{ activeDevice.host }} &middot; MAC {{ activeDevice.macAddress }}
                </div>
              </div>
            </div>

            <div class="col-4" style="margin-bottom: 10px;">
              <div class="hik-meta-tile">
                <div class="kpi-label">Serial Number</div>
                <div class="mono hik-meta-val hik-serial-text" :title="activeDevice.serialNumber">
                  {{ activeDevice.serialNumber }}
                </div>
                <div class="mono hik-meta-sub">
                  Device Name: {{ activeDevice.deviceName }}
                </div>
              </div>
            </div>

            <div class="col-3" style="margin-bottom: 10px;">
              <div class="hik-meta-tile">
                <div class="kpi-label">Firmware Version</div>
                <div class="mono hik-meta-val" style="color: #22d3ee;">
                  {{ activeDevice.firmwareVersion }}
                </div>
                <div class="mono hik-meta-sub">
                  {{ activeDevice.firmwareBuild && activeDevice.firmwareBuild !== '-' ? activeDevice.firmwareBuild : 'ISAPI / RTSP Ready' }}
                </div>
              </div>
            </div>

            <div class="col-2" style="margin-bottom: 10px;">
              <div class="hik-meta-tile">
                <div class="kpi-label">NVR Load &amp; Storage</div>
                <div class="mono hik-meta-val" style="color: #34d399;">
                  <template v-if="activeDevice.cpuPercent > 0">
                    CPU {{ activeDevice.cpuPercent }}% &middot; RAM {{ activeDevice.memPercent }}%
                  </template>
                  <template v-else>
                    {{ activeDevice.hdds.length }} SATA
                  </template>
                </div>
                <div class="mono hik-meta-sub">
                  <template v-if="activeDevice.uptimeSeconds > 0">
                    UP {{ formatUptime(activeDevice.uptimeSeconds) }}
                  </template>
                  <template v-else-if="totalHddCapacityBytes > 0">
                    {{ formatBytes(totalHddUsedBytes) }} / {{ formatBytes(totalHddCapacityBytes) }}
                  </template>
                  <template v-else>
                    ONLINE
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sub-Tab Navigation + Matrix Controls Bar -->
        <div class="hik-toolbar">
          <div class="btn-group">
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': activeSubTab === 'live' }"
              @click="setSubTab('live')"
            >
              Live Feeds ({{ activeDevice.channels.length }})
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': activeSubTab === 'channels' }"
              @click="setSubTab('channels')"
            >
              Channels &amp; PoE ({{ activeDevice.channels.length }})
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': activeSubTab === 'storage' }"
              @click="setSubTab('storage')"
            >
              Storage HDDs ({{ activeDevice.hdds.length }})
            </button>
          </div>

          <!-- Live Matrix Stream Controls -->
          <div v-if="activeSubTab === 'live'" class="btn-group">
            <!-- Grid Layout Size -->
            <button
              v-for="g in gridOptions"
              :key="g.id"
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': gridLayout === g.id }"
              @click="setGridLayout(g.id)"
            >
              {{ g.label }}
            </button>

            <!-- Stream Quality -->
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': matrixStreamKind === 'sub' }"
              @click="setMatrixStreamKind('sub')"
            >
              SD
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': matrixStreamKind === 'main' }"
              @click="setMatrixStreamKind('main')"
            >
              HD
            </button>

            <!-- Refresh Rate -->
            <button
              v-for="r in rateOptions"
              :key="r.id"
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': refreshRate === r.id }"
              @click="setRefreshRate(r.id)"
            >
              {{ r.label }}
            </button>
          </div>
        </div>

        <!-- SUB-TAB 1: LIVE CAMERA MATRIX -->
        <div v-if="activeSubTab === 'live'">
          <!-- Page Switcher when total channels exceed current grid size -->
          <div v-if="totalPages > 1" class="hik-page-bar">
            <div class="mono" style="font-size: 12px; color: #94a3b8;">
              Showing Channels {{ pageStartChannelLabel }} (Page {{ currentPage + 1 }} of {{ totalPages }})
            </div>
            <div class="btn-group">
              <button
                class="btn btn-sm"
                type="button"
                :disabled="currentPage <= 0"
                @click="currentPage = Math.max(0, currentPage - 1)"
              >
                &larr; Prev Page
              </button>
              <button
                v-for="p in totalPages"
                :key="p"
                class="btn btn-sm"
                :class="{ 'btn-primary': currentPage === p - 1 }"
                type="button"
                @click="currentPage = p - 1"
              >
                {{ p }}
              </button>
              <button
                class="btn btn-sm"
                type="button"
                :disabled="currentPage >= totalPages - 1"
                @click="currentPage = Math.min(totalPages - 1, currentPage + 1)"
              >
                Next Page &rarr;
              </button>
            </div>
          </div>

          <div class="rack-row">
            <div
              v-for="ch in visibleChannels"
              :key="`${activeDevice.configId}-ch-${ch.id}`"
              :class="tileColClass"
            >
              <div
                class="panel hik-cam-card"
                :class="{ 'hik-cam-offline': !ch.online }"
                @click="openLiveCamera(ch)"
              >
                <div class="hik-cam-viewport">
                  <img
                    v-if="ch.online && frameUrls[ch.id]"
                    :src="frameUrls[ch.id]"
                    class="hik-cam-img"
                    :alt="ch.name"
                  />

                  <div v-if="!ch.online" class="hik-cam-placeholder">
                    <div class="mono" style="color: #f87171; font-weight: 800; font-size: 13px;">
                      NO SIGNAL / OFFLINE
                    </div>
                    <div class="mono" style="color: #64748b; font-size: 11px; margin-top: 4px;">
                      CH{{ pad2(ch.id) }} &middot; {{ ch.ipAddress || ch.sourceType.toUpperCase() }}
                    </div>
                  </div>
                  <div v-else-if="!frameUrls[ch.id]" class="hik-cam-placeholder">
                    <div class="mono" style="color: #22d3ee; font-size: 12px;">
                      Loading CH{{ pad2(ch.id) }} live frame...
                    </div>
                  </div>

                  <!-- Top Overlay Badges -->
                  <div class="hik-cam-overlay-top">
                    <div class="hik-cam-tags">
                      <span class="hik-badge hik-badge-ch mono">CH{{ pad2(ch.id) }}</span>
                      <span v-if="ch.poePort" class="hik-badge hik-badge-poe mono">
                        PoE {{ ch.poePort }}
                      </span>
                      <span class="hik-badge mono">{{ ch.codec }}</span>
                    </div>
                    <div class="hik-cam-tags">
                      <span v-if="ch.recording" class="hik-badge hik-badge-rec mono">
                        &bull; REC
                      </span>
                      <span
                        class="dot"
                        :class="ch.online ? 'dot-ok' : 'dot-crit'"
                        style="margin-left: 4px;"
                      ></span>
                    </div>
                  </div>

                  <!-- Bottom Overlay Bar -->
                  <div class="hik-cam-overlay-bottom">
                    <div class="hik-cam-name">{{ ch.name }}</div>
                    <div class="hik-cam-spec mono">
                      {{ ch.resolution }} &middot; {{ ch.fps }}fps
                      <template v-if="ch.bitrateKbps > 0"> &middot; {{ ch.bitrateKbps }}kbps</template>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- SUB-TAB 2: CHANNELS & PoE TABLE -->
        <div v-else-if="activeSubTab === 'channels'" class="panel">
          <div class="panel-header">
            <span class="panel-title">
              Configured Camera Channels ({{ activeDevice.channels.length }})
            </span>
            <span class="panel-subtitle">
              Tap any row or <strong>Watch Live</strong> to open high-frame-rate live stream &amp; PTZ controls
            </span>
          </div>

          <div class="table-scroll">
            <table class="rack-table">
              <thead>
                <tr>
                  <th>CH</th>
                  <th>Camera Name</th>
                  <th>Status</th>
                  <th>Source / PoE Port</th>
                  <th>Camera IP</th>
                  <th>Protocol / Model</th>
                  <th>Stream Spec</th>
                  <th style="text-align: right;">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="ch in activeDevice.channels"
                  :key="`row-${ch.id}`"
                  style="cursor: pointer;"
                  @click="openLiveCamera(ch)"
                >
                  <td class="mono" style="font-weight: 800; color: #22d3ee;">
                    CH{{ pad2(ch.id) }}
                  </td>
                  <td style="font-weight: 700; color: #f8fafc;">
                    {{ ch.name }}
                    <span v-if="ch.ptzSupported" class="pill pill-cyan mono" style="margin-left: 6px; font-size: 10px;">
                      PTZ
                    </span>
                  </td>
                  <td>
                    <span class="pill" :class="ch.online ? 'pill-ok' : 'pill-crit'">
                      <span class="dot" :class="ch.online ? 'dot-ok' : 'dot-crit'"></span>
                      {{ ch.online ? 'ONLINE' : 'OFFLINE' }}
                    </span>
                    <span
                      v-if="ch.recording"
                      class="pill pill-crit mono"
                      style="margin-left: 6px; font-size: 10px;"
                    >
                      &bull; REC
                    </span>
                  </td>
                  <td class="mono">
                    <span v-if="ch.poePort" class="pill pill-violet mono">
                      Built-in PoE #{{ ch.poePort }}
                    </span>
                    <span v-else-if="ch.sourceType === 'analog'" class="pill pill-muted mono">
                      BNC / TurboHD
                    </span>
                    <span v-else class="pill pill-cyan mono">
                      LAN IP Proxy
                    </span>
                  </td>
                  <td class="mono">{{ ch.ipAddress || '-' }}</td>
                  <td class="mono">{{ ch.model && ch.model !== '-' ? ch.model : ch.protocol || '-' }}</td>
                  <td class="mono">
                    {{ ch.codec }} &middot; {{ ch.resolution }} &middot; {{ ch.fps }}fps
                    <template v-if="ch.bitrateKbps > 0"> ({{ ch.bitrateKbps }} kbps)</template>
                  </td>
                  <td style="text-align: right;">
                    <button
                      class="btn btn-sm btn-primary"
                      type="button"
                      @click.stop="openLiveCamera(ch)"
                    >
                      Watch Live
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- SUB-TAB 3: SATA HDD STORAGE BAYS -->
        <div v-else-if="activeSubTab === 'storage'">
          <div v-if="activeDevice.hdds.length === 0" class="panel empty-card">
            <p>No SATA HDD or SD storage bays reported by this Hikvision device.</p>
          </div>
          <div v-else class="rack-row">
            <div v-for="hdd in activeDevice.hdds" :key="`hdd-${hdd.id}`" class="col-6">
              <div class="panel">
                <div class="panel-header">
                  <div>
                    <div class="host-name-row">
                      <span
                        class="dot"
                        :class="
                          hdd.status === 'ok'
                            ? 'dot-ok'
                            : hdd.status === 'error'
                              ? 'dot-crit'
                              : 'dot-warn'
                        "
                      ></span>
                      <span class="panel-title">SATA Bay #{{ hdd.id }} &mdash; {{ hdd.name }}</span>
                      <span class="pill pill-muted mono" style="margin-left: 8px; font-size: 10px;">
                        {{ hdd.type.toUpperCase() }} &middot; {{ hdd.property }}
                      </span>
                    </div>
                  </div>
                  <span
                    class="pill mono"
                    :class="
                      hdd.status === 'ok'
                        ? 'pill-ok'
                        : hdd.status === 'error'
                          ? 'pill-crit'
                          : 'pill-warn'
                    "
                  >
                    {{ hdd.statusText }}
                  </span>
                </div>

                <div style="margin-bottom: 10px;">
                  <ProgressBar
                    :percent="hdd.usedPercent"
                    :label="`Used ${hdd.usedPercent}%`"
                    :right-text="`${formatBytes(hdd.usedBytes)} / ${formatBytes(hdd.capacityBytes)}`"
                    :tone="hdd.status === 'error' ? 'rose' : 'emerald'"
                  />
                </div>

                <div class="hik-hdd-footer mono">
                  <span>Capacity: {{ formatBytes(hdd.capacityBytes) }}</span>
                  <span>Free Space: {{ formatBytes(hdd.freeBytes) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- Single-Camera Live Stream & PTZ Modal -->
    <CameraLiveModal
      :open="Boolean(liveModalChannel && activeDevice)"
      :device="activeDevice"
      :channel="liveModalChannel"
      :channels="activeDevice ? activeDevice.channels : []"
      @close="liveModalChannel = null"
      @select-channel="liveModalChannel = $event"
    />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { HikvisionChannel, HikvisionSnapshot, OverviewResponse } from '@shared/types';
import { api } from '@/api/client';
import ProgressBar from '@/components/ProgressBar.vue';
import CameraLiveModal from '@/components/CameraLiveModal.vue';
import { formatBytes, formatUptime } from '@/utils/format';

type HikSubTab = 'live' | 'channels' | 'storage';
type GridLayout = '2x2' | '3x3' | '4x4' | 'all';
type RefreshRate = 'live' | '1s' | '2s' | '5s' | 'paused';

export default defineComponent({
  name: 'HikvisionView',
  components: { ProgressBar, CameraLiveModal },
  props: {
    overview: { type: Object as () => OverviewResponse, required: true },
    initialSubTab: { type: String as () => HikSubTab, default: 'live' },
  },
  setup(props, { emit }) {
    const selectedConfigId = ref('');
    const activeSubTab = ref<HikSubTab>(props.initialSubTab || 'live');
    const gridLayout = ref<GridLayout>('3x3');
    const matrixStreamKind = ref<'sub' | 'main'>('sub');
    const refreshRate = ref<RefreshRate>('1s');
    const currentPage = ref(0);
    const liveModalChannel = ref<HikvisionChannel | null>(null);

    // Map of channelId -> currently rendered double-buffered image URL
    const frameUrls = reactive<Record<number, string>>({});

    const gridOptions: Array<{ id: GridLayout; label: string }> = [
      { id: '2x2', label: '2x2 (4)' },
      { id: '3x3', label: '3x3 (9)' },
      { id: '4x4', label: '4x4 (16)' },
      { id: 'all', label: 'All' },
    ];

    const rateOptions: Array<{ id: RefreshRate; label: string }> = [
      { id: 'live', label: 'Fast' },
      { id: '1s', label: '1s' },
      { id: '2s', label: '2s' },
      { id: '5s', label: '5s' },
      { id: 'paused', label: 'Pause' },
    ];

    const devices = computed<HikvisionSnapshot[]>(() =>
      props.overview && Array.isArray(props.overview.hikvision) ? props.overview.hikvision : [],
    );

    const activeDevice = computed<HikvisionSnapshot | null>(() => {
      if (devices.value.length === 0) return null;
      const found = devices.value.find((d) => d.configId === selectedConfigId.value);
      return found || devices.value[0];
    });

    const recordingCount = computed(() => {
      if (!activeDevice.value) return 0;
      return activeDevice.value.channels.filter((c) => c.recording).length;
    });

    const poeCount = computed(() => {
      if (!activeDevice.value) return 0;
      return activeDevice.value.channels.filter((c) => Boolean(c.poePort)).length;
    });

    const totalHddCapacityBytes = computed(() => {
      if (!activeDevice.value) return 0;
      return activeDevice.value.storageTotalBytes || activeDevice.value.hdds.reduce((acc, h) => acc + h.capacityBytes, 0);
    });

    const totalHddUsedBytes = computed(() => {
      if (!activeDevice.value) return 0;
      return activeDevice.value.storageUsedBytes || activeDevice.value.hdds.reduce((acc, h) => acc + h.usedBytes, 0);
    });

    const pageSize = computed(() => {
      if (gridLayout.value === '2x2') return 4;
      if (gridLayout.value === '3x3') return 9;
      if (gridLayout.value === '4x4') return 16;
      return 64;
    });

    const totalPages = computed(() => {
      if (!activeDevice.value || activeDevice.value.channels.length === 0) return 1;
      return Math.max(1, Math.ceil(activeDevice.value.channels.length / pageSize.value));
    });

    const visibleChannels = computed<HikvisionChannel[]>(() => {
      if (!activeDevice.value) return [];
      const start = currentPage.value * pageSize.value;
      return activeDevice.value.channels.slice(start, start + pageSize.value);
    });

    const pageStartChannelLabel = computed(() => {
      if (visibleChannels.value.length === 0) return '-';
      const first = visibleChannels.value[0];
      const last = visibleChannels.value[visibleChannels.value.length - 1];
      return `CH${pad2(first.id)}–CH${pad2(last.id)}`;
    });

    const tileColClass = computed(() => {
      if (gridLayout.value === '2x2') return 'col-6';
      if (gridLayout.value === '3x3') return 'col-4';
      return 'col-3';
    });

    function pad2(n: number): string {
      return n < 10 ? `0${n}` : `${n}`;
    }

    function setSubTab(tab: HikSubTab) {
      activeSubTab.value = tab;
      emit('change-sub-tab', tab);
    }

    function setGridLayout(layout: GridLayout) {
      gridLayout.value = layout;
      currentPage.value = 0;
    }

    function setMatrixStreamKind(kind: 'sub' | 'main') {
      matrixStreamKind.value = kind;
      restartMatrixPump();
    }

    function setRefreshRate(rate: RefreshRate) {
      refreshRate.value = rate;
      restartMatrixPump();
    }

    function openLiveCamera(ch: HikvisionChannel) {
      liveModalChannel.value = ch;
    }

    // ---- Tear-Free Double-Buffered Matrix Frame Streamer (Android 4.4 Safe) ----
    let matrixPumpId = 0;
    const channelTimers = new Map<number, number>();
    const channelLoaders = new Map<number, HTMLImageElement>();

    function stopMatrixPump() {
      matrixPumpId++;
      channelTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      channelTimers.clear();
      channelLoaders.forEach((img) => {
        img.onload = null;
        img.onerror = null;
        img.src = '';
      });
      channelLoaders.clear();
    }

    function getCadenceDelayMs(): number {
      if (refreshRate.value === 'live') return 260;
      if (refreshRate.value === '1s') return 1000;
      if (refreshRate.value === '2s') return 2000;
      return 5000;
    }

    function startChannelWorker(session: number, configId: string, ch: HikvisionChannel, staggerMs: number) {
      const streamKind = matrixStreamKind.value;

      const schedule = (delayMs: number) => {
        if (session !== matrixPumpId) return;
        const t = window.setTimeout(() => {
          fetchFrame();
        }, delayMs);
        channelTimers.set(ch.id, t);
      };

      const fetchFrame = () => {
        if (session !== matrixPumpId) return;
        if (activeSubTab.value !== 'live' || refreshRate.value === 'paused') return;
        // While focused single-camera modal is open, pause background matrix fetches for other channels to preserve NVR bandwidth
        if (liveModalChannel.value && liveModalChannel.value.id !== ch.id) {
          schedule(1500);
          return;
        }

        const started = Date.now();
        const url = api.getHikvisionSnapshotUrl(configId, ch.id, streamKind, started);
        const img = new Image();
        channelLoaders.set(ch.id, img);

        img.onload = () => {
          if (session !== matrixPumpId) return;
          thisSetFrame(ch.id, url);
          const elapsed = Date.now() - started;
          const wait = Math.max(120, getCadenceDelayMs() - elapsed);
          schedule(wait);
        };

        img.onerror = () => {
          if (session !== matrixPumpId) return;
          schedule(2500);
        };

        img.src = url;
      };

      schedule(staggerMs);
    }

    function thisSetFrame(channelId: number, url: string) {
      // Vue 2.7 reactive assignment on reactive object
      frameUrls[channelId] = url;
    }

    function restartMatrixPump() {
      stopMatrixPump();
      if (!activeDevice.value || activeSubTab.value !== 'live' || refreshRate.value === 'paused') {
        return;
      }
      const session = matrixPumpId;
      const cfgId = activeDevice.value.configId;
      const list = visibleChannels.value.filter((c) => c.online);
      for (let i = 0; i < list.length; i++) {
        // Stagger initial requests by 70ms per camera so NVR is never hit with a simultaneous burst
        startChannelWorker(session, cfgId, list[i], i * 70);
      }
    }

    watch(
      () => props.initialSubTab,
      (val) => {
        if (val && val !== activeSubTab.value) {
          activeSubTab.value = val;
        }
      },
    );

    watch(
      () => [
        activeDevice.value ? activeDevice.value.configId : '',
        activeSubTab.value,
        gridLayout.value,
        currentPage.value,
        visibleChannels.value.map((c) => `${c.id}:${c.online}`).join(','),
      ],
      () => {
        restartMatrixPump();
      },
    );

    onMounted(() => {
      // Auto-select 2x2 if 4 or fewer cameras, 3x3 for up to 9, 4x4 for 10+
      if (activeDevice.value) {
        const count = activeDevice.value.channels.length;
        if (count <= 4) gridLayout.value = '2x2';
        else if (count <= 9) gridLayout.value = '3x3';
        else gridLayout.value = '4x4';
      }
      restartMatrixPump();
    });

    onBeforeUnmount(() => {
      stopMatrixPump();
    });

    return {
      selectedConfigId,
      activeSubTab,
      gridLayout,
      matrixStreamKind,
      refreshRate,
      currentPage,
      liveModalChannel,
      frameUrls,
      gridOptions,
      rateOptions,
      devices,
      activeDevice,
      recordingCount,
      poeCount,
      totalHddCapacityBytes,
      totalHddUsedBytes,
      totalPages,
      visibleChannels,
      pageStartChannelLabel,
      tileColClass,
      pad2,
      setSubTab,
      setGridLayout,
      setMatrixStreamKind,
      setRefreshRate,
      openLiveCamera,
      formatBytes,
      formatUptime,
    };
  },
});
</script>

<style scoped lang="scss">
.hik-device-tabs {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.hik-device-tab {
  margin-right: 8px;
  margin-bottom: 6px;
}

.hik-identity-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
}

.hik-device-title {
  font-size: 17px;
  font-weight: 800;
  color: #f8fafc;
}

.hik-meta-tile {
  background: #0b101b;
  border: 1px solid #1d283d;
  border-radius: 4px;
  padding: 10px 12px;
  height: 100%;
}

.hik-meta-val {
  font-size: 14px;
  font-weight: 800;
  color: #f8fafc;
  margin-top: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hik-serial-text {
  font-size: 12px;
  color: #e2e8f0;
}

.hik-meta-sub {
  font-size: 11px;
  color: #64748b;
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hik-toolbar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.hik-page-bar {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 4px;
  background: #0d1320;
  border: 1px solid #1e293b;
}

.hik-cam-card {
  padding: 0 !important;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid #1f2d46;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: #22d3ee;
  }

  &.hik-cam-offline {
    border-color: rgba(248, 113, 113, 0.35);
  }
}

.hik-cam-viewport {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 16:9 aspect ratio */
  background: #05080f;
  overflow: hidden;
}

.hik-cam-img {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.hik-cam-placeholder {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
}

.hik-cam-overlay-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  padding: 6px 8px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(180deg, rgba(4, 7, 13, 0.82) 0%, rgba(4, 7, 13, 0) 100%);
  pointer-events: none;
}

.hik-cam-tags {
  display: flex;
  flex-direction: row;
  align-items: center;
}

.hik-badge {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(148, 163, 184, 0.3);
  color: #cbd5e1;
  margin-right: 4px;
}

.hik-badge-ch {
  background: rgba(8, 145, 178, 0.85);
  border-color: rgba(34, 211, 238, 0.6);
  color: #f8fafc;
}

.hik-badge-poe {
  background: rgba(109, 40, 217, 0.82);
  border-color: rgba(167, 139, 250, 0.55);
  color: #f3e8ff;
}

.hik-badge-rec {
  background: rgba(185, 28, 28, 0.88);
  border-color: rgba(248, 113, 113, 0.6);
  color: #fef2f2;
}

.hik-cam-overlay-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 10px 10px 7px 10px;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  background: linear-gradient(0deg, rgba(4, 7, 13, 0.92) 0%, rgba(4, 7, 13, 0) 100%);
  pointer-events: none;
}

.hik-cam-name {
  font-size: 13px;
  font-weight: 700;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 8px;
}

.hik-cam-spec {
  font-size: 11px;
  color: #94a3b8;
  white-space: nowrap;
}

.hik-hdd-footer {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  font-size: 12px;
  color: #94a3b8;
  margin-top: 8px;
}

.host-name-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
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
  padding: 36px 20px;
  color: #94a3b8;
}
</style>
