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
  <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; height: 100vh; background: #f5f6f8">
    <img src="/logo.svg" alt="" width="56" height="56" />
    <n-card :title="title" style="width: 360px">
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
