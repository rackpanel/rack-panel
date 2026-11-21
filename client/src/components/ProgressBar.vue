<template>
  <div class="pbar-wrap">
    <div v-if="label || rightText" class="pbar-header">
      <span class="text-slate-300 font-semibold whitespace-nowrap overflow-hidden text-ellipsis mr-2">
        {{ label }}
      </span>
      <span class="text-slate-400 text-xs font-mono whitespace-nowrap">{{ rightText }}</span>
    </div>
    <div class="pbar-track">
      <div class="pbar-fill" :class="toneClass" :style="{ width: clamped + '%' }"></div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';

export default defineComponent({
  name: 'ProgressBar',
  props: {
    percent: { type: Number, required: true },
    label: { type: String, default: '' },
    rightText: { type: String, default: '' },
    tone: { type: String, default: 'auto' },
  },
  setup(props) {
    const clamped = computed(() => Math.max(0, Math.min(100, Math.round((props.percent || 0) * 10) / 10)));

    const toneClass = computed(() => {
      if (props.tone !== 'auto') return `tone-${props.tone}`;
      if (clamped.value >= 88) return 'tone-crimson';
      if (clamped.value >= 72) return 'tone-amber';
      return 'tone-cyan';
    });

    return { clamped, toneClass };
  },
});
</script>
