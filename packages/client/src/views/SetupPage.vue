<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { NAlert, NButton, NCard, NForm, NFormItem, NInput } from 'naive-ui';
import { ApiError } from '../api';
import { useSession } from '../stores/session';

const session = useSession();
const router = useRouter();
const code = ref('');
const username = ref(session.setupUsername ?? '');
const displayName = ref('Administrator');
const password = ref('');
const confirmPassword = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  if (password.value !== confirmPassword.value) { error.value = 'Passwords do not match'; return; }
  busy.value = true;
  try {
    await session.completeSetup({ code: code.value, username: username.value, displayName: displayName.value, password: password.value });
    await router.push('/');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Setup failed';
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="setup-page">
    <n-card class="setup-card" title="Administrator setup">
      <p>Create the first system administrator. The one-time code is shown in the server or Docker logs.</p>
      <n-alert v-if="session.setupLegacyReset" type="warning" style="margin-bottom:16px">The insecure admin/admin password must be replaced. The username remains admin.</n-alert>
      <n-form @keyup.enter="submit">
        <n-form-item label="One-time setup code"><n-input v-model:value="code" autocomplete="one-time-code" /></n-form-item>
        <n-form-item label="Username"><n-input v-model:value="username" :disabled="session.setupLegacyReset" autocomplete="username" /></n-form-item>
        <n-form-item label="Display name"><n-input v-model:value="displayName" /></n-form-item>
        <n-form-item label="Password (at least 12 characters)"><n-input v-model:value="password" type="password" show-password-on="click" autocomplete="new-password" /></n-form-item>
        <n-form-item label="Confirm password"><n-input v-model:value="confirmPassword" type="password" show-password-on="click" autocomplete="new-password" /></n-form-item>
        <n-alert v-if="error" type="error" style="margin-bottom:12px;white-space:pre-line">{{ error }}</n-alert>
        <n-button type="primary" block :loading="busy" @click="submit">Complete setup</n-button>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>
.setup-page{min-height:100vh;display:grid;place-content:center;padding:24px;background:#f5f7fb}.setup-card{width:min(480px,calc(100vw - 32px));box-shadow:0 24px 70px rgba(15,23,42,.13)}p{color:#64748b;margin-top:0}
</style>
