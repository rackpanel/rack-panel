import { computed, ref, watch } from 'vue';

export type PanelColSpan = 3 | 4 | 6 | 8 | 12;
export type PanelHeight = 'compact' | 'normal' | 'tall';

export interface PanelDefaultConfig {
  id: string;
  title: string;
  colSpan: PanelColSpan;
  height?: PanelHeight;
  hidden?: boolean;
}

export interface PanelLayoutState {
  order: string[];
  sizes: Record<string, PanelColSpan>;
  heights: Record<string, PanelHeight>;
  hidden: string[];
}

const VALID_SPANS: PanelColSpan[] = [3, 4, 6, 8, 12];
const VALID_HEIGHTS: PanelHeight[] = ['compact', 'normal', 'tall'];

function buildDefaultState(defaults: PanelDefaultConfig[]): PanelLayoutState {
  const order: string[] = [];
  const sizes: Record<string, PanelColSpan> = {};
  const heights: Record<string, PanelHeight> = {};
  const hidden: string[] = [];

  for (const item of defaults) {
    order.push(item.id);
    sizes[item.id] = item.colSpan;
    heights[item.id] = item.height || 'normal';
    if (item.hidden) hidden.push(item.id);
  }

  return { order, sizes, heights, hidden };
}

function loadState(storageKey: string, defaults: PanelDefaultConfig[]): PanelLayoutState {
  const base = buildDefaultState(defaults);
  try {
    const raw = localStorage.getItem(`rackpanel_layout_${storageKey}`);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<PanelLayoutState>;
    const validIds = new Set(defaults.map((d) => d.id));

    const order: string[] = [];
    if (Array.isArray(parsed.order)) {
      for (const id of parsed.order) {
        if (typeof id === 'string' && validIds.has(id) && !order.includes(id)) {
          order.push(id);
        }
      }
    }
    for (const item of defaults) {
      if (!order.includes(item.id)) {
        order.push(item.id);
      }
    }

    const sizes: Record<string, PanelColSpan> = { ...base.sizes };
    if (parsed.sizes && typeof parsed.sizes === 'object') {
      for (const [id, span] of Object.entries(parsed.sizes)) {
        if (validIds.has(id) && VALID_SPANS.includes(span as PanelColSpan)) {
          sizes[id] = span as PanelColSpan;
        }
      }
    }

    const heights: Record<string, PanelHeight> = { ...base.heights };
    if (parsed.heights && typeof parsed.heights === 'object') {
      for (const [id, h] of Object.entries(parsed.heights)) {
        if (validIds.has(id) && VALID_HEIGHTS.includes(h as PanelHeight)) {
          heights[id] = h as PanelHeight;
        }
      }
    }

    const hidden: string[] = [];
    if (Array.isArray(parsed.hidden)) {
      for (const id of parsed.hidden) {
        if (typeof id === 'string' && validIds.has(id) && !hidden.includes(id)) {
          hidden.push(id);
        }
      }
    }

    return { order, sizes, heights, hidden };
  } catch {
    return base;
  }
}

