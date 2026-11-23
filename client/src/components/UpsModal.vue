<template>
  <UiDialog
    :open="open"
    :title="editConfig ? 'Edit UPS / Power Unit' : 'Connect UPS / Power Unit'"
    max-width="580px"
    @close="$emit('close')"
  >
    <DeviceAutoScan v-if="!editConfig" kind="ups" :open="open" @select="onAutoScanPick" />

    <form class="form-grid" @submit.prevent="save">
      <div class="form-row">
        <label class="form-label">UPS Name</label>
        <input v-model="form.name" class="input" type="text" placeholder="IBM 3000VA/2700W Rack HV UPS" required />
      </div>

      <div class="form-row">
        <label class="form-label">Model Preset</label>
        <select v-model="form.modelPreset" class="select" @change="onPresetChange">
          <option value="ibm-3000va-2700w-hv">IBM 3000VA/2700W Rack HV UPS (2U · 230V)</option>
          <option value="tesla-powerwall-2">Tesla Powerwall 2 / + (5kW · 13.5kWh)</option>
          <option value="tesla-powerwall-3">Tesla Powerwall 3 (11.5kW · 13.5kWh)</option>
          <option value="apc-smartups">APC Smart-UPS Rackmount</option>
          <option value="eaton-5px">Eaton 5PX / 9PX Rack UPS</option>
          <option value="cyberpower">CyberPower OR / PR Rack UPS</option>
          <option value="generic-rfc1628">Generic RFC 1628 SNMP / NUT UPS</option>
          <option value="auto">Auto-Detect</option>
        </select>
      </div>

      <div class="form-row-2">
        <div v-if="form.protocol === 'powerwall-cloud'">
          <label class="form-label">Tesla Cloud Region</label>
          <select v-model="form.host" class="select mono">
            <option value="fleet-api.prd.eu.vn.cloud.tesla.com">EU / UK (fleet-api.prd.eu.vn.cloud.tesla.com)</option>
            <option value="fleet-api.prd.na.vn.cloud.tesla.com">North America / APAC (fleet-api.prd.na.vn.cloud.tesla.com)</option>
            <option value="owner-api.teslamotors.com">Legacy Owner API (owner-api.teslamotors.com)</option>
          </select>
        </div>
        <div v-else>
          <label class="form-label">{{ isPowerwall ? 'Gateway IP / Hostname' : 'IP / Hostname' }}</label>
          <input
            v-model="form.host"
            class="input mono"
            type="text"
            :placeholder="isPowerwall ? '192.168.0.x (Tesla Gateway)' : '192.168.0.240'"
            required
          />
        </div>

        <div v-if="isPowerwall">
          <label class="form-label">Connection Mode</label>
          <select v-model="form.protocol" class="select" @change="onProtocolChange">
            <option value="powerwall-cloud">Tesla Cloud / Fleet API (HTTPS)</option>
            <option value="powerwall">Local Gateway (HTTPS :443)</option>
          </select>
        </div>
        <div v-else>
          <label class="form-label">Protocol</label>
          <select v-model="form.protocol" class="select" @change="onProtocolChange">
            <option value="snmp">SNMP (UDP :161)</option>
            <option value="nut">NUT Server (TCP :3493)</option>
            <option value="powerwall">Tesla Powerwall Local (HTTPS :443)</option>
            <option value="powerwall-cloud">Tesla Powerwall Cloud / Fleet API</option>
          </select>
        </div>
      </div>

      <div v-if="!isPowerwall && form.protocol === 'snmp'" class="form-row-3">
        <div>
          <label class="form-label">Port</label>
          <input v-model.number="form.port" class="input mono" type="number" min="1" max="65535" />
        </div>
        <div>
          <label class="form-label">SNMP Community</label>
          <input v-model="form.community" class="input mono" type="text" placeholder="public" />
        </div>
        <div>
          <label class="form-label">SNMP Version</label>
          <select v-model="form.snmpVersion" class="select">
            <option value="2c">v2c</option>
            <option value="1">v1</option>
          </select>
        </div>
      </div>

      <template v-else-if="form.protocol === 'powerwall-cloud'">
        <div
          v-if="!teslaCredsConfigured"
          style="
            background: rgba(245, 158, 11, 0.08);
            border: 1px solid rgba(245, 158, 11, 0.45);
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 10px;
          "
        >
          <div class="mono" style="font-size: 12px; font-weight: 700; color: #fbbf24;">
            Tesla Fleet API Credentials Required
          </div>
          <div style="font-size: 12px; color: #cbd5e1; margin: 4px 0 10px 0;">
            Add your Tesla App Client ID &amp; Client Secret in <strong>Settings &rarr; Tesla Fleet API Credentials</strong> before using Tesla Cloud login.
          </div>
          <button type="button" class="btn btn-sm btn-primary" @click="goToSettings">
            Open Settings &rarr;
          </button>
        </div>

        <div
          v-else
          style="
            background: #091122;
            border: 1px solid #1e3a5f;
            border-radius: 6px;
            padding: 10px 12px;
            margin-bottom: 10px;
          "
        >
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
            <div>
              <div class="mono" style="font-size: 12px; font-weight: 700; color: #38bdf8;">
                Tesla Fleet API OAuth Sign-In (PKCE)
              </div>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
                Using saved Client ID <span class="mono">{{ oauthClientId.slice(0, 12) }}...</span> from Settings.
              </div>
            </div>
            <div class="btn-group">
              <button
                type="button"
                class="btn btn-sm"
                :disabled="registeringPartner || !partnerDomain.trim()"
                @click="registerPartner"
              >
                {{ registeringPartner ? 'Registering...' : 'Register Partner' }}
              </button>
              <button
                type="button"
                class="btn btn-sm btn-primary"
                :disabled="oauthStarting"
                @click="startTeslaSignIn"
              >
                {{ oauthStarting ? 'Opening...' : '1. Open Tesla Login' }}
              </button>
            </div>
          </div>

          <div v-if="partnerMsg" class="mono" style="font-size: 11px; margin-top: 6px;" :style="{ color: partnerOk ? '#4ade80' : '#f87171' }">
            {{ partnerMsg }}
          </div>

          <div v-if="oauthState" style="display: flex; gap: 8px; margin-top: 10px;">
            <input
              v-model="oauthCallbackUrl"
              class="input mono"
              type="text"
              placeholder="2. Paste https://auth.tesla.com/void/callback?code=... URL here"
              style="flex: 1;"
            />
            <button
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="oauthExchanging || !oauthCallbackUrl.trim()"
              @click="exchangeTeslaCallback"
            >
              {{ oauthExchanging ? 'Exchanging...' : '2. Get Token' }}
            </button>
          </div>
          <div v-if="oauthMsg" class="mono" style="font-size: 11px; margin-top: 6px; color: #4ade80;">
            {{ oauthMsg }}
          </div>
        </div>

        <div v-if="teslaCredsConfigured" class="form-row-2">
          <div>
            <label class="form-label">Energy Site ID (optional)</label>
            <input
              v-model="form.upsName"
              class="input mono"
              type="text"
              placeholder="Auto-detect from account if blank"
            />
          </div>
          <div>
            <label class="form-label">Tesla API Access Token</label>
            <input
              v-model="form.password"
              class="input mono"
              type="password"
              :placeholder="editConfig && editConfig.hasPassword ? 'Saved (leave blank to keep)' : 'Auto-filled after sign-in'"
            />
          </div>
        </div>
      </template>

      <div v-else-if="form.protocol === 'powerwall'" class="form-row-2">
        <div>
          <label class="form-label">HTTPS Port</label>
          <input v-model.number="form.port" class="input mono" type="number" min="1" max="65535" />
        </div>
        <div>
          <label class="form-label">Gateway Customer Password</label>
          <input
            v-model="form.password"
            class="input mono"
            type="password"
            :placeholder="editConfig && editConfig.hasPassword ? 'Saved (leave blank to keep)' : 'Last 5 chars of Gateway serial'"
          />
        </div>
      </div>

      <div v-else class="form-row-2">
        <div>
          <label class="form-label">NUT Port</label>
          <input v-model.number="form.port" class="input mono" type="number" min="1" max="65535" />
        </div>
        <div>
          <label class="form-label">NUT UPS Name (optional)</label>
          <input v-model="form.upsName" class="input mono" type="text" placeholder="ups (auto-detect if blank)" />
        </div>
      </div>

      <div v-if="isPowerwall" class="form-row">
        <label class="form-label">Max Continuous Output (W)</label>
        <input v-model.number="form.ratedWatts" class="input mono" type="number" min="100" />
      </div>

      <div v-else class="form-row-3">
        <div>
          <label class="form-label">Rated VA</label>
          <input v-model.number="form.ratedVa" class="input mono" type="number" min="100" />
        </div>
        <div>
          <label class="form-label">Rated Watts</label>
          <input v-model.number="form.ratedWatts" class="input mono" type="number" min="100" />
        </div>
        <div>
          <label class="form-label">Rack Height (U)</label>
          <input v-model.number="form.heightU" class="input mono" type="number" min="0" max="12" />
        </div>
      </div>

      <div v-if="testMsg" class="alert-row" :class="testOk ? 'alert-ok' : 'alert-critical'">
        {{ testMsg }}
      </div>
    </form>

    <template #footer>
      <UiButton :disabled="testing || !form.host" @click="runTest">
        {{ testing ? 'Testing...' : 'Test Connection' }}
      </UiButton>
      <UiButton @click="$emit('close')">Cancel</UiButton>
      <UiButton variant="primary" :disabled="saving || !form.name || !form.host" @click="save">
        {{ saving ? 'Saving...' : editConfig ? 'Save Changes' : 'Add UPS' }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<script lang="ts">
import { computed, defineComponent, reactive, ref, watch, type PropType } from 'vue';
import type { UpsConfigPublic, UpsModelPreset } from '@shared/types';
import { api } from '@/api/client';
import UiDialog from '@/components/ui/UiDialog.vue';
import UiButton from '@/components/ui/UiButton.vue';
import DeviceAutoScan, { type ScannedDevicePick } from '@/components/DeviceAutoScan.vue';

const PRESET_DEFAULTS: Record<
  UpsModelPreset,
  { va: number; watts: number; u: number; protocol?: 'snmp' | 'nut' | 'powerwall' | 'powerwall-cloud' }
> = {
  'ibm-3000va-2700w-hv': { va: 3000, watts: 2700, u: 2 },
  'tesla-powerwall-2': { va: 5000, watts: 5000, u: 0, protocol: 'powerwall' },
  'tesla-powerwall-3': { va: 11500, watts: 11500, u: 0, protocol: 'powerwall-cloud' },
  'apc-smartups': { va: 1500, watts: 1350, u: 2 },
  'eaton-5px': { va: 2200, watts: 1980, u: 2 },
  cyberpower: { va: 1500, watts: 1350, u: 2 },
  'generic-rfc1628': { va: 1500, watts: 1200, u: 2 },
  auto: { va: 1500, watts: 1350, u: 2 },
};

export default defineComponent({
  name: 'UpsModal',
  components: { UiDialog, UiButton, DeviceAutoScan },
  props: {
    open: { type: Boolean, required: true },
    editConfig: { type: Object as PropType<UpsConfigPublic | null>, default: null },
  },
  emits: ['close', 'saved', 'toast', 'open-settings'],
  setup(props, { emit }) {
    const testing = ref(false);
    const saving = ref(false);
    const testMsg = ref('');
    const testOk = ref(false);
    const oauthStarting = ref(false);
    const oauthExchanging = ref(false);
    const teslaCredsConfigured = ref(false);
    const oauthClientId = ref('');
    const oauthRedirectUri = ref('https://auth.tesla.com/void/callback');
    const oauthState = ref('');
    const oauthCallbackUrl = ref('');
    const oauthMsg = ref('');
    const showPartnerReg = ref(false);
    const partnerDomain = ref(typeof window !== 'undefined' ? window.location.hostname : '');
    const partnerClientSecret = ref('');
    const registeringPartner = ref(false);
    const partnerMsg = ref('');
    const partnerOk = ref(false);

    const form = reactive({
      name: 'IBM 3000VA/2700W Rack HV UPS',
      host: '',
      protocol: 'snmp' as 'snmp' | 'nut' | 'powerwall' | 'powerwall-cloud',
      port: 161,
      community: 'public',
      password: '',
      snmpVersion: '2c' as '1' | '2c',
      upsName: '',
      modelPreset: 'ibm-3000va-2700w-hv' as UpsModelPreset,
      ratedVa: 3000,
      ratedWatts: 2700,
      heightU: 2,
    });

    const isPowerwall = computed(
      () =>
        form.modelPreset === 'tesla-powerwall-2' ||
        form.modelPreset === 'tesla-powerwall-3' ||
        form.protocol === 'powerwall' ||
        form.protocol === 'powerwall-cloud',
    );

    watch(
      () => props.open,
      (isOpen) => {
        if (!isOpen) return;
        void api.getSettings().then((s) => {
          teslaCredsConfigured.value = Boolean(s.teslaClientId && s.hasTeslaClientSecret);
          oauthClientId.value = s.teslaClientId || '';
          oauthRedirectUri.value = s.teslaRedirectUri || 'https://auth.tesla.com/void/callback';
          partnerDomain.value = s.teslaPartnerDomain || (typeof window !== 'undefined' ? window.location.hostname : '');
        }).catch(() => {});
        testMsg.value = '';
        testOk.value = false;
        oauthState.value = '';
        oauthCallbackUrl.value = '';
        oauthMsg.value = '';
        if (props.editConfig) {
          form.name = props.editConfig.name;
          form.host = props.editConfig.host;
          form.protocol = props.editConfig.protocol;
          form.port = props.editConfig.port;
          form.community = '';
          form.password = '';
          form.snmpVersion = props.editConfig.snmpVersion || '2c';
          form.upsName = props.editConfig.upsName || '';
          form.modelPreset = props.editConfig.modelPreset || 'ibm-3000va-2700w-hv';
          form.ratedVa = props.editConfig.ratedVa || 3000;
          form.ratedWatts = props.editConfig.ratedWatts || 2700;
          form.heightU = props.editConfig.heightU || 2;
        } else {
          form.name = 'IBM 3000VA/2700W Rack HV UPS';
          form.host = '';
          form.protocol = 'snmp';
          form.port = 161;
          form.community = 'public';
          form.password = '';
          form.snmpVersion = '2c';
          form.upsName = '';
          form.modelPreset = 'ibm-3000va-2700w-hv';
          form.ratedVa = 3000;
          form.ratedWatts = 2700;
          form.heightU = 2;
        }
      },
    );

    function onPresetChange() {
      const d = PRESET_DEFAULTS[form.modelPreset];
      if (d) {
        form.ratedVa = d.va;
        form.ratedWatts = d.watts;
        form.heightU = d.u;
        if (d.protocol) {
          form.protocol = d.protocol;
          onProtocolChange();
          if (!props.editConfig && form.name === 'IBM 3000VA/2700W Rack HV UPS') {
            form.name = form.modelPreset === 'tesla-powerwall-3' ? 'Tesla Powerwall 3' : 'Tesla Powerwall 2';
          }
        }
      }
    }

    function onProtocolChange() {
      form.port = form.protocol === 'nut' ? 3493 : form.protocol === 'powerwall' || form.protocol === 'powerwall-cloud' ? 443 : 161;
      if (form.protocol === 'powerwall-cloud' && !form.host.includes('tesla')) {
        form.host = 'fleet-api.prd.eu.vn.cloud.tesla.com';
      } else if (form.protocol !== 'powerwall-cloud' && form.host.includes('tesla')) {
        form.host = '';
      }
    }

    function onAutoScanPick(pick: ScannedDevicePick) {
      form.host = pick.host;
      form.protocol = pick.protocol === 'nut' ? 'nut' : pick.protocol === 'powerwall' ? 'powerwall' : 'snmp';
      form.port = pick.port || (form.protocol === 'nut' ? 3493 : form.protocol === 'powerwall' ? 443 : 161);
      if (pick.name) form.name = pick.name;
      if (/powerwall|tesla/i.test(pick.name + ' ' + pick.detail)) {
        form.modelPreset = 'tesla-powerwall-2';
        onPresetChange();
      } else if (/ibm|3000/i.test(pick.name + ' ' + pick.detail)) {
        form.modelPreset = 'ibm-3000va-2700w-hv';
        onPresetChange();
      }
    }

    function goToSettings() {
      emit('close');
      emit('open-settings');
    }

    async function startTeslaSignIn() {
      oauthStarting.value = true;
      oauthMsg.value = '';
      testMsg.value = '';
      try {
        const res = await api.startTeslaPowerwallAuth(oauthClientId.value.trim(), oauthRedirectUri.value.trim());
        oauthState.value = res.state;
        window.open(res.authUrl, '_blank', 'noopener');
      } catch (err) {
        testOk.value = false;
        testMsg.value = err instanceof Error ? err.message : 'Failed to start Tesla login';
      } finally {
        oauthStarting.value = false;
      }
    }

    async function exchangeTeslaCallback() {
      if (!oauthCallbackUrl.value.trim()) return;
      oauthExchanging.value = true;
      oauthMsg.value = '';
      testMsg.value = '';
      try {
        const res = await api.exchangeTeslaPowerwallAuth(oauthCallbackUrl.value.trim(), oauthState.value);
        form.password = res.accessToken;
        if (res.refreshToken) {
          form.community = res.refreshToken;
        }
        if (!res.isFleetApi) {
          form.host = 'owner-api.teslamotors.com';
        }
        oauthMsg.value = 'Signed in! Access & auto-refresh tokens loaded.';
        oauthCallbackUrl.value = '';
      } catch (err) {
        testOk.value = false;
        testMsg.value = err instanceof Error ? err.message : 'Failed to exchange Tesla callback URL';
      } finally {
        oauthExchanging.value = false;
      }
    }

    async function registerPartner() {
      registeringPartner.value = true;
      partnerMsg.value = '';
      try {
        const res = await api.registerTeslaPartnerAccount({
          clientId: oauthClientId.value.trim(),
          clientSecret: partnerClientSecret.value.trim(),
          domain: partnerDomain.value.trim(),
          regionHost: form.host || 'fleet-api.prd.eu.vn.cloud.tesla.com',
        });
        partnerOk.value = true;
        partnerMsg.value = res.message;
      } catch (err) {
        partnerOk.value = false;
        partnerMsg.value = err instanceof Error ? err.message : 'Partner registration failed';
      } finally {
        registeringPartner.value = false;
      }
    }

    async function copyPartnerPublicKey() {
      try {
        const res = await api.getTeslaPartnerPublicKey();
        await navigator.clipboard.writeText(res.publicKeyPem);
        partnerOk.value = true;
        partnerMsg.value = 'Public key PEM copied to clipboard.';
      } catch (err) {
        partnerOk.value = false;
        partnerMsg.value = err instanceof Error ? err.message : 'Failed to load public key';
      }
    }

    async function runTest() {
      testing.value = true;
      testMsg.value = '';
      try {
        const res = await api.testUps({
          id: props.editConfig?.id,
          name: form.name,
          host: form.host,
          protocol: form.protocol,
          port: form.port,
          community: form.community || undefined,
          password: form.password || undefined,
          snmpVersion: form.snmpVersion,
          upsName: form.upsName || undefined,
          modelPreset: form.modelPreset,
          ratedVa: form.ratedVa,
          ratedWatts: form.ratedWatts,
          heightU: form.heightU,
        });
        testOk.value = res.ok;
        testMsg.value = res.message;
      } catch (err) {
        testOk.value = false;
        testMsg.value = err instanceof Error ? err.message : 'Test failed';
      } finally {
        testing.value = false;
      }
    }

    async function save() {
      saving.value = true;
      try {
        const payload = {
          name: form.name,
          host: form.host,
          protocol: form.protocol,
          port: form.port,
          community: form.community || undefined,
          password: form.password || undefined,
          snmpVersion: form.snmpVersion,
          upsName: form.upsName || undefined,
          modelPreset: form.modelPreset,
          ratedVa: form.ratedVa,
          ratedWatts: form.ratedWatts,
          heightU: form.heightU,
        };
        if (props.editConfig) {
          await api.updateUps(props.editConfig.id, payload);
          emit('toast', { message: `Updated ${form.name}`, error: false });
        } else {
          await api.createUps(payload);
          emit('toast', { message: `Added ${form.name}`, error: false });
        }
        emit('saved');
        emit('close');
      } catch (err) {
        emit('toast', { message: err instanceof Error ? err.message : 'Save failed', error: true });
      } finally {
        saving.value = false;
      }
    }

    return {
      form,
      isPowerwall,
      testing,
      saving,
      testMsg,
      testOk,
      oauthStarting,
      oauthExchanging,
      teslaCredsConfigured,
      goToSettings,
      oauthClientId,
      oauthRedirectUri,
      oauthState,
      oauthCallbackUrl,
      oauthMsg,
      showPartnerReg,
      partnerDomain,
      partnerClientSecret,
      registeringPartner,
      partnerMsg,
      partnerOk,
      registerPartner,
      copyPartnerPublicKey,
      startTeslaSignIn,
      exchangeTeslaCallback,
      onPresetChange,
      onProtocolChange,
      onAutoScanPick,
      runTest,
      save,
    };
  },
});
</script>
