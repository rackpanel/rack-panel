<template>
  <div class="pw-flow-wrap">
    <svg
      class="pw-flow-svg"
      viewBox="0 0 820 296"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="pw-glow-gold" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="pw-glow-cyan" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id="pw-monolith" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1a2438" />
          <stop offset="55%" stop-color="#111827" />
          <stop offset="100%" stop-color="#090f1d" />
        </linearGradient>
        <linearGradient id="pw-side-bevel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0f172a" />
          <stop offset="100%" stop-color="#050811" />
        </linearGradient>
      </defs>

      <!-- Dark Telemetry Backdrop -->
      <rect x="0" y="0" width="820" height="296" rx="10" fill="#060a13" stroke="#1b273d" stroke-width="1" />

      <!-- TOP-RIGHT LIVE STATUS BADGE -->
      <rect x="618" y="14" width="184" height="24" rx="12" fill="#0d1526" :stroke="isIslanded ? '#f59e0b' : '#22c55e'" stroke-width="1" />
      <circle cx="634" cy="26" r="4" :fill="isIslanded ? '#f59e0b' : '#22c55e'" />
      <text x="645" y="30" font-family="monospace" font-size="10.5" font-weight="700" :fill="isIslanded ? '#fbbf24' : '#86efac'">
        {{ isIslanded ? 'OFF-GRID · BACKUP' : 'GRID CONNECTED' }}
      </text>

      <!-- ================================================================= -->
      <!-- WIRE 1: SOLAR PV (bottom y=84) -> POWERWALL TOP (y=116)           -->
      <!-- ================================================================= -->
      <line x1="406" y1="84" x2="406" y2="116" stroke="#1e293b" stroke-width="5" stroke-linecap="round" />
      <line
        v-if="solarActive"
        x1="406"
        y1="84"
        x2="406"
        y2="116"
        stroke="#fbbf24"
        stroke-width="2.8"
        stroke-dasharray="6 5"
        class="pw-anim-fwd"
      />
      <circle v-if="solarActive" cx="406" cy="100" r="3.5" fill="#fde047">
        <animate attributeName="cy" values="84;116" dur="0.9s" repeatCount="indefinite" />
      </circle>
      <polygon v-if="solarActive" points="401,109 406,116 411,109" fill="#fbbf24" />

      <!-- ================================================================= -->
      <!-- WIRE 2: UTILITY GRID (x=188) <-> POWERWALL LEFT (x=330) at y=194  -->
      <!-- ================================================================= -->
      <line x1="188" y1="194" x2="330" y2="194" stroke="#1e293b" stroke-width="5" stroke-linecap="round" />
      <template v-if="!isIslanded && isOnline">
        <!-- Exporting (Center -> Left) -->
        <template v-if="gridWatts < -20">
          <line
            x1="330"
            y1="194"
            x2="188"
            y2="194"
            stroke="#22c55e"
            stroke-width="2.8"
            stroke-dasharray="8 6"
            class="pw-anim-fwd"
          />
          <circle cx="260" cy="194" r="3.8" fill="#86efac">
            <animate attributeName="cx" values="330;188" dur="1.2s" repeatCount="indefinite" />
          </circle>
          <polygon points="196,189 188,194 196,199" fill="#22c55e" />
        </template>
        <!-- Importing / Grid Connected (Left -> Center) -->
        <template v-else>
          <line
            x1="188"
            y1="194"
            x2="330"
            y2="194"
            stroke="#22c55e"
            stroke-width="2.8"
            stroke-dasharray="8 6"
            :class="gridWatts > 20 ? 'pw-anim-fwd' : 'pw-anim-slow'"
          />
          <circle v-if="gridWatts > 20" cx="260" cy="194" r="3.8" fill="#86efac">
            <animate attributeName="cx" values="188;330" dur="1.3s" repeatCount="indefinite" />
          </circle>
          <polygon points="322,189 330,194 322,199" fill="#22c55e" />
        </template>
      </template>

      <!-- ================================================================= -->
      <!-- WIRE 3: POWERWALL RIGHT (x=492) -> HOME & RACK (x=632) at y=194   -->
      <!-- ================================================================= -->
      <line x1="492" y1="194" x2="632" y2="194" stroke="#1e293b" stroke-width="5" stroke-linecap="round" />
      <template v-if="isOnline">
        <line
          x1="492"
          y1="194"
          x2="632"
          y2="194"
          :stroke="batteryWatts > 50 ? '#22c55e' : '#22d3ee'"
          stroke-width="2.8"
          stroke-dasharray="8 6"
          class="pw-anim-fwd"
        />
        <circle cx="560" cy="194" r="3.8" :fill="batteryWatts > 50 ? '#86efac' : '#7dd3fc'">
          <animate attributeName="cx" values="492;632" dur="1.15s" repeatCount="indefinite" />
        </circle>
        <polygon points="624,189 632,194 624,199" :fill="batteryWatts > 50 ? '#22c55e' : '#22d3ee'" />
      </template>

      <!-- Wire Terminal Junction Dots -->
      <circle cx="406" cy="84" r="3" fill="#475569" />
      <circle cx="406" cy="116" r="3" fill="#475569" />
      <circle cx="188" cy="194" r="3.5" fill="#475569" />
      <circle cx="330" cy="194" r="3.5" fill="#475569" />
      <circle cx="492" cy="194" r="3.5" fill="#475569" />
      <circle cx="632" cy="194" r="3.5" fill="#475569" />

      <!-- 1. TOP NODE: SOLAR PV -->
      <g>
        <rect
          x="314"
          y="14"
          width="184"
          height="70"
          rx="8"
          fill="#0c1322"
          :stroke="solarActive ? '#f59e0b' : '#243452'"
          stroke-width="1.5"
        />
        <g transform="translate(328, 28)">
          <polygon points="4,22 10,6 32,6 26,22" fill="#1e293b" :stroke="solarActive ? '#fbbf24' : '#64748b'" stroke-width="1.4" />
          <line x1="15" y1="6" x2="11" y2="22" stroke="#475569" stroke-width="1" />
          <line x1="23" y1="6" x2="19" y2="22" stroke="#475569" stroke-width="1" />
          <line x1="7" y1="14" x2="29" y2="14" stroke="#475569" stroke-width="1" />
        </g>
        <text x="368" y="34" font-family="monospace" font-size="11" font-weight="700" fill="#cbd5e1">
          SOLAR PV
        </text>
        <text x="368" y="54" font-family="monospace" font-size="15.5" font-weight="700" :fill="solarActive ? '#fbbf24' : '#64748b'">
          {{ formatPower(solarWatts) }}
        </text>
        <text x="368" y="71" font-family="monospace" font-size="10" fill="#94a3b8">
          {{ solarActive ? 'Generating' : 'Idle / Night' }}
        </text>
      </g>

      <!-- 2. LEFT NODE: UTILITY GRID -->
      <g>
        <rect
          x="22"
          y="149"
          width="166"
          height="90"
          rx="8"
          fill="#0c1322"
          :stroke="isIslanded ? '#ef4444' : Math.abs(gridWatts) > 20 ? '#38bdf8' : '#243452'"
          stroke-width="1.5"
        />
        <g transform="translate(34, 167)" stroke="#94a3b8" stroke-width="1.4" stroke-linecap="round">
          <path d="M12 2L6 28M12 2L18 28M4 10H20M6 18H18M7 28H17" />
        </g>
        <text x="68" y="173" font-family="monospace" font-size="11" font-weight="700" fill="#cbd5e1">
          UTILITY GRID
        </text>
        <text
          x="68"
          y="197"
          font-family="monospace" font-size="16"
          font-weight="700"
          :fill="isIslanded ? '#f87171' : gridWatts < -20 ? '#4ade80' : gridWatts > 20 ? '#38bdf8' : '#94a3b8'"
        >
          {{ isIslanded ? 'OFFLINE' : formatPower(Math.abs(gridWatts)) }}
        </text>
        <text x="68" y="216" font-family="monospace" font-size="10" fill="#94a3b8">
          {{
            isIslanded
              ? 'Grid Disconnected'
              : gridWatts > 20
                ? 'Importing'
                : gridWatts < -20
                  ? 'Exporting'
                  : 'Balanced'
          }}
        </text>
        <text x="68" y="230" font-family="monospace" font-size="9.5" fill="#64748b">
          {{ ups.inputVoltage ? `${ups.inputVoltage}V` : '230V' }} &middot; {{ ups.inputFrequencyHz ? `${ups.inputFrequencyHz}Hz` : '50Hz' }}
        </text>
      </g>

      <!-- 3. CENTER HERO NODE: DARK-MODE TESLA POWERWALL MONOLITH -->
      <g>
        <!-- Outer 3D dark chassis depth -->
        <rect
          x="336"
          y="118"
          width="156"
          height="164"
          rx="10"
          fill="url(#pw-side-bevel)"
          stroke="#475569"
          stroke-width="1.2"
        />
        <!-- Dark Matte Front Faceplate -->
        <rect
          x="330"
          y="116"
          width="152"
          height="162"
          rx="9"
          fill="url(#pw-monolith)"
          :stroke="batteryWatts > 50 ? '#22c55e' : batteryWatts < -50 ? '#38bdf8' : '#334155'"
          stroke-width="1.6"
        />
        <!-- Subtle top/bottom contoured trim -->
        <line x1="342" y1="124" x2="470" y2="124" stroke="#38bdf8" stroke-width="1" opacity="0.28" />
        <!-- Minimalist Tesla "T" Crest -->
        <path
          d="M396 131H416C414 133.5 410.5 134 408 134V146L406 149L404 146V134C401.5 134 398 133.5 396 131Z"
          fill="#cbd5e1"
        />
        <text x="406" y="159" text-anchor="middle" font-family="monospace" font-size="8.5" font-weight="800" letter-spacing="2" fill="#94a3b8">
          POWERWALL
        </text>

        <!-- Signature Glowing Vertical Side Light Bar -->
        <rect x="466" y="138" width="5" height="120" rx="2.5" fill="#1e293b" />
        <rect
          x="466"
          :y="138 + Math.round((120 * (100 - chargePctClamped)) / 100)"
          width="5"
          :height="Math.max(8, Math.round((120 * chargePctClamped) / 100))"
          rx="2.5"
          :fill="chargePctClamped < 20 ? '#ef4444' : batteryWatts > 50 ? '#22c55e' : '#38bdf8'"
          filter="url(#pw-glow-cyan)"
        />

        <!-- Embedded Dark Glass Telemetry Readout -->
        <rect x="342" y="168" width="116" height="96" rx="6" fill="#060a13" stroke="#1e293b" stroke-width="1" />
        <text x="400" y="197" text-anchor="middle" font-family="monospace" font-size="25" font-weight="800" fill="#f8fafc">
          {{ ups.batteryChargePercent !== null ? `${ups.batteryChargePercent}%` : '—' }}
        </text>
        <text
          x="400"
          y="217"
          text-anchor="middle"
          font-family="monospace"
          font-size="10.5"
          font-weight="700"
          :fill="batteryWatts > 50 ? '#4ade80' : batteryWatts < -50 ? '#38bdf8' : '#94a3b8'"
        >
          {{
            batteryWatts > 50
              ? `OUT ${formatPower(batteryWatts)}`
              : batteryWatts < -50
                ? `IN ${formatPower(Math.abs(batteryWatts))}`
                : 'STANDBY'
          }}
        </text>
        <text x="400" y="236" text-anchor="middle" font-family="monospace" font-size="9.5" fill="#94a3b8">
          {{ ups.estimatedRuntimeMinutes !== null ? formatRuntime(ups.estimatedRuntimeMinutes) : '13.5 kWh Pack' }}
        </text>
        <text x="400" y="252" text-anchor="middle" font-family="monospace" font-size="8.5" fill="#64748b">
          Max {{ (ups.ratedWatts / 1000).toFixed(1) }} kW
        </text>
      </g>

      <!-- 4. RIGHT NODE: HOME & RACK LOAD -->
      <g>
        <rect
          x="632"
          y="149"
          width="166"
          height="90"
          rx="8"
          fill="#0c1322"
          :stroke="loadWatts > 0 ? '#38bdf8' : '#243452'"
          stroke-width="1.5"
        />
        <g transform="translate(644, 167)" stroke="#38bdf8" stroke-width="1.4" stroke-linejoin="round">
          <path d="M2 13L12 4L22 13" />
          <path d="M5 11V24H19V11" fill="#0f172a" />
          <rect x="9" y="15" width="6" height="9" fill="#1e293b" />
        </g>
        <text x="676" y="173" font-family="monospace" font-size="11" font-weight="700" fill="#cbd5e1">
          HOME &amp; RACK
        </text>
        <text x="676" y="197" font-family="monospace" font-size="16" font-weight="700" fill="#38bdf8">
          {{ formatPower(loadWatts) }}
        </text>
        <text x="676" y="216" font-family="monospace" font-size="10" fill="#94a3b8">
          {{ ups.outputLoadPercent !== null ? `${ups.outputLoadPercent}% of ${(ups.ratedWatts / 1000).toFixed(1)}kW` : 'Active Load' }}
        </text>
        <text x="676" y="230" font-family="monospace" font-size="9.5" fill="#64748b">
          {{ ups.outputVoltage ? `${ups.outputVoltage}V AC` : '230V AC' }}
        </text>
      </g>
    </svg>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue';
