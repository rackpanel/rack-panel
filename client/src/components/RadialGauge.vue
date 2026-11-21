<template>
  <div class="radial-gauge" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <circle
        class="gauge-track"
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke-width="strokeWidth"
        fill="none"
      />
      <circle
        class="gauge-arc"
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke="strokeColor"
        :stroke-width="strokeWidth"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        stroke-linecap="round"
        fill="none"
        :transform="`rotate(-90 ${center} ${center})`"
      />
    </svg>
    <div class="gauge-center">
      <div class="gauge-value mono" :style="{ fontSize: valueFontSize + 'px' }">{{ displayValue }}</div>
      <div v-if="label" class="gauge-label">{{ label }}</div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';

export default defineComponent({
  name: 'RadialGauge',
  props: {
    value: { type: Number, required: true },
    max: { type: Number, default: 100 },
    size: { type: Number, default: 112 },
    strokeWidth: { type: Number, default: 10 },
    label: { type: String, default: '' },
    suffix: { type: String, default: '%' },
    color: { type: String, default: '' },
  },
  setup(props) {
    const clamped = computed(() => Math.max(0, Math.min(props.max, props.value || 0)));
    const pct = computed(() => (props.max > 0 ? clamped.value / props.max : 0));
    const center = computed(() => props.size / 2);
    const radius = computed(() => (props.size - props.strokeWidth) / 2 - 2);
    const circumference = computed(() => 2 * Math.PI * radius.value);
    const dashOffset = computed(() => circumference.value * (1 - pct.value));
    const valueFontSize = computed(() => Math.max(14, Math.round(props.size * 0.2)));

    const strokeColor = computed(() => {
      if (props.color) return props.color;
      const p = pct.value * 100;
      if (p >= 88) return '#f87171';
      if (p >= 72) return '#fbbf24';
      return '#22d3ee';
    });

    const displayValue = computed(() => `${Math.round(clamped.value)}${props.suffix}`);

    return {
      center,
      radius,
      circumference,
      dashOffset,
      strokeColor,
      displayValue,
      valueFontSize,
    };
  },
});
</script>

<style scoped lang="scss">
.radial-gauge {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gauge-track {
  stroke: #1b2538;
}

.gauge-arc {
  transition: stroke-dashoffset 0.55s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.3s ease;
}

.gauge-center {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.gauge-value {
  font-weight: 800;
  color: #f8fafc;
  line-height: 1.1;
}

.gauge-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #94a3b8;
  margin-top: 3px;
}
</style>
