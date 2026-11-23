<template>
  <UiDialog
    :open="open"
    :title="isEdit ? 'Edit UniFi Controller / Device' : 'Connect UniFi Controller or Device'"
    @close="$emit('close')"
  >
    <DeviceAutoScan v-if="!isEdit" kind="unifi" :open="open" @select="applyScanned" />
    <div class="rack-row">
      <div class="col-7">
        <div class="field">
          <label class="field-label">Name</label>
          <input v-model="form.name" class="input" type="text" placeholder="e.g. Rack UDM-Pro or U6-Pro AP" />
        </div>
      </div>

      <div class="col-5">
        <div class="field">
          <label class="field-label">Connection Mode</label>
          <select v-model="form.controllerType" class="select" @change="onTypeChange">
            <option value="auto">Auto-Detect Controller (OS / Classic)</option>
            <option value="unifi-os">UniFi OS Controller (:443)</option>
            <option value="classic">Classic Network Server (:8443)</option>
            <option value="standalone">Standalone UniFi Device (No Controller)</option>
          </select>
        </div>
      </div>

      <div class="col-6">
        <div class="field">
          <label class="field-label">Host IP / Hostname</label>
          <input v-model="form.host" class="input font-mono" type="text" placeholder="192.168.1.1" />
        </div>
      </div>

      <div class="col-3">
        <div class="field">
          <label class="field-label">{{ isStandalone ? 'SSH Port' : 'HTTPS Port' }}</label>
          <input v-model.number="form.port" class="input font-mono" type="number" :placeholder="isStandalone ? '22' : '443'" />
        </div>
      </div>

      <div v-if="!isStandalone" class="col-3">
        <div class="field">
          <label class="field-label">Site ID</label>
          <input v-model="form.site" class="input font-mono" type="text" placeholder="default" />
        </div>
      </div>

      <div v-else class="col-3">
        <div class="field">
          <label class="field-label">Device Type</label>
          <select v-model="form.site" class="select">
            <option value="uap">Access Point (UAP/U6)</option>
            <option value="usw">Switch (USW)</option>
            <option value="ugw">Gateway (USG/UXG)</option>
            <option value="standalone">Auto-Detect</option>
          </select>
        </div>
      </div>

      <div class="col-6">
        <div class="field">
          <label class="field-label">{{ isStandalone ? 'SSH Username (Optional)' : 'Local Username' }}</label>
          <input v-model="form.username" class="input font-mono" type="text" placeholder="ubnt or local admin" />
        </div>
      </div>

      <div class="col-6">
        <div class="field">
          <label class="field-label">
            {{ isStandalone ? 'SSH Password (Optional)' : 'Password' }}
            {{ isEdit && initialConfig && initialConfig.hasPassword ? '(leave blank to keep saved)' : '' }}
          </label>
          <input
            v-model="form.password"
            class="input font-mono"
            type="password"
            :placeholder="isStandalone ? 'Leave blank for Ping/SNMP-only' : 'Local UniFi admin password'"
          />
        </div>
      </div>

      <div v-if="!isStandalone" class="col-12">
        <div class="field">
          <label class="field-label">
            UniFi Network API Key (Optional)
            {{ isEdit && initialConfig && initialConfig.hasApiKey ? '(leave blank to keep saved)' : '' }}
          </label>
          <input
            v-model="form.apiKey"
            class="input font-mono"
            type="password"
            placeholder="X-API-KEY from UniFi OS Settings -> Control Plane -> Integrations"
          />
        </div>
      </div>

      <div v-if="!isStandalone" class="col-12">
        <label class="unifi-check-row">
          <input v-model="form.allowInsecureTls" type="checkbox" class="unifi-check-box" />
          <span>Allow self-signed HTTPS certificate (standard for local UniFi controllers)</span>
        </label>
      </div>
    </div>

    <div class="unifi-tip">
      Supports <strong>UniFi OS</strong> (:443), <strong>Classic Network Server</strong> (:8443), and
      <strong>Standalone UniFi Devices</strong> (APs, Switches, Gateways without a controller via UDP/SNMP/SSH).
      Secrets are stored encrypted (AES-256-GCM).
    </div>

    <div v-if="testResult" class="test-box" :class="testResult.ok ? 'test-ok' : 'test-err'">
      <strong>{{ testResult.ok ? 'Connected' : 'Failed' }}:</strong> {{ testResult.message }}
    </div>
    <div v-if="errorMsg" class="test-box test-err">{{ errorMsg }}</div>

    <template #footer>
      <UiButton @click="$emit('close')">Cancel</UiButton>
      <UiButton :disabled="testing || saving" @click="handleTest">
        {{ testing ? 'Testing...' : 'Test UniFi API' }}
      </UiButton>
      <UiButton variant="primary" :disabled="saving" @click="handleSave">
        {{ saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add UniFi Controller' }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script lang="ts">
import { defineComponent, reactive, ref, watch, computed } from 'vue';
import type { ConnectionTestResult, UnifiConfigPublic, UnifiControllerType } from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';
import DeviceAutoScan, { type ScannedDevicePick } from '@/components/DeviceAutoScan.vue';

export default defineComponent({
  name: 'UnifiModal',
  components: { UiDialog, UiButton, DeviceAutoScan },
  props: {
    open: { type: Boolean, default: false },
    initialConfig: { type: Object as () => UnifiConfigPublic | null, default: null },
  },
  setup(props, { emit }) {
    const form = reactive({
      id: '',
      name: '',
      host: '',
      port: 443,
      controllerType: 'auto' as UnifiControllerType,
      site: 'default',
      username: '',
      password: '',
      apiKey: '',
      allowInsecureTls: true,
      enabled: true,
    });
    const testing = ref(false);
    const saving = ref(false);
    const testResult = ref<ConnectionTestResult | null>(null);
    const errorMsg = ref('');

    const isEdit = computed(() => Boolean(props.initialConfig && props.initialConfig.id));
    const isStandalone = computed(() => form.controllerType === 'standalone');

    watch(
      () => props.open,
      (val) => {
        if (!val) return;
        testResult.value = null;
        errorMsg.value = '';
        if (props.initialConfig) {
          form.id = props.initialConfig.id;
          form.name = props.initialConfig.name;
          form.host = props.initialConfig.host;
          form.port = props.initialConfig.port || 443;
          form.controllerType = props.initialConfig.controllerType || 'auto';
          form.site = props.initialConfig.site || 'default';
          form.username = props.initialConfig.username || '';
          form.password = '';
          form.apiKey = '';
          form.allowInsecureTls = props.initialConfig.allowInsecureTls;
          form.enabled = props.initialConfig.enabled;
        } else {
          form.id = '';
          form.name = '';
          form.host = '';
          form.port = 443;
          form.controllerType = 'auto';
          form.site = 'default';
          form.username = '';
          form.password = '';
          form.apiKey = '';
          form.allowInsecureTls = true;
          form.enabled = true;
        }
      },
    );

    function onTypeChange() {
      if (form.controllerType === 'classic' && (form.port === 443 || form.port === 22)) {
        form.port = 8443;
      } else if (form.controllerType === 'unifi-os' && (form.port === 8443 || form.port === 22)) {
        form.port = 443;
      } else if (form.controllerType === 'standalone') {
        if (form.port === 443 || form.port === 8443) form.port = 22;
        if (form.site === 'default') form.site = 'uap';
      }
    }

    function applyScanned(d: ScannedDevicePick) {
      form.host = d.host;
      form.port = d.port || 443;
      if (d.controllerType) {
        form.controllerType = d.controllerType;
      }
      if (d.controllerType === 'standalone') {
        form.site = d.unifiDeviceType || 'uap';
      }
      if (!form.name.trim()) form.name = d.name;
    }

    function buildPayload() {
      return {
        id: form.id || undefined,
        name: form.name.trim() || form.host.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 443,
        controllerType: form.controllerType,
        site: form.site.trim() || 'default',
        username: form.username.trim() || undefined,
        password: form.password.trim() || undefined,
        apiKey: form.apiKey.trim() || undefined,
        allowInsecureTls: form.allowInsecureTls,
        enabled: form.enabled,
      };
    }

    async function handleTest() {
      errorMsg.value = '';
      testResult.value = null;
      if (!form.host.trim()) {
        errorMsg.value = 'UniFi Controller IP or hostname is required.';
        return;
      }
      testing.value = true;
      try {
        testResult.value = await api.testUnifi(buildPayload());
      } catch (err) {
        errorMsg.value = err instanceof Error ? err.message : String(err);
      } finally {
        testing.value = false;
      }
    }

    async function handleSave() {
      errorMsg.value = '';
      if (!form.host.trim()) {
        errorMsg.value = 'UniFi Controller IP or hostname is required.';
        return;
      }
      const hasAnyAuth =
        isStandalone.value ||
        Boolean(form.apiKey.trim()) ||
        (Boolean(form.username.trim()) && Boolean(form.password.trim())) ||
        (isEdit.value &&
          Boolean(props.initialConfig && (props.initialConfig.hasPassword || props.initialConfig.hasApiKey)));
      if (!hasAnyAuth) {
        errorMsg.value = 'Provide either Username + Password or a UniFi API Key.';
        return;
      }
      saving.value = true;
      try {
        await api.saveUnifi(buildPayload());
        emit('saved');
        emit('close');
      } catch (err) {
        errorMsg.value = err instanceof Error ? err.message : String(err);
      } finally {
        saving.value = false;
      }
    }

    return {
      form,
      isEdit,
      isStandalone,
      testing,
      saving,
      testResult,
      errorMsg,
      applyScanned,
      onTypeChange,
      handleTest,
      handleSave,
    };
  },
});
</script>

<style scoped lang="scss">
.unifi-check-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 44px;
  cursor: pointer;
  color: #cbd5e1;
  font-size: 14px;
}

.unifi-check-box {
  width: 22px;
  height: 22px;
  margin-right: 10px;
}

.unifi-tip {
  padding: 10px 12px;
  border-radius: 4px;
  background: #0b1019;
  border: 1px solid #1f2a40;
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 10px;
}

.test-box {
  padding: 12px 14px;
  border-radius: 4px;
  font-size: 13px;
  margin-top: 8px;
}

.test-ok {
  background: rgba(16, 185, 129, 0.16);
  border: 1px solid rgba(52, 211, 153, 0.45);
  color: #a7f3d0;
}

.test-err {
  background: rgba(220, 38, 38, 0.16);
  border: 1px solid rgba(248, 113, 113, 0.45);
  color: #fecaca;
}
</style>
