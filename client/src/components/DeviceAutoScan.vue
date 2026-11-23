<template>
  <div class="autoscan-box">
    <div class="autoscan-top">
      <div>
        <div class="autoscan-title">Auto-Scan Local Network</div>
        <div class="autoscan-sub">
          Scans for verified {{ kindLabel }} devices. If none match, enter details manually below.
        </div>
      </div>
      <div class="autoscan-actions">
        <input
          v-model="subnetInput"
          class="input mono autoscan-subnet"
          type="text"
          placeholder="Subnet (auto)"
          title="Default auto-scan: 192.168.1.0/24, 192.168.0.0/24, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (or enter custom CIDR)"
        />
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="scanning"
          @click="runScan"
        >
          {{ scanning ? 'Scanning...' : 'Auto-Scan' }}
        </button>
      </div>
    </div>

    <div v-if="scanned" class="autoscan-result">
      <div v-if="devices.length > 0" class="autoscan-select-row">
        <select
          v-model="selectedHost"
          class="select mono"
          @change="onPick"
        >
          <option value="">-- Select discovered {{ kindLabel }} ({{ devices.length }} found) --</option>
          <option v-for="d in devices" :key="`${d.host}:${d.port}`" :value="d.host">
            {{ d.host }} — {{ d.name }} ({{ d.detail }})
          </option>
        </select>
      </div>
      <div v-else class="autoscan-empty mono">
        No confident {{ kindLabel }} found on {{ lastSubnet }} ({{ scannedIps }} IPs checked). Enter details manually below.
      </div>
    </div>

    <div v-if="scanError" class="autoscan-err">{{ scanError }}</div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, type PropType } from 'vue';
import { api } from '@/api/client';

export type ScanKind = 'server' | 'proxmox' | 'opnsense' | 'switch' | 'hikvision' | 'unifi' | 'ups';

export interface ScannedDevicePick {
  host: string;
  port: number;
  protocol: string;
  name: string;
  detail: string;
  mac?: string;
  modelPreset?: string;
  deviceKind?: 'nvr' | 'dvr' | 'camera' | 'auto';
  controllerType?: 'unifi-os' | 'classic' | 'standalone';
  unifiDeviceType?: 'uap' | 'usw' | 'ugw' | 'udm' | 'uxg' | 'other';
}

export default defineComponent({
  name: 'DeviceAutoScan',
  props: {
    kind: {
      type: String as PropType<ScanKind>,
      required: true,
    },
    open: {
      type: Boolean,
      default: true,
    },
  },
  emits: ['select'],
  setup(props, { emit }) {
    const scanning = ref(false);
    const scanned = ref(false);
    const scanError = ref('');
    const subnetInput = ref('');
    const lastSubnet = ref('');
    const scannedIps = ref(0);
    const selectedHost = ref('');
    const devices = ref<ScannedDevicePick[]>([]);

    const kindLabel = computed(() => {
      switch (props.kind) {
        case 'proxmox':
          return 'Proxmox VE';
        case 'opnsense':
          return 'OPNsense';
        case 'switch':
          return 'Managed Switch';
        case 'hikvision':
          return 'Hikvision NVR / Camera';
        case 'unifi':
          return 'UniFi Controller / Device';
        case 'ups':
          return 'SNMP / NUT UPS';
        default:
          return 'SSH Server';
      }
    });

    watch(
      () => props.open,
      (isOpen) => {
        if (isOpen) {
          scanned.value = false;
          scanError.value = '';
          selectedHost.value = '';
          devices.value = [];
        }
      },
    );

    async function runScan() {
      scanning.value = true;
      scanError.value = '';
      try {
        const res = await api.autoScanDevices(props.kind, subnetInput.value.trim() || undefined);
        devices.value = res.devices || [];
        lastSubnet.value = res.subnet;
        scannedIps.value = res.scannedIps;
        scanned.value = true;
        if (devices.value.length === 1) {
          selectedHost.value = devices.value[0].host;
          emit('select', devices.value[0]);
        } else {
          selectedHost.value = '';
        }
      } catch (err) {
        scanError.value = err instanceof Error ? err.message : 'Auto-scan failed';
      } finally {
        scanning.value = false;
      }
    }

    function onPick() {
      const hit = devices.value.find((d) => d.host === selectedHost.value);
      if (hit) emit('select', hit);
    }

    return {
      scanning,
      scanned,
      scanError,
      subnetInput,
      lastSubnet,
      scannedIps,
      selectedHost,
      devices,
      kindLabel,
      runScan,
      onPick,
    };
  },
});
</script>

<style scoped>
.autoscan-box {
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid #1e293b;
  margin-bottom: 14px;
}

.autoscan-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.autoscan-title {
  font-size: 12.5px;
  font-weight: 700;
  color: #e2e8f0;
}

.autoscan-sub {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}

.autoscan-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.autoscan-subnet {
  width: 126px;
  min-height: 30px;
  font-size: 11.5px;
  padding: 4px 8px;
}

.autoscan-result {
  margin-top: 8px;
}

.autoscan-empty {
  font-size: 11px;
  color: #94a3b8;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.9);
}

.autoscan-err {
  margin-top: 8px;
  font-size: 11.5px;
  color: #fca5a5;
}
</style>
