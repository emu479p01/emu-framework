import { defineStore } from 'pinia';
import { api, ApiError } from '../api';

interface User {
  username: string;
  displayName: string;
  roles?: string[];
}

export const useSession = defineStore('session', {
  state: () => ({ user: null as User | null, checked: false }),
  getters: {
    isFrameworkUser: (s) =>
      s.user !== null &&
      (s.user.username === 'admin' ||
        (s.user.roles ?? []).some((r) => r === 'FW_FrameworkUser' || r === 'FW_SystemAdminRole')),
    isDesigner: (s) =>
      s.user !== null &&
      (s.user.username === 'admin' ||
        (s.user.roles ?? []).some((r) => r === 'FW_FrameworkUser' || r === 'FW_SystemAdminRole')),
  },
  actions: {
    async check() {
      try {
        this.user = await api.get<User>('/api/me');
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) throw err;
        this.user = null;
      }
      this.checked = true;
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
