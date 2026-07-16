<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { NAlert, NButton, NCard, NCheckbox, NForm, NFormItem, NInput, NInputNumber, NSpace } from 'naive-ui';
import { api, ApiError } from '../api';

interface SmtpSettings {
  configured: boolean; host: string; port: number; secure: boolean; username: string;
  passwordConfigured: boolean; fromAddress: string; fromName: string;
}
const form = reactive({ host: '', port: 587, secure: false, username: '', password: '', fromAddress: '', fromName: '' });
const passwordConfigured = ref(false);
const testRecipient = ref('');
const busy = ref(false);
const message = ref('');
const error = ref('');

function showError(err: unknown) { error.value = err instanceof ApiError ? err.message : 'Request failed'; message.value = ''; }
async function load() {
  try {
    const value = await api.get<SmtpSettings>('/api/system/integrations/smtp');
    Object.assign(form, { host: value.host, port: value.port, secure: value.secure, username: value.username, password: '', fromAddress: value.fromAddress, fromName: value.fromName });
    passwordConfigured.value = value.passwordConfigured;
  } catch (err) { showError(err); }
}
async function save() {
  busy.value = true; error.value = '';
  try {
    const value = await api.put<SmtpSettings>('/api/system/integrations/smtp', form);
    passwordConfigured.value = value.passwordConfigured; form.password = ''; message.value = 'SMTP settings saved.';
  } catch (err) { showError(err); } finally { busy.value = false; }
}
async function verify() {
  busy.value = true; error.value = '';
  try { await api.post('/api/system/integrations/smtp/verify'); message.value = 'SMTP connection verified.'; }
  catch (err) { showError(err); } finally { busy.value = false; }
}
async function sendTest() {
  busy.value = true; error.value = '';
  try { await api.post('/api/system/integrations/smtp/test', { to: testRecipient.value }); message.value = 'Test email sent.'; }
  catch (err) { showError(err); } finally { busy.value = false; }
}
onMounted(load);
</script>

<template>
  <div class="smtp-page">
    <h1>SMTP Settings</h1>
    <p class="lead">Configure the shared mail transport available to async Functions through <code>services.email.send(...)</code>.</p>
    <n-alert type="info" style="margin-bottom:16px">The password is encrypted in designer.db. Keep the separate integration secret key when moving the installation or re-enter the password after restore.</n-alert>
    <n-alert v-if="message" type="success" closable style="margin-bottom:12px" @close="message=''">{{ message }}</n-alert>
    <n-alert v-if="error" type="error" closable style="margin-bottom:12px;white-space:pre-line" @close="error=''">{{ error }}</n-alert>
    <n-card title="Connection">
      <n-form label-placement="top">
        <div class="grid">
          <n-form-item label="SMTP host"><n-input v-model:value="form.host" placeholder="smtp.example.com" /></n-form-item>
          <n-form-item label="Port"><n-input-number v-model:value="form.port" :min="1" :max="65535" /></n-form-item>
          <n-form-item label="Username"><n-input v-model:value="form.username" autocomplete="username" /></n-form-item>
          <n-form-item :label="passwordConfigured ? 'Password (leave blank to keep current)' : 'Password'"><n-input v-model:value="form.password" type="password" show-password-on="click" autocomplete="new-password" /></n-form-item>
          <n-form-item label="Sender address"><n-input v-model:value="form.fromAddress" placeholder="noreply@example.com" /></n-form-item>
          <n-form-item label="Sender name"><n-input v-model:value="form.fromName" placeholder="EmuFramework" /></n-form-item>
        </div>
        <n-checkbox v-model:checked="form.secure">Implicit TLS (normally port 465)</n-checkbox>
        <n-space style="margin-top:18px"><n-button type="primary" :loading="busy" @click="save">Save</n-button><n-button :disabled="!form.host" :loading="busy" @click="verify">Verify connection</n-button></n-space>
      </n-form>
    </n-card>
    <n-card title="Send test email" style="margin-top:16px">
      <n-space align="end"><n-form-item label="Recipient" style="margin:0;min-width:300px"><n-input v-model:value="testRecipient" placeholder="you@example.com" /></n-form-item><n-button :disabled="!testRecipient" :loading="busy" @click="sendTest">Send test</n-button></n-space>
    </n-card>
  </div>
</template>

<style scoped>
.smtp-page{max-width:900px;margin:0 auto}.smtp-page h1{margin:0}.lead{color:#64748b}.grid{display:grid;grid-template-columns:2fr 1fr;gap:0 16px}code{font-family:ui-monospace,monospace}@media(max-width:650px){.grid{grid-template-columns:1fr}}
</style>
