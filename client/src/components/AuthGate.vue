<template>
  <div class="auth-screen">
    <div class="auth-card">
      <div class="auth-header">
        <div class="auth-brand-row">
          <div class="auth-brand mono">{{ rackTitle || 'RACK//PANEL' }}</div>
          <span class="pill pill-cyan mono" style="font-size: 10px;">
            {{ setupRequired ? 'FIRST-TIME SETUP' : 'CONSOLE AUTH' }}
          </span>
        </div>
        <div class="auth-subtitle">
          {{
            setupRequired
              ? 'Create your initial administrator account to lock down API routes, terminals, and controls.'
              : 'Sign in to access live rack telemetry, terminals, Proxmox VMs, and firewall controls.'
          }}
        </div>
      </div>

      <div v-if="errorMsg" class="alert-row alert-critical" style="margin-bottom: 14px;">
        <div>{{ errorMsg }}</div>
      </div>

      <form @submit.prevent="submit">
        <div class="field">
          <label class="field-label">Username</label>
          <input
            v-model="username"
            class="input mono"
            type="text"
            autocomplete="username"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            placeholder="admin"
            required
          />
        </div>

        <div v-if="setupRequired" class="field">
          <label class="field-label">Display Name (Optional)</label>
          <input
            v-model="displayName"
            class="input"
            type="text"
            autocomplete="name"
            placeholder="e.g. Ashley"
          />
        </div>

        <div class="field">
          <label class="field-label">Password</label>
          <input
            v-model="password"
            class="input"
            type="password"
            :autocomplete="setupRequired ? 'new-password' : 'current-password'"
            placeholder="Enter password"
            required
          />
        </div>

        <div v-if="setupRequired" class="field">
          <label class="field-label">Confirm Password</label>
          <input
            v-model="confirmPassword"
            class="input"
            type="password"
            autocomplete="new-password"
            placeholder="Re-enter password"
            required
          />
        </div>

        <button
          class="btn btn-primary auth-submit-btn"
          type="submit"
          :disabled="submitting"
        >
          {{
            submitting
              ? setupRequired
                ? 'Creating Account...'
                : 'Signing In...'
              : setupRequired
                ? 'Create Admin Account & Sign In'
                : 'Sign In'
          }}
        </button>
      </form>

      <div class="auth-footer">
        Persistent session &mdash; stays signed in on this browser until you sign out or clear browser storage.
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from 'vue';
import type { AuthLoginResponse } from '@shared/types';
import { api } from '@/api/client';

export default defineComponent({
  name: 'AuthGate',
  props: {
    setupRequired: { type: Boolean, default: false },
    rackTitle: { type: String, default: 'RACK//PANEL' },
  },
  setup(props, { emit }) {
    const username = ref(props.setupRequired ? 'admin' : '');
    const displayName = ref('');
    const password = ref('');
    const confirmPassword = ref('');
    const submitting = ref(false);
    const errorMsg = ref('');

    watch(
      () => props.setupRequired,
      (req) => {
        if (req && !username.value) username.value = 'admin';
      },
    );

    async function submit() {
      errorMsg.value = '';
      const u = username.value.trim();
      const p = password.value;
      if (!u || !p) {
        errorMsg.value = 'Username and password are required';
        return;
      }
      if (props.setupRequired) {
        if (p.length < 4) {
          errorMsg.value = 'Password must be at least 4 characters';
          return;
        }
        if (p !== confirmPassword.value) {
          errorMsg.value = 'Passwords do not match';
          return;
        }
      }

      submitting.value = true;
      try {
        let res: AuthLoginResponse;
        if (props.setupRequired) {
          res = await api.setupAdmin({
            username: u,
            displayName: displayName.value.trim() || undefined,
            password: p,
          });
        } else {
          res = await api.login(u, p);
        }
        password.value = '';
        confirmPassword.value = '';
        emit('authenticated', res);
      } catch (err) {
        errorMsg.value = err instanceof Error ? err.message : 'Authentication failed';
      } finally {
        submitting.value = false;
      }
    }

    return {
      username,
      displayName,
      password,
      confirmPassword,
      submitting,
      errorMsg,
      submit,
    };
  },
});
</script>

<style scoped lang="scss">
.auth-screen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(180deg, #090e19 0%, #05070c 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  overflow-y: auto;
}

.auth-card {
  width: 100%;
  max-width: 420px;
  background: #0e1525;
  border: 1px solid #22314d;
  border-radius: 6px;
  padding: 24px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.65);
}

.auth-header {
  border-bottom: 1px solid #1d2a42;
  padding-bottom: 14px;
  margin-bottom: 18px;
}

.auth-brand-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.auth-brand {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 1.4px;
  color: #f8fafc;
}

.auth-subtitle {
  font-size: 13px;
  color: #94a3b8;
  margin-top: 8px;
  line-height: 1.5;
}

.auth-submit-btn {
  width: 100%;
  min-height: 46px;
  font-size: 14px;
  font-weight: 700;
  margin-top: 4px;
}

.auth-footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #1a2438;
  font-size: 11px;
  color: #64748b;
  text-align: center;
  line-height: 1.5;
}
</style>
