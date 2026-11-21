<template>
  <transition name="modal-pop">
    <div
      v-if="target"
      class="modal-backdrop"
      :class="{ 'backdrop-fullscreen': isFullscreen }"
      @click.self="!isFullscreen && $emit('close')"
    >
      <div
        ref="modalEl"
        class="vnc-modal"
        :class="{ 'vnc-fullscreen': isFullscreen }"
      >
        <!-- Floating Touch Controls Pill when Fullscreen Bars are Hidden -->
        <div v-if="isFullscreen && barsHidden" class="fs-float-bar">
          <button class="btn btn-sm fs-float-btn" type="button" @click="barsHidden = false">
            Show Controls
          </button>
          <button
            class="btn btn-sm btn-primary fs-float-btn"
            style="margin-left: 6px;"
            type="button"
            @click="toggleFullscreen"
          >
            Exit Full
          </button>
        </div>

        <!-- Header -->
        <div v-if="!isFullscreen || !barsHidden" class="vnc-header">
          <div class="vnc-title-group">
            <span
              class="dot"
              :class="
                status === 'connected'
                  ? 'dot-ok pulse'
                  : status === 'connecting'
                    ? 'dot-warn pulse'
                    : 'dot-crit'
              "
            ></span>
            <span class="vnc-title font-mono">VNC &middot; {{ target.title }}</span>
            <span
              class="pill"
              style="margin-left: 8px; font-size: 11px;"
              :class="
                status === 'connected'
                  ? 'pill-ok'
                  : status === 'connecting'
                    ? 'pill-warn'
                    : 'pill-crit'
              "
            >
              {{ status.toUpperCase() }}
            </span>
          </div>

          <div class="vnc-head-actions">
            <button
              v-if="isFullscreen"
              class="btn btn-sm"
              type="button"
              @click="barsHidden = true"
            >
              Hide Bars
            </button>
            <button
              class="btn btn-sm"
              :class="{ 'btn-primary': isFullscreen }"
              style="margin-left: 6px;"
              type="button"
              @click="toggleFullscreen"
            >
              {{ isFullscreen ? 'Exit Full' : 'Fullscreen' }}
            </button>
            <button class="btn btn-sm" style="margin-left: 6px;" type="button" @click="toggleScale">
              {{ scaleViewport ? 'Fit: ON' : '1:1 Native' }}
            </button>
            <button class="btn btn-sm" style="margin-left: 6px;" type="button" @click="reconnect">
              Reconnect
            </button>
            <button
              class="btn btn-sm btn-ghost"
              style="margin-left: 6px;"
              type="button"
              @click="handleClose"
            >
              Close
            </button>
          </div>
        </div>

        <div v-if="errorMsg" class="vnc-error">{{ errorMsg }}</div>

        <!-- VNC Canvas Viewport -->
        <div class="vnc-stage">
          <div v-if="isDemoMode" class="vnc-demo-box font-mono">
            <div class="text-cyan-400 text-base font-bold mb-2">DEMO VNC DISPLAY &middot; {{ target.title }}</div>
            <div class="text-slate-400 text-xs leading-relaxed" style="max-width: 480px;">
              Connect a real Proxmox VE host in <strong>Settings</strong> or <strong>Proxmox</strong> to stream live full-color graphical VNC sessions directly from your QEMU VMs via Proxmox <span class="text-slate-200">vncproxy</span> + WebSocket RFB.
            </div>
          </div>
          <div ref="stageEl" class="vnc-canvas-host" :style="{ display: isDemoMode ? 'none' : 'flex' }"></div>
        </div>

        <!-- Touchscreen VM Key Toolbar -->
        <div v-if="!isFullscreen || !barsHidden" class="vnc-keys">
          <button
            class="btn btn-sm btn-warn vnc-key-btn"
            type="button"
            :disabled="status !== 'connected'"
            @click="sendCtrlAltDel"
          >
            Ctrl+Alt+Del
          </button>
          <button
            class="btn btn-sm vnc-key-btn"
            type="button"
            :disabled="status !== 'connected'"
            @click="tapKey(0xff1b)"
          >
            Esc
          </button>
          <button
            class="btn btn-sm vnc-key-btn"
            type="button"
            :disabled="status !== 'connected'"
            @click="tapKey(0xff09)"
          >
            Tab
          </button>
          <button
            class="btn btn-sm vnc-key-btn"
            type="button"
            :disabled="status !== 'connected'"
            @click="tapKey(0xff0d)"
          >
            Enter
          </button>
          <button
            class="btn btn-sm vnc-key-btn"
            type="button"
            :disabled="status !== 'connected'"
            @click="tapKey(0xffeb)"
          >
            Super / Win
          </button>
          <button
            class="btn btn-sm vnc-key-btn"
            type="button"
            :disabled="status !== 'connected'"
            @click="focusCanvas"
          >
            Focus Screen
          </button>
        </div>

        <!-- Touch Soft-Keyboard Text Sender -->
        <div v-if="!isFullscreen || !barsHidden" class="vnc-input-bar">
          <input
            v-model="textToType"
            class="input font-mono"
            style="min-height: 44px; flex: 1;"
            type="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Type text on touchscreen and tap Send to type into VM..."
            @keyup.enter="sendTypedText(true)"
          />
          <button
            class="btn btn-primary"
            style="margin-left: 8px; min-height: 44px;"
            type="button"
            :disabled="status !== 'connected' || !textToType"
            @click="sendTypedText(false)"
          >
            Type
          </button>
          <button
            class="btn btn-success"
            style="margin-left: 6px; min-height: 44px;"
            type="button"
            :disabled="status !== 'connected'"
            @click="sendTypedText(true)"
          >
            Type + Enter
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script lang="ts">
import { defineComponent, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import RFB from '@novnc/novnc/core/rfb.js';
import { api } from '@/api/client';
import { getAuthToken } from '@/api/auth';

export interface VncTarget {
  configId: string;
  node: string;
  type: 'qemu' | 'lxc';
  vmid: number;
  title: string;
}

export default defineComponent({
  name: 'VncModal',
  props: {
    target: { type: Object as () => VncTarget | null, default: null },
  },
  setup(props, { emit }) {
    const modalEl = ref<HTMLElement | null>(null);
    const stageEl = ref<HTMLElement | null>(null);
    const status = ref<'connecting' | 'connected' | 'disconnected'>('connecting');
    const errorMsg = ref('');
    const scaleViewport = ref(true);
    const isDemoMode = ref(false);
    const textToType = ref('');
    const isFullscreen = ref(false);
    const barsHidden = ref(false);

    let rfb: RFB | null = null;
    let connectSeq = 0;

    function triggerVncReflow() {
      void nextTick(() => {
        window.setTimeout(() => {
          try {
            window.dispatchEvent(new Event('resize'));
          } catch {
            // Android 4.4 fallback
            const evt = document.createEvent('UIEvents');
            evt.initEvent('resize', true, false);
            window.dispatchEvent(evt);
          }
          if (rfb) {
            rfb.scaleViewport = scaleViewport.value;
          }
        }, 120);
      });
    }

    function exitNativeFullscreen() {
      const doc: any = document;
      try {
        if (doc.fullscreenElement || doc.webkitFullscreenElement) {
          if (doc.exitFullscreen) void doc.exitFullscreen();
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
        barsHidden.value = false;
        exitNativeFullscreen();
      } else {
        const el: any = modalEl.value;
        try {
          if (el && el.requestFullscreen) {
            const p = el.requestFullscreen();
            if (p && typeof p.catch === 'function') p.catch(() => undefined);
          } else if (el && el.webkitRequestFullscreen) {
            el.webkitRequestFullscreen();
          }
        } catch {
          // CSS viewport fullscreen remains active
        }
      }
      triggerVncReflow();
    }

    function onNativeFullscreenChange() {
      const doc: any = document;
      const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (!fsEl && isFullscreen.value) {
        isFullscreen.value = false;
        barsHidden.value = false;
        triggerVncReflow();
      }
    }

    function handleClose() {
      if (isFullscreen.value) {
        isFullscreen.value = false;
        barsHidden.value = false;
        exitNativeFullscreen();
      }
      emit('close');
    }

    watch(barsHidden, () => {
      triggerVncReflow();
    });

    function destroyRfb() {
      if (rfb) {
        try {
          rfb.disconnect();
        } catch {
          // ignore
        }
        rfb = null;
      }
      if (stageEl.value) {
        stageEl.value.innerHTML = '';
      }
    }

    async function connectVnc(t: VncTarget) {
      const seq = ++connectSeq;
      destroyRfb();
      status.value = 'connecting';
      errorMsg.value = '';
      isDemoMode.value = false;

      try {
        const session = await api.createProxmoxVnc(t.configId, t.node, t.type, t.vmid);
        if (seq !== connectSeq) return;

        if (session.demo) {
          isDemoMode.value = true;
          status.value = 'connected';
          return;
        }

        await nextTick();
        if (seq !== connectSeq || !stageEl.value) return;

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const authToken = getAuthToken();
        const wsUrl = `${proto}//${window.location.host}/ws/vnc?token=${encodeURIComponent(session.token)}${authToken ? `&auth=${encodeURIComponent(authToken)}` : ''}`;

        const client = new RFB(stageEl.value, wsUrl, {
          credentials: { password: session.password },
          wsProtocols: ['binary'],
        });
        client.scaleViewport = scaleViewport.value;
        client.resizeSession = true;
        client.clipViewport = false;
        client.background = '#05080e';

        client.addEventListener('connect', () => {
          if (rfb !== client) return;
          status.value = 'connected';
          errorMsg.value = '';
          client.focus();
        });

        client.addEventListener('disconnect', (e: any) => {
          if (rfb !== client) return;
          status.value = 'disconnected';
          if (e && e.detail && !e.detail.clean) {
            errorMsg.value = 'VNC session disconnected unexpectedly. Tap Reconnect to try again.';
          }
        });

        client.addEventListener('securityfailure', (e: any) => {
          if (rfb !== client) return;
          status.value = 'disconnected';
          errorMsg.value =
            (e && e.detail && e.detail.reason) || 'Proxmox VNC authentication failed.';
        });

        rfb = client;
      } catch (err) {
        if (seq !== connectSeq) return;
        status.value = 'disconnected';
        errorMsg.value = err instanceof Error ? err.message : 'Failed to start Proxmox VNC session';
      }
    }

    function toggleScale() {
      scaleViewport.value = !scaleViewport.value;
      if (rfb) rfb.scaleViewport = scaleViewport.value;
    }

    function reconnect() {
      if (props.target) void connectVnc(props.target);
    }

    function sendCtrlAltDel() {
      if (rfb) rfb.sendCtrlAltDel();
    }

    function tapKey(keysym: number) {
      if (rfb) {
        rfb.sendKey(keysym, null, true);
        rfb.sendKey(keysym, null, false);
      }
    }

    function focusCanvas() {
      if (rfb) rfb.focus();
    }

    function sendTypedText(withEnter: boolean) {
      if (!rfb) return;
      const text = textToType.value;
      textToType.value = '';
      for (let i = 0; i < text.length; i++) {
        const cp = text.charCodeAt(i);
        const keysym = cp < 0x100 ? cp : 0x01000000 | cp;
        rfb.sendKey(keysym, null, true);
        rfb.sendKey(keysym, null, false);
      }
      if (withEnter) {
        tapKey(0xff0d);
      }
    }

    watch(
      () => props.target,
      (val) => {
        if (val) {
          document.addEventListener('fullscreenchange', onNativeFullscreenChange);
          document.addEventListener('webkitfullscreenchange', onNativeFullscreenChange);
          void connectVnc(val);
        } else {
          isFullscreen.value = false;
          barsHidden.value = false;
          exitNativeFullscreen();
          document.removeEventListener('fullscreenchange', onNativeFullscreenChange);
          document.removeEventListener('webkitfullscreenchange', onNativeFullscreenChange);
          connectSeq++;
          destroyRfb();
        }
      },
      { immediate: true },
    );

    onBeforeUnmount(() => {
      exitNativeFullscreen();
      document.removeEventListener('fullscreenchange', onNativeFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onNativeFullscreenChange);
      connectSeq++;
      destroyRfb();
    });

    return {
      modalEl,
      stageEl,
      status,
      errorMsg,
      scaleViewport,
      isDemoMode,
      textToType,
      isFullscreen,
      barsHidden,
      toggleFullscreen,
      handleClose,
      toggleScale,
      reconnect,
      sendCtrlAltDel,
      tapKey,
      focusCanvas,
      sendTypedText,
    };
  },
});
</script>

<style scoped lang="scss">
.backdrop-fullscreen {
  padding: 0 !important;
}

.vnc-modal {
  position: relative;
  width: 100%;
  max-width: 1120px;
  height: 90vh;
  max-height: 860px;
  background: #0d121c;
  border: 1px solid #2d3d5c;
  border-radius: 6px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.78);
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &.vnc-fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    max-width: none;
    height: 100%;
    max-height: none;
    border-radius: 0;
    border: none;
    z-index: 420;
  }
}

