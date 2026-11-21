<template>
  <button
    :type="type"
    :disabled="disabled"
    class="btn"
    :class="[variantClass, sizeClass]"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';

export default defineComponent({
  name: 'UiButton',
  props: {
    variant: {
      type: String as () => 'default' | 'primary' | 'success' | 'warn' | 'danger' | 'ghost',
      default: 'default',
    },
    size: {
      type: String as () => 'sm' | 'md' | 'lg',
      default: 'md',
    },
    type: {
      type: String as () => 'button' | 'submit' | 'reset',
      default: 'button',
    },
    disabled: { type: Boolean, default: false },
  },
  setup(props) {
    const variantClass = computed(() =>
      props.variant === 'default' ? '' : `btn-${props.variant}`,
    );
    const sizeClass = computed(() => (props.size === 'md' ? '' : `btn-${props.size}`));
    return { variantClass, sizeClass };
  },
});
</script>
