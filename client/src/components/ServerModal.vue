<template>
  <UiDialog
    :open="open"
    :title="isEdit ? 'Edit SSH Server' : 'Add SSH Server'"
    @close="$emit('close')"
  >
    <DeviceAutoScan v-if="!isEdit" kind="server" :open="open" @select="applyScanned" />
    <div class="rack-row">
          <div class="col-6">
            <div class="field">
              <label class="field-label">Display Name</label>
              <input v-model="form.name" class="input" type="text" placeholder="e.g. NAS-VAULT-01" />
            </div>
          </div>
          <div class="col-6">
            <div class="field">
              <label class="field-label">Rack Unit (Optional)</label>
              <input v-model="form.rackUnit" class="input" type="text" placeholder="e.g. U12" />
            </div>
          </div>
          <div class="col-8">
            <div class="field">
              <label class="field-label">Server IP Address / Hostname</label>
              <input v-model="form.host" class="input mono" type="text" placeholder="192.168.1.50" />
            </div>
          </div>
          <div class="col-4">
            <div class="field">
              <label class="field-label">SSH Port</label>
              <input v-model.number="form.port" class="input mono" type="number" placeholder="22" />
            </div>
          </div>
          <div class="col-6">
            <div class="field">
              <label class="field-label">
                SSH Username {{ form.authMethod === 'tailscale' ? '(Optional)' : '' }}
              </label>
              <input
                v-model="form.username"
                class="input mono"
                type="text"
                :placeholder="form.authMethod === 'tailscale' ? 'Auto (local user / root)' : 'root or admin'"
              />
            </div>
          </div>
          <div class="col-6">
            <div class="field">
              <label class="field-label">Authentication</label>
              <select v-model="form.authMethod" class="select">
                <option value="tailscale">Tailscale SSH (Passwordless)</option>
                <option value="password">Password</option>
                <option value="privateKey">SSH Private Key</option>
              </select>
            </div>
          </div>

          <div v-if="form.authMethod === 'tailscale'" class="col-12">
            <div class="ts-info-box">
              <strong>Tailscale SSH:</strong> Authenticates automatically over your Tailnet with no password or private key. Leave Username blank to auto-detect (local user / <span class="mono">root</span>), or specify a remote account if needed.
            </div>
          </div>

          <div v-else-if="form.authMethod === 'password'" class="col-12">
            <div class="field">
              <label class="field-label">
                SSH Password {{ isEdit && initialServer && initialServer.hasPassword ? '(leave blank to keep saved)' : '' }}
              </label>
              <input v-model="form.password" class="input" type="password" placeholder="Enter SSH password" />
            </div>
          </div>

          <div v-else class="col-12">
            <div class="field">
              <label class="field-label">
                Private Key (PEM / OpenSSH) {{ isEdit && initialServer && initialServer.hasPrivateKey ? '(leave blank to keep saved)' : '' }}
              </label>
              <textarea
                v-model="form.privateKey"
                class="textarea"
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              ></textarea>
            </div>
            <div class="field">
              <label class="field-label">Key Passphrase (Optional)</label>
              <input v-model="form.passphrase" class="input" type="password" placeholder="Optional passphrase" />
            </div>
          </div>

          <div class="col-12">
            <div class="field">
              <label class="field-label">Tags (comma separated)</label>
              <input v-model="tagsInput" class="input" type="text" placeholder="docker, storage, prod" />
            </div>
          </div>
        </div>

      <div v-if="testResult" class="test-box" :class="testResult.ok ? 'test-ok' : 'test-err'">
        <strong>{{ testResult.ok ? 'Connection OK' : 'Connection Failed' }}:</strong>
        {{ testResult.message }}
      </div>
      <div v-if="errorMsg" class="test-box test-err">{{ errorMsg }}</div>

    <template #footer>
      <UiButton :disabled="testing || saving" @click="handleTest">
        {{ testing ? 'Testing...' : 'Test SSH' }}
      </UiButton>
      <UiButton variant="primary" :disabled="saving" @click="handleSave">
        {{ saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Server' }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script lang="ts">
import { defineComponent, reactive, ref, watch, computed } from 'vue';
import type { AuthMethod, ConnectionTestResult, SshServerPublic } from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';
import DeviceAutoScan, { type ScannedDevicePick } from '@/components/DeviceAutoScan.vue';

export default defineComponent({
  name: 'ServerModal',
  components: { UiDialog, UiButton, DeviceAutoScan },
  props: {
    open: { type: Boolean, default: false },
    initialServer: { type: Object as () => SshServerPublic | null, default: null },
    prefill: {
      type: Object as () => { name?: string; host?: string; tags?: string[]; authMethod?: AuthMethod } | null,
      default: null,
    },
  },
  setup(props, { emit }) {
    const form = reactive({
      id: '',
      name: '',
      host: '',
      port: 22,
      username: '',
      authMethod: 'tailscale' as AuthMethod,
      password: '',
      privateKey: '',
      passphrase: '',
      rackUnit: '',
      enabled: true,
    });
    const tagsInput = ref('');
    const testing = ref(false);
    const saving = ref(false);
    const testResult = ref<ConnectionTestResult | null>(null);
    const errorMsg = ref('');

    const isEdit = computed(() => Boolean(props.initialServer && props.initialServer.id));

    watch(
      () => props.open,
      (val) => {
        if (!val) return;
        testResult.value = null;
        errorMsg.value = '';
        if (props.initialServer) {
          form.id = props.initialServer.id;
          form.name = props.initialServer.name;
          form.host = props.initialServer.host;
          form.port = props.initialServer.port || 22;
          form.username = props.initialServer.username;
          form.authMethod = props.initialServer.authMethod || 'password';
          form.password = '';
          form.privateKey = '';
          form.passphrase = '';
          form.rackUnit = props.initialServer.rackUnit || '';
          form.enabled = props.initialServer.enabled;
          tagsInput.value = (props.initialServer.tags || []).join(', ');
        } else {
          form.id = '';
          form.name = (props.prefill && props.prefill.name) || '';
          form.host = (props.prefill && props.prefill.host) || '';
          form.port = 22;
          form.authMethod = (props.prefill && props.prefill.authMethod) || 'tailscale';
          form.username = form.authMethod === 'tailscale' ? '' : 'root';
          form.password = '';
          form.privateKey = '';
          form.passphrase = '';
          form.rackUnit = '';
          form.enabled = true;
          tagsInput.value = props.prefill && props.prefill.tags ? props.prefill.tags.join(', ') : '';
        }
      },
    );

    function buildPayload() {
      const tags = tagsInput.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      return {
        id: form.id || undefined,
        name: form.name.trim() || form.host.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 22,
        username: form.username.trim(),
        authMethod: form.authMethod,
        password: form.password || undefined,
        privateKey: form.privateKey || undefined,
        passphrase: form.passphrase || undefined,
        rackUnit: form.rackUnit.trim(),
        tags,
        enabled: form.enabled,
      };
    }

    async function handleTest() {
      errorMsg.value = '';
      testResult.value = null;
      if (!form.host.trim()) {
        errorMsg.value = 'Please enter a Host IP or Tailscale hostname.';
        return;
      }
      if (form.authMethod !== 'tailscale' && !form.username.trim()) {
        errorMsg.value = 'Please enter an SSH Username.';
        return;
      }
      testing.value = true;
      try {
        testResult.value = await api.testServer(buildPayload());
      } catch (err) {
        errorMsg.value = err instanceof Error ? err.message : String(err);
      } finally {
        testing.value = false;
      }
    }

    async function handleSave() {
      errorMsg.value = '';
      if (!form.host.trim()) {
        errorMsg.value = 'Host IP / hostname is required.';
        return;
      }
      if (form.authMethod !== 'tailscale' && !form.username.trim()) {
        errorMsg.value = 'SSH Username is required for password or key auth.';
        return;
      }
      saving.value = true;
      try {
        const payload = buildPayload();
        if (isEdit.value && form.id) {
          await api.updateServer(form.id, payload);
        } else {
          await api.createServer(payload);
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
      form.port = d.port || 22;
      if (!form.name.trim()) form.name = d.name;
    }

    return {
      form,
      tagsInput,
      isEdit,
      testing,
      saving,
      testResult,
      errorMsg,
      applyScanned,
      handleTest,
      handleSave,
    };
  },
});
</script>

<style scoped lang="scss">
.ts-info-box {
  padding: 10px 12px;
  border-radius: 4px;
  background: rgba(6, 182, 212, 0.12);
  border: 1px solid rgba(34, 211, 238, 0.35);
  color: #bae6fd;
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 14px;
}

.test-box {
  padding: 12px 14px;
  border-radius: 4px;
  font-size: 13px;
  margin-top: 6px;
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
