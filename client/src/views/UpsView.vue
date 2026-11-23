<template>
  <div>
    <div class="section-bar">
      <div>
        <h2 class="section-heading">UPS &amp; Rack Power Management</h2>
        <div class="panel-subtitle">
          Live battery charge, runtime, input/output voltage, load watts, and power source telemetry (IBM HV, Eaton, APC, NUT, RFC 1628)
        </div>
      </div>
      <div class="btn-group">
        <button
          v-if="upsList.length > 0"
          class="btn"
          :class="layout.editMode.value ? 'btn-primary' : ''"
          type="button"
          @click="layout.toggleEditMode()"
        >
          {{ layout.editMode.value ? 'Done Customizing' : 'Customize Layout' }}
        </button>
        <button
          v-if="layout.editMode.value"
          class="btn"
          type="button"
          @click="layout.resetLayout()"
        >
          Reset
        </button>
        <button class="btn btn-primary" type="button" @click="$emit('add-ups')">
          + Connect UPS
        </button>
      </div>
    </div>

    <div v-if="layout.editMode.value && layout.hiddenPanels.value.length > 0" class="panel" style="margin-bottom: 14px;">
      <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px;">
        <span class="mono" style="font-size: 11px; color: #94a3b8;">Hidden Power Units:</span>
        <button
          v-for="hp in layout.hiddenPanels.value"
          :key="hp.id"
          class="btn btn-sm"
          type="button"
          @click="layout.showPanel(hp.id)"
        >
          + {{ hp.title }}
        </button>
      </div>
    </div>

    <div v-if="upsList.length === 0" class="panel empty-state">
      <h3>No UPS Connected</h3>
      <p>
        Connect your <strong>IBM 3000VA/2700W Rack HV UPS</strong>, APC Smart-UPS, Eaton, or NUT daemon via SNMP (:161) or NUT (:3493) to monitor battery charge, runtime, wattage, and line voltage.
      </p>
      <button class="btn btn-primary btn-lg" type="button" @click="$emit('add-ups')">
        + Connect UPS
      </button>
    </div>

    <div v-else class="rack-row">
      <CustomizablePanel
        v-for="u in orderedUps"
        :key="u.configId"
        :panel-id="u.configId"
        :title="u.name"
        :col-span="layout.getColSpan(u.configId)"
        :height="layout.getHeight(u.configId)"
        :edit-mode="layout.editMode.value"
        :is-dragging="layout.draggedId.value === u.configId"
        :is-drag-over="layout.dragOverId.value === u.configId"
        style="margin-bottom: 16px;"
        @drag-start="layout.onDragStart(u.configId, $event)"
        @drag-over="layout.onDragOver(u.configId, $event)"
        @drag-leave="layout.onDragLeave(u.configId)"
        @drop="layout.onDrop(u.configId, $event)"
        @drag-end="layout.onDragEnd()"
        @resize="layout.setColSpan(u.configId, $event)"
        @cycle-size="layout.cycleColSpan(u.configId)"
        @set-height="layout.setHeight(u.configId, $event)"
        @move-step="layout.moveStep(u.configId, $event)"
        @hide="layout.toggleHide(u.configId)"
      >
        <div class="panel">
          <div class="panel-header" style="flex-wrap: wrap; gap: 10px;">
            <div>
              <div class="node-title-row">
                <span
                  class="dot"
                  :class="
                    u.status === 'online'
                      ? 'dot-ok pulse'
                      : u.status === 'on-battery' || u.status === 'bypass'
                        ? 'dot-warn pulse'
                        : 'dot-crit'
                  "
                ></span>
                <span class="node-name mono">{{ u.name }}</span>
                <span
                  class="pill mono"
                  :class="
                    u.status === 'online'
                      ? 'pill-ok'
                      : u.status === 'on-battery' || u.status === 'bypass'
                        ? 'pill-warn'
                        : 'pill-crit'
                  "
                  style="margin-left: 8px;"
                >
                  {{ u.status.toUpperCase() }}
                </span>
                <span class="pill pill-cyan mono" style="margin-left: 6px;">
                  {{ u.ratedVa }}VA / {{ u.ratedWatts }}W
                </span>
                <span class="pill pill-muted mono" style="margin-left: 6px;">
                  {{ u.protocol.toUpperCase() }} &middot; {{ u.host }}
                </span>
              </div>
              <div class="panel-subtitle mono" style="margin-top: 4px;">
                {{ u.manufacturer }} {{ u.model }}
                <template v-if="u.firmwareVersion"> &middot; {{ u.firmwareVersion }}</template>
              </div>
            </div>

            <div class="btn-group">
              <button class="btn btn-sm" type="button" @click="editUps(u.configId)">Edit</button>
              <button class="btn btn-sm btn-danger" type="button" @click="deleteUps(u)">Remove</button>
            </div>
          </div>

          <div v-if="u.errorMessage" class="alert-row alert-critical" style="margin-bottom: 14px;">
            {{ u.errorMessage }}
          </div>

          <TeslaPowerwallDiagram
            v-if="u.protocol === 'powerwall' || u.protocol === 'powerwall-cloud'"
            :ups="u"
          />
          <UpsPowerFlowDiagram v-else :ups="u" />

          <div class="rack-row">
            <div class="col-3">
              <div class="panel kpi-card" style="background: #0a101d;">
                <div class="kpi-label">LOAD POWER</div>
                <div class="kpi-value mono">
                  {{ u.outputWatts !== null ? `${u.outputWatts}W` : '—' }}
                  <span style="font-size: 13px; opacity: 0.65;">/ {{ u.ratedWatts }}W</span>
                </div>
                <div class="kpi-sub mono">
                  {{ u.outputLoadPercent !== null ? `${u.outputLoadPercent}% capacity` : 'Load % unavailable' }}
                </div>
              </div>
            </div>

            <div class="col-3">
              <div class="panel kpi-card" style="background: #0a101d;">
                <div class="kpi-label">BATTERY CHARGE</div>
                <div class="kpi-value mono" :style="{ color: (u.batteryChargePercent ?? 100) < 30 ? '#f87171' : '#22c55e' }">
                  {{ u.batteryChargePercent !== null ? `${u.batteryChargePercent}%` : '—' }}
                </div>
                <div class="kpi-sub mono">
                  {{ u.estimatedRuntimeMinutes !== null ? `${u.estimatedRuntimeMinutes} min runtime` : 'Runtime unavailable' }}
                  <template v-if="u.batteryVoltage !== null"> &middot; {{ u.batteryVoltage }}V DC</template>
                </div>
              </div>
            </div>

            <div class="col-3">
              <div class="panel kpi-card" style="background: #0a101d;">
                <div class="kpi-label">INPUT / OUTPUT AC</div>
                <div class="kpi-value mono">
                  {{ u.inputVoltage !== null ? `${u.inputVoltage}V` : '—' }}
                  <span style="opacity: 0.5;">&rarr;</span>
                  {{ u.outputVoltage !== null ? `${u.outputVoltage}V` : '—' }}
                </div>
                <div class="kpi-sub mono">
                  Source: {{ u.outputSource.toUpperCase() }}
                  <template v-if="u.inputFrequencyHz !== null"> &middot; {{ u.inputFrequencyHz }} Hz</template>
                </div>
              </div>
            </div>

            <div class="col-3">
              <div class="panel kpi-card" style="background: #0a101d;">
                <div class="kpi-label">{{ u.protocol === 'powerwall' || u.protocol === 'powerwall-cloud' ? 'SOLAR / GRID' : 'THERMAL & ALARMS' }}</div>
                <div class="kpi-value mono">
                  <template v-if="u.protocol === 'powerwall' || u.protocol === 'powerwall-cloud'">
                    {{ u.solarWatts !== undefined && u.solarWatts !== null ? `${u.solarWatts}W` : '0W' }}
                  </template>
                  <template v-else>
                    {{ u.batteryTempC !== null ? `${u.batteryTempC}°C` : 'N/A' }}
                  </template>
                </div>
                <div class="kpi-sub mono" :style="{ color: u.alarmsCount > 0 ? '#f87171' : '#94a3b8' }">
                  <template v-if="u.protocol === 'powerwall' || u.protocol === 'powerwall-cloud'">
                    Grid: {{ u.gridWatts !== undefined && u.gridWatts !== null ? `${u.gridWatts}W` : '—' }}
                  </template>
                  <template v-else>
                    {{ u.alarmsCount }} active alarm{{ u.alarmsCount === 1 ? '' : 's' }}
                    <template v-if="u.batteryTempC === null"> &middot; No temp probe</template>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </CustomizablePanel>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, watch, type PropType } from 'vue';
