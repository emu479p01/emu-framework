<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import {
  NAlert, NButton, NCard, NCheckbox, NDatePicker, NForm, NFormItem, NInput, NModal,
  NSelect, NSpace, NSwitch, NTable, NTabPane, NTabs, NTag, useDialog, useMessage,
} from 'naive-ui';
import { api, ApiError } from '../api';
import { useMeta } from '../stores/meta';

interface Grant { appName: string; canOpen: boolean; canCustomize: boolean }
interface UserRow { id: number; username: string; displayName?: string; enabled: boolean; roles: string[]; appAccess: Grant[] }
interface Catalog { roles: { name: string; label: string; legacy?: boolean }[]; apps: { name: string; label: string }[] }
interface TokenRow { id: number; name: string; enabled: boolean; views: string[]; expiresAt?: string; lastUsedAt?: string; revokedAt?: string }

const meta = useMeta();
const message = useMessage();
const dialog = useDialog();
const users = ref<UserRow[]>([]);
const catalog = ref<Catalog>({ roles: [], apps: [] });
const tokens = ref<TokenRow[]>([]);
const busy = ref(false);
const showUser = ref(false);
const showReset = ref(false);
const showToken = ref(false);
const editingId = ref<number | null>(null);
const error = ref('');
const resetPassword = ref('');
const issuedSecret = ref('');
const draft = reactive({ username: '', displayName: '', password: '', enabled: true, roles: [] as string[], appAccess: [] as Grant[] });
const tokenDraft = reactive({ name: '', views: [] as string[], expiresAt: null as number | null });
const roleOptions = computed(() => catalog.value.roles.map((role) => ({ label: `${role.label}${role.legacy ? ' — legacy' : ''}`, value: role.name })));
const viewOptions = computed(() => (meta.meta?.views ?? []).map((view) => ({ label: view.label ?? view.name, value: view.name })));

async function load() {
  const [catalogResult, userResult, tokenResult] = await Promise.all([
    api.get<Catalog>('/api/system/security/catalog'),
    api.get<{ data: UserRow[] }>('/api/system/security/users'),
    api.get<{ data: TokenRow[] }>('/api/system/view-tokens'),
  ]);
  catalog.value = catalogResult; users.value = userResult.data; tokens.value = tokenResult.data;
}
onMounted(load);
function allGrants(existing: Grant[] = []): Grant[] {
  return catalog.value.apps.map((app) => existing.find((grant) => grant.appName === app.name) ?? { appName: app.name, canOpen: false, canCustomize: false });
}
function createUser() {
  editingId.value = null; error.value = '';
  Object.assign(draft, { username: '', displayName: '', password: '', enabled: true, roles: [], appAccess: allGrants() });
  showUser.value = true;
}
function editUser(user: UserRow) {
  editingId.value = user.id; error.value = '';
  Object.assign(draft, { username: user.username, displayName: user.displayName ?? '', password: '', enabled: user.enabled, roles: [...user.roles], appAccess: allGrants(user.appAccess) });
  showUser.value = true;
}
async function saveUser() {
  error.value = ''; busy.value = true;
  const payload = { username: draft.username, displayName: draft.displayName, enabled: draft.enabled, roles: draft.roles, appAccess: draft.appAccess.filter((grant) => grant.canOpen || grant.canCustomize), ...(editingId.value ? {} : { password: draft.password }) };
  try {
    if (editingId.value) await api.patch(`/api/system/security/users/${editingId.value}`, payload);
    else await api.post('/api/system/security/users', payload);
    draft.password = ''; showUser.value = false; await load(); message.success(editingId.value ? 'User updated' : 'User created');
  } catch (err) { error.value = err instanceof ApiError ? err.message : 'User could not be saved.'; }
  finally { busy.value = false; }
}
function confirmDelete(user: UserRow) {
  dialog.warning({ title: 'Delete user', content: `Delete '${user.username}' and revoke all sessions?`, positiveText: 'Delete', negativeText: 'Cancel', onPositiveClick: async () => {
    try { await api.delete(`/api/system/security/users/${user.id}`); await load(); message.success('User deleted'); }
    catch (err) { message.error(err instanceof ApiError ? err.message : 'User could not be deleted'); }
  } });
}
function openReset(user: UserRow) { editingId.value = user.id; resetPassword.value = ''; error.value = ''; showReset.value = true; }
async function applyReset() {
  if (!editingId.value) return; busy.value = true; error.value = '';
  try { await api.post(`/api/system/security/users/${editingId.value}/reset-password`, { newPassword: resetPassword.value }); resetPassword.value = ''; showReset.value = false; message.success('Password reset and old sessions revoked'); }
  catch (err) { error.value = err instanceof ApiError ? err.message : 'Password could not be reset.'; }
  finally { busy.value = false; }
}
function createToken() { Object.assign(tokenDraft, { name: '', views: [], expiresAt: null }); issuedSecret.value = ''; error.value = ''; showToken.value = true; }
async function issueToken() {
  busy.value = true; error.value = '';
  try {
    const created = await api.post<{ token: string }>('/api/system/view-tokens', { name: tokenDraft.name, views: tokenDraft.views, expiresAt: tokenDraft.expiresAt ? new Date(tokenDraft.expiresAt).toISOString() : null });
    issuedSecret.value = created.token; await load();
  } catch (err) { error.value = err instanceof ApiError ? err.message : 'Token could not be created.'; }
  finally { busy.value = false; }
}
async function revokeToken(token: TokenRow) {
  try { await api.post(`/api/system/view-tokens/${token.id}/revoke`); await load(); message.success('Token revoked'); }
  catch (err) { message.error(err instanceof ApiError ? err.message : 'Token could not be revoked'); }
}
</script>

