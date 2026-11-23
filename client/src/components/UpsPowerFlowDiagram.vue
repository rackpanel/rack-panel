<template>
  <div class="ups-flow-wrap">
    <svg
      class="ups-flow-svg"
      viewBox="0 0 760 220"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <filter id="ups-glow-green" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="ups-glow-amber" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <!-- Background subtle grid -->
      <rect x="0" y="0" width="760" height="220" rx="8" fill="#070b14" stroke="#1b263b" stroke-width="1" />

      <!-- TOP BYPASS RAIL -->
      <path
        d="M 162 66 L 195 30 L 565 30 L 598 66"
        :stroke="isBypass ? '#f59e0b' : '#1e293b'"
        :stroke-width="isBypass ? 2.6 : 1.5"
        stroke-dasharray="6 5"
        :class="{ 'flow-anim-fast': isBypass }"
      />
      <rect x="336" y="17" width="88" height="22" rx="4" fill="#0d1424" :stroke="isBypass ? '#f59e0b' : '#243452'" stroke-width="1.2" />
      <text x="380" y="31" text-anchor="middle" font-family="monospace" font-size="10" font-weight="700" :fill="isBypass ? '#fbbf24' : '#64748b'">
        STATIC BYPASS
      </text>

      <!-- AC INPUT -> RECTIFIER FLOW -->
      <line x1="162" y1="84" x2="262" y2="84" stroke="#1e293b" stroke-width="4" stroke-linecap="round" />
      <line
        v-if="mainsActive"
        x1="162"
        y1="84"
        x2="262"
        y2="84"
        stroke="#22c55e"
        stroke-width="2.6"
        stroke-dasharray="8 6"
        stroke-linecap="round"
        filter="url(#ups-glow-green)"
        class="flow-anim-fwd"
      />
      <polygon v-if="mainsActive" points="258,79 267,84 258,89" fill="#22c55e" />

      <!-- RECTIFIER -> INVERTER (DC BUS) -->
      <line x1="348" y1="84" x2="412" y2="84" stroke="#1e293b" stroke-width="4" />
      <line
        v-if="mainsActive || onBattery"
        x1="348"
        y1="84"
        x2="412"
        y2="84"
        :stroke="onBattery ? '#f59e0b' : '#38bdf8'"
        stroke-width="2.6"
        stroke-dasharray="7 5"
        class="flow-anim-fwd"
      />

      <!-- INVERTER -> PROTECTED LOAD FLOW -->
      <line x1="498" y1="84" x2="598" y2="84" stroke="#1e293b" stroke-width="4" stroke-linecap="round" />
      <line
        v-if="outputActive"
        x1="498"
        y1="84"
        x2="598"
        y2="84"
        :stroke="onBattery ? '#f59e0b' : isBypass ? '#f59e0b' : '#22d3ee'"
        stroke-width="2.8"
        stroke-dasharray="8 6"
        stroke-linecap="round"
        :filter="onBattery ? 'url(#ups-glow-amber)' : 'url(#ups-glow-green)'"
        class="flow-anim-fwd"
      />
      <polygon
        v-if="outputActive"
        points="594,79 603,84 594,89"
        :fill="onBattery || isBypass ? '#f59e0b' : '#22d3ee'"
      />

      <!-- DC BUS <-> BATTERY FLOW -->
      <line x1="380" y1="84" x2="380" y2="142" stroke="#1e293b" stroke-width="4" />
      <!-- Charging downward when normal -->
      <line
        v-if="mainsActive && !onBattery"
        x1="380"
        y1="84"
        x2="380"
        y2="142"
        stroke="#38bdf8"
        stroke-width="2.2"
        stroke-dasharray="5 6"
        class="flow-anim-down"
      />
      <!-- Discharging upward when on battery -->
      <line
        v-if="onBattery"
        x1="380"
        y1="142"
        x2="380"
        y2="84"
        stroke="#f59e0b"
        stroke-width="3"
        stroke-dasharray="7 5"
        filter="url(#ups-glow-amber)"
        class="flow-anim-up"
      />
      <polygon v-if="onBattery" points="375,92 380,82 385,92" fill="#f59e0b" />

      <!-- NODE 1: AC MAINS INPUT -->
      <g>
        <rect
          x="22"
          y="50"
          width="140"
          height="68"
          rx="6"
          fill="#0d1424"
          :stroke="mainsActive ? '#22c55e' : '#ef4444'"
          stroke-width="1.5"
        />
        <circle cx="36" cy="65" r="4" :fill="mainsActive ? '#22c55e' : '#ef4444'" />
        <text x="46" y="69" font-family="monospace" font-size="11" font-weight="700" fill="#e2e8f0">
          {{ isPowerwall ? 'GRID / SOLAR' : 'AC MAINS IN' }}
        </text>
        <text x="32" y="90" font-family="monospace" font-size="15" font-weight="700" :fill="mainsActive ? '#4ade80' : '#f87171'">
          {{
            isPowerwall && ups.gridWatts !== undefined && ups.gridWatts !== null
              ? `${ups.gridWatts}W`
              : ups.inputVoltage !== null
                ? `${ups.inputVoltage}V`
                : '—'
          }}
        </text>
        <text x="32" y="107" font-family="monospace" font-size="10.5" fill="#94a3b8">
          <template v-if="isPowerwall">
            {{ ups.solarWatts !== undefined && ups.solarWatts !== null ? `Solar ${ups.solarWatts}W` : mainsActive ? 'Grid Connected' : 'Off-Grid' }}
          </template>
          <template v-else>
            {{ ups.inputFrequencyHz !== null ? `${ups.inputFrequencyHz} Hz` : mainsActive ? 'Utility Normal' : 'Mains Lost' }}
          </template>
        </text>
      </g>

      <!-- NODE 2: RECTIFIER / CHARGER -->
      <g>
        <rect
          x="262"
          y="56"
          width="86"
          height="56"
          rx="6"
          fill="#0f172a"
          :stroke="mainsActive ? '#38bdf8' : '#334155'"
          stroke-width="1.4"
        />
        <text x="305" y="79" text-anchor="middle" font-family="monospace" font-size="10" font-weight="700" fill="#cbd5e1">
          RECTIFIER
        </text>
        <text x="305" y="95" text-anchor="middle" font-family="monospace" font-size="10" fill="#38bdf8">
          AC &rarr; DC
        </text>
      </g>

      <!-- NODE 3: INVERTER -->
      <g>
        <rect
          x="412"
          y="56"
          width="86"
          height="56"
          rx="6"
          fill="#0f172a"
          :stroke="outputActive ? (onBattery ? '#f59e0b' : '#22d3ee') : '#334155'"
          stroke-width="1.4"
        />
        <text x="455" y="79" text-anchor="middle" font-family="monospace" font-size="10" font-weight="700" fill="#cbd5e1">
          INVERTER
        </text>
        <text x="455" y="95" text-anchor="middle" font-family="monospace" font-size="10" :fill="onBattery ? '#fbbf24' : '#22d3ee'">
          DC &rarr; AC
        </text>
      </g>

      <!-- NODE 4: BATTERY BANK -->
      <g>
        <rect
          x="280"
          y="142"
          width="200"
          height="62"
          rx="6"
          fill="#0d1424"
          :stroke="onBattery ? '#f59e0b' : (ups.batteryChargePercent ?? 100) < 30 ? '#ef4444' : '#38bdf8'"
          stroke-width="1.5"
        />
        <!-- Battery Fill Bar -->
        <rect x="292" y="154" width="38" height="20" rx="2" fill="#060911" stroke="#64748b" stroke-width="1.2" />
        <rect x="330" y="159" width="3" height="10" rx="1" fill="#64748b" />
        <rect
          x="295"
          y="157"
          :width="Math.max(2, Math.round((32 * Math.min(100, Math.max(0, ups.batteryChargePercent ?? 100))) / 100))"
          height="14"
          rx="1"
          :fill="onBattery ? '#f59e0b' : (ups.batteryChargePercent ?? 100) < 30 ? '#ef4444' : '#22c55e'"
        />
        <text x="342" y="164" font-family="monospace" font-size="12" font-weight="700" fill="#f1f5f9">
          BATT {{ ups.batteryChargePercent !== null ? `${ups.batteryChargePercent}%` : '—' }}
        </text>
        <text x="342" y="180" font-family="monospace" font-size="10" fill="#94a3b8">
          {{ ups.estimatedRuntimeMinutes !== null ? `${ups.estimatedRuntimeMinutes}m` : '—' }}
          <template v-if="ups.batteryVoltage !== null"> &middot; {{ ups.batteryVoltage }}V DC</template>
        </text>
        <text x="380" y="196" text-anchor="middle" font-family="monospace" font-size="9.5" :fill="onBattery ? '#fbbf24' : '#38bdf8'">
          <template v-if="isPowerwall">
            {{
              ups.batteryWatts !== undefined && ups.batteryWatts !== null
                ? ups.batteryWatts > 50
                  ? `DISCHARGING (${ups.batteryWatts}W)`
                  : ups.batteryWatts < -50
                    ? `CHARGING (${Math.abs(ups.batteryWatts)}W)`
                    : 'POWERWALL STANDBY'
                : onBattery
                  ? 'DISCHARGING TO LOAD'
                  : 'POWERWALL READY'
            }}
          </template>
          <template v-else>
            {{ onBattery ? 'DISCHARGING TO LOAD' : 'FLOAT CHARGING' }}
          </template>
        </text>
      </g>

      <!-- NODE 5: PROTECTED RACK LOAD -->
      <g>
        <rect
          x="598"
          y="50"
          width="140"
          height="68"
          rx="6"
          fill="#0d1424"
          :stroke="outputActive ? '#22d3ee' : '#ef4444'"
          stroke-width="1.5"
        />
        <circle cx="612" cy="65" r="4" :fill="outputActive ? '#22d3ee' : '#ef4444'" />
        <text x="622" y="69" font-family="monospace" font-size="11" font-weight="700" fill="#e2e8f0">
          RACK LOAD
        </text>
        <text x="608" y="90" font-family="monospace" font-size="15" font-weight="700" fill="#38bdf8">
          {{ ups.outputWatts !== null ? `${ups.outputWatts}W` : '—' }}
        </text>
        <text x="608" y="107" font-family="monospace" font-size="10.5" fill="#94a3b8">
          {{ ups.outputVoltage !== null ? `${ups.outputVoltage}V` : '—' }}
          <template v-if="ups.outputLoadPercent !== null"> &middot; {{ ups.outputLoadPercent }}%</template>
        </text>
      </g>
    </svg>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue';
