<template>
  <div>
    <!-- Top Section Bar -->
    <div class="section-bar">
      <div>
        <h2 class="section-heading">Network Switches &amp; L2/L3 Switching</h2>
        <div class="panel-subtitle">
          Port link states, 1G/100M/SFP metrics, PoE budgets, LLDP neighbors, MAC tables &amp; rack integration (synced with Topology)
        </div>
      </div>
      <div class="btn-group">
        <button class="btn btn-sm" type="button" :disabled="loading" @click="loadSwitches()">
          {{ loading ? 'Refreshing...' : 'Refresh' }}
        </button>
        <button class="btn btn-primary" type="button" @click="openAddModal()">
          + Add / Detect Switch
        </button>
      </div>
    </div>

    <div v-if="!loading && switches.length === 0" class="panel empty-state">
      <h3>No Managed Switches Added</h3>
      <p>
        Connect a managed switch (TP-Link JetStream, Omada, Cisco, Ubiquiti, MikroTik) via SSH, Telnet, SNMP, or HTTP.
        Switches added here are automatically synced to Topology &amp; Rack Builder with no duplication.
      </p>
      <button class="btn btn-primary btn-lg" type="button" @click="openAddModal()">
        + Add / Detect Switch
      </button>
    </div>

    <template v-else-if="switches.length > 0">
      <!-- Switch Selector Strip -->
      <div class="opn-strip">
        <button
          v-for="sw in switches"
          :key="sw.id"
          type="button"
          class="opn-chip"
          :class="{ active: activeId === sw.id }"
          @click="selectedId = sw.id"
        >
          <span
            class="dot"
            :class="sw.status === 'online' ? 'dot-ok' : sw.status === 'offline' ? 'dot-crit' : 'dot-warn'"
          ></span>
          <span style="margin-right: 8px;">{{ sw.name }}</span>
          <span class="pill pill-muted mono" style="font-size: 10px; padding: 2px 6px;">
            {{ (sw.switchMeta && sw.switchMeta.model) || 'Switch' }}
          </span>
        </button>
      </div>

      <div v-if="activeSwitch">
        <!-- Identity & Control Bar -->
        <div class="panel" style="margin-bottom: 16px;">
          <div class="opn-id-row">
            <div>
              <div class="opn-title-line">
                <span
                  class="dot"
                  :class="activeSwitch.status === 'online' ? 'dot-ok pulse' : activeSwitch.status === 'offline' ? 'dot-crit' : 'dot-warn'"
                ></span>
                <h3 class="opn-name">{{ activeSwitch.name }}</h3>
                <span class="pill pill-cyan mono" style="margin-left: 8px;">
                  {{ (activeSwitch.switchMeta && activeSwitch.switchMeta.vendor) || activeSwitch.manufacturer || 'Managed Switch' }}
                </span>
                <span class="pill pill-muted mono" style="margin-left: 6px;">
                  {{ (activeSwitch.switchMeta && activeSwitch.switchMeta.model) || 'Switch' }}
                </span>
                <span
                  v-if="activeSwitch.switchMeta && activeSwitch.switchMeta.poeSupported"
                  class="pill pill-violet mono"
                  style="margin-left: 6px;"
                >
                  PoE+ {{ activeSwitch.switchMeta.poeUsedWatts || 0 }}W/{{ activeSwitch.switchMeta.poeBudgetWatts || 192 }}W
                </span>
                <span v-if="rackBadge" class="pill pill-muted mono" style="margin-left: 6px;">
                  {{ rackBadge }}
                </span>
              </div>
              <div class="opn-meta mono">
                {{ activeSwitch.ipAddress || 'No IP' }}
                <template v-if="activeSwitch.macAddress"> &middot; MAC: {{ activeSwitch.macAddress }}</template>
                <template v-if="activeSwitch.switchMeta && activeSwitch.switchMeta.firmwareVersion">
                  &middot; FW: <strong>{{ activeSwitch.switchMeta.firmwareVersion }}</strong>
                </template>
                <template v-if="activeSwitch.switchMeta && activeSwitch.switchMeta.uptimeStr">
                  &middot; Uptime: <strong>{{ activeSwitch.switchMeta.uptimeStr }}</strong>
                </template>
                <template v-if="activeSwitch.latencyMs !== null">
                  &middot; Latency: <strong>{{ activeSwitch.latencyMs }}ms</strong>
                </template>
              </div>
              <div v-if="activeSwitch.statusDetail" class="panel-subtitle" style="margin-top: 4px;">
                {{ activeSwitch.statusDetail }}
              </div>
            </div>

            <div class="btn-group">
              <button class="btn btn-sm btn-primary" type="button" @click="openPollModal(activeSwitch)">
                Poll / Configure
              </button>
              <button class="btn btn-sm" type="button" @click="$emit('navigate', 'topology')">
                View in Topology &rarr;
              </button>
              <button class="btn btn-sm btn-danger" type="button" @click="confirmDeleteTarget = activeSwitch">
                Remove
              </button>
            </div>
          </div>
        </div>

        <!-- Visual 1U Switch Faceplate Strip -->
        <div class="panel" style="margin-bottom: 16px;">
          <div class="panel-header" style="margin-bottom: 10px;">
            <span class="panel-title">Live 1U Port Faceplate ({{ upPortsCount }}/{{ totalPortsCount }} UP)</span>
            <div class="sw-legend mono">
              <span><i class="sw-dot sw-dot-1g"></i>1G+</span>
              <span><i class="sw-dot sw-dot-100m"></i>10/100M</span>
              <span><i class="sw-dot sw-dot-sfp"></i>SFP UP</span>
              <span v-if="activeSwitch.switchMeta && activeSwitch.switchMeta.poeSupported">
                <i class="sw-dot sw-dot-poe"></i>PoE Active
              </span>
              <span><i class="sw-dot sw-dot-down"></i>Down</span>
            </div>
          </div>

          <div class="sw-faceplate-wrap">
            <div class="sw-rj45-grid">
              <div class="sw-rj45-row">
                <button
                  v-for="p in oddRj45Ports"
                  :key="`fp-odd-${p.portNumber}`"
                  type="button"
                  class="sw-port-tile mono"
                  :class="portTileClass(p)"
                  :title="portTitle(p)"
                  @click="selectedPort = p"
                >
                  <span class="sw-port-num">{{ p.portNumber }}</span>
                </button>
              </div>
              <div class="sw-rj45-row">
                <button
                  v-for="p in evenRj45Ports"
                  :key="`fp-even-${p.portNumber}`"
                  type="button"
                  class="sw-port-tile mono"
                  :class="portTileClass(p)"
                  :title="portTitle(p)"
                  @click="selectedPort = p"
                >
                  <span class="sw-port-num">{{ p.portNumber }}</span>
                </button>
              </div>
            </div>

            <div v-if="sfpPorts.length > 0" class="sw-sfp-grid">
              <button
                v-for="p in sfpPorts"
                :key="`fp-sfp-${p.portNumber}`"
                type="button"
                class="sw-port-tile sw-port-sfp mono"
                :class="portTileClass(p)"
                :title="portTitle(p)"
                @click="selectedPort = p"
              >
                <span class="sw-port-num">S{{ p.portNumber }}</span>
              </button>
            </div>
          </div>

          <div v-if="selectedPort" class="sw-selected-port mono">
            <strong>{{ selectedPort.name }}</strong>
            <span>({{ selectedPort.media.toUpperCase() }})</span>
            <span class="pill" :class="selectedPort.linkStatus === 'up' ? 'pill-ok' : 'pill-muted'">
              {{ selectedPort.linkStatus.toUpperCase() }} &middot; {{ selectedPort.speed }}
            </span>
            <span v-if="selectedPort.duplex">Duplex: {{ selectedPort.duplex }}</span>
            <span v-if="selectedPort.vlan">VLAN {{ selectedPort.vlan }}</span>
            <span v-if="selectedPort.connectedDeviceName" style="color: #22d3ee;">
              &rarr; {{ selectedPort.connectedDeviceName }}
            </span>
            <span v-else-if="selectedPort.connectedMac" style="color: #94a3b8;">
              MAC: {{ selectedPort.connectedMac }}
            </span>
            <span v-if="selectedPort.poeActive" style="color: #c084fc;">
              PoE: {{ selectedPort.poeWatts || 0 }}W
            </span>
          </div>
        </div>

        <!-- Sub-view Touch Tabs -->
        <div class="tab-strip">
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'overview' }"
            @click="subTab = 'overview'"
          >
            Overview &amp; Metrics
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'ports' }"
            @click="subTab = 'ports'"
          >
            Ports ({{ totalPortsCount }})
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'neighbors' }"
            @click="subTab = 'neighbors'"
          >
            Neighbors &amp; MACs ({{ neighborCount }})
          </button>
          <button
            type="button"
            class="tab-btn"
            :class="{ active: subTab === 'services' }"
            @click="subTab = 'services'"
          >
            Services &amp; Rack ({{ activeSwitch.services.length }})
          </button>
        </div>

        <transition name="view-fade" mode="out-in">
          <!-- SUB-TAB 1: OVERVIEW & METRICS -->
          <div v-if="subTab === 'overview'" key="sw-overview">
            <div class="rack-row">
              <div class="col-3">
                <div class="panel">
                  <div class="kpi-label">Active Links</div>
                  <div class="mono sw-kpi-big">{{ upPortsCount }} / {{ totalPortsCount }}</div>
                  <div class="kpi-sub mono">
                    {{ rj45UpCount }} RJ45 UP &middot; {{ sfpUpCount }} SFP UP
                  </div>
                </div>
              </div>
              <div class="col-3">
                <div class="panel">
                  <div class="kpi-label">Link Speeds</div>
                  <div class="mono sw-kpi-big">{{ gigabitUpCount }} <span style="font-size: 13px; color: #34d399;">1G+</span></div>
                  <div class="kpi-sub mono">
                    {{ slowUpCount }}x 10/100M &middot; {{ downPortsCount }} Down
                  </div>
                </div>
              </div>
              <div class="col-3">
                <div class="panel">
                  <template v-if="activeSwitch.switchMeta && activeSwitch.switchMeta.poeSupported">
                    <div class="kpi-label">PoE+ Power</div>
                    <div class="mono sw-kpi-big">{{ activeSwitch.switchMeta.poeUsedWatts || 0 }}W</div>
                    <div class="kpi-sub mono">
                      Budget {{ activeSwitch.switchMeta.poeBudgetWatts || 192 }}W &middot; {{ poeActiveCount }} active
                    </div>
                  </template>
                  <template v-else>
                    <div class="kpi-label">Port Hardware</div>
                    <div class="mono sw-kpi-big">
                      {{ (activeSwitch.switchMeta && activeSwitch.switchMeta.rj45PortCount) || 24 }}G + {{ (activeSwitch.switchMeta && activeSwitch.switchMeta.sfpPortCount) || 4 }} SFP
                    </div>
                    <div class="kpi-sub mono">Non-PoE Managed Switch</div>
                  </template>
                </div>
              </div>
              <div class="col-3">
                <div class="panel">
                  <div class="kpi-label">Management &amp; Health</div>
                  <div class="mono sw-kpi-big">
                    {{ activeSwitch.latencyMs !== null ? activeSwitch.latencyMs + 'ms' : 'OK' }}
                  </div>
                  <div class="kpi-sub mono">
                    {{ ((activeSwitch.switchMeta && activeSwitch.switchMeta.managementProtocol) || 'auto').toUpperCase() }}
                    <template v-if="activeSwitch.switchMeta && activeSwitch.switchMeta.lastPolledAt">
                      &middot; {{ formatRelativeTime(activeSwitch.switchMeta.lastPolledAt) }}
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- SUB-TAB 2: PORTS -->
          <div v-else-if="subTab === 'ports'" key="sw-ports" class="panel">
            <div class="panel-header" style="margin-bottom: 10px;">
              <span class="panel-title">Port Telemetry ({{ filteredPorts.length }})</span>
              <div class="btn-group">
                <button
                  v-for="f in portFilterOptions"
                  :key="f"
                  type="button"
                  class="btn btn-sm"
                  :class="{ 'btn-primary': portFilter === f }"
                  @click="portFilter = f"
                >
                  {{ f.toUpperCase() }}
                </button>
              </div>
            </div>

            <div class="table-wrap">
              <table class="data-table mono">
                <thead>
                  <tr>
                    <th>Port</th>
                    <th>Media</th>
                    <th>Status</th>
                    <th>Speed</th>
                    <th>Duplex</th>
                    <th>VLAN</th>
                    <th>Connected Device / MAC</th>
                    <th v-if="activeSwitch.switchMeta && activeSwitch.switchMeta.poeSupported">PoE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in filteredPorts" :key="`tbl-${p.portNumber}`">
                    <td><strong>{{ p.name }}</strong></td>
                    <td>{{ p.media.toUpperCase() }}</td>
                    <td>
                      <span class="pill" :class="p.linkStatus === 'up' ? 'pill-ok' : 'pill-muted'">
                        {{ p.linkStatus.toUpperCase() }}
                      </span>
                    </td>
                    <td>{{ p.speed }}</td>
                    <td>{{ p.duplex || '-' }}</td>
                    <td>{{ p.vlan || 1 }}</td>
                    <td>
                      <span v-if="p.connectedDeviceName" style="color: #22d3ee;">{{ p.connectedDeviceName }}</span>
                      <span v-else-if="p.connectedMac" style="color: #94a3b8;">{{ p.connectedMac }}</span>
                      <span v-else style="color: #475569;">-</span>
                    </td>
                    <td v-if="activeSwitch.switchMeta && activeSwitch.switchMeta.poeSupported">
                      <span v-if="p.poeActive" style="color: #c084fc;">{{ p.poeWatts || 0 }}W</span>
                      <span v-else style="color: #475569;">-</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- SUB-TAB 3: NEIGHBORS & MACS -->
          <div v-else-if="subTab === 'neighbors'" key="sw-neighbors" class="panel">
            <div class="panel-header">
              <span class="panel-title">Detected Neighbors &amp; MAC Mappings ({{ neighborCount }})</span>
            </div>
            <div v-if="neighborPorts.length === 0" class="empty-state" style="padding: 28px 16px;">
              <p>No LLDP neighbors or MAC table entries mapped yet. Poll the switch via SSH, Telnet, or SNMP to discover connected devices.</p>
            </div>
            <div v-else class="table-wrap">
              <table class="data-table mono">
                <thead>
                  <tr>
                    <th>Port</th>
                    <th>Status</th>
                    <th>Connected Device</th>
                    <th>MAC Address</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in neighborPorts" :key="`nbr-${p.portNumber}`">
                    <td><strong>{{ p.name }}</strong></td>
                    <td>
                      <span class="pill" :class="p.linkStatus === 'up' ? 'pill-ok' : 'pill-muted'">
                        {{ p.linkStatus.toUpperCase() }}
                      </span>
                    </td>
                    <td style="color: #22d3ee;">{{ p.connectedDeviceName || '-' }}</td>
                    <td>{{ p.connectedMac || '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- SUB-TAB 4: SERVICES & RACK -->
          <div v-else-if="subTab === 'services'" key="sw-services" class="panel">
            <div class="panel-header">
              <span class="panel-title">Management Services &amp; Rack Placement</span>
            </div>
            <div v-if="rackBadge" class="alert-row" style="margin-bottom: 12px;">
              Mounted in Physical Rack: <strong class="mono" style="margin-left: 6px;">{{ rackBadge }}</strong>
            </div>
            <div v-if="activeSwitch.services.length === 0" class="panel-subtitle">
              No management services recorded.
            </div>
            <div v-else>
              <div v-for="s in activeSwitch.services" :key="s.port" class="hl-srv-row mono">
                <span>:{{ s.port }}/{{ s.protocol }} &mdash; {{ s.serviceName }}</span>
                <a v-if="s.url" :href="s.url" target="_blank" class="pill pill-cyan">Open &nearr;</a>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </template>

    <!-- Add / Poll Switch Modal -->
    <div v-if="modalOpen" class="modal-backdrop" @click.self="modalOpen = false">
      <div class="modal-card" style="max-width: 560px;">
        <div class="modal-header">
          <h3 class="modal-title">{{ modalNodeId ? 'Poll / Update Switch' : 'Add & Detect Managed Switch' }}</h3>
          <button type="button" class="btn btn-sm" @click="modalOpen = false">&times;</button>
        </div>

        <form class="modal-body" @submit.prevent="submitProbe">
          <DeviceAutoScan v-if="!modalNodeId" kind="switch" :open="modalOpen" @select="applyScanned" />
          <div class="form-row">
            <label class="field-label">Switch Model Preset</label>
            <select v-model="form.modelPreset" class="select mono">
              <option value="T1600G-28TS">TP-Link JetStream T1600G-28TS (24G + 4x SFP)</option>
              <option value="T1600G-28PS">TP-Link JetStream T1600G-28PS (24x PoE+ 192W + 4x SFP)</option>
              <option value="auto">Auto-Detect Switch Model (SSH / Telnet / SNMP / HTTP)</option>
              <option value="T2600G-28TS">TP-Link JetStream T2600G-28TS</option>
              <option value="TL-SG3428">TP-Link Omada TL-SG3428</option>
              <option value="TL-SG2428P">TP-Link Omada TL-SG2428P (PoE+)</option>
              <option value="CISCO-28P">Cisco SG300-28 / CBS350-24T-4G</option>
              <option value="UBIQUITI-24P">Ubiquiti USW-24-PoE / EdgeSwitch 24</option>
              <option value="MIKROTIK-CRS326">MikroTik CRS326-24G-2S+RM</option>
            </select>
          </div>

          <div class="rack-row">
            <div class="col-6">
              <div class="form-row">
                <label class="field-label">Switch IP / Host</label>
                <input v-model="form.host" class="input mono" type="text" placeholder="192.168.0.254" required />
              </div>
            </div>
            <div class="col-6">
              <div class="form-row">
                <label class="field-label">Display Name (optional)</label>
                <input v-model="form.name" class="input" type="text" placeholder="Core Rack Switch" />
              </div>
            </div>
          </div>

          <div class="rack-row">
            <div class="col-6">
              <div class="form-row">
                <label class="field-label">Protocol</label>
                <select v-model="form.protocol" class="select mono">
                  <option value="auto">Auto (SSH / Telnet / SNMP / HTTP)</option>
                  <option value="ssh">SSH (:22)</option>
                  <option value="telnet">Telnet (:23)</option>
                  <option value="snmp">SNMP v2c (:161)</option>
                  <option value="http">HTTP Web (:80)</option>
                </select>
              </div>
            </div>
            <div class="col-6">
              <div class="form-row">
                <label class="field-label">Username</label>
                <input v-model="form.username" class="input mono" type="text" placeholder="admin" />
              </div>
            </div>
          </div>

          <div class="rack-row">
            <div class="col-6">
              <div class="form-row">
                <label class="field-label">Password</label>
                <input v-model="form.password" class="input mono" type="password" placeholder="Switch CLI password" />
              </div>
            </div>
            <div class="col-6">
              <div class="form-row">
                <label class="field-label">SNMP Community (if SNMP)</label>
                <input v-model="form.snmpCommunity" class="input mono" type="text" placeholder="public" />
              </div>
            </div>
          </div>

          <label style="display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 13px; color: #cbd5e1;">
            <input v-model="form.mountInRack" type="checkbox" />
            Mount / sync in Physical Rack Builder
          </label>

          <div v-if="formError" class="alert-row alert-critical" style="margin-top: 12px;">
            {{ formError }}
          </div>

          <div class="modal-footer">
            <button type="button" class="btn" @click="modalOpen = false">Cancel</button>
            <button type="submit" class="btn btn-primary" :disabled="probing">
              {{ probing ? 'Probing Switch...' : modalNodeId ? 'Poll & Update' : 'Detect & Add Switch' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Confirm Delete Modal -->
    <div v-if="confirmDeleteTarget" class="modal-backdrop" @click.self="confirmDeleteTarget = null">
      <div class="modal-card" style="max-width: 420px;">
        <div class="modal-header">
          <h3 class="modal-title">Remove Switch</h3>
        </div>
        <div class="modal-body">
          <p>
            Remove <strong>{{ confirmDeleteTarget.name }}</strong>? This removes it from Switches, Topology, and Rack Builder.
          </p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn" @click="confirmDeleteTarget = null">Cancel</button>
          <button type="button" class="btn btn-danger" :disabled="deleting" @click="executeDelete">
            {{ deleting ? 'Removing...' : 'Remove Switch' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, reactive, ref, watch, type PropType } from 'vue';
import { api } from '@/api/client';
import DeviceAutoScan, { type ScannedDevicePick } from '@/components/DeviceAutoScan.vue';
import type { TopologyNode, TopologyRack, TopologySwitchPortState } from '../../../shared/types';

type SwSubTab = 'overview' | 'ports' | 'neighbors' | 'services';

export default defineComponent({
  name: 'SwitchesView',
  components: { DeviceAutoScan },
  props: {
    initialSubTab: {
      type: String as PropType<SwSubTab>,
      default: 'overview',
    },
  },
  emits: ['change-sub-tab', 'navigate', 'toast'],
  setup(props, { emit }) {
    const loading = ref(false);
    const switches = ref<TopologyNode[]>([]);
    const racks = ref<TopologyRack[]>([]);
    const selectedId = ref('');
    const subTab = ref<SwSubTab>(props.initialSubTab || 'overview');
    const portFilterOptions: Array<'all' | 'up' | 'down' | 'sfp'> = ['all', 'up', 'down', 'sfp'];
    const portFilter = ref<'all' | 'up' | 'down' | 'sfp'>('all');
    const selectedPort = ref<TopologySwitchPortState | null>(null);

    const modalOpen = ref(false);
    const modalNodeId = ref<string | undefined>(undefined);
    const probing = ref(false);
    const formError = ref('');
    const confirmDeleteTarget = ref<TopologyNode | null>(null);
    const deleting = ref(false);

    const form = reactive({
      modelPreset: 'T1600G-28TS',
      host: '',
      name: '',
      protocol: 'auto' as 'auto' | 'ssh' | 'telnet' | 'snmp' | 'http',
      username: 'admin',
      password: '',
      snmpCommunity: 'public',
      mountInRack: true,
    });

    watch(
      () => props.initialSubTab,
      (val) => {
        if (val) subTab.value = val;
      },
    );

    watch(subTab, (val) => {
      emit('change-sub-tab', val);
    });

    const activeId = computed(() => {
      if (selectedId.value && switches.value.some((s) => s.id === selectedId.value)) {
        return selectedId.value;
      }
      return switches.value[0]?.id || '';
    });

    const activeSwitch = computed<TopologyNode | null>(() => {
      return switches.value.find((s) => s.id === activeId.value) || null;
    });

    watch(activeSwitch, () => {
      selectedPort.value = null;
    });

    const ports = computed<TopologySwitchPortState[]>(() => activeSwitch.value?.switchMeta?.ports || []);
    const oddRj45Ports = computed(() => ports.value.filter((p) => p.media !== 'sfp' && p.portNumber % 2 === 1));
    const evenRj45Ports = computed(() => ports.value.filter((p) => p.media !== 'sfp' && p.portNumber % 2 === 0));
    const sfpPorts = computed(() => ports.value.filter((p) => p.media === 'sfp'));

    const totalPortsCount = computed(() => ports.value.length);
    const upPortsCount = computed(() => ports.value.filter((p) => p.linkStatus === 'up').length);
    const downPortsCount = computed(() => ports.value.filter((p) => p.linkStatus !== 'up').length);
    const rj45UpCount = computed(() => ports.value.filter((p) => p.media !== 'sfp' && p.linkStatus === 'up').length);
    const sfpUpCount = computed(() => ports.value.filter((p) => p.media === 'sfp' && p.linkStatus === 'up').length);
    const gigabitUpCount = computed(
      () => ports.value.filter((p) => p.linkStatus === 'up' && !/100M|10M/i.test(p.speed)).length,
    );
    const slowUpCount = computed(
      () => ports.value.filter((p) => p.linkStatus === 'up' && /100M|10M/i.test(p.speed)).length,
    );
    const poeActiveCount = computed(() => ports.value.filter((p) => p.poeActive).length);

    const filteredPorts = computed(() => {
      if (portFilter.value === 'up') return ports.value.filter((p) => p.linkStatus === 'up');
      if (portFilter.value === 'down') return ports.value.filter((p) => p.linkStatus !== 'up');
      if (portFilter.value === 'sfp') return ports.value.filter((p) => p.media === 'sfp');
      return ports.value;
    });

    const neighborPorts = computed(() =>
      ports.value.filter((p) => Boolean(p.connectedDeviceName || p.connectedMac)),
    );
    const neighborCount = computed(() => neighborPorts.value.length);

    const rackBadge = computed(() => {
      const sw = activeSwitch.value;
      if (!sw?.rackPlacement) return '';
      const rack = racks.value.find((r) => r.id === sw.rackPlacement!.rackId);
      return `${rack?.name || 'Rack'} · U${sw.rackPlacement.startU}`;
    });

    async function loadSwitches() {
      loading.value = true;
      try {
        const res = await api.listSwitches();
        switches.value = res.switches || [];
        racks.value = res.racks || [];
      } catch (err) {
        emit('toast', {
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to load switches',
        });
      } finally {
        loading.value = false;
      }
    }

    function openAddModal() {
      modalNodeId.value = undefined;
      form.modelPreset = 'T1600G-28TS';
      form.host = '';
      form.name = '';
      form.protocol = 'auto';
      form.username = 'admin';
      form.password = '';
      form.snmpCommunity = 'public';
      form.mountInRack = true;
      formError.value = '';
      modalOpen.value = true;
    }

    function openPollModal(sw: TopologyNode) {
      modalNodeId.value = sw.id;
      form.modelPreset = sw.switchMeta?.model || 'auto';
      form.host = sw.ipAddress || '';
      form.name = sw.name || '';
      form.protocol = sw.switchMeta?.managementProtocol || 'auto';
      form.username = sw.switchMeta?.username || 'admin';
      form.password = '';
      form.snmpCommunity = 'public';
      form.mountInRack = true;
      formError.value = '';
      modalOpen.value = true;
    }

    async function submitProbe() {
      if (!form.host.trim()) {
        formError.value = 'Please enter the switch IP address or hostname.';
        return;
      }
      probing.value = true;
      formError.value = '';
      try {
        const res = await api.probeTopologySwitch({
          nodeId: modalNodeId.value,
          host: form.host.trim(),
          name: form.name.trim() || undefined,
          protocol: form.protocol,
          username: form.username.trim() || undefined,
          password: form.password || undefined,
          snmpCommunity: form.snmpCommunity.trim() || undefined,
          modelPreset: form.modelPreset,
          mountInRack: form.mountInRack,
        });
        modalOpen.value = false;
        await loadSwitches();
        if (res.node?.id) selectedId.value = res.node.id;
        emit('toast', { type: 'success', message: res.probe?.message || 'Switch updated' });
      } catch (err) {
        formError.value = err instanceof Error ? err.message : 'Failed to probe switch';
      } finally {
        probing.value = false;
      }
    }

    async function executeDelete() {
      if (!confirmDeleteTarget.value) return;
      deleting.value = true;
      try {
        await api.deleteSwitch(confirmDeleteTarget.value.id);
        confirmDeleteTarget.value = null;
        await loadSwitches();
        emit('toast', { type: 'success', message: 'Switch removed' });
      } catch (err) {
        emit('toast', {
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to remove switch',
        });
      } finally {
        deleting.value = false;
      }
    }

    function portTileClass(p: TopologySwitchPortState) {
      return {
        'sw-port-up-1g': p.linkStatus === 'up' && p.media !== 'sfp' && !/100M|10M/i.test(p.speed),
        'sw-port-up-100m': p.linkStatus === 'up' && p.media !== 'sfp' && /100M|10M/i.test(p.speed),
        'sw-port-up-sfp': p.linkStatus === 'up' && p.media === 'sfp',
        'sw-port-poe': Boolean(p.poeActive),
        'sw-port-selected': selectedPort.value?.portNumber === p.portNumber,
      };
    }

    function portTitle(p: TopologySwitchPortState) {
      return `${p.name} · ${p.linkStatus.toUpperCase()} (${p.speed})${p.poeActive ? ` · PoE ${p.poeWatts || 0}W` : ''}${p.connectedDeviceName ? ` · ${p.connectedDeviceName}` : ''}`;
    }

    function formatRelativeTime(ts: number): string {
      const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
      if (diffSec < 60) return `${diffSec}s ago`;
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      return `${Math.floor(diffSec / 3600)}h ago`;
    }

    function applyScanned(d: ScannedDevicePick) {
      form.host = d.host;
      if (d.modelPreset) form.modelPreset = d.modelPreset;
      if (d.protocol === 'ssh' || d.protocol === 'telnet' || d.protocol === 'snmp' || d.protocol === 'http') {
        form.protocol = d.protocol;
      }
      if (!form.name.trim()) form.name = d.name;
    }

    onMounted(() => {
      void loadSwitches();
    });

    return {
      loading,
      switches,
      activeId,
      activeSwitch,
      selectedId,
      subTab,
      portFilterOptions,
      portFilter,
      selectedPort,
      oddRj45Ports,
      evenRj45Ports,
      sfpPorts,
      totalPortsCount,
      upPortsCount,
      downPortsCount,
      rj45UpCount,
      sfpUpCount,
      gigabitUpCount,
      slowUpCount,
      poeActiveCount,
      filteredPorts,
      neighborPorts,
      neighborCount,
      rackBadge,
      modalOpen,
      modalNodeId,
      probing,
      formError,
      form,
      confirmDeleteTarget,
      deleting,
      loadSwitches,
      openAddModal,
      openPollModal,
      applyScanned,
      submitProbe,
      executeDelete,
      portTileClass,
      portTitle,
      formatRelativeTime,
    };
  },
});
</script>

<style scoped>
.opn-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.opn-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  background: #0d1525;
  border: 1px solid #1b2840;
  color: #cbd5e1;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.opn-chip.active {
  border-color: #22d3ee;
  background: rgba(34, 211, 238, 0.08);
  color: #f8fafc;
}

.opn-id-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.opn-title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.opn-name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.opn-meta {
  margin-top: 6px;
  font-size: 12px;
  color: #94a3b8;
}

.sw-kpi-big {
  font-size: 24px;
  font-weight: 700;
  margin: 4px 0;
  color: #f8fafc;
}

.sw-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 11px;
  color: #94a3b8;
}

.sw-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  margin-right: 4px;
}

.sw-dot-1g { background: #10b981; }
.sw-dot-100m { background: #f59e0b; }
.sw-dot-sfp { background: #06b6d4; }
.sw-dot-poe { background: #a855f7; }
.sw-dot-down { background: #1e293b; border: 1px solid #334155; }

.sw-faceplate-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border-radius: 10px;
  background: #070d18;
  border: 1px solid #1b2840;
  overflow-x: auto;
}

.sw-rj45-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sw-rj45-row {
  display: flex;
  gap: 5px;
}

.sw-sfp-grid {
  display: grid;
  grid-template-columns: repeat(2, auto);
  gap: 6px;
  padding-left: 12px;
  border-left: 1px solid #1e293b;
}

.sw-port-tile {
  width: 28px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid #334155;
  background: #0f172a;
  color: #64748b;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.sw-port-tile.sw-port-up-1g {
  background: rgba(16, 185, 129, 0.22);
  border-color: #10b981;
  color: #6ee7b7;
}

.sw-port-tile.sw-port-up-100m {
  background: rgba(245, 158, 11, 0.22);
  border-color: #f59e0b;
  color: #fcd34d;
}

.sw-port-tile.sw-port-up-sfp {
  background: rgba(6, 182, 212, 0.22);
  border-color: #06b6d4;
  color: #67e8f9;
}

.sw-port-tile.sw-port-poe {
  box-shadow: inset 0 -2px 0 #a855f7;
}

.sw-port-tile.sw-port-selected {
  outline: 2px solid #f8fafc;
  outline-offset: 1px;
}

.sw-selected-port {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #0d1525;
  border: 1px solid #1e293b;
  font-size: 12px;
}

.hl-srv-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-radius: 8px;
  background: #0d1525;
  border: 1px solid #1b2840;
  margin-bottom: 6px;
  font-size: 12px;
}

.pill-violet {
  background: rgba(168, 85, 247, 0.16);
  color: #d8b4fe;
  border: 1px solid rgba(168, 85, 247, 0.35);
}
</style>
