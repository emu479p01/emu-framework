<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NCard, NForm, NFormItem, NInput, NButton, NAlert } from 'naive-ui';
import { useSession } from '../stores/session';
import { useMeta } from '../stores/meta';
import { ApiError } from '../api';

const session = useSession();
const meta = useMeta();
const router = useRouter();
const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

const title = computed(() => meta.meta?.branding.title ?? 'EmuFramework');

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await session.login(username.value, password.value);
    router.push('/');
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Login failed';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-brand"><img src="/logo.svg" alt="" width="58" height="58" /><div><strong>{{ title }}</strong><span>Business application platform</span></div></div>
    <n-card class="login-card">
      <h1>Welcome back</h1><p class="login-copy">Sign in to continue to your workspace.</p>
      <n-form @keyup.enter="submit">
        <n-form-item label="Username">
          <n-input v-model:value="username" placeholder="admin" data-testid="username" />
        </n-form-item>
        <n-form-item label="Password">
          <n-input v-model:value="password" type="password" placeholder="••••" data-testid="password" />
        </n-form-item>
        <n-alert v-if="error" type="error" style="margin-bottom: 12px">{{ error }}</n-alert>
        <n-button type="primary" block :loading="busy" data-testid="login" @click="submit">
          Sign in
        </n-button>
      </n-form>
    </n-card>
  </div>
</template>

<style scoped>
.login-page{min-height:100vh;display:grid;place-content:center;gap:22px;padding:24px;background:radial-gradient(circle at 15% 15%,rgba(99,102,241,.18),transparent 30%),radial-gradient(circle at 85% 80%,rgba(14,165,233,.12),transparent 30%),#f5f7fb}.login-brand{display:flex;align-items:center;gap:13px}.login-brand strong{display:block;font-size:18px;letter-spacing:-.02em}.login-brand span{display:block;color:var(--emu-muted);font-size:12px;margin-top:2px}.login-card{width:min(400px,calc(100vw - 32px));padding:8px;border:1px solid rgba(226,232,240,.9);box-shadow:0 24px 70px rgba(15,23,42,.13)}.login-card h1{font-size:24px;letter-spacing:-.035em;margin:2px 0 4px}.login-copy{color:var(--emu-muted);margin:0 0 22px}
</style>
