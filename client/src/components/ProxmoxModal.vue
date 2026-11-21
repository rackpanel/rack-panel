<template>
  <UiDialog
    :open="open"
    :title="isEdit ? 'Edit Proxmox VE Host' : 'Connect Proxmox VE'"
    @close="$emit('close')"
  >
    <div class="rack-row">
          <div class="col-12">
            <div class="field">
              <label class="field-label">Cluster / Host Label</label>
              <input v-model="form.name" class="input" type="text" placeholder="e.g. HOMELAB-PVE" />
            </div>
          </div>
          <div class="col-8">
            <div class="field">
              <label class="field-label">Proxmox IP Address / Hostname</label>
              <input v-model="form.host" class="input mono" type="text" placeholder="192.168.1.10" />
            </div>
          </div>
          <div class="col-4">
            <div class="field">
              <label class="field-label">API Port</label>
              <input v-model.number="form.port" class="input mono" type="number" placeholder="8006" />
            </div>
          </div>

          <div class="col-12">
            <div class="field">
              <label class="field-label">Authentication Method</label>
              <select v-model="form.authType" class="select">
                <option value="token">API Token (Recommended)</option>
                <option value="password">Username &amp; Password (Ticket)</option>
              </select>
            </div>
          </div>

          <template v-if="form.authType === 'token'">
            <div class="col-12">
              <div class="field">
                <label class="field-label">API Token ID (user@realm!tokenname)</label>
                <input
                  v-model="form.tokenId"
                  class="input mono"
                  type="text"
                  placeholder="root@pam!rackpanel"
                />
              </div>
            </div>
            <div class="col-12">
              <div class="field">
                <label class="field-label">
                  API Token Secret {{ isEdit && initialConfig && initialConfig.hasTokenSecret ? '(leave blank to keep saved)' : '' }}
                </label>
                <input
                  v-model="form.tokenSecret"
                  class="input mono"
                  type="password"
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </div>
            </div>
          </template>

          <template v-else>
            <div class="col-6">
              <div class="field">
                <label class="field-label">Username (with realm)</label>
                <input v-model="form.username" class="input mono" type="text" placeholder="root@pam" />
              </div>
            </div>
            <div class="col-6">
              <div class="field">
                <label class="field-label">
                  Password {{ isEdit && initialConfig && initialConfig.hasPassword ? '(blank to keep)' : '' }}
                </label>
                <input v-model="form.password" class="input" type="password" placeholder="Proxmox password" />
              </div>
            </div>
          </template>

          <div class="col-12">
            <label class="check-row">
              <input v-model="form.allowInsecureTls" type="checkbox" class="check-input" />
              <span>Allow self-signed Proxmox HTTPS certificate (typical for homelab)</span>
            </label>
          </div>
        </div>

    <div v-if="testResult" class="test-box" :class="testResult.ok ? 'test-ok' : 'test-err'">
      <strong>{{ testResult.ok ? 'Connected' : 'Failed' }}:</strong> {{ testResult.message }}
    </div>
    <div v-if="errorMsg" class="test-box test-err">{{ errorMsg }}</div>

    <template #footer>
      <UiButton :disabled="testing || saving" @click="handleTest">
        {{ testing ? 'Testing...' : 'Test API' }}
      </UiButton>
      <UiButton variant="primary" :disabled="saving" @click="handleSave">
        {{ saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Proxmox' }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script lang="ts">
import { defineComponent, reactive, ref, watch, computed } from 'vue';
import type { ConnectionTestResult, ProxmoxAuthType, ProxmoxConfigPublic } from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';

export default defineComponent({
  name: 'ProxmoxModal',
  components: { UiDialog, UiButton },
  props: {
    open: { type: Boolean, default: false },
    initialConfig: { type: Object as () => ProxmoxConfigPublic | null, default: null },
    prefill: {
      type: Object as () => { name?: string; host?: string } | null,
      default: null,
    },
  },
  setup(props, { emit }) {
    const form = reactive({
      id: '',
      name: '',
      host: '',
      port: 8006,
      authType: 'token' as ProxmoxAuthType,
      username: 'root@pam',
      password: '',
      tokenId: '',
      tokenSecret: '',
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
          form.port = props.initialConfig.port || 8006;
          form.authType = props.initialConfig.authType || 'token';
          form.username = props.initialConfig.username || 'root@pam';
          form.password = '';
          form.tokenId = props.initialConfig.tokenId || '';
          form.tokenSecret = '';
          form.allowInsecureTls = props.initialConfig.allowInsecureTls;
          form.enabled = props.initialConfig.enabled;
        } else {
          form.id = '';
          form.name = (props.prefill && props.prefill.name) || '';
          form.host = (props.prefill && props.prefill.host) || '';
          form.port = 8006;
          form.authType = 'token';
          form.username = 'root@pam';
          form.password = '';
          form.tokenId = '';
          form.tokenSecret = '';
          form.allowInsecureTls = true;
          form.enabled = true;
        }
      },
    );

    function buildPayload() {
      return {
        id: form.id || undefined,
        name: form.name.trim() || form.host.trim(),
        host: form.host.trim(),
        port: Number(form.port) || 8006,
        authType: form.authType,
        username: form.username.trim() || 'root@pam',
        password: form.password || undefined,
        tokenId: form.tokenId.trim() || undefined,
        tokenSecret: form.tokenSecret || undefined,
        allowInsecureTls: form.allowInsecureTls,
        enabled: form.enabled,
      };
    }

    async function handleTest() {
      errorMsg.value = '';
      testResult.value = null;
      if (!form.host.trim()) {
        errorMsg.value = 'Please enter the Proxmox IP or hostname.';
        return;
      }
      testing.value = true;
      try {
        testResult.value = await api.testProxmox(buildPayload());
      } catch (err) {
        errorMsg.value = err instanceof Error ? err.message : String(err);
      } finally {
        testing.value = false;
      }
    }

    async function handleSave() {
      errorMsg.value = '';
      if (!form.host.trim()) {
        errorMsg.value = 'Proxmox host IP is required.';
        return;
      }
      saving.value = true;
      try {
        const payload = buildPayload();
        if (isEdit.value && form.id) {
          await api.updateProxmox(form.id, payload);
        } else {
          await api.createProxmox(payload);
        }
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
      testing,
      saving,
      testResult,
      errorMsg,
      handleTest,
      handleSave,
    };
  },
});
</script>

<style scoped lang="scss">
.check-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  min-height: 44px;
  cursor: pointer;
  color: #cbd5e1;
  font-size: 14px;
}

.check-input {
  width: 22px;
  height: 22px;
  margin-right: 10px;
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
