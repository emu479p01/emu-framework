import { defineStore } from 'pinia';
import { api, ApiError } from '../api';

interface User {
  username: string;
  displayName: string;
  roles?: string[];
}

export const useSession = defineStore('session', {
  state: () => ({ user: null as User | null, checked: false, setupRequired: false, setupLegacyReset: false, setupUsername: null as string | null }),
  getters: {
    isFrameworkUser: (s) =>
      s.user !== null &&
      (s.user.roles ?? []).some((r) => r === 'FW_FrameworkUser' || r === 'FW_SystemAdminRole'),
    isDesigner: (s) =>
      s.user !== null &&
      (s.user.roles ?? []).some((r) => r === 'FW_FrameworkUser' || r === 'FW_SystemAdminRole'),
  },
  actions: {
    async check() {
      const setup = await api.get<{ required: boolean; legacyReset: boolean; username: string | null }>('/api/setup/status');
      this.setupRequired = setup.required;
      this.setupLegacyReset = setup.legacyReset;
      this.setupUsername = setup.username;
      if (setup.required) {
        this.user = null;
        this.checked = true;
        return;
      }
      try {
        this.user = await api.get<User>('/api/me');
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) throw err;
        this.user = null;
      }
      this.checked = true;
    },
    async completeSetup(input: { code: string; username: string; displayName: string; password: string }) {
      await api.post('/api/setup/complete', input);
      this.setupRequired = false;
      this.checked = false;
      await this.check();
    },
    async login(username: string, password: string) {
      await api.post('/api/login', { username, password });
      await this.check();
    },
    async logout() {
      await api.post('/api/logout');
      this.user = null;
    },
  },
});
