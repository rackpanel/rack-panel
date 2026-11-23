<template>
  <UiDialog
    :open="open"
    :title="isEdit ? 'Edit Hikvision Device' : 'Connect Hikvision NVR / DVR / Camera'"
    @close="$emit('close')"
  >
    <DeviceAutoScan v-if="!isEdit" kind="hikvision" :open="open" @select="applyScanned" />
    <div class="rack-row">
      <div class="col-8">
        <div class="field">
          <label class="field-label">Device Label</label>
          <input v-model="form.name" class="input" type="text" placeholder="e.g. Rack NVR (DS-7732NI-I4/16P)" />
        </div>
      </div>

      <div class="col-4">
        <div class="field">
          <label class="field-label">Device Role</label>
          <select v-model="form.deviceKind" class="select">
            <option value="auto">Auto-Detect (ISAPI)</option>
            <option value="nvr">Hikvision NVR</option>
            <option value="dvr">Hikvision DVR / Hybrid</option>
            <option value="camera">IP Camera (Standalone)</option>
          </select>
        </div>
      </div>

      <div class="col-6">
        <div class="field">
          <label class="field-label">Host IP / Hostname</label>
          <input v-model="form.host" class="input font-mono" type="text" placeholder="192.168.0.64" />
        </div>
      </div>

      <div class="col-2">
        <div class="field">
          <label class="field-label">Protocol</label>
          <select v-model="form.protocol" class="select" @change="onProtocolChange">
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </div>
      </div>

      <div class="col-2">
        <div class="field">
          <label class="field-label">HTTP Port</label>
          <input v-model.number="form.port" class="input font-mono" type="number" placeholder="80" />
        </div>
      </div>

      <div class="col-2">
        <div class="field">
          <label class="field-label">RTSP Port</label>
          <input v-model.number="form.rtspPort" class="input font-mono" type="number" placeholder="554" />
        </div>
      </div>

      <div class="col-6">
        <div class="field">
          <label class="field-label">Username</label>
          <input v-model="form.username" class="input font-mono" type="text" placeholder="admin" />
        </div>
      </div>

      <div class="col-6">
        <div class="field">
          <label class="field-label">
            Password {{ isEdit && initialConfig && initialConfig.hasPassword ? '(leave blank to keep saved)' : '' }}
          </label>
          <input
            v-model="form.password"
            class="input font-mono"
            type="password"
            placeholder="Hikvision admin / operator password"
          />
        </div>
      </div>

      <div class="col-12">
        <label class="hik-check-row">
          <input v-model="form.allowInsecureTls" type="checkbox" class="hik-check-box" />
          <span>Allow self-signed HTTPS certificate (when HTTPS is enabled on NVR/Camera)</span>
        </label>
      </div>
    </div>

    <div class="hik-tip">
      Supports <strong>Hikvision I-Series / K-Series / M-Series / Q-Series NVRs</strong> (including
      <span class="mono">DS-7732NI-I4 / 16P(B)</span> V4.x &amp; V5.x), <strong>TurboHD / AcuSense DVRs</strong>, and
      <strong>Standalone IP Cameras</strong> over HTTP Digest ISAPI &amp; RTSP. Passwords are stored encrypted
      (AES-256-GCM) on the backend.
    </div>

    <div v-if="testResult" class="test-box" :class="testResult.ok ? 'test-ok' : 'test-err'">
      <strong>{{ testResult.ok ? 'Connected' : 'Failed' }}:</strong> {{ testResult.message }}
    </div>
    <div v-if="errorMsg" class="test-box test-err">{{ errorMsg }}</div>

    <template #footer>
      <UiButton :disabled="testing || saving" @click="handleTest">
        {{ testing ? 'Testing...' : 'Test Hikvision ISAPI' }}
      </UiButton>
      <UiButton variant="primary" :disabled="saving" @click="handleSave">
        {{ saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Hikvision' }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script lang="ts">
import { defineComponent, reactive, ref, watch, computed } from 'vue';
import type { ConnectionTestResult, HikvisionConfigPublic, HikvisionDeviceKind } from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';
import DeviceAutoScan, { type ScannedDevicePick } from '@/components/DeviceAutoScan.vue';

export default defineComponent({
  name: 'HikvisionModal',
  components: { UiDialog, UiButton, DeviceAutoScan },
  props: {
    open: { type: Boolean, default: false },
    initialConfig: { type: Object as () => HikvisionConfigPublic | null, default: null },
  },
  setup(props, { emit }) {
    const form = reactive({
      id: '',
      name: '',
      host: '',
      protocol: 'http' as 'http' | 'https',
      port: 80,
      rtspPort: 554,
      username: 'admin',
      password: '',
      deviceKind: 'auto' as HikvisionDeviceKind,
      allowInsecureTls: true,
      enabled: true,
    });
    const testing = ref(false);
    const saving = ref(false);
    const testResult = ref<ConnectionTestResult | null>(null);
    const errorMsg = ref('');

    const isEdit = computed(() => Boolean(props.initialConfig && props.initialConfig.id));

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
          form.protocol = props.initialConfig.protocol || 'http';
          form.port = props.initialConfig.port || (form.protocol === 'https' ? 443 : 80);
          form.rtspPort = props.initialConfig.rtspPort || 554;
          form.username = props.initialConfig.username || 'admin';
          form.password = '';
          form.deviceKind = props.initialConfig.deviceKind || 'auto';
          form.allowInsecureTls = props.initialConfig.allowInsecureTls;
          form.enabled = props.initialConfig.enabled;
        } else {
          form.id = '';
          form.name = '';
          form.host = '';
          form.protocol = 'http';
          form.port = 80;
          form.rtspPort = 554;
          form.username = 'admin';
          form.password = '';
          form.deviceKind = 'auto';
          form.allowInsecureTls = true;
          form.enabled = true;
        }
      },
    );

    function onProtocolChange() {
      if (form.protocol === 'https' && form.port === 80) form.port = 443;
      if (form.protocol === 'http' && form.port === 443) form.port = 80;
    }

    function buildPayload() {
      return {
        id: form.id || undefined,
        name: form.name.trim() || form.host.trim(),
        host: form.host.trim(),
        protocol: form.protocol,
        port: Number(form.port) || (form.protocol === 'https' ? 443 : 80),
        rtspPort: Number(form.rtspPort) || 554,
        username: form.username.trim() || 'admin',
        password: form.password.trim() || undefined,
        deviceKind: form.deviceKind,
        allowInsecureTls: form.allowInsecureTls,
        enabled: form.enabled,
      };
    }

    async function handleTest() {
      errorMsg.value = '';
      testResult.value = null;
      if (!form.host.trim()) {
        errorMsg.value = 'Hikvision IP or hostname is required.';
        return;
      }
      testing.value = true;
      try {
        testResult.value = await api.testHikvision(buildPayload());
      } catch (err) {
        errorMsg.value = err instanceof Error ? err.message : String(err);
      } finally {
        testing.value = false;
      }
    }

    async function handleSave() {
      errorMsg.value = '';
      if (!form.host.trim()) {
        errorMsg.value = 'Hikvision IP or hostname is required.';
        return;
      }
      if (!isEdit.value && !form.password.trim()) {
        errorMsg.value = 'Hikvision password is required.';
        return;
      }
      saving.value = true;
      try {
        const payload = buildPayload();
        if (isEdit.value && form.id) {
          await api.updateHikvision(form.id, payload);
        } else {
          await api.createHikvision(payload);
        }
        emit('saved');
        emit('close');
      } catch (err) {
        errorMsg.value = err instanceof Error ? err.message : String(err);
      } finally {
        saving.value = false;
      }
    }

    function applyScanned(d: ScannedDevicePick) {
      form.host = d.host;
      form.port = d.port || 80;
      form.protocol = d.protocol === 'https' ? 'https' : 'http';
      if (d.deviceKind) form.deviceKind = d.deviceKind;
      if (!form.name.trim()) form.name = d.name;
    }

    return {
      form,
      isEdit,
      testing,
      saving,
      testResult,
      errorMsg,
      applyScanned,
      onProtocolChange,
      handleTest,
      handleSave,
    };
  },
});
</script>

<style scoped lang="scss">
.hik-check-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 44px;
  cursor: pointer;
  color: #cbd5e1;
  font-size: 14px;
}

.hik-check-box {
  width: 22px;
  height: 22px;
  margin-right: 10px;
}

.hik-tip {
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