import type { UpsSnapshot } from '@shared/types';

export default defineComponent({
  name: 'UpsPowerFlowDiagram',
  props: {
    ups: { type: Object as PropType<UpsSnapshot>, required: true },
  },
  setup(props) {
    const isPowerwall = computed(() => props.ups.protocol === 'powerwall' || props.ups.protocol === 'powerwall-cloud');
    const onBattery = computed(
      () => props.ups.outputSource === 'battery' || props.ups.status === 'on-battery' || props.ups.status === 'low-battery',
    );
    const isBypass = computed(() => props.ups.outputSource === 'bypass' || props.ups.status === 'bypass');
    const mainsActive = computed(
      () =>
        props.ups.status !== 'offline' &&
        props.ups.status !== 'error' &&
        !onBattery.value &&
        (props.ups.inputVoltage === null || props.ups.inputVoltage > 50),
    );
    const outputActive = computed(() => props.ups.status !== 'offline' && props.ups.status !== 'error');

    return { isPowerwall, onBattery, isBypass, mainsActive, outputActive };
  },
});
</script>

<style scoped>
.ups-flow-wrap {
  margin-bottom: 14px;
  width: 100%;
  overflow: hidden;
}

.ups-flow-svg {
  width: 100%;
  height: auto;
  display: block;
}

.flow-anim-fwd {
  animation: upsDashFwd 1.1s linear infinite;
}

.flow-anim-fast {
  animation: upsDashFwd 0.7s linear infinite;
}

.flow-anim-down {
  animation: upsDashFwd 1.8s linear infinite;
}

.flow-anim-up {
  animation: upsDashFwd 0.8s linear infinite;
}

@keyframes upsDashFwd {
  from {
    stroke-dashoffset: 28;
  }
  to {
    stroke-dashoffset: 0;
  }
}
</style>
