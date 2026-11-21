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
        class="term-modal"
        :class="{ 'term-fullscreen': isFullscreen }"
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

        <div v-if="!isFullscreen || !barsHidden" class="term-header">
          <div class="term-title-group">
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
            <span class="term-title mono">&gt;_ {{ target.title }}</span>
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
          <div class="term-head-actions">
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

        <div v-if="errorMsg" class="term-error">{{ errorMsg }}</div>

        <!-- Interactive Terminal Output Viewport (click to type directly on desktop) -->
        <div
          ref="screenEl"
          class="term-screen mono"
          tabindex="0"
          @keydown="onDirectKeydown"
          @paste="onDirectPaste"
        >
          <div class="term-content" v-html="renderedHtml"></div>
          <span v-if="status === 'connected'" class="term-cursor">&nbsp;</span>
        </div>

        <!-- Touch Control Keys Bar -->
        <div v-if="!isFullscreen || !barsHidden" class="term-keys">
          <button class="btn btn-sm key-btn" type="button" @click="sendRaw('\x03')">Ctrl+C</button>
          <button class="btn btn-sm key-btn" type="button" @click="sendRaw('\x04')">Ctrl+D</button>
          <button class="btn btn-sm key-btn" type="button" @click="sendRaw('\t')">Tab</button>
          <button class="btn btn-sm key-btn" type="button" @click="sendRaw('\x1b')">Esc</button>
          <button class="btn btn-sm key-btn" type="button" @click="sendRaw('\x1b[A')">&uarr;</button>
          <button class="btn btn-sm key-btn" type="button" @click="sendRaw('\x1b[B')">&darr;</button>
          <button class="btn btn-sm key-btn" type="button" @click="clearScreen">Clear</button>
        </div>

        <!-- Touchscreen Command Line Input -->
        <div v-if="!isFullscreen || !barsHidden" class="term-input-bar">
          <input
            ref="inputEl"
            v-model="commandLine"
            class="input mono"
            style="min-height: 44px; flex: 1;"
            type="text"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Type command and tap Send (or click terminal above for live keys)..."
            @keyup.enter="sendCommandLine"
          />
          <button
            class="btn btn-primary"
            style="margin-left: 8px; min-height: 44px;"
            type="button"
            :disabled="status !== 'connected'"
            @click="sendCommandLine"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { getAuthToken } from '@/api/auth';

export interface TerminalTarget {
  kind: 'ssh' | 'proxmox-lxc' | 'proxmox-qemu' | 'proxmox-node';
  title: string;
  serverId?: string;
  configId?: string;
  node?: string;
  vmid?: number;
  name?: string;
}

const ANSI_COLORS: Record<number, string> = {
  30: '#475569',
  31: '#f87171',
  32: '#34d399',
  33: '#fbbf24',
  34: '#60a5fa',
  35: '#c084fc',
  36: '#22d3ee',
  37: '#e2e8f0',
  90: '#64748b',
  91: '#fca5a5',
  92: '#6ee7b7',
  93: '#fde68a',
  94: '#93c5fd',
  95: '#d8b4fe',
  96: '#67e8f9',
  97: '#ffffff',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function ansi256ToHex(n: number): string {
  if (n < 0 || n > 255) return '';
  if (n < 8) return ANSI_COLORS[30 + n] || '';
  if (n < 16) return ANSI_COLORS[90 + (n - 8)] || '';
  if (n < 232) {
    const idx = n - 16;
    const r = Math.floor(idx / 36);
    const g = Math.floor((idx % 36) / 6);
    const b = idx % 6;
    const toByte = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    return `rgb(${toByte(r)},${toByte(g)},${toByte(b)})`;
  }
  const gray = 8 + (n - 232) * 10;
  return `rgb(${gray},${gray},${gray})`;
}

function ansiToHtml(raw: string): string {
  // Strip OSC sequences (window title, hyperlinks, etc.) and non-SGR CSI/charset control sequences
  const cleaned = raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[?=>!][0-9;:]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[0-9;:]*[A-LN-Za-z@`~]/g, '')
    .replace(/\x1b[()][A-Za-z0-9]/g, '')
    .replace(/\x1b[=>c78DEHM]/g, '');

  const parts = cleaned.split(/(\x1b\[[0-9;:]*m)/g);
  let color = '';
  let bold = false;
  let out = '';

  for (const part of parts) {
    const m = part.match(/^\x1b\[([0-9;:]*)m$/);
    if (m) {
      const codes = (m[1] || '0').split(/[;:]/).map((n) => parseInt(n, 10) || 0);
      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (code === 0) {
          color = '';
          bold = false;
        } else if (code === 1) {
          bold = true;
        } else if (code === 22) {
          bold = false;
        } else if (code === 39) {
          color = '';
        } else if (code === 38 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
          color = ansi256ToHex(codes[i + 2]);
          i += 2;
        } else if (code === 38 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
          color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`;
          i += 4;
        } else if (code === 48 && codes[i + 1] === 5 && codes[i + 2] !== undefined) {
          i += 2;
        } else if (code === 48 && codes[i + 1] === 2 && codes[i + 4] !== undefined) {
          i += 4;
        } else if (ANSI_COLORS[code]) {
          color = ANSI_COLORS[code];
        }
      }
      continue;
    }
    if (!part) continue;
    const escaped = escapeHtml(part);
    if (color || bold) {
      const style = `${color ? `color:${color};` : ''}${bold ? 'font-weight:700;' : ''}`;
      out += `<span style="${style}">${escaped}</span>`;
    } else {
      out += escaped;
    }
  }
  return out;
}

