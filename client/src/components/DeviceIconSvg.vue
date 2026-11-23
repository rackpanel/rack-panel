<template>
  <svg
    class="dev-icon-svg"
    :width="size"
    :height="size"
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <!-- MacBook / Laptop -->
    <g v-if="archetype === 'macbook'">
      <rect x="7" y="7" width="26" height="18" rx="2" fill="#0f172a" stroke="#94a3b8" stroke-width="1.6" />
      <rect x="9.5" y="9.5" width="21" height="13" rx="1" fill="#1e293b" />
      <path d="M12 19L16.5 14L20 17L24 12.5L28 19H12Z" fill="#38bdf8" opacity="0.35" />
      <circle cx="20" cy="8.3" r="0.6" fill="#38bdf8" />
      <path d="M3.5 26.5H36.5L34.5 31.5C34.2 32.1 33.6 32.5 32.9 32.5H7.1C6.4 32.5 5.8 32.1 5.5 31.5L3.5 26.5Z" fill="#334155" stroke="#94a3b8" stroke-width="1.3" />
      <rect x="16" y="28.2" width="8" height="2" rx="0.8" fill="#0f172a" />
    </g>

    <!-- Smartphone / Tablet -->
    <g v-else-if="archetype === 'phone'">
      <rect x="11.5" y="4" width="17" height="32" rx="3.2" fill="#0f172a" stroke="#94a3b8" stroke-width="1.7" />
      <rect x="13.5" y="6.5" width="13" height="25.5" rx="1.6" fill="#172554" />
      <!-- Dynamic Island / Notch -->
      <rect x="17" y="7.8" width="6" height="1.6" rx="0.8" fill="#020617" />
      <!-- Screen UI bars -->
      <rect x="15.5" y="12" width="9" height="4" rx="1" fill="#38bdf8" opacity="0.4" />
      <rect x="15.5" y="18" width="4" height="4" rx="1" fill="#22c55e" opacity="0.55" />
      <rect x="20.5" y="18" width="4" height="4" rx="1" fill="#a855f7" opacity="0.55" />
      <rect x="15.5" y="24" width="9" height="2" rx="0.8" fill="#64748b" opacity="0.6" />
      <rect x="17.5" y="33.2" width="5" height="1" rx="0.5" fill="#64748b" />
    </g>

    <!-- UniFi Saucer Access Point -->
    <g v-else-if="archetype === 'unifi-ap'">
      <circle cx="20" cy="20" r="15.5" fill="#1e293b" stroke="#cbd5e1" stroke-width="1.6" />
      <circle cx="20" cy="20" r="12" fill="#0f172a" stroke="#334155" stroke-width="1" />
      <!-- Signature glowing Ubiquiti blue LED ring -->
      <circle cx="20" cy="20" r="5.5" fill="#090d16" stroke="#38bdf8" stroke-width="2.4" />
      <circle cx="20" cy="20" r="5.5" stroke="#22d3ee" stroke-width="0.8" opacity="0.8" />
    </g>

    <!-- UniFi Dream Machine Pro / Rack Console -->
    <g v-else-if="archetype === 'unifi-udm-pro'">
      <rect x="3" y="13" width="34" height="14" rx="2" fill="#1e293b" stroke="#94a3b8" stroke-width="1.5" />
      <!-- Signature left 1.3" LCM touchscreen -->
      <rect x="5.5" y="15.5" width="7.5" height="9" rx="1" fill="#0c4a6e" stroke="#38bdf8" stroke-width="1.2" />
      <circle cx="9.25" cy="19" r="1.5" fill="#22d3ee" />
      <rect x="7" y="22" width="4.5" height="1.2" rx="0.5" fill="#7dd3fc" />
      <!-- 8x GbE + 2x SFP+ ports -->
      <rect x="15.5" y="16" width="2.2" height="2.6" rx="0.4" fill="#22c55e" />
      <rect x="18.5" y="16" width="2.2" height="2.6" rx="0.4" fill="#22c55e" />
      <rect x="21.5" y="16" width="2.2" height="2.6" rx="0.4" fill="#38bdf8" />
      <rect x="24.5" y="16" width="2.2" height="2.6" rx="0.4" fill="#334155" />
      <rect x="15.5" y="20.5" width="2.2" height="2.6" rx="0.4" fill="#22c55e" />
      <rect x="18.5" y="20.5" width="2.2" height="2.6" rx="0.4" fill="#334155" />
      <rect x="21.5" y="20.5" width="2.2" height="2.6" rx="0.4" fill="#22c55e" />
      <rect x="24.5" y="20.5" width="2.2" height="2.6" rx="0.4" fill="#334155" />
      <!-- SFP+ cages -->
      <rect x="29" y="16" width="3" height="3" rx="0.4" fill="#020617" stroke="#38bdf8" stroke-width="1" />
      <rect x="29" y="20.5" width="3" height="3" rx="0.4" fill="#020617" stroke="#38bdf8" stroke-width="1" />
    </g>

    <!-- UniFi Dream Machine (Cylinder Pill) -->
    <g v-else-if="archetype === 'unifi-udm'">
      <rect x="11" y="7" width="18" height="26" rx="6" fill="#e2e8f0" fill-opacity="0.14" stroke="#94a3b8" stroke-width="1.6" />
      <ellipse cx="20" cy="10.5" rx="7.5" ry="2.6" fill="#0f172a" stroke="#38bdf8" stroke-width="2" />
      <line x1="20" y1="15" x2="20" y2="28" stroke="#334155" stroke-width="1.2" />
      <rect x="15" y="29" width="10" height="2" rx="1" fill="#38bdf8" opacity="0.5" />
    </g>

    <!-- CCTV NVR / DVR Chassis -->
    <g v-else-if="archetype === 'nvr'">
      <rect x="3" y="10" width="34" height="20" rx="2.5" fill="#141129" stroke="#a855f7" stroke-width="1.5" />
      <!-- Left REC & Power LEDs -->
      <circle cx="7" cy="14.5" r="1.6" fill="#ef4444" />
      <circle cx="7" cy="19.5" r="1.3" fill="#22c55e" />
      <circle cx="7" cy="24.5" r="1.3" fill="#38bdf8" />
      <!-- 4x NVR HDD Bays -->
      <rect x="11" y="13" width="4.5" height="14" rx="1" fill="#090d16" stroke="#7e22ce" stroke-width="1.1" />
      <rect x="16.8" y="13" width="4.5" height="14" rx="1" fill="#090d16" stroke="#7e22ce" stroke-width="1.1" />
      <rect x="22.6" y="13" width="4.5" height="14" rx="1" fill="#090d16" stroke="#7e22ce" stroke-width="1.1" />
      <rect x="28.4" y="13" width="4.5" height="14" rx="1" fill="#090d16" stroke="#7e22ce" stroke-width="1.1" />
      <circle cx="13.25" cy="15.5" r="0.9" fill="#22c55e" />
      <circle cx="19.05" cy="15.5" r="0.9" fill="#22c55e" />
      <circle cx="24.85" cy="15.5" r="0.9" fill="#22c55e" />
      <circle cx="30.65" cy="15.5" r="0.9" fill="#c084fc" />
    </g>

    <!-- Security Camera -->
    <g v-else-if="archetype === 'camera'">
      <path d="M7 13L25 10L29 19L11 23L7 13Z" fill="#1e293b" stroke="#c084fc" stroke-width="1.5" />
      <circle cx="27" cy="14.5" r="3.2" fill="#090d16" stroke="#38bdf8" stroke-width="1.4" />
      <circle cx="27" cy="14.5" r="1.1" fill="#ef4444" />
      <path d="M14 22.5V29H9" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" />
      <rect x="6" y="28" width="6" height="3" rx="1" fill="#475569" />
    </g>

    <!-- NAS Storage Array -->
    <g v-else-if="archetype === 'nas'">
      <rect x="6" y="6" width="28" height="28" rx="2.5" fill="#0f172a" stroke="#10b981" stroke-width="1.5" />
      <rect x="9.5" y="10" width="4.2" height="20" rx="1" fill="#1e293b" stroke="#334155" stroke-width="1" />
      <rect x="15.2" y="10" width="4.2" height="20" rx="1" fill="#1e293b" stroke="#334155" stroke-width="1" />
      <rect x="20.9" y="10" width="4.2" height="20" rx="1" fill="#1e293b" stroke="#334155" stroke-width="1" />
      <rect x="26.6" y="10" width="4.2" height="20" rx="1" fill="#1e293b" stroke="#334155" stroke-width="1" />
      <circle cx="11.6" cy="12.5" r="0.9" fill="#22c55e" />
      <circle cx="17.3" cy="12.5" r="0.9" fill="#22c55e" />
      <circle cx="23" cy="12.5" r="0.9" fill="#22c55e" />
      <circle cx="28.7" cy="12.5" r="0.9" fill="#38bdf8" />
    </g>

    <!-- Firewall / OPNsense -->
    <g v-else-if="archetype === 'firewall'">
      <path d="M20 5L32 9.5V19C32 26.8 26.8 32.8 20 35C13.2 32.8 8 26.8 8 19V9.5L20 5Z" fill="#172554" stroke="#f97316" stroke-width="1.6" />
      <rect x="14" y="14" width="12" height="10" rx="1.5" fill="#0f172a" stroke="#fb923c" stroke-width="1.2" />
      <circle cx="17" cy="19" r="1.2" fill="#22c55e" />
      <circle cx="20" cy="19" r="1.2" fill="#fb923c" />
      <circle cx="23" cy="19" r="1.2" fill="#38bdf8" />
    </g>

    <!-- Router / Gateway -->
    <g v-else-if="archetype === 'router'">
      <rect x="5" y="17" width="30" height="14" rx="2.5" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5" />
      <line x1="12" y1="17" x2="10" y2="7" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" />
      <line x1="28" y1="17" x2="30" y2="7" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" />
      <circle cx="10" cy="7" r="1.6" fill="#38bdf8" />
      <circle cx="30" cy="7" r="1.6" fill="#38bdf8" />
      <circle cx="11" cy="24" r="1.4" fill="#22c55e" />
      <circle cx="16" cy="24" r="1.4" fill="#22c55e" />
      <circle cx="21" cy="24" r="1.4" fill="#38bdf8" />
      <rect x="26" y="22.5" width="5" height="3" rx="0.6" fill="#1e293b" stroke="#475569" stroke-width="0.9" />
    </g>

    <!-- ISP / WAN Globe -->
    <g v-else-if="archetype === 'isp'">
      <circle cx="20" cy="20" r="13.5" fill="#0c4a6e" fill-opacity="0.35" stroke="#38bdf8" stroke-width="1.6" />
      <ellipse cx="20" cy="20" rx="6" ry="13.5" stroke="#38bdf8" stroke-width="1.2" />
      <line x1="6.5" y1="20" x2="33.5" y2="20" stroke="#38bdf8" stroke-width="1.2" />
      <path d="M9 13.5H31M9 26.5H31" stroke="#38bdf8" stroke-width="1" opacity="0.7" />
    </g>

    <!-- Docker Container -->
    <g v-else-if="archetype === 'docker'">
      <rect x="7" y="14" width="6" height="6" rx="1" fill="#0284c7" stroke="#38bdf8" stroke-width="1.1" />
      <rect x="14.5" y="14" width="6" height="6" rx="1" fill="#0284c7" stroke="#38bdf8" stroke-width="1.1" />
      <rect x="22" y="14" width="6" height="6" rx="1" fill="#0284c7" stroke="#38bdf8" stroke-width="1.1" />
      <rect x="14.5" y="6.5" width="6" height="6" rx="1" fill="#0ea5e9" stroke="#7dd3fc" stroke-width="1.1" />
      <path d="M4.5 22.5H34.5C33.2 29.2 28.4 33 20 33C11.6 33 6.2 29.2 4.5 22.5Z" fill="#0f172a" stroke="#38bdf8" stroke-width="1.5" />
      <circle cx="26" cy="26.5" r="1.2" fill="#e2e8f0" />
    </g>

    <!-- IoT / Zigbee / Z-Wave -->
    <g v-else-if="archetype === 'iot'">
      <circle cx="20" cy="23" r="6" fill="#0f172a" stroke="#eab308" stroke-width="1.6" />
      <circle cx="20" cy="23" r="2" fill="#fde047" />
      <path d="M12.5 16.5C14.6 14.3 17.2 13 20 13C22.8 13 25.4 14.3 27.5 16.5" stroke="#eab308" stroke-width="1.6" stroke-linecap="round" />
      <path d="M8.5 12.5C11.7 9.2 15.7 7.5 20 7.5C24.3 7.5 28.3 9.2 31.5 12.5" stroke="#eab308" stroke-width="1.6" stroke-linecap="round" opacity="0.7" />
    </g>

    <!-- UPS / PDU Power -->
    <g v-else-if="archetype === 'electric'">
      <rect x="8" y="6" width="24" height="28" rx="2.5" fill="#0f172a" stroke="#22c55e" stroke-width="1.5" />
      <rect x="12" y="10" width="16" height="6" rx="1" fill="#064e3b" stroke="#22c55e" stroke-width="1" />
      <path d="M21 19L16.5 25H20L19 30L23.5 24H20L21 19Z" fill="#4ade80" />
    </g>

    <!-- Server / Proxmox / VM / LXC -->
    <g v-else-if="archetype === 'server'">
      <rect x="4" y="8" width="32" height="10" rx="1.8" fill="#0f172a" stroke="#38bdf8" stroke-width="1.4" />
      <circle cx="8.5" cy="13" r="1.4" fill="#22c55e" />
      <rect x="13" y="11.5" width="14" height="3" rx="0.8" fill="#1e293b" />
      <rect x="29" y="11.5" width="3.5" height="3" rx="0.6" fill="#38bdf8" opacity="0.6" />

      <rect x="4" y="22" width="32" height="10" rx="1.8" fill="#0f172a" stroke="#64748b" stroke-width="1.4" />
      <circle cx="8.5" cy="27" r="1.4" fill="#38bdf8" />
      <rect x="13" y="25.5" width="14" height="3" rx="0.8" fill="#1e293b" />
      <rect x="29" y="25.5" width="3.5" height="3" rx="0.6" fill="#22c55e" opacity="0.6" />
    </g>

    <!-- Generic Network Host -->
    <g v-else>
      <rect x="6" y="9" width="28" height="22" rx="3" fill="#0f172a" stroke="#64748b" stroke-width="1.5" />
      <circle cx="11" cy="15" r="1.5" fill="#22c55e" />
      <rect x="15" y="14" width="14" height="2" rx="1" fill="#475569" />
      <rect x="11" y="20" width="18" height="6" rx="1.2" fill="#1e293b" stroke="#334155" stroke-width="1" />
    </g>
  </svg>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue';

