<template>
  <transition name="modal-fade">
    <div
      v-if="open && channel && device"
      class="modal-backdrop"
      :class="{ 'cam-backdrop-fullscreen': isFullscreen }"
      @click.self="handleClose"
    >
      <div
        ref="modalCardEl"
        class="cam-modal-card"
        :class="{
          'cam-modal-fullscreen': isFullscreen,
          'cam-modal-chromeless': isFullscreen && hideBars,
        }"
      >
        <!-- Floating Top-Right Pill in Fullscreen Chromeless Mode -->
        <div v-if="isFullscreen && hideBars" class="cam-fs-floating-pill">
          <button class="btn btn-sm" type="button" @click="hideBars = false">
            Show Controls
          </button>
          <button
            class="btn btn-sm btn-danger"
            type="button"
            style="margin-left: 6px;"
            @click="toggleFullscreen"
          >
            Exit Full
          </button>
        </div>

        <!-- Top Header Bar -->
        <div v-show="!isFullscreen || !hideBars" class="cam-header">
          <div class="cam-title-group">
            <span class="dot" :class="channel.online ? 'dot-ok pulse' : 'dot-crit'"></span>
            <span class="pill pill-cyan mono" style="margin-right: 8px;">CH{{ pad2(channel.id) }}</span>
            <span class="cam-title">{{ channel.name }}</span>
            <span v-if="channel.recording" class="pill pill-crit mono" style="margin-left: 8px;">
              &bull; REC
            </span>
            <span v-if="channel.poePort" class="pill pill-violet mono" style="margin-left: 6px;">
              PoE #{{ channel.poePort }}
            </span>
            <span v-if="channel.codec" class="pill pill-muted mono" style="margin-left: 6px;">
              {{ channel.codec }} &middot; {{ channel.resolution }}
            </span>
          </div>

          <div class="btn-group">
            <!-- Prev / Next Camera Navigation -->
            <button
              v-if="channels.length > 1"
              class="btn btn-sm"
              type="button"
              @click="stepChannel(-1)"
            >
              &larr; Prev
            </button>
            <button
              v-if="channels.length > 1"
              class="btn btn-sm"
              type="button"
              @click="stepChannel(1)"
            >
              Next &rarr;
            </button>

            <!-- Stream Quality Toggle -->
            <button
              class="btn btn-sm"
              :class="{ 'btn-primary': streamKind === 'sub' }"
              type="button"
              @click="setStreamKind('sub')"
            >
              SD (Sub)
            </button>
            <button
              class="btn btn-sm"
              :class="{ 'btn-primary': streamKind === 'main' }"
              type="button"
              @click="setStreamKind('main')"
            >
              HD (Main)
            </button>

            <!-- Live Engine Mode -->
            <button
              class="btn btn-sm"
              :class="{ 'btn-primary': transportMode === 'continuous' }"
              type="button"
              @click="setTransportMode('continuous')"
            >
              Live
            </button>
            <button
              class="btn btn-sm"
              :class="{ 'btn-primary': transportMode === 'mjpeg' }"
              type="button"
              @click="setTransportMode('mjpeg')"
            >
              MJPEG
            </button>
            <button
              class="btn btn-sm"
              :class="{ 'btn-primary': transportMode === '1s' }"
              type="button"
              @click="setTransportMode('1s')"
            >
              1 FPS
            </button>

            <button
              v-if="channel.ptzSupported"
              class="btn btn-sm"
              :class="{ 'btn-primary': showPtzPad }"
              type="button"
              @click="showPtzPad = !showPtzPad"
            >
              PTZ
            </button>

            <button
              class="btn btn-sm"
              :class="{ 'btn-primary': isFullscreen }"
              type="button"
              @click="toggleFullscreen"
            >
              {{ isFullscreen ? 'Exit Full' : 'Fullscreen' }}
            </button>
            <button
              v-if="isFullscreen"
              class="btn btn-sm"
              type="button"
              @click="hideBars = true"
            >
              Hide Bars
            </button>
            <button class="btn btn-sm btn-danger" type="button" @click="handleClose">
              Close
            </button>
          </div>
        </div>

        <!-- Video Stage (Double-Buffered Tear-Free <img> + Optional Multipart MJPEG) -->
        <div class="cam-stage">
          <img
            v-if="transportMode === 'mjpeg'"
            :key="`mjpeg-${device.configId}-${channel.id}-${streamKind}-${mjpegNonce}`"
            :src="mjpegSrc"
            class="cam-video-img"
            :alt="channel.name"
            @load="onMjpegLoad"
            @error="onMjpegError"
          />
          <img
            v-else-if="displaySrc"
            :src="displaySrc"
            class="cam-video-img"
            :alt="channel.name"
          />

          <div v-if="!channel.online" class="cam-overlay-center">
            <div class="cam-status-box cam-status-err">
              <div class="mono" style="font-size: 15px; font-weight: 800;">CAMERA OFFLINE</div>
              <div style="font-size: 12px; margin-top: 4px;">
                {{ channel.ipAddress ? `Target IP ${channel.ipAddress} is not responding` : 'No video signal on this channel' }}
              </div>
            </div>
          </div>

          <div v-else-if="loadingFirstFrame && !displaySrc && transportMode !== 'mjpeg'" class="cam-overlay-center">
            <div class="cam-status-box">
              <div class="mono" style="color: #22d3ee; font-weight: 700;">
                Connecting to {{ device.name }} &middot; CH{{ pad2(channel.id) }}...
              </div>
            </div>
          </div>

          <div v-else-if="frameError" class="cam-overlay-bottom-left">
            <div class="cam-error-pill mono">
              {{ frameError }}
            </div>
          </div>

          <!-- Top-Left Live Telemetry HUD Overlay -->
          <div class="cam-hud-top-left mono">
            <span class="cam-hud-badge">
              {{ device.model !== '-' ? device.model : device.name }}
            </span>
            <span class="cam-hud-badge">
              {{ streamKind === 'main' ? 'MAIN STREAM' : 'SUB STREAM' }}
            </span>
            <span v-if="lastLatencyMs > 0 && transportMode !== 'mjpeg'" class="cam-hud-badge">
              {{ currentFps.toFixed(1) }} FPS &middot; {{ lastLatencyMs }}ms
            </span>
            <span v-else-if="transportMode === 'mjpeg'" class="cam-hud-badge">
              MULTIPART MJPEG
            </span>
          </div>

          <!-- Interactive Touch PTZ Control Pad Overlay -->
          <div v-if="showPtzPad" class="cam-ptz-pad" @click.stop>
            <div class="cam-ptz-header mono">
              <span>PTZ CONTROL (CH{{ pad2(channel.id) }})</span>
              <span v-if="ptzStatus" class="cam-ptz-status">{{ ptzStatus }}</span>
            </div>
            <div class="cam-ptz-grid">
              <div class="cam-ptz-row">
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-btn"
                  @mousedown.prevent="startPtz(-40, 40, 0)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(-40, 40, 0)"
                  @touchend.prevent="stopPtz"
                >
                  &#8598;
                </button>
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-btn"
                  @mousedown.prevent="startPtz(0, 50, 0)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(0, 50, 0)"
                  @touchend.prevent="stopPtz"
                >
                  &uarr;
                </button>
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-btn"
                  @mousedown.prevent="startPtz(40, 40, 0)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(40, 40, 0)"
                  @touchend.prevent="stopPtz"
                >
                  &#8599;
                </button>
              </div>
              <div class="cam-ptz-row">
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-btn"
                  @mousedown.prevent="startPtz(-50, 0, 0)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(-50, 0, 0)"
                  @touchend.prevent="stopPtz"
                >
                  &larr;
                </button>
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-btn cam-ptz-stop"
                  @click.prevent="stopPtz"
                >
                  STOP
                </button>
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-btn"
                  @mousedown.prevent="startPtz(50, 0, 0)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(50, 0, 0)"
                  @touchend.prevent="stopPtz"
                >
                  &rarr;
                </button>
              </div>
              <div class="cam-ptz-row">
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-btn"
                  @mousedown.prevent="startPtz(-40, -40, 0)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(-40, -40, 0)"
                  @touchend.prevent="stopPtz"
                >
                  &#8601;
                </button>
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-btn"
                  @mousedown.prevent="startPtz(0, -50, 0)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(0, -50, 0)"
                  @touchend.prevent="stopPtz"
                >
                  &darr;
                </button>
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-btn"
                  @mousedown.prevent="startPtz(40, -40, 0)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(40, -40, 0)"
                  @touchend.prevent="stopPtz"
                >
                  &#8600;
                </button>
              </div>
              <div class="cam-ptz-zoom-row">
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-zoom-btn"
                  @mousedown.prevent="startPtz(0, 0, -40)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(0, 0, -40)"
                  @touchend.prevent="stopPtz"
                >
                  &minus; Zoom Out
                </button>
                <button
                  type="button"
                  class="btn btn-sm cam-ptz-zoom-btn"
                  @mousedown.prevent="startPtz(0, 0, 40)"
                  @mouseup.prevent="stopPtz"
                  @touchstart.prevent="startPtz(0, 0, 40)"
                  @touchend.prevent="stopPtz"
                >
                  + Zoom In
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Bottom Metadata Bar -->
        <div v-show="!isFullscreen || !hideBars" class="cam-footer mono">
          <div>
            <span><strong>NVR/Host:</strong> {{ device.name }} ({{ device.host }})</span>
            <span v-if="channel.ipAddress" style="margin-left: 14px;">
              <strong>Cam IP:</strong> {{ channel.ipAddress }}
            </span>
            <span v-if="channel.protocol && channel.protocol !== '-'" style="margin-left: 14px;">
              <strong>Protocol:</strong> {{ channel.protocol }}
            </span>
          </div>
          <div>
            <span>
              {{ channel.codec }} &middot; {{ channel.resolution }} &middot; {{ channel.fps }} fps &middot;
              {{ channel.bitrateKbps }} kbps
            </span>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import type { HikvisionChannel, HikvisionSnapshot } from '@shared/types';