export default defineComponent({
  name: 'TerminalModal',
  props: {
    target: { type: Object as () => TerminalTarget | null, default: null },
  },
  setup(props, { emit }) {
    const status = ref<'connecting' | 'connected' | 'closed'>('connecting');
    const errorMsg = ref('');
    const rawBuffer = ref('');
    const commandLine = ref('');
    const modalEl = ref<HTMLElement | null>(null);
    const screenEl = ref<HTMLElement | null>(null);
    const inputEl = ref<HTMLInputElement | null>(null);
    const isFullscreen = ref(false);
    const barsHidden = ref(false);

    let ws: WebSocket | null = null;
    let pendingCR = false;
    const MAX_BUFFER_CHARS = 48000;

    function syncPtySize() {
      void nextTick(() => {
        if (!ws || ws.readyState !== 1 || !screenEl.value) return;
        const rect = screenEl.value.getBoundingClientRect();
        const cols = Math.max(60, Math.min(240, Math.floor((rect.width - 28) / 8)));
        const rows = Math.max(16, Math.min(90, Math.floor((rect.height - 28) / 19.5)));
        try {
          ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        } catch {
          // ignore
        }
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
      window.setTimeout(syncPtySize, 120);
    }

    function onNativeFullscreenChange() {
      const doc: any = document;
      const fsEl = doc.fullscreenElement || doc.webkitFullscreenElement;
      if (!fsEl && isFullscreen.value) {
        // If user pressed Escape in native fullscreen, exit cleanly
        isFullscreen.value = false;
        barsHidden.value = false;
        window.setTimeout(syncPtySize, 120);
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
      window.setTimeout(syncPtySize, 120);
    });

    const renderedHtml = computed(() => ansiToHtml(rawBuffer.value));

    function scrollBottom() {
      void nextTick(() => {
        if (screenEl.value) {
          screenEl.value.scrollTop = screenEl.value.scrollHeight;
        }
      });
    }

    function appendOutput(chunk: string) {
      let buf = rawBuffer.value;
      // Handle explicit clear screen sequences
      if (chunk.indexOf('\x1b[2J') !== -1 || chunk.indexOf('\x1b[3J') !== -1) {
        const lastClear = Math.max(chunk.lastIndexOf('\x1b[2J'), chunk.lastIndexOf('\x1b[3J'));
        buf = '';
        pendingCR = false;
        chunk = chunk.slice(lastClear + 4);
      }

      let i = 0;
      while (i < chunk.length) {
        const ch = chunk[i];

        // Preserve ANSI escape sequences intact without letting them trigger a CR line wipe
        if (ch === '\x1b') {
          const nextCh = chunk[i + 1];
          if (nextCh === '[') {
            let j = i + 2;
            while (j < chunk.length && !(chunk.charCodeAt(j) >= 0x40 && chunk.charCodeAt(j) <= 0x7e)) {
              j++;
            }
            const end = j < chunk.length ? j + 1 : chunk.length;
            buf += chunk.slice(i, end);
            i = end;
            continue;
          } else if (nextCh === ']') {
            let j = i + 2;
            while (j < chunk.length && chunk[j] !== '\x07' && !(chunk[j] === '\x1b' && chunk[j + 1] === '\\')) {
              j++;
            }
            const end = j < chunk.length ? (chunk[j] === '\x07' ? j + 1 : j + 2) : chunk.length;
            buf += chunk.slice(i, end);
            i = end;
            continue;
          }
          buf += ch;
          i++;
          continue;
        }

        if (ch === '\r') {
          // Defer CR handling so double/triple CRs (\r\r\n from LXC/pct enter) or split \r + \n
          // across WebSocket frames never erase the line!
          pendingCR = true;
          i++;
          continue;
        }

        if (ch === '\n') {
          pendingCR = false;
          buf += '\n';
          i++;
          continue;
        }

        if (ch === '\b' || ch === '\x7f') {
          pendingCR = false;
          if (buf.length > 0 && buf[buf.length - 1] !== '\n') {
            buf = buf.slice(0, -1);
          }
          i++;
          continue;
        }

        // Only rewind current line when new printable text arrives directly after CR (e.g. progress bars)
        if (pendingCR) {
          const nl = buf.lastIndexOf('\n');
          buf = nl === -1 ? '' : buf.slice(0, nl + 1);
          pendingCR = false;
        }

        buf += ch;
        i++;
      }

      if (buf.length > MAX_BUFFER_CHARS) {
        buf = buf.slice(buf.length - MAX_BUFFER_CHARS);
      }
      rawBuffer.value = buf;
      scrollBottom();
    }

    function closeSocket() {
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    }

    function openSocket(t: TerminalTarget) {
      closeSocket();
      status.value = 'connecting';
      errorMsg.value = '';
      rawBuffer.value = '';
      pendingCR = false;
      commandLine.value = '';

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params: string[] = [`kind=${encodeURIComponent(t.kind)}`, 'cols=110', 'rows=30'];
      const authToken = getAuthToken();
      if (authToken) params.push(`token=${encodeURIComponent(authToken)}`);
      if (t.serverId) params.push(`serverId=${encodeURIComponent(t.serverId)}`);
      if (t.configId) params.push(`configId=${encodeURIComponent(t.configId)}`);
      if (t.node) params.push(`node=${encodeURIComponent(t.node)}`);
      if (t.vmid) params.push(`vmid=${encodeURIComponent(String(t.vmid))}`);
      if (t.name) params.push(`name=${encodeURIComponent(t.name)}`);

      const url = `${proto}//${window.location.host}/ws/terminal?${params.join('&')}`;
      const socket = new window.WebSocket(url);
      ws = socket;

      socket.onmessage = (ev) => {
        if (ws !== socket) return;
        try {
          const msg = JSON.parse(String(ev.data || ''));
          if (msg.type === 'data' && typeof msg.data === 'string') {
            appendOutput(msg.data);
          } else if (msg.type === 'status') {
            if (msg.status === 'connected') {
              status.value = 'connected';
              void nextTick(() => {
                if (screenEl.value) screenEl.value.focus();
              });
            } else if (msg.status === 'connecting') {
              status.value = 'connecting';
            } else if (msg.status === 'closed') {
              status.value = 'closed';
              if (msg.message) appendOutput(`\n[${msg.message}]\n`);
            }
          } else if (msg.type === 'error') {
            errorMsg.value = msg.message || 'Terminal error';
            status.value = 'closed';
          }
        } catch {
          // ignore
        }
      };

      socket.onerror = () => {
        if (ws !== socket) return;
        errorMsg.value = 'WebSocket terminal connection error.';
        status.value = 'closed';
      };

      socket.onclose = () => {
        if (ws !== socket) return;
        status.value = 'closed';
      };
    }

    function sendRaw(data: string) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    }

    function sendCommandLine() {
      const cmd = commandLine.value;
      commandLine.value = '';
      sendRaw(`${cmd}\r`);
    }

    function clearScreen() {
      rawBuffer.value = '';
      pendingCR = false;
      sendRaw('\x0c');
    }

    function reconnect() {
      if (props.target) openSocket(props.target);
    }

    function onDirectKeydown(e: KeyboardEvent) {
      if (status.value !== 'connected') return;
      if (e.metaKey) return; // allow Cmd+C / Cmd+V on macOS
      if (e.ctrlKey && e.key.length === 1) {
        const lower = e.key.toLowerCase();
        if (lower === 'c') {
          e.preventDefault();
          sendRaw('\x03');
          return;
        }
        if (lower === 'd') {
          e.preventDefault();
          sendRaw('\x04');
          return;
        }
        if (lower === 'l') {
          e.preventDefault();
          clearScreen();
          return;
        }
        if (lower === 'z') {
          e.preventDefault();
          sendRaw('\x1a');
          return;
        }
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        sendRaw('\r');
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        sendRaw('\x7f');
      } else if (e.key === 'Tab') {
        e.preventDefault();
        sendRaw('\t');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        sendRaw('\x1b');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        sendRaw('\x1b[A');
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        sendRaw('\x1b[B');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        sendRaw('\x1b[C');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        sendRaw('\x1b[D');
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        sendRaw(e.key);
      }
    }

    function onDirectPaste(e: ClipboardEvent) {
      if (status.value !== 'connected') return;
      const text = e.clipboardData ? e.clipboardData.getData('text') : '';
      if (text) {
        e.preventDefault();
        sendRaw(text);
      }
    }

    watch(
      () => props.target,
      (val) => {
        if (val) {
          document.addEventListener('fullscreenchange', onNativeFullscreenChange);
          document.addEventListener('webkitfullscreenchange', onNativeFullscreenChange);
          openSocket(val);
        } else {
          isFullscreen.value = false;
          barsHidden.value = false;
          exitNativeFullscreen();
          document.removeEventListener('fullscreenchange', onNativeFullscreenChange);
          document.removeEventListener('webkitfullscreenchange', onNativeFullscreenChange);
          closeSocket();
        }
      },
      { immediate: true },
    );

    onBeforeUnmount(() => {
      exitNativeFullscreen();
      document.removeEventListener('fullscreenchange', onNativeFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onNativeFullscreenChange);
      closeSocket();
    });

    return {
      status,
      errorMsg,
      renderedHtml,
      commandLine,
      modalEl,
      screenEl,
      inputEl,
      isFullscreen,
      barsHidden,
      toggleFullscreen,
      handleClose,
      sendRaw,
      sendCommandLine,
      clearScreen,
      reconnect,
      onDirectKeydown,
      onDirectPaste,
    };
  },
});
</script>

<style scoped lang="scss">
.backdrop-fullscreen {
  padding: 0 !important;
}

.term-modal {
  position: relative;
  width: 100%;
  max-width: 960px;
  height: 86vh;
  max-height: 760px;
  background: #0d121c;
  border: 1px solid #2d3d5c;
  border-radius: 6px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.72);
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &.term-fullscreen {
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

.term-header {
  padding: 12px 16px;
  background: #121826;
  border-bottom: 1px solid #1f2a40;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.term-title-group {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-width: 0;
}

.term-title {
  font-size: 15px;
  font-weight: 800;
  color: #f8fafc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.term-head-actions {
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}

.term-error {
  padding: 10px 14px;
  background: rgba(220, 38, 38, 0.18);
  border-bottom: 1px solid rgba(248, 113, 113, 0.45);
  color: #fecaca;
  font-size: 13px;
  flex-shrink: 0;
}

.term-screen {
  flex: 1;
  background: #05080e;
  color: #d1fae5;
  padding: 14px;
  font-size: 13px;
  line-height: 1.48;
  overflow-y: auto;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  outline: none;
  cursor: text;
  -webkit-user-select: text;
  user-select: text;

  &:focus {
    box-shadow: inset 0 0 0 1px #1f5c73;
  }
}

.term-content {
  display: inline;
  white-space: pre-wrap;
  word-break: break-all;
}

.term-cursor {
  display: inline-block;
  width: 8px;
  background: #22d3ee;
  animation: cursorBlink 1.1s step-end infinite;
}

@keyframes cursorBlink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}

.term-keys {
  padding: 8px 12px 2px 12px;
  background: #0f1522;
  border-top: 1px solid #1f2a40;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.key-btn {
  min-height: 36px;
  padding: 0 11px;
  font-size: 12px;
  margin-right: 6px;
  margin-bottom: 6px;
}

.term-input-bar {
  padding: 8px 12px 12px 12px;
  background: #0f1522;
  display: flex;
  flex-direction: row;
  align-items: center;
  flex-shrink: 0;
}
</style>
