<template>
  <div
    class="cp-wrap"
    :class="[
      `col-${colSpan}`,
      `cp-h-${height}`,
      {
        'cp-editing': editMode,
        'cp-dragging': isDragging,
        'cp-drag-over': isDragOver,
      },
    ]"
    :draggable="editMode"
    @dragstart="$emit('drag-start', $event)"
    @dragover="$emit('drag-over', $event)"
    @dragleave="$emit('drag-leave')"
    @drop="$emit('drop', $event)"
    @dragend="$emit('drag-end')"
  >
    <div v-if="editMode" class="cp-toolbar">
      <div class="cp-title-drag" title="Drag panel to reorder">
        <span class="cp-grip" aria-hidden="true">&#8942;&#8942;</span>
        <span class="cp-title-text">{{ title }}</span>
      </div>
      <div class="cp-controls" @mousedown.stop>
        <div class="cp-btn-group" title="Move panel order">
          <button
            class="cp-btn"
            type="button"
            title="Move earlier"
            @click="$emit('move-step', -1)"
          >
            &larr;
          </button>
          <button
            class="cp-btn"
            type="button"
            title="Move later"
            @click="$emit('move-step', 1)"
          >
            &rarr;
          </button>
        </div>

        <div class="cp-btn-group" title="Panel width">
          <button
            v-for="opt in spanOptions"
            :key="opt.value"
            class="cp-btn"
            :class="{ active: colSpan === opt.value }"
            type="button"
            @click="$emit('resize', opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>

        <div class="cp-btn-group" title="Panel height">
          <button
            v-for="h in heightOptions"
            :key="h.value"
            class="cp-btn"
            :class="{ active: height === h.value }"
            type="button"
            @click="$emit('set-height', h.value)"
          >
            {{ h.label }}
          </button>
        </div>

        <button
          class="cp-btn cp-btn-hide"
          type="button"
          title="Hide panel"
          @click="$emit('hide')"
        >
          &times;
        </button>
      </div>
    </div>

    <div class="cp-body">
      <slot />
    </div>

    <button
      v-if="editMode"
      class="cp-resize-corner"
      type="button"
      title="Click to cycle panel width"
      @click.stop="$emit('cycle-size')"
    >
      &#8690;
    </button>
  </div>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';
import type { PanelColSpan, PanelHeight } from '@/composables/usePanelLayout';

export default defineComponent({
  name: 'CustomizablePanel',
  props: {
    panelId: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    colSpan: {
      type: Number as PropType<PanelColSpan>,
      default: 6,
    },
    height: {
      type: String as PropType<PanelHeight>,
      default: 'normal',
    },
    editMode: {
      type: Boolean,
      default: false,
    },
    isDragging: {
      type: Boolean,
      default: false,
    },
    isDragOver: {
      type: Boolean,
      default: false,
    },
  },
  emits: [
    'drag-start',
    'drag-over',
    'drag-leave',
    'drop',
    'drag-end',
    'resize',
    'cycle-size',
    'set-height',
    'move-step',
    'hide',
  ],
  setup() {
    const spanOptions: Array<{ value: PanelColSpan; label: string }> = [
      { value: 3, label: '1/4' },
      { value: 4, label: '1/3' },
      { value: 6, label: '1/2' },
      { value: 8, label: '2/3' },
      { value: 12, label: 'Full' },
    ];
    const heightOptions: Array<{ value: PanelHeight; label: string }> = [
      { value: 'compact', label: 'S' },
      { value: 'normal', label: 'M' },
      { value: 'tall', label: 'L' },
    ];

    return {
      spanOptions,
      heightOptions,
    };
  },
});
</script>

<style scoped>
.cp-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  transition: transform 0.14s ease, box-shadow 0.14s ease, border-color 0.14s ease;
}

.cp-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.cp-body > :deep(.panel) {
  flex: 1 1 auto;
  height: 100%;
}

.cp-h-compact .cp-body > :deep(.panel) {
  padding: 10px 12px;
}

.cp-h-tall .cp-body > :deep(.panel) {
  min-height: 360px;
}

.cp-editing {
  cursor: grab;
  border-radius: 12px;
  outline: 1px dashed rgba(34, 211, 238, 0.45);
  outline-offset: 2px;
}

.cp-editing:active {
  cursor: grabbing;
}

.cp-dragging {
  opacity: 0.45;
  transform: scale(0.985);
}

.cp-drag-over {
  outline: 2px solid #22d3ee;
  box-shadow: 0 0 0 4px rgba(34, 211, 238, 0.16);
  background: rgba(34, 211, 238, 0.04);
}

.cp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  padding: 5px 8px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(34, 211, 238, 0.35);
}

.cp-title-drag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #67e8f9;
}

.cp-grip {
  font-size: 13px;
  color: #94a3b8;
  letter-spacing: -2px;
}

.cp-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.cp-btn-group {
  display: inline-flex;
  align-items: center;
  border-radius: 5px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.25);
}

.cp-btn {
  border: none;
  background: rgba(30, 41, 59, 0.85);
  color: #cbd5e1;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  cursor: pointer;
  line-height: 1.4;
}

.cp-btn:hover {
  background: rgba(51, 65, 85, 0.95);
  color: #f8fafc;
}

.cp-btn.active {
  background: rgba(34, 211, 238, 0.22);
  color: #67e8f9;
}

.cp-btn-hide {
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 5px;
  color: #fca5a5;
  padding: 2px 7px;
}

.cp-btn-hide:hover {
  background: rgba(239, 68, 68, 0.22);
  color: #fecaca;
}

.cp-resize-corner {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 5;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid rgba(34, 211, 238, 0.45);
  background: rgba(15, 23, 42, 0.9);
  color: #67e8f9;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cp-resize-corner:hover {
  background: rgba(34, 211, 238, 0.25);
}
</style>