import type { OverviewResponse, UpsSnapshot } from '@shared/types';
import { api } from '@/api/client';
import UpsPowerFlowDiagram from '@/components/UpsPowerFlowDiagram.vue';
import TeslaPowerwallDiagram from '@/components/TeslaPowerwallDiagram.vue';
import CustomizablePanel from '@/components/ui/CustomizablePanel.vue';
import { usePanelLayout } from '@/composables/usePanelLayout';

export default defineComponent({
  name: 'UpsView',
  components: { UpsPowerFlowDiagram, TeslaPowerwallDiagram, CustomizablePanel },
  props: {
    overview: { type: Object as PropType<OverviewResponse | null>, default: null },
  },
  emits: ['add-ups', 'edit-ups', 'refresh', 'toast'],
  setup(props, { emit }) {
    const upsList = computed<UpsSnapshot[]>(() => props.overview?.ups ?? []);
    const layout = usePanelLayout('ups_v1', []);

    watch(
      upsList,
      (list) => {
        layout.syncPanels(
          list.map((u) => ({
            id: u.configId,
            title: u.name,
            colSpan: 12,
          })),
        );
      },
      { immediate: true },
    );

    const orderedUps = computed(() => {
      const map = new Map(upsList.value.map((u) => [u.configId, u]));
      return layout.visibleIds.value
        .map((id) => map.get(id))
        .filter((u): u is UpsSnapshot => Boolean(u));
    });

    async function editUps(id: string) {
      try {
        const list = await api.listUps();
        const found = list.find((u) => u.id === id);
        if (found) emit('edit-ups', found);
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to load UPS config', error: true });
      }
    }

    async function deleteUps(u: UpsSnapshot) {
      if (!window.confirm(`Remove UPS "${u.name}" (${u.host})?`)) return;
      try {
        await api.deleteUps(u.configId);
        emit('toast', { message: `Removed ${u.name}`, error: false });
        emit('refresh');
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Failed to remove UPS', error: true });
      }
    }

    return { upsList, orderedUps, layout, editUps, deleteUps };
  },
});
</script>
