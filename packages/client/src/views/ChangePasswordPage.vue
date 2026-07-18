<script setup lang="ts">
import { ref } from 'vue';
import { NAlert, NButton, NCard, NForm, NFormItem, NInput, useMessage } from 'naive-ui';
import { api, ApiError } from '../api';

const currentPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const busy = ref(false);
const error = ref('');
const message = useMessage();

async function save() {
  error.value = '';
  if (newPassword.value.length < 12) { error.value = 'New password must be at least 12 characters.'; return; }
  if (newPassword.value !== confirmPassword.value) { error.value = 'The new passwords do not match.'; return; }
  busy.value = true;
  try {
    await api.post('/api/account/change-password', { currentPassword: currentPassword.value, newPassword: newPassword.value });
    currentPassword.value = ''; newPassword.value = ''; confirmPassword.value = '';
    message.success('Password changed. Other sessions have been signed out.');
  } catch (err) { error.value = err instanceof ApiError ? err.message : 'Password could not be changed.'; }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="account-page"><h1>Change password</h1><p>Use at least 12 characters. Changing it signs out your other sessions.</p>
    <n-card><n-alert v-if="error" type="error" style="margin-bottom:16px">{{ error }}</n-alert>
      <n-form label-placement="top" @submit.prevent="save">
        <n-form-item label="Current password" required><n-input v-model:value="currentPassword" type="password" show-password-on="click" autocomplete="current-password" /></n-form-item>
        <n-form-item label="New password" required><n-input v-model:value="newPassword" type="password" show-password-on="click" autocomplete="new-password" /></n-form-item>
        <n-form-item label="Confirm new password" required><n-input v-model:value="confirmPassword" type="password" show-password-on="click" autocomplete="new-password" /></n-form-item>
        <n-button type="primary" attr-type="submit" :loading="busy">Change password</n-button>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>.account-page{max-width:620px;margin:0 auto}.account-page h1{margin:0 0 6px}.account-page>p{color:var(--emu-muted);margin:0 0 20px}</style>