<template>
  <div class="security-page"><div class="page-heading"><div><h1>Users & Security</h1><p>App Access controls entry to an App. Roles control the data and objects inside it; users need both.</p></div></div>
    <n-tabs type="line">
      <n-tab-pane name="users" tab="Users">
        <n-space justify="end" style="margin-bottom:12px"><n-button type="primary" @click="createUser">New user</n-button></n-space>
        <n-card><div class="table-scroll"><n-table striped><thead><tr><th>User</th><th>Enabled</th><th>Roles</th><th>App Access</th><th></th></tr></thead><tbody>
          <tr v-for="user in users" :key="user.id"><td><strong>{{ user.username }}</strong><br><span class="muted">{{ user.displayName }}</span></td><td><n-tag :type="user.enabled ? 'success' : 'default'">{{ user.enabled ? 'Enabled' : 'Disabled' }}</n-tag></td><td><n-space><n-tag v-for="role in user.roles" :key="role" size="small">{{ role }}</n-tag><span v-if="!user.roles.length" class="muted">No role</span></n-space></td><td><div v-for="grant in user.appAccess" :key="grant.appName"><strong>{{ grant.appName }}</strong>: {{ grant.canOpen ? 'Open' : '' }}{{ grant.canOpen && grant.canCustomize ? ' + ' : '' }}{{ grant.canCustomize ? 'Customize' : '' }}</div><span v-if="!user.appAccess.length" class="muted">No App Access</span></td><td><n-space><n-button size="small" @click="editUser(user)">Edit</n-button><n-button size="small" @click="openReset(user)">Reset password</n-button><n-button size="small" type="error" quaternary @click="confirmDelete(user)">Delete</n-button></n-space></td></tr>
        </tbody></n-table></div></n-card>
      </n-tab-pane>
      <n-tab-pane name="tokens" tab="Power BI / View tokens">
        <n-alert type="info" style="margin-bottom:14px">Tokens can call only the selected View JSON/CSV endpoints. The secret is shown once and must be sent in the Authorization: Bearer header.</n-alert>
        <n-space justify="end" style="margin-bottom:12px"><n-button type="primary" @click="createToken">Create View token</n-button></n-space>
        <n-card><div class="table-scroll"><n-table><thead><tr><th>Name</th><th>Views</th><th>Expires</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="token in tokens" :key="token.id"><td>{{ token.name }}</td><td>{{ token.views.join(', ') }}</td><td>{{ token.expiresAt || 'Never' }}</td><td>{{ token.lastUsedAt || 'Never' }}</td><td><n-tag :type="token.enabled && !token.revokedAt ? 'success' : 'error'">{{ token.enabled && !token.revokedAt ? 'Active' : 'Revoked' }}</n-tag></td><td><n-button v-if="token.enabled && !token.revokedAt" size="small" type="error" @click="revokeToken(token)">Revoke</n-button></td></tr></tbody></n-table></div></n-card>
      </n-tab-pane>
    </n-tabs>

    <n-modal v-model:show="showUser" preset="card" :title="editingId ? 'Edit user' : 'New user'" style="width:min(800px,calc(100vw - 24px))">
      <n-alert v-if="error" type="error" style="margin-bottom:12px">{{ error }}</n-alert><n-form label-placement="top">
        <div class="two-col"><n-form-item label="Username" required><n-input v-model:value="draft.username" :disabled="Boolean(editingId)" /></n-form-item><n-form-item label="Display name"><n-input v-model:value="draft.displayName" /></n-form-item></div>
        <n-form-item v-if="!editingId" label="Initial password (minimum 12 characters)" required><n-input v-model:value="draft.password" type="password" show-password-on="click" /></n-form-item>
        <n-form-item label="Enabled"><n-switch v-model:value="draft.enabled" /></n-form-item><n-form-item label="Roles"><n-select v-model:value="draft.roles" :options="roleOptions" multiple filterable /></n-form-item>
        <h3>App Access</h3><div class="table-scroll"><n-table size="small"><thead><tr><th>App</th><th>Open</th><th>Customize</th></tr></thead><tbody><tr v-for="grant in draft.appAccess" :key="grant.appName"><td>{{ catalog.apps.find((app) => app.name === grant.appName)?.label ?? grant.appName }}<br><span class="muted">{{ grant.appName }}</span></td><td><n-checkbox v-model:checked="grant.canOpen" /></td><td><n-checkbox v-model:checked="grant.canCustomize" /></td></tr></tbody></n-table></div>
      </n-form><template #footer><n-space justify="end"><n-button @click="showUser=false">Cancel</n-button><n-button type="primary" :loading="busy" @click="saveUser">Save</n-button></n-space></template>
    </n-modal>
    <n-modal v-model:show="showReset" preset="card" title="Reset password" style="width:min(520px,calc(100vw - 24px))"><n-alert v-if="error" type="error" style="margin-bottom:12px">{{ error }}</n-alert><n-form-item label="New password (minimum 12 characters)" required><n-input v-model:value="resetPassword" type="password" show-password-on="click" /></n-form-item><template #footer><n-space justify="end"><n-button @click="showReset=false">Cancel</n-button><n-button type="primary" :loading="busy" @click="applyReset">Reset and revoke sessions</n-button></n-space></template></n-modal>
    <n-modal v-model:show="showToken" preset="card" title="Create View token" style="width:min(620px,calc(100vw - 24px))"><n-alert v-if="error" type="error" style="margin-bottom:12px">{{ error }}</n-alert><template v-if="!issuedSecret"><n-form-item label="Name" required><n-input v-model:value="tokenDraft.name" /></n-form-item><n-form-item label="Allowed Views" required><n-select v-model:value="tokenDraft.views" :options="viewOptions" multiple filterable /></n-form-item><n-form-item label="Expiry (optional)"><n-date-picker v-model:value="tokenDraft.expiresAt" type="datetime" clearable /></n-form-item></template><n-alert v-else type="warning" title="Copy this secret now — it will not be shown again"><code class="secret">{{ issuedSecret }}</code></n-alert><template #footer><n-space justify="end"><n-button @click="showToken=false">{{ issuedSecret ? 'Done' : 'Cancel' }}</n-button><n-button v-if="!issuedSecret" type="primary" :loading="busy" @click="issueToken">Create token</n-button></n-space></template></n-modal>
  </div>
</template>

<style scoped>.security-page{max-width:1400px;margin:0 auto}.page-heading h1{margin:0}.page-heading p,.muted{color:var(--emu-muted)}.page-heading{margin-bottom:20px}.table-scroll{overflow:auto}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}.secret{display:block;margin-top:12px;padding:12px;background:#111827;color:#fff;border-radius:8px;overflow-wrap:anywhere}@media(max-width:700px){.two-col{grid-template-columns:1fr}.table-scroll table{min-width:760px}}</style>
