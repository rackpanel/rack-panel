<template>
  <div class="w-full h-16 rounded bg-rack-input border border-rack-border overflow-hidden">
    <svg :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="none" class="block w-full h-full">
      <line
        v-for="y in gridLines"
        :key="y"
        x1="0"
        :x2="width"
        :y1="y"
        :y2="y"
        stroke="#1e293b"
        stroke-width="1"
        stroke-dasharray="3 3"
      />
      <polygon v-if="areaPoints" :points="areaPoints" :fill="fillColor" />
      <polyline
        v-if="linePoints"
        :points="linePoints"
        fill="none"
        :stroke="strokeColor"
        stroke-width="2.2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';

export default defineComponent({
  name: 'SparklineChart',
  props: {
    values: { type: Array as () => number[], required: true },
    max: { type: Number, default: 100 },
    height: { type: Number, default: 64 },
    width: { type: Number, default: 260 },
    strokeColor: { type: String, default: '#22d3ee' },
    fillColor: { type: String, default: 'rgba(34, 211, 238, 0.16)' },
  },
  setup(props) {
    const gridLines = computed(() => [
      Math.round(props.height * 0.25),
      Math.round(props.height * 0.5),
      Math.round(props.height * 0.75),
    ]);

    const coords = computed(() => {
      const vals = props.values.length > 0 ? props.values : [0];
      const maxVal = props.max > 0 ? props.max : Math.max(1, ...vals);
      const count = vals.length;
      const pad = 3;
      const usableH = props.height - pad * 2;
      return vals.map((v, idx) => {
        const x = count === 1 ? props.width : (idx / (count - 1)) * props.width;
        const norm = Math.max(0, Math.min(1, v / maxVal));
        const y = props.height - pad - norm * usableH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      });
    });

    const linePoints = computed(() => coords.value.join(' '));
    const areaPoints = computed(() => {
      if (coords.value.length < 2) return '';
      return `0,${props.height} ${coords.value.join(' ')} ${props.width},${props.height}`;
    });

    return {
      gridLines,
      linePoints,
      areaPoints,
    };
  },
});
</script>