export function usePanelLayout(storageKey: string, defaults: PanelDefaultConfig[]) {
  const state = ref<PanelLayoutState>(loadState(storageKey, defaults));
  const editMode = ref(false);
  const draggedId = ref<string | null>(null);
  const dragOverId = ref<string | null>(null);

  watch(
    state,
    (next) => {
      try {
        localStorage.setItem(`rackpanel_layout_${storageKey}`, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
    },
    { deep: true },
  );

  const visibleIds = computed(() =>
    state.value.order.filter((id) => !state.value.hidden.includes(id)),
  );

  const hiddenPanels = computed(() =>
    defaults.filter((d) => state.value.hidden.includes(d.id)),
  );

  function getColSpan(id: string): PanelColSpan {
    return state.value.sizes[id] || 6;
  }

  function getHeight(id: string): PanelHeight {
    return state.value.heights[id] || 'normal';
  }

  function setColSpan(id: string, span: PanelColSpan) {
    state.value.sizes = { ...state.value.sizes, [id]: span };
  }

  function cycleColSpan(id: string) {
    const current = getColSpan(id);
    const idx = VALID_SPANS.indexOf(current);
    const next = VALID_SPANS[(idx + 1) % VALID_SPANS.length];
    setColSpan(id, next);
  }

  function setHeight(id: string, height: PanelHeight) {
    state.value.heights = { ...state.value.heights, [id]: height };
  }

  function toggleHide(id: string) {
    if (state.value.hidden.includes(id)) {
      state.value.hidden = state.value.hidden.filter((item) => item !== id);
    } else {
      state.value.hidden = [...state.value.hidden, id];
    }
  }

  function showPanel(id: string) {
    state.value.hidden = state.value.hidden.filter((item) => item !== id);
  }

  function movePanel(fromId: string, toId: string) {
    if (!fromId || !toId || fromId === toId) return;
    const nextOrder = [...state.value.order];
    const fromIdx = nextOrder.indexOf(fromId);
    const toIdx = nextOrder.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    nextOrder.splice(fromIdx, 1);
    nextOrder.splice(toIdx, 0, fromId);
    state.value.order = nextOrder;
  }

  function moveStep(id: string, dir: -1 | 1) {
    const visible = visibleIds.value;
    const visIdx = visible.indexOf(id);
    if (visIdx === -1) return;
    const targetVisIdx = visIdx + dir;
    if (targetVisIdx < 0 || targetVisIdx >= visible.length) return;
    movePanel(id, visible[targetVisIdx]);
  }

  function resetLayout() {
    state.value = buildDefaultState(defaults);
    try {
      localStorage.removeItem(`rackpanel_layout_${storageKey}`);
    } catch {
      // Ignore
    }
  }

  function toggleEditMode() {
    editMode.value = !editMode.value;
    draggedId.value = null;
    dragOverId.value = null;
  }

  function syncPanels(nextDefaults: PanelDefaultConfig[]) {
    const validIds = new Set(nextDefaults.map((d) => d.id));
    const nextOrder = state.value.order.filter((id) => validIds.has(id));
    const nextSizes = { ...state.value.sizes };
    const nextHeights = { ...state.value.heights };
    for (const item of nextDefaults) {
      if (!nextOrder.includes(item.id)) {
        nextOrder.push(item.id);
      }
      if (!nextSizes[item.id]) {
        nextSizes[item.id] = item.colSpan;
      }
      if (!nextHeights[item.id]) {
        nextHeights[item.id] = item.height || 'normal';
      }
    }
    state.value = {
      order: nextOrder,
      sizes: nextSizes,
      heights: nextHeights,
      hidden: state.value.hidden.filter((id) => validIds.has(id)),
    };
  }

  function onDragStart(id: string, e: DragEvent) {
    if (!editMode.value) return;
    draggedId.value = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  }

  function onDragOver(id: string, e: DragEvent) {
    if (!editMode.value || !draggedId.value || draggedId.value === id) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    dragOverId.value = id;
  }

  function onDragLeave(id: string) {
    if (dragOverId.value === id) {
      dragOverId.value = null;
    }
  }

  function onDrop(id: string, e: DragEvent) {
    if (!editMode.value) return;
    e.preventDefault();
    const from = draggedId.value || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
    if (from && from !== id) {
      movePanel(from, id);
    }
    draggedId.value = null;
    dragOverId.value = null;
  }

  function onDragEnd() {
    draggedId.value = null;
    dragOverId.value = null;
  }

  return {
    state,
    editMode,
    draggedId,
    dragOverId,
    visibleIds,
    hiddenPanels,
    getColSpan,
    getHeight,
    setColSpan,
    cycleColSpan,
    setHeight,
    toggleHide,
    showPanel,
    movePanel,
    moveStep,
    resetLayout,
    toggleEditMode,
    syncPanels,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd,
  };
}