import { api } from '@/api/client';

export default defineComponent({
  name: 'CameraLiveModal',
  props: {
    open: { type: Boolean, default: false },
    device: { type: Object as () => HikvisionSnapshot | null, default: null },
    channel: { type: Object as () => HikvisionChannel | null, default: null },
    channels: { type: Array as () => HikvisionChannel[], default: () => [] },
  },
  setup(props, { emit }) {
    const modalCardEl = ref<HTMLElement | null>(null);
    const streamKind = ref<'sub' | 'main'>('sub');
    const transportMode = ref<'continuous' | 'mjpeg' | '1s'>('continuous');
    const isFullscreen = ref(false);
    const hideBars = ref(false);
    const showPtzPad = ref(false);
    const ptzStatus = ref('');

    const displaySrc = ref('');
    const loadingFirstFrame = ref(false);
    const frameError = ref('');
    const lastLatencyMs = ref(0);
    const currentFps = ref(0);
    const mjpegNonce = ref(Date.now());

    let pumpTimer: number | null = null;
    let activePreloader: HTMLImageElement | null = null;
    let pumpSessionId = 0;

    function pad2(n: number): string {
      return n < 10 ? `0${n}` : `${n}`;
    }

    const mjpegSrc = computed(() => {
      if (!props.device || !props.channel) return '';
      return api.getHikvisionMjpegUrl(
        props.device.configId,
        props.channel.id,
        streamKind.value,
        'auto',
        streamKind.value === 'main' ? 5 : 8,
        mjpegNonce.value,
      );
    });

    function stopFramePump() {
      pumpSessionId++;
      if (pumpTimer !== null) {
        window.clearTimeout(pumpTimer);
        pumpTimer = null;
      }
      if (activePreloader) {
        activePreloader.onload = null;
        activePreloader.onerror = null;
        activePreloader.src = '';
        activePreloader = null;
      }
    }

    function startFramePump() {
      stopFramePump();
      if (!props.open || !props.device || !props.channel) return;
      if (transportMode.value === 'mjpeg') return;
      if (!props.channel.online) return;

      const session = pumpSessionId;
      const cfgId = props.device.configId;
      const chId = props.channel.id;
      const sKind = streamKind.value;
      loadingFirstFrame.value = !displaySrc.value;

      const scheduleNext = (delayMs: number) => {
        if (session !== pumpSessionId) return;
        pumpTimer = window.setTimeout(() => {
          loadSingleFrame();
        }, delayMs);
      };

      const loadSingleFrame = () => {
        if (session !== pumpSessionId || !props.open) return;
        const startedAt = Date.now();
        const url = api.getHikvisionSnapshotUrl(cfgId, chId, sKind, startedAt);
        const img = new Image();
        activePreloader = img;

        img.onload = () => {
          if (session !== pumpSessionId) return;
          const elapsed = Math.max(1, Date.now() - startedAt);
          lastLatencyMs.value = elapsed;
          const targetDelay = transportMode.value === '1s' ? Math.max(200, 1000 - elapsed) : 80;
          const cycleMs = elapsed + targetDelay;
          currentFps.value = Math.min(25, Math.round((1000 / Math.max(60, cycleMs)) * 10) / 10);
          displaySrc.value = url;
          loadingFirstFrame.value = false;
          frameError.value = '';
          scheduleNext(targetDelay);
        };

        img.onerror = () => {
          if (session !== pumpSessionId) return;
          loadingFirstFrame.value = false;
          frameError.value = 'Stream frame timeout — retrying...';
          scheduleNext(1500);
        };

        img.src = url;
      };

      loadSingleFrame();
    }

    function onMjpegLoad() {
      frameError.value = '';
    }

    function onMjpegError() {
      // Automatically fall back to double-buffered continuous frame mode if multipart MJPEG fails
      frameError.value = 'MJPEG stream unsupported on this browser/channel — switched to Live Frame mode';
      transportMode.value = 'continuous';
      startFramePump();
    }

    function setStreamKind(kind: 'sub' | 'main') {
      if (streamKind.value === kind) return;
      streamKind.value = kind;
      mjpegNonce.value = Date.now();
      startFramePump();
    }

    function setTransportMode(mode: 'continuous' | 'mjpeg' | '1s') {
      if (transportMode.value === mode) return;
      transportMode.value = mode;
      if (mode === 'mjpeg') {
        stopFramePump();
        mjpegNonce.value = Date.now();
      } else {
        startFramePump();
      }
    }

    function stepChannel(delta: number) {
      if (!props.channel || props.channels.length < 2) return;
      const idx = props.channels.findIndex((c) => c.id === props.channel!.id);
      if (idx === -1) return;
      const nextIdx = (idx + delta + props.channels.length) % props.channels.length;
      emit('select-channel', props.channels[nextIdx]);
    }

    async function startPtz(pan: number, tilt: number, zoom: number) {
      if (!props.device || !props.channel) return;
      ptzStatus.value = 'MOVING...';
      try {
        const res = await api.hikvisionPtz(props.device.configId, props.channel.id, pan, tilt, zoom);
        ptzStatus.value = res.ok ? 'ACTIVE' : res.message;
      } catch (err) {
        ptzStatus.value = err instanceof Error ? err.message : 'PTZ failed';
      }
    }

    async function stopPtz() {
      if (!props.device || !props.channel) return;
      try {
        await api.hikvisionPtz(props.device.configId, props.channel.id, 0, 0, 0);
        ptzStatus.value = 'STOPPED';
      } catch {
        // ignore
      }
    }

    function exitNativeFullscreenIfActive() {
      try {
        const doc: any = document;
        const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
        if (fsEl && modalCardEl.value && (fsEl === modalCardEl.value || modalCardEl.value.contains(fsEl))) {
          if (doc.exitFullscreen) doc.exitFullscreen();
          else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
        }
      } catch {
        // ignore
      }
    }

    function toggleFullscreen() {
      const next = !isFullscreen.value;
      isFullscreen.value = next;
      if (!next) {
        hideBars.value = false;
        exitNativeFullscreenIfActive();
      } else {
        try {
          const el: any = modalCardEl.value;
          const doc: any = document;
          if (el && !doc.fullscreenElement && !doc.webkitFullscreenElement) {
            if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
            else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
          }
        } catch {
          // CSS fullscreen fallback works on Android 4.4
        }
      }
    }

    function onNativeFullscreenChange() {
      try {
        const doc: any = document;
        const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
        if (!fsEl && isFullscreen.value) {
          isFullscreen.value = false;
          hideBars.value = false;
        }
      } catch {
        // ignore
      }
    }

    function handleClose() {
      stopFramePump();
      exitNativeFullscreenIfActive();
      isFullscreen.value = false;
      hideBars.value = false;
      emit('close');
    }

    watch(
      () => [props.open, props.device ? props.device.configId : '', props.channel ? props.channel.id : 0],
      () => {
        displaySrc.value = '';
        frameError.value = '';
        if (props.open && props.device && props.channel) {
          showPtzPad.value = Boolean(props.channel.ptzSupported);
          mjpegNonce.value = Date.now();
          startFramePump();
        } else {
          stopFramePump();
        }
      },
    );

    onMounted(() => {
      document.addEventListener('fullscreenchange', onNativeFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onNativeFullscreenChange);
    });

    onBeforeUnmount(() => {
      stopFramePump();
      exitNativeFullscreenIfActive();
      document.removeEventListener('fullscreenchange', onNativeFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onNativeFullscreenChange);
    });

    return {
      modalCardEl,
      streamKind,
      transportMode,
      isFullscreen,
      hideBars,
      showPtzPad,
      ptzStatus,
      displaySrc,
      mjpegSrc,
      mjpegNonce,
      loadingFirstFrame,
      frameError,
      lastLatencyMs,
      currentFps,
      pad2,
      setStreamKind,
      setTransportMode,
      stepChannel,
      startPtz,
      stopPtz,
      onMjpegLoad,
      onMjpegError,
      toggleFullscreen,
      handleClose,
    };
  },
});
</script>