import type { UpsSnapshot } from '@shared/types';

export default defineComponent({
  name: 'TeslaPowerwallDiagram',
  props: {
    ups: { type: Object as PropType<UpsSnapshot>, required: true },
  },
  setup(props) {
    const solarWatts = computed(() => Math.round(props.ups.solarWatts ?? 0));
    const solarActive = computed(() => solarWatts.value > 20);
    const gridWatts = computed(() => Math.round(props.ups.gridWatts ?? 0));
    const batteryWatts = computed(() => Math.round(props.ups.batteryWatts ?? 0));
    const loadWatts = computed(() => Math.round(props.ups.outputWatts ?? 0));
    const isOnline = computed(() => props.ups.status !== 'offline' && props.ups.status !== 'error');
    const isIslanded = computed(
      () => props.ups.status === 'on-battery' || props.ups.status === 'low-battery' || /island/i.test(props.ups.gridStatus || ''),
    );
    const chargePctClamped = computed(() => Math.min(100, Math.max(0, props.ups.batteryChargePercent ?? 0)));

    function formatPower(watts: number): string {
      if (Math.abs(watts) >= 1000) {
        return `${(watts / 1000).toFixed(2)} kW`;
      }
      return `${watts} W`;
    }

    function formatRuntime(mins: number): string {
      if (mins >= 60) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${h}h ${m}m left`;
      }
      return `${mins}m left`;
    }

    return {
      solarWatts,
      solarActive,
      gridWatts,
      batteryWatts,
      loadWatts,
      isOnline,
      isIslanded,
      chargePctClamped,
      formatPower,
      formatRuntime,
    };
  },
});
</script>

<style scoped>
.pw-flow-wrap {
  margin-bottom: 14px;
  width: 100%;
  overflow: hidden;
}

.pw-flow-svg {
  width: 100%;
  height: auto;
  display: block;
}

.pw-anim-fwd {
  animation: pwDash 1.05s linear infinite;
}

.pw-anim-slow {
  animation: pwDash 2.4s linear infinite;
}

@keyframes pwDash {
  from {
    stroke-dashoffset: 28;
  }
  to {
    stroke-dashoffset: 0;
  }
}
</style>
