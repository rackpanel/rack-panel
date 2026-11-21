<template>
  <span class="pill" :class="toneClass">
    <span v-if="dot" class="dot" :class="[dotClass, pulse ? 'pulse' : '']"></span>
    <slot />
  </span>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';

export default defineComponent({
  name: 'UiBadge',
  props: {
    tone: {
      type: String as () => 'ok' | 'warn' | 'crit' | 'cyan' | 'violet' | 'muted',
      default: 'muted',
    },
    dot: { type: Boolean, default: false },
    pulse: { type: Boolean, default: false },
  },
  setup(props) {
    const toneClass = computed(() => `pill-${props.tone}`);
    const dotClass = computed(() => {
      if (props.tone === 'ok') return 'dot-ok';
      if (props.tone === 'warn') return 'dot-warn';
      if (props.tone === 'crit') return 'dot-crit';
      return 'dot-muted';
    });
    return { toneClass, dotClass };
  },
});
</script>