export default defineComponent({
  name: 'DeviceIconSvg',
  props: {
    kind: { type: String, default: 'generic' },
    name: { type: String, default: '' },
    hostname: { type: String, default: '' },
    vendor: { type: String, default: '' },
    size: { type: Number, default: 32 },
  },
  setup(props) {
    const archetype = computed(() => {
      const k = String(props.kind || 'generic').toLowerCase();
      const hay = `${props.name} ${props.hostname} ${props.vendor}`.toLowerCase();

      if (/\b(macbook|mbp|mba|thinkpad|laptop|notebook|xps)\b/.test(hay)) return 'macbook';
      if (/\b(iphone|ipad|android|pixel|galaxy|samsung|oneplus|smartphone|mobile|phone)\b/.test(hay)) return 'phone';
      if (/\b(udm[-\s]?pro|udm[-\s]?se|dream\s*machine\s*pro|ucg[-\s]?max|uxg[-\s]?pro)\b/.test(hay)) {
        return 'unifi-udm-pro';
      }
      if (/\b(udm|dream\s*machine|ucg|unifi.*gateway|usg|uxg)\b/.test(hay)) return 'unifi-udm';
      if (k === 'ap' || /\b(uap|u6|u7|unifi.*ap|ac-pro|ac-lite|nanohd|flexhd|iw-hd|access\s*point)\b/.test(hay)) {
        return 'unifi-ap';
      }
      if (k === 'nvr' || /\b(nvr|dvr|ds-77|ds-76)\b/.test(hay)) return 'nvr';
      if (k === 'camera' || /\b(camera|ipcam|doorbell|rtsp)\b/.test(hay)) return 'camera';
      if (k === 'nas' || /\b(nas|synology|qnap|truenas|unraid)\b/.test(hay)) return 'nas';
      if (k === 'firewall' || /\b(opnsense|pfsense|firewall|fortigate)\b/.test(hay)) return 'firewall';
      if (k === 'router') return 'router';
      if (k === 'isp') return 'isp';
      if (k === 'docker') return 'docker';
      if (k === 'iot' || k === 'zigbee' || k === 'zwave') return 'iot';
      if (k === 'electric' || /\b(ups|pdu)\b/.test(hay)) return 'electric';
      if (k === 'server' || k === 'proxmox' || k === 'vm' || k === 'lxc') return 'server';
      return 'generic';
    });

    return { archetype };
  },
});
</script>

<style scoped>
.dev-icon-svg {
  flex-shrink: 0;
  display: block;
}
</style>