<style scoped lang="scss">
.cam-backdrop-fullscreen {
  padding: 0 !important;
}

.cam-modal-card {
  width: 100%;
  max-width: 1120px;
  height: 84vh;
  max-height: 780px;
  background: #070b12;
  border: 1px solid #263554;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 25px 70px rgba(0, 0, 0, 0.85);
  position: relative;

  &.cam-modal-fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    max-width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
    border: none;
    z-index: 260;
  }
}

.cam-fs-floating-pill {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 40;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 4px 6px;
  border-radius: 4px;
  background: rgba(9, 13, 22, 0.85);
  border: 1px solid rgba(56, 189, 248, 0.45);
}

.cam-header {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: #0e1422;
  border-bottom: 1px solid #1e293b;
}

.cam-title-group {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-wrap: wrap;
  margin-right: 8px;
}

.cam-title {
  font-size: 16px;
  font-weight: 800;
  color: #f8fafc;
}

.cam-stage {
  flex: 1;
  background: #030509;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.cam-video-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  user-select: none;
}

.cam-overlay-center {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  pointer-events: none;
}

.cam-status-box {
  padding: 16px 22px;
  border-radius: 4px;
  background: rgba(11, 16, 27, 0.9);
  border: 1px solid #1f2d47;
  color: #cbd5e1;
  text-align: center;
}

