<template>
  <UiDialog :open="open" :title="title" max-width="460px" :show-close="false" @close="$emit('cancel')">
    <p class="m-0 text-base text-slate-200 leading-relaxed">{{ message }}</p>
    <template #footer>
      <UiButton variant="ghost" size="lg" @click="$emit('cancel')">Cancel</UiButton>
      <UiButton :variant="danger ? 'danger' : 'primary'" size="lg" @click="$emit('confirm')">
        {{ confirmLabel }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';

export default defineComponent({
  name: 'ConfirmModal',
  components: { UiDialog, UiButton },
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: 'Confirm Action' },
    message: { type: String, default: '' },
    confirmLabel: { type: String, default: 'Confirm' },
    danger: { type: Boolean, default: false },
  },
});
</script>