.fs-float-bar {
  position: absolute;
  top: 10px;
  right: 12px;
  z-index: 20;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 6px;
  border-radius: 6px;
  background: rgba(13, 18, 28, 0.88);
  border: 1px solid #2d3d5c;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
}

.fs-float-btn {
  min-height: 44px;
  padding: 0 14px;
}

.vnc-header {
  padding: 12px 16px;
  background: #121826;
  border-bottom: 1px solid #1f2a40;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.vnc-title-group {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-width: 0;
}

.vnc-title {
  font-size: 15px;
  font-weight: 800;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vnc-head-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}

.vnc-error {
  padding: 10px 14px;
  background: rgba(220, 38, 38, 0.18);
  border-bottom: 1px solid rgba(248, 113, 113, 0.45);
  color: #fecaca;
  font-size: 13px;
  flex-shrink: 0;
}

.vnc-stage {
  flex: 1;
  min-height: 0;
  background: #05080e;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.vnc-canvas-host {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vnc-demo-box {
  text-align: center;
  padding: 28px;
  border: 1px dashed #243047;
  border-radius: 6px;
  background: #0b1019;
}

.vnc-keys {
  padding: 8px 12px 2px 12px;
  background: #0f1522;
  border-top: 1px solid #1f2a40;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.vnc-key-btn {
  min-height: 36px;
  padding: 0 11px;
  font-size: 12px;
  margin-right: 6px;
  margin-bottom: 6px;
}

.vnc-input-bar {
  padding: 8px 12px 12px 12px;
  background: #0f1522;
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}
</style>