.cam-status-err {
  border-color: rgba(248, 113, 113, 0.5);
  color: #fecaca;
}

.cam-overlay-bottom-left {
  position: absolute;
  bottom: 12px;
  left: 12px;
  z-index: 20;
}

.cam-error-pill {
  padding: 6px 10px;
  border-radius: 4px;
  background: rgba(127, 29, 29, 0.88);
  border: 1px solid rgba(248, 113, 113, 0.5);
  color: #fecaca;
  font-size: 11px;
}

.cam-hud-top-left {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 15;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  pointer-events: none;
}

.cam-hud-badge {
  padding: 3px 8px;
  margin-right: 6px;
  margin-bottom: 4px;
  border-radius: 3px;
  background: rgba(6, 10, 18, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.28);
  color: #e2e8f0;
  font-size: 11px;
  font-weight: 700;
}

/* Touch PTZ Pad */
.cam-ptz-pad {
  position: absolute;
  bottom: 14px;
  right: 14px;
  z-index: 25;
  width: 224px;
  padding: 10px;
  border-radius: 6px;
  background: rgba(11, 16, 27, 0.92);
  border: 1px solid #263554;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.75);
}

.cam-ptz-header {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
  color: #94a3b8;
  margin-bottom: 8px;
}

.cam-ptz-status {
  color: #22d3ee;
}

.cam-ptz-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  margin-bottom: 6px;
}

.cam-ptz-btn {
  flex: 1;
  min-height: 44px;
  margin: 0 3px;
  font-size: 16px;
  font-weight: 800;
  padding: 0;
}

.cam-ptz-stop {
  font-size: 11px;
  color: #38bdf8;
}

.cam-ptz-zoom-row {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  margin-top: 6px;
}

.cam-ptz-zoom-btn {
  flex: 1;
  min-height: 42px;
  margin: 0 3px;
  font-size: 12px;
  font-weight: 700;
}

.cam-footer {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 8px 14px;
  background: #0b101b;
  border-top: 1px solid #1e293b;
  font-size: 12px;
  color: #94a3b8;
}
</style>
