<template>
  <div class="panel text-center py-9 px-5 text-slate-400">
    <h3 v-if="title" class="text-lg font-bold text-slate-100 mt-0 mb-2">{{ title }}</h3>
    <p v-if="description" class="text-sm text-slate-400 mt-0 mb-5 mx-auto" style="max-width: 520px;">
      {{ description }}
    </p>
    <slot />
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'UiEmptyState',
  props: {
    title: { type: String, default: '' },
    description: { type: String, default: '' },
  },
});
</script>
