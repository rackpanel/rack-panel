<template>
  <UiDialog
    :open="open"
    :title="isEdit ? 'Edit OPNsense Firewall' : 'Connect OPNsense Firewall'"
    @close="$emit('close')"
  >
    <DeviceAutoScan v-if="!isEdit" kind="opnsense" :open="open" @select="applyScanned" />
    <div class="rack-row">
      <div class="col-12">
        <div class="field">
          <label class="field-label">Firewall Label</label>
          <input v-model="form.name" class="input" type="text" placeholder="e.g. OPNSENSE-EDGE-01" />
        </div>
      </div>

      <div class="col-6">
        <div class="field">
          <label class="field-label">OPNsense IP / Hostname</label>
          <input v-model="form.host" class="input font-mono" type="text" placeholder="192.168.1.1" />
        </div>
      </div>

      <div class="col-3">
        <div class="field">
          <label class="field-label">Protocol</label>
          <select v-model="form.protocol" class="select" @change="onProtocolChange">
            <option value="https">HTTPS</option>
            <option value="http">HTTP</option>
          </select>
        </div>
      </div>

      <div class="col-3">
        <div class="field">
          <label class="field-label">Port</label>
          <input v-model.number="form.port" class="input font-mono" type="number" placeholder="443" />
        </div>
      </div>

      <div class="col-12">
        <div class="opn-import-box">
          <div class="opn-import-info">
            <div style="font-size: 13px; font-weight: 600; color: #e2e8f0;">
              Import OPNsense API Key File
            </div>
            <div class="opn-import-sub mono">
              {{ importedFileName ? 'Loaded: ' + importedFileName : 'e.g. OPNsense.gitcloud.local_apikey.txt (or enter manually below)' }}
            </div>
          </div>
          <label class="btn btn-sm btn-primary opn-import-btn">
            Import Key File
            <input
              type="file"
              accept=".txt,.key,.json,text/plain"
              style="display: none;"
              @change="handleKeyFileUpload"
            />
          </label>
        </div>
      </div>

      <div class="col-12">
        <div class="field">
          <label class="field-label">
            API Key {{ isEdit && initialConfig && initialConfig.hasApiKey ? '(leave blank to keep saved)' : '' }}
          </label>
          <input
            v-model="form.apiKey"
            class="input font-mono"
            type="password"
            placeholder="Paste OPNsense API Key"
          />
        </div>
      </div>

      <div class="col-12">
        <div class="field">
          <label class="field-label">
            API Secret {{ isEdit && initialConfig && initialConfig.hasApiSecret ? '(leave blank to keep saved)' : '' }}
          </label>
          <input
            v-model="form.apiSecret"
            class="input font-mono"
            type="password"
            placeholder="Paste OPNsense API Secret"
          />
        </div>
      </div>

      <div class="col-12">
        <label class="opn-check-row">
          <input v-model="form.allowInsecureTls" type="checkbox" class="opn-check-box" />
          <span>Allow self-signed HTTPS certificate (standard for local OPNsense WebGUI)</span>
        </label>
      </div>
    </div>

    <div class="opn-tip">
      In OPNsense WebGUI go to <strong>System &rarr; Access &rarr; Users</strong>, edit your admin/API user, and click <strong>+ Create API Key</strong> to download the key &amp; secret. Both are stored encrypted (AES-256-GCM) on the backend.
    </div>

    <div v-if="testResult" class="test-box" :class="testResult.ok ? 'test-ok' : 'test-err'">
      <strong>{{ testResult.ok ? 'Connected' : 'Failed' }}:</strong> {{ testResult.message }}
    </div>
    <div v-if="errorMsg" class="test-box test-err">{{ errorMsg }}</div>

    <template #footer>
      <UiButton :disabled="testing || saving" @click="handleTest">
        {{ testing ? 'Testing...' : 'Test OPNsense API' }}
      </UiButton>
      <UiButton variant="primary" :disabled="saving" @click="handleSave">
        {{ saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add OPNsense' }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script lang="ts">
import { defineComponent, reactive, ref, watch, computed } from 'vue';
import type { ConnectionTestResult, OpnsenseConfigPublic } from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';
import DeviceAutoScan, { type ScannedDevicePick } from '@/components/DeviceAutoScan.vue';

export default defineComponent({
  name: 'OpnsenseModal',
  components: { UiDialog, UiButton, DeviceAutoScan },
  props: {
    open: { type: Boolean, default: false },
    initialConfig: { type: Object as () => OpnsenseConfigPublic | null, default: null },
  },
  setup(props, { emit }) {
    const form = reactive({
      id: '',
      name: '',
      host: '',
      protocol: 'https' as 'https' | 'http',
      port: 443,
      apiKey: '',
      apiSecret: '',
      allowInsecureTls: true,
      enabled: true,
    });
    const testing = ref(false);
    const saving = ref(false);
    const testResult = ref<ConnectionTestResult | null>(null);
    const errorMsg = ref('');
    const importedFileName = ref('');

    const isEdit = computed(() => Boolean(props.initialConfig && props.initialConfig.id));

    watch(
      () => props.open,
      (val) => {
        if (!val) return;
        testResult.value = null;
        errorMsg.value = '';
        importedFileName.value = '';
        if (props.initialConfig) {
          form.id = props.initialConfig.id;
          form.name = props.initialConfig.name;
          form.host = props.initialConfig.host;
          form.protocol = props.initialConfig.protocol || 'https';
          form.port = props.initialConfig.port || (form.protocol === 'https' ? 443 : 80);
          form.apiKey = '';
          form.apiSecret = '';
          form.allowInsecureTls = props.initialConfig.allowInsecureTls;
          form.enabled = props.initialConfig.enabled;
        } else {
          form.id = '';
          form.name = '';
          form.host = '';
          form.protocol = 'https';
          form.port = 443;
          form.apiKey = '';
          form.apiSecret = '';
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
        apiKey: form.apiKey.trim() || undefined,
        apiSecret: form.apiSecret.trim() || undefined,
        allowInsecureTls: form.allowInsecureTls,
        enabled: form.enabled,
      };
    }

    async function handleTest() {
      errorMsg.value = '';
      testResult.value = null;
      if (!form.host.trim()) {
        errorMsg.value = 'OPNsense IP or hostname is required.';
        return;
      }
      testing.value = true;
      try {
        testResult.value = await api.testOpnsense(buildPayload());
      } catch (err) {
        errorMsg.value = err instanceof Error ? err.message : String(err);
      } finally {
        testing.value = false;
      }
    }

    async function handleSave() {
      errorMsg.value = '';
      if (!form.host.trim()) {
        errorMsg.value = 'OPNsense IP or hostname is required.';
        return;
      }
      if (!isEdit.value && (!form.apiKey.trim() || !form.apiSecret.trim())) {
        errorMsg.value = 'OPNsense API Key and API Secret are required.';
        return;
      }
      saving.value = true;
      try {
        const payload = buildPayload();
        if (isEdit.value && form.id) {
          await api.updateOpnsense(form.id, payload);
        } else {
          await api.createOpnsense(payload);
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
      form.port = d.port || 443;
      form.protocol = d.protocol === 'http' ? 'http' : 'https';
      if (!form.name.trim()) form.name = d.name;
    }

    function handleKeyFileUpload(evt: Event) {
      errorMsg.value = '';
      const input = evt.target as HTMLInputElement | null;
      const file = input && input.files ? input.files[0] : null;
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        let parsedKey = '';
        let parsedSecret = '';

        const trimmed = text.trim();
        if (trimmed.startsWith('{')) {
          try {
            const obj = JSON.parse(trimmed) as Record<string, unknown>;
            parsedKey = String(obj.key || obj.apiKey || '').trim();
            parsedSecret = String(obj.secret || obj.apiSecret || '').trim();
          } catch {
            // fall through to line parser
          }
        }

        if (!parsedKey || !parsedSecret) {
          const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
          for (const line of lines) {
            const keyMatch = line.match(/^(?:key|api[_-]?key)\s*[:=]\s*(.+)$/i);
            if (keyMatch) {
              parsedKey = keyMatch[1].trim();
              continue;
            }
            const secMatch = line.match(/^(?:secret|api[_-]?secret)\s*[:=]\s*(.+)$/i);
            if (secMatch) {
              parsedSecret = secMatch[1].trim();
            }
          }
          if ((!parsedKey || !parsedSecret) && lines.length >= 2) {
            parsedKey = parsedKey || lines[0];
            parsedSecret = parsedSecret || lines[1];
          }
        }

        if (!parsedKey || !parsedSecret) {
          errorMsg.value = `Could not parse key and secret from "${file.name}". Please enter them manually below.`;
          return;
        }

        form.apiKey = parsedKey;
        form.apiSecret = parsedSecret;
        importedFileName.value = file.name;

        const hostMatch = file.name.match(/^OPNsense\.(.+?)_apikey\.txt$/i);
        if (hostMatch && hostMatch[1]) {
          const inferredHost = hostMatch[1].trim();
          if (!form.host.trim()) form.host = inferredHost;
          if (!form.name.trim()) form.name = `OPNsense (${inferredHost})`;
        }
      };
      reader.readAsText(file);
      if (input) input.value = '';
    }

    return {
      form,
      isEdit,
      testing,
      saving,
      testResult,
      errorMsg,
      importedFileName,
      handleKeyFileUpload,
      applyScanned,
      onProtocolChange,
      handleTest,
      handleSave,
    };
  },
});
</script>

<style scoped lang="scss">
.opn-check-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 44px;
  cursor: pointer;
  color: #cbd5e1;
  font-size: 14px;
}

.opn-check-box {
  width: 22px;
  height: 22px;
  margin-right: 10px;
}

.opn-tip {
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

.opn-import-box {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  padding: 10px 12px;
  margin-bottom: 12px;
  border-radius: 4px;
  background: #0b1019;
  border: 1px dashed #2b3b5a;
}

.opn-import-info {
  margin-right: 10px;
}

.opn-import-sub {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 2px;
}

.opn-import-btn {
  cursor: pointer;
  margin-top: 4px;
}
</style>
