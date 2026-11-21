<template>
  <transition name="modal-pop">
    <div
      v-if="open"
      class="modal-backdrop"
      role="dialog"
      aria-modal="true"
      @click.self="$emit('close')"
    >
      <div class="modal-card" :style="maxWidth ? { maxWidth } : undefined">
        <div class="modal-header">
          <h3 class="modal-title">{{ title }}</h3>
          <button
            v-if="showClose"
            class="btn btn-sm btn-ghost"
            type="button"
            @click="$emit('close')"
          >
            Close
          </button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </transition>
</template>

<script lang="ts">
import { defineComponent, watch, onBeforeUnmount } from 'vue';

export default defineComponent({
  name: 'UiDialog',
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '' },
    maxWidth: { type: String, default: '' },
    showClose: { type: Boolean, default: true },
  },
  setup(props, { emit }) {
    function onKeydown(e: KeyboardEvent) {
      if (props.open && e.key === 'Escape') {
        emit('close');
      }
    }

    watch(
      () => props.open,
      (val) => {
        if (val) {
          window.addEventListener('keydown', onKeydown);
        } else {
          window.removeEventListener('keydown', onKeydown);
        }
      },
      { immediate: true },
    );

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeydown);
    });
  },
});
</script>
