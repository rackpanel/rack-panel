<template>
  <UiDialog
    :open="open"
    :title="isEdit ? 'Edit Tailscale Connection' : 'Connect Tailscale Network'"
    @close="$emit('close')"
  >
    <div class="field">
          <label class="field-label">Connection Label</label>
          <input v-model="form.name" class="input" type="text" placeholder="e.g. Homelab Tailnet" />
        </div>

        <div class="field">
          <label class="field-label">Discovery Method</label>
          <div class="btn-group">
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': form.mode === 'local' }"
              @click="form.mode = 'local'"
            >
              Local Tailscale Daemon
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': form.mode === 'apiKey' }"
              @click="form.mode = 'apiKey'"
            >
              Tailscale API Key
            </button>
            <button
              type="button"
              class="btn btn-sm"
              :class="{ 'btn-primary': form.mode === 'oauth' }"
              @click="form.mode = 'oauth'"
            >
              OAuth Client
            </button>
          </div>
        </div>

        <div v-if="form.mode === 'local'" class="mode-note">
          <strong>Zero-Config Local Daemon:</strong> Queries <span class="mono">tailscale status --json</span> directly on the host running Rack Panel. Grabs all tailnet peers, live online state, DERP/direct peer addresses, and RX/TX bytes without needing an API key.
        </div>

        <template v-else-if="form.mode === 'apiKey'">
          <div class="field">
            <label class="field-label">Tailnet Name (leave as "-" for default tailnet)</label>
            <input v-model="form.tailnet" class="input mono" type="text" placeholder="- or example.com" />
          </div>
          <div class="field">
            <label class="field-label">
              API Access Token {{ isEdit && initialConfig && initialConfig.hasApiKey ? '(leave blank to keep saved)' : '' }}
            </label>
            <input
              v-model="form.apiKey"
              class="input mono"
              type="password"
              placeholder="tskey-api-..."
            />
          </div>
          <div class="mode-note">
            Generate a key in Tailscale Admin Console &rarr; <strong>Settings &rarr; Keys &rarr; Generate API key</strong>. Stored encrypted (AES-256-GCM) on the backend.
          </div>
        </template>

        <template v-else>
          <div class="field">
            <label class="field-label">Tailnet Name (leave as "-" for default tailnet)</label>
            <input v-model="form.tailnet" class="input mono" type="text" placeholder="- or example.com" />
          </div>
          <div class="field">
            <label class="field-label">OAuth Client ID</label>
            <input v-model="form.oauthClientId" class="input mono" type="text" placeholder="k123456CNTRL" />
          </div>
          <div class="field">
            <label class="field-label">
              OAuth Client Secret {{ isEdit && initialConfig && initialConfig.hasOauthSecret ? '(leave blank to keep saved)' : '' }}
            </label>
            <input
              v-model="form.oauthClientSecret"
              class="input mono"
              type="password"
              placeholder="tskey-client-..."
            />
          </div>
          <div class="mode-note">
            Requires the <span class="mono">devices:core:read</span> scope on your Tailscale OAuth client.
          </div>
        </template>

    <div v-if="testResult" class="test-box" :class="testResult.ok ? 'test-ok' : 'test-err'">
      <strong>{{ testResult.ok ? 'Connected' : 'Failed' }}:</strong> {{ testResult.message }}
    </div>
    <div v-if="errorMsg" class="test-box test-err">{{ errorMsg }}</div>

    <template #footer>
      <UiButton :disabled="testing || saving" @click="handleTest">
        {{ testing ? 'Testing...' : 'Test Tailscale' }}
      </UiButton>
      <UiButton variant="primary" :disabled="saving" @click="handleSave">
        {{ saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Connect Tailnet' }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script lang="ts">
import { defineComponent, reactive, ref, watch, computed } from 'vue';
import type { ConnectionTestResult, TailscaleAuthMode, TailscaleConfigPublic } from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';

export default defineComponent({
  name: 'TailscaleModal',
  components: { UiDialog, UiButton },
  props: {
    open: { type: Boolean, default: false },
    initialConfig: { type: Object as () => TailscaleConfigPublic | null, default: null },
  },
  setup(props, { emit }) {
    const form = reactive({
      id: '',
      name: '',
      mode: 'local' as TailscaleAuthMode,
      tailnet: '-',
      apiKey: '',
      oauthClientId: '',
      oauthClientSecret: '',
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
          form.mode = props.initialConfig.mode || 'local';
          form.tailnet = props.initialConfig.tailnet || '-';
          form.apiKey = '';
          form.oauthClientId = props.initialConfig.oauthClientId || '';
          form.oauthClientSecret = '';
          form.enabled = props.initialConfig.enabled;
        } else {
          form.id = '';
          form.name = '';
          form.mode = 'local';
          form.tailnet = '-';
          form.apiKey = '';
          form.oauthClientId = '';
          form.oauthClientSecret = '';
          form.enabled = true;
        }
      },
    );

    function buildPayload() {
      return {
        id: form.id || undefined,
        name:
          form.name.trim() ||
          (form.mode === 'local' ? 'Local Tailscale' : form.tailnet !== '-' ? form.tailnet : 'Tailscale Tailnet'),
        mode: form.mode,
        tailnet: form.tailnet.trim() || '-',
        apiKey: form.apiKey.trim() || undefined,
        oauthClientId: form.oauthClientId.trim() || undefined,
        oauthClientSecret: form.oauthClientSecret.trim() || undefined,
        enabled: form.enabled,
      };
    }

    async function handleTest() {
      errorMsg.value = '';
      testResult.value = null;
      testing.value = true;
      try {
        testResult.value = await api.testTailscale(buildPayload());
      } catch (err) {
        errorMsg.value = err instanceof Error ? err.message : String(err);
      } finally {
        testing.value = false;
      }
    }

    async function handleSave() {
      errorMsg.value = '';
      if (form.mode === 'apiKey' && !isEdit.value && !form.apiKey.trim()) {
        errorMsg.value = 'Please enter your Tailscale API key.';
        return;
      }
      if (form.mode === 'oauth' && !isEdit.value && (!form.oauthClientId.trim() || !form.oauthClientSecret.trim())) {
        errorMsg.value = 'Please enter both OAuth Client ID and Client Secret.';
        return;
      }
      saving.value = true;
      try {
        const payload = buildPayload();
        if (isEdit.value && form.id) {
          await api.updateTailscale(form.id, payload);
        } else {
          await api.createTailscale(payload);
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
.mode-note {
  padding: 10px 12px;
  border-radius: 4px;
  background: #0b1019;
  border: 1px solid #1f2a40;
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 12px;
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
