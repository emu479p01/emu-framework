<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NAvatar,
  NAlert,
  NButton,
  NCard,
  NDropdown,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NSkeleton,
  NSpace,
  NTable,
  NTag,
  NText,
  NThing,
  useDialog,
  useMessage,
} from 'naive-ui';
import { useDesigner } from '../../stores/designer';
import { ApiError } from '../../api';
import type { MetadataPackagePreview } from '../../api';
import SimpleBuilder from './SimpleBuilder.vue';

const designer = useDesigner();
const router = useRouter();
const route = useRoute();
const workspaceMode = ref(route.query.mode === 'advanced' ? 'advanced' : 'simple');
const message = useMessage();
const dialog = useDialog();

const loading = ref(true);
onMounted(async () => {
  await designer.load();
  loading.value = false;
});

const selectedApp = ref(String(route.params.appName ?? route.query.app ?? ''));
const selectedModel = ref(String(route.params.modelName ?? route.query.model ?? ''));
const searchQuery = ref('');
const reloading = ref(false);

const selectedAppEntry = computed(() => designer.apps.find((a) => a.name === selectedApp.value));
const selectedModelEntry = computed(() =>
  selectedAppEntry.value?.models?.find((m) => m.name === selectedModel.value),
);

function contextPath() {
  if (selectedApp.value && selectedModel.value) return `/designer/app/${encodeURIComponent(selectedApp.value)}/model/${encodeURIComponent(selectedModel.value)}`;
  if (selectedApp.value) return `/designer/app/${encodeURIComponent(selectedApp.value)}`;
  return '/designer';
}
function syncContext() { router.replace({ path: contextPath(), query: { mode: workspaceMode.value } }); }
function goToApps() { selectedApp.value = ''; selectedModel.value = ''; searchQuery.value = ''; syncContext(); }
function goToModels() { selectedModel.value = ''; searchQuery.value = ''; syncContext(); }
function selectApp(name: string) { selectedApp.value = name; selectedModel.value = ''; searchQuery.value = ''; syncContext(); }
function selectModel(name: string) { selectedModel.value = name; searchQuery.value = ''; syncContext(); }

// ---- stats ----
const totalApps = computed(() => designer.apps.length);
const totalModels = computed(() => designer.apps.reduce((s, a) => s + (a.models ?? []).length, 0));
const totalArtifacts = computed(() => designer.artifacts.length);

// ---- search ----
const filteredApps = computed(() => {
  const q = searchQuery.value.toLowerCase();
  if (!q) return designer.apps;
  return designer.apps.filter(
    (a) => a.name.toLowerCase().includes(q) || (a.label ?? '').toLowerCase().includes(q),
  );
});
const businessApps = computed(() => filteredApps.value.filter((app) => app.name !== 'system'));
const frameworkApps = computed(() => filteredApps.value.filter((app) => app.name === 'system'));

// ---- avatar ----
function avatarLabel(name: string, label?: string): string {
  return ((label ?? name)[0] ?? '?').toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ['#4c6ef5', '#20c997', '#f59f00', '#f06595', '#845ef7', '#339af0', '#51cf66'];
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

// ---- kebab menus ----
function appMenuOptions(appName: string) {
  if (appName === 'system') return [];
  const opts = [{ key: 'edit', label: 'Edit App' }];
  if (appName !== 'system') opts.push(
    { key: 'export', label: 'Export App' },
    { key: 'import', label: 'Import / Merge App' },
    { key: 'delete', label: 'Delete App' },
  );
  return opts;
}
function modelMenuOptions(appName: string, modelName: string) {
  if (appName === 'system') return [];
  const opts = [{ key: 'edit', label: 'Edit Model' }];
  if (appName !== 'system') opts.push(
    { key: 'export', label: 'Export Model' },
    { key: 'import', label: 'Import / Merge Model' },
    { key: 'delete', label: 'Delete Model' },
  );
  return opts;
}
function handleAppMenu(appName: string, key: string) {
  if (key === 'edit') router.push(`/designer/app/${encodeURIComponent(appName)}`);
  else if (key === 'export') downloadPackage(designer.exportAppUrl(appName));
  else if (key === 'import') choosePackage();
  else if (key === 'delete') removeApp(appName);
}
function handleModelMenu(appName: string, model: { name: string; label?: string; layer: string }, key: string) {
  if (key === 'edit') openEditModel(appName, model.name, model.label ?? '', model.layer);
  else if (key === 'export') downloadPackage(designer.exportModelUrl(appName, model.name));
  else if (key === 'import') choosePackage();
  else if (key === 'delete') removeModel(appName, model.name);
}

const showPackagePreview = ref(false);
const packagePreview = ref<MetadataPackagePreview | null>(null);
const packageBusy = ref(false);

function downloadPackage(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function choosePackage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.emuapp.json,.emumodel.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    packageBusy.value = true;
    try {
      packagePreview.value = await designer.previewPackage(file);
      showPackagePreview.value = true;
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Package could not be validated');
    } finally {
      packageBusy.value = false;
    }
  };
  input.click();
}

async function commitPackage() {
  if (!packagePreview.value) return;
  packageBusy.value = true;
  try {
    await designer.applyChangeSet(
      packagePreview.value.previewId,
      packagePreview.value.diff.some((item) => item.highRisk),
    );
    showPackagePreview.value = false;
    packagePreview.value = null;
    message.success('Metadata package imported');
  } catch (err) {
    message.error(err instanceof ApiError ? err.message : 'Package import failed');
  } finally {
    packageBusy.value = false;
  }
}

// ---- kind icon/label ----
const KIND_META: Record<string, { icon: string; label: string }> = {
  table: { icon: '⊞', label: 'Table' },
  enum: { icon: '☰', label: 'Enum' },
  form: { icon: '⊟', label: 'Form' },
  menu: { icon: '≡', label: 'Menu' },
  privilege: { icon: '◈', label: 'Privilege' },
  duty: { icon: '◆', label: 'Duty' },
  role: { icon: '◉', label: 'Role' },
  view: { icon: '▤', label: 'View' },
  chart: { icon: '▥', label: 'Chart' },
  script: { icon: '⚡', label: 'Script' },
  function: { icon: 'ƒ', label: 'Function' },
  app: { icon: '⬡', label: 'App' },
  tableExtension: { icon: '+⊞', label: 'Table Ext' },
  formExtension: { icon: '+⊟', label: 'Form Ext' },
  menuExtension: { icon: '+≡', label: 'Menu Ext' },
  enumExtension: { icon: '+☰', label: 'Enum Ext' },
  privilegeExtension: { icon: '+◈', label: 'Privilege Ext' },
  dutyExtension: { icon: '+◆', label: 'Duty Ext' },
  roleExtension: { icon: '+◉', label: 'Role Ext' },
  scriptExtension: { icon: '+⚡', label: 'Script Ext' },
};

function layerType(layer: string): 'default' | 'info' | 'success' | 'warning' {
  if (layer === 'CUS') return 'success';
  if (layer === 'DEV') return 'warning';
  if (layer === 'ISV') return 'info';
  return 'default';
}

// ---- model dialog ----
const showModelDialog = ref(false);
const modelDialogTitle = ref('');
const editingModel = ref<{ app: string; originalName: string }>({ app: '', originalName: '' });
const modelForm = reactive({ name: '', label: '', layer: 'CUS' });

const LAYER_OPTIONS = [
  { label: 'SYS — System', value: 'SYS' },
  { label: 'ISV — Third-party', value: 'ISV' },
  { label: 'LOC — Localization', value: 'LOC' },
  { label: 'DEV — Development', value: 'DEV' },
  { label: 'CUS — Customer', value: 'CUS' },
];

function openAddModel(appName: string) {
  editingModel.value = { app: appName, originalName: '' };
  modelDialogTitle.value = 'Create Model';
  modelForm.name = '';
  modelForm.label = '';
  modelForm.layer = 'CUS';
  showModelDialog.value = true;
}

function openEditModel(appName: string, modelName: string, label: string, layer: string) {
  editingModel.value = { app: appName, originalName: modelName };
  modelDialogTitle.value = 'Edit Model';
  modelForm.name = modelName;
  modelForm.label = label;
  modelForm.layer = layer;
  showModelDialog.value = true;
}

async function handleSaveModel() {
  if (!modelForm.name.trim()) { message.error('Model name is required'); return; }
  try {
    await designer.saveModel(
      editingModel.value.app,
      editingModel.value.originalName || modelForm.name.trim(),
      { label: modelForm.label || undefined, layer: modelForm.layer },
    );
    message.success(editingModel.value.originalName ? 'Model updated' : 'Model created');
    showModelDialog.value = false;
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  }
}

// ---- new artifact dropdown ----
const NEW_KINDS = [
  { key: 'table', label: 'Table (+ form + menu)' },
  { key: 'enum', label: 'Enum' },
  { key: 'form', label: 'Form' },
  { key: 'menu', label: 'Menu' },
  { key: 'privilege', label: 'Privilege' },
  { key: 'duty', label: 'Duty' },
  { key: 'role', label: 'Role' },
  { key: 'report', label: 'Report' },
  { key: 'view', label: 'View (query / data source)' },
  { key: 'chart', label: 'Chart' },
  { type: 'divider' as const, key: 'd1' },
  { key: 'tableExtension', label: 'Table Extension' },
  { key: 'formExtension', label: 'Form Extension' },
  { key: 'menuExtension', label: 'Menu Extension' },
  { key: 'enumExtension', label: 'Enum Extension' },
  { key: 'privilegeExtension', label: 'Privilege Extension' },
  { key: 'dutyExtension', label: 'Duty Extension' },
  { key: 'roleExtension', label: 'Role Extension' },
  { type: 'divider' as const, key: 'd2' },
  { key: 'script', label: 'Script' },
  { key: 'scriptExtension', label: 'Script Extension' },
  { key: 'function', label: 'Function' },
  { type: 'divider' as const, key: 'd3' },
  { key: 'app', label: 'App' },
];

const KIND_ORDER = [
  'table', 'enum', 'form', 'menu', 'view', 'chart', 'privilege', 'duty', 'role', 'script', 'function', 'report',
  'tableExtension', 'enumExtension', 'formExtension', 'menuExtension',
  'privilegeExtension', 'dutyExtension', 'roleExtension', 'scriptExtension',
];

// ---- artifact counting ----
function artifactCountForApp(appName: string): number {
  return designer.artifacts.filter((a) => {
    const art = a.artifact as any;
    return art.app === appName || (a.kind === 'app' && a.name === appName);
  }).length;
}

function artifactCountForModel(appName: string, modelName: string): number {
  return designer.artifacts.filter((a) => {
    const art = a.artifact as any;
    return art.app === appName && art.model === modelName;
  }).length;
}

// ---- level 3: filtered artifacts ----
const filteredArtifacts = computed(() => {
  const q = searchQuery.value.toLowerCase();
  return designer.artifacts.filter((a) => {
    const art = a.artifact as any;
    if (selectedApp.value && art.app !== selectedApp.value) return false;
    if (selectedModel.value && art.model !== selectedModel.value) return false;
    if (q && !a.name.toLowerCase().includes(q)) return false;
    return true;
  });
});

const grouped = computed(() =>
  KIND_ORDER
    .map((kind) => ({ kind, items: filteredArtifacts.value.filter((a) => a.kind === kind) }))
    .filter((g) => g.items.length > 0),
);

// ---- customize existing tables ----
const customizableTables = computed(() =>
  designer.catalog.tables
    .filter((t) => !designer.get(t.name))
    .filter((t) => {
      if (!selectedApp.value) return true;
      return designer.artifacts.some((a) => {
        const art = a.artifact as any;
        return (art.app === selectedApp.value || a.name === selectedApp.value);
      }) || t.name.startsWith('ERP_') || t.name.startsWith('FW_');
    }),
);

// ---- actions ----
function onNew(kind: string) {
  if (selectedApp.value && selectedModel.value) router.push(`${contextPath()}/new/${kind}`);
  else router.push({ path: `/designer/new/${kind}`, query: { ...(selectedApp.value ? { app: selectedApp.value } : {}) } });
}

function editArtifact(kind: string, name: string) {
  router.push(selectedApp.value && selectedModel.value ? `${contextPath()}/${kind}/${encodeURIComponent(name)}` : `/designer/${kind}/${encodeURIComponent(name)}`);
}

function customizeTable(tableName: string) {
  router.push(
    `${selectedApp.value && selectedModel.value ? contextPath() : '/designer'}/new/tableExtension?target=${encodeURIComponent(tableName)}`,
  );
}

function remove(kind: string, name: string) {
  dialog.warning({
    title: 'Delete Artifact',
    content: `Delete '${name}'? Existing data in the database is preserved.`,
    positiveText: 'Delete',
    negativeText: 'Cancel',
    onPositiveClick: async () => {
      try {
        await designer.remove(kind, name);
        message.success('Deleted');
      } catch (err) {
        if (err instanceof ApiError) message.error(err.message);
        else throw err;
      }
    },
  });
}

function removeModel(appName: string, modelName: string) {
  dialog.warning({
    title: 'Delete Model',
    content: `Delete model '${modelName}' and all its web artifacts from '${appName}'?`,
    positiveText: 'Delete',
    negativeText: 'Cancel',
    onPositiveClick: async () => {
      try {
        await designer.removeModel(appName, modelName);
        if (selectedModel.value === modelName) selectedModel.value = '';
        message.success('Model deleted');
      } catch (err) {
        if (err instanceof ApiError) message.error(err.message);
        else throw err;
      }
    },
  });
}

function removeApp(appName: string) {
  dialog.warning({
    title: 'Delete App',
    content: `Delete '${appName}' and all its models, artifacts, and data tables?`,
    positiveText: 'Delete',
    negativeText: 'Cancel',
    onPositiveClick: async () => {
      try {
        await designer.remove('app', appName);
        if (selectedApp.value === appName) { selectedApp.value = ''; selectedModel.value = ''; }
        message.success('App deleted');
      } catch (err) {
        if (err instanceof ApiError) message.error(err.message);
        else throw err;
      }
    },
  });
}

async function onReload() {
  reloading.value = true;
  try {
    await designer.reloadFromDisk();
    message.success('Synced from disk');
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  } finally {
    reloading.value = false;
  }
}
</script>

<template>
  <div>
    <div class="mode-switch" role="tablist" aria-label="Builder mode">
      <n-button :type="workspaceMode === 'simple' ? 'primary' : 'default'" :secondary="workspaceMode === 'simple'" @click="workspaceMode = 'simple'">Simple Builder</n-button>
      <n-button :type="workspaceMode === 'advanced' ? 'primary' : 'default'" :secondary="workspaceMode === 'advanced'" @click="workspaceMode = 'advanced'">Advanced</n-button>
    </div>
    <SimpleBuilder v-if="workspaceMode === 'simple'" />
    <div v-else class="designer-root">
    <!-- Header -->
    <div class="designer-toolbar">
      <div class="designer-toolbar-left">
        <h2 class="designer-title">Designer</h2>
        <div v-if="!loading" class="designer-stats">
          <span class="stat">{{ totalApps }} app{{ totalApps !== 1 ? 's' : '' }}</span>
          <span class="stat-sep">·</span>
          <span class="stat">{{ totalModels }} model{{ totalModels !== 1 ? 's' : '' }}</span>
          <span class="stat-sep">·</span>
          <span class="stat">{{ totalArtifacts }} artifact{{ totalArtifacts !== 1 ? 's' : '' }}</span>
        </div>
      </div>
      <n-space>
        <n-button v-if="selectedApp !== 'system'" secondary :loading="packageBusy" @click="choosePackage">Import Package</n-button>
        <n-button text @click="onReload" :loading="reloading">
          Sync from disk
        </n-button>
        <n-dropdown v-if="selectedApp !== 'system'" trigger="click" :options="NEW_KINDS" @select="onNew">
          <n-button type="primary" data-testid="designer-new">
            + New
          </n-button>
        </n-dropdown>
      </n-space>
    </div>

    <!-- Breadcrumb -->
    <div v-if="selectedApp && !loading" class="designer-breadcrumb">
      <button class="breadcrumb-link" @click="goToApps">Apps</button>
      <span class="breadcrumb-sep">/</span>
      <template v-if="selectedModel">
        <button class="breadcrumb-link" @click="goToModels">{{ selectedAppEntry?.label ?? selectedApp }}</button>
        <span class="breadcrumb-sep">/</span>
        <n-tag :type="layerType(selectedModelEntry?.layer ?? '')" size="small" :bordered="false">
          {{ selectedModelEntry?.label ?? selectedModel }}
        </n-tag>
      </template>
      <template v-else>
        <span class="breadcrumb-current">{{ selectedAppEntry?.label ?? selectedApp }}</span>
      </template>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="designer-section">
      <n-space vertical :size="12">
        <n-skeleton height="48px" width="30%" />
        <n-skeleton height="80px" :repeat="3" />
      </n-space>
    </div>

    <template v-else>
      <!-- Search (levels 1 & 3) -->
      <div v-if="!selectedApp || selectedModel" class="designer-section">
        <n-input
          v-model:value="searchQuery"
          placeholder="Search…"
          clearable
          round
          size="small"
          style="max-width: 320px"
        >
          <template #prefix>
            <span style="opacity:.4">⌕</span>
          </template>
        </n-input>
      </div>

      <!-- ═══════════════ Level 1: App list ═══════════════ -->
      <div v-if="!selectedApp" class="designer-section">
        <n-empty
          v-if="filteredApps.length === 0 && searchQuery"
          description="No apps match your search"
          style="padding: 48px 0"
        />
        <n-empty
          v-else-if="designer.apps.length === 0"
          description='No apps yet. Create one via + New → App.'
          style="padding: 48px 0"
        />
        <div v-if="businessApps.length" class="section-header"><span class="section-title">Business Apps</span></div>
        <div v-if="businessApps.length" class="card-grid">
          <div
            v-for="app in businessApps"
            :key="app.name"
            class="app-card"
            @click="selectApp(app.name)"
          >
            <div class="app-card-avatar" :style="{ background: avatarColor(app.name) }">
              {{ avatarLabel(app.name, app.label) }}
            </div>
            <div class="app-card-body">
              <div class="app-card-title">{{ app.label ?? app.name }}</div>
              <div class="app-card-subtitle">{{ app.name }}</div>
              <div class="app-card-meta">
                {{ (app.models ?? []).length }} model{{ (app.models ?? []).length !== 1 ? 's' : '' }}
                &nbsp;·&nbsp;
                {{ artifactCountForApp(app.name) }} artifact{{ artifactCountForApp(app.name) !== 1 ? 's' : '' }}
              </div>
            </div>
            <div v-if="app.name !== 'system'" class="app-card-action" @click.stop>
              <n-dropdown trigger="click" :options="appMenuOptions(app.name)" @select="(k: string) => handleAppMenu(app.name, k)">
                <n-button text size="tiny" class="kebab-btn">⋯</n-button>
              </n-dropdown>
            </div>
          </div>
        </div>
        <div v-if="frameworkApps.length" class="section-header" style="margin-top:24px"><span class="section-title">Framework — Read-only</span></div>
        <div v-if="frameworkApps.length" class="card-grid">
          <div
            v-for="app in frameworkApps"
            :key="app.name"
            class="app-card"
            @click="selectApp(app.name)"
          >
            <div class="app-card-avatar" :style="{ background: avatarColor(app.name) }">{{ avatarLabel(app.name, app.label) }}</div>
            <div class="app-card-body">
              <div class="app-card-title">{{ app.label ?? app.name }}</div>
              <div class="app-card-subtitle">{{ app.name }}</div>
              <div class="app-card-meta">{{ (app.models ?? []).length }} model{{ (app.models ?? []).length !== 1 ? 's' : '' }} &nbsp;·&nbsp; {{ artifactCountForApp(app.name) }} artifact{{ artifactCountForApp(app.name) !== 1 ? 's' : '' }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════ Level 2: Model list ═══════════════ -->
      <div v-if="selectedApp && !selectedModel" class="designer-section">
        <n-alert v-if="selectedApp === 'system'" type="info" title="Framework — Read-only" style="margin-bottom:14px">System Apps and Models are metadata for inspection only and are not a business security boundary.</n-alert>
        <div class="section-header">
          <span class="section-title">Models</span>
          <n-button
            v-if="selectedApp !== 'system'"
            text size="small"
            type="primary"
            @click="openAddModel(selectedApp)"
          >+ Add Model</n-button>
        </div>
        <n-empty
          v-if="(selectedAppEntry?.models ?? []).length === 0"
          :description="selectedApp === 'system' ? 'System models are built-in.' : 'No models yet. Add one to start creating artifacts.'"
          style="padding: 48px 0"
        />
        <div v-else class="card-grid">
          <div
            v-for="m in (selectedAppEntry?.models ?? [])"
            :key="m.name"
            class="app-card"
            @click="selectModel(m.name)"
          >
            <div class="model-dot" :class="`layer-${m.layer.toLowerCase()}`" />
            <div class="app-card-body">
              <div class="app-card-title">{{ m.label ?? m.name }}</div>
              <div class="app-card-meta">
                <span class="layer-badge" :class="`layer-${m.layer.toLowerCase()}`">{{ m.layer }}</span>
                &nbsp;·&nbsp;
                {{ artifactCountForModel(selectedApp, m.name) }} artifact{{ artifactCountForModel(selectedApp, m.name) !== 1 ? 's' : '' }}
              </div>
            </div>
            <div v-if="selectedApp !== 'system'" class="app-card-action" @click.stop>
              <n-dropdown trigger="click" :options="modelMenuOptions(selectedApp, m.name)" @select="(k: string) => handleModelMenu(selectedApp, m, k)">
                <n-button text size="tiny" class="kebab-btn">⋯</n-button>
              </n-dropdown>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══════════════ Level 3: Artifact list ═══════════════ -->
      <div v-if="selectedModel" class="designer-section">
        <div class="section-header">
          <span class="section-title">Artifacts</span>
          <span class="section-count">{{ filteredArtifacts.length }}</span>
        </div>
        <n-empty
          v-if="grouped.length === 0 && searchQuery"
          description="No artifacts match your search"
          style="padding: 48px 0"
        />
        <n-empty
          v-else-if="grouped.length === 0"
          description="No artifacts in this model. Use + New to create one."
          style="padding: 48px 0"
        />
        <n-table v-else size="small" :bordered="false" class="artifact-table">
          <thead>
            <tr>
              <th style="width: 80px">Kind</th>
              <th>Name</th>
              <th style="width: 100px">Layer</th>
              <th style="width: 80px"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="group in grouped" :key="group.kind">
              <tr
                v-for="a in group.items"
                :key="a.name"
                :data-testid="`artifact-${a.name}`"
                class="artifact-row"
                @click="editArtifact(a.kind, a.name)"
              >
                <td>
                  <span class="kind-icon">{{ KIND_META[a.kind]?.icon ?? '?' }}</span>
                  <span class="kind-label">{{ KIND_META[a.kind]?.label ?? a.kind }}</span>
                </td>
                <td>
                  <span class="artifact-name">{{ a.name }}</span>
                  <n-text v-if="a.error" type="error" depth="2" style="font-size:11px;display:block">
                    {{ a.error }}
                  </n-text>
                </td>
                <td>
                  <n-tag
                    size="tiny"
                    :type="layerType((a.artifact as any).layer ?? 'SYS')"
                    :bordered="false"
                  >{{ (a.artifact as any).layer ?? 'SYS' }}</n-tag>
                </td>
                <td>
                  <n-space :size="4" @click.stop>
                    <n-button text size="tiny" class="icon-btn" title="Edit" @click="editArtifact(a.kind, a.name)">
                      ✎
                    </n-button>
                    <n-button text size="tiny" class="icon-btn icon-btn-danger" title="Delete" @click="remove(a.kind, a.name)">
                      ✕
                    </n-button>
                  </n-space>
                </td>
              </tr>
            </template>
          </tbody>
        </n-table>
      </div>

      <!-- Customize existing tables (level 3 only) -->
      <div v-if="selectedModel && customizableTables.length > 0" class="designer-section">
        <div class="section-header">
          <span class="section-title">Extend Existing Tables</span>
          <span class="section-hint">Add custom fields to file-defined tables</span>
        </div>
        <n-space>
          <n-button
            v-for="t in customizableTables"
            :key="t.name"
            size="small"
            secondary
            :data-testid="`customize-${t.name}`"
            @click="customizeTable(t.name)"
          >
            {{ t.name }}
          </n-button>
        </n-space>
      </div>
    </template>

    <!-- Model create/edit dialog -->
    <n-modal v-model:show="showModelDialog" preset="card" :title="modelDialogTitle" style="width: 420px">
      <n-form label-placement="top" size="small">
        <n-form-item v-if="!editingModel.originalName" label="Name" required>
          <n-input v-model:value="modelForm.name" placeholder="e.g. SalesCore" />
        </n-form-item>
        <n-form-item label="Label">
          <n-input v-model:value="modelForm.label" placeholder="Display name (optional)" />
        </n-form-item>
        <n-form-item label="Layer">
          <n-select v-model:value="modelForm.layer" :options="LAYER_OPTIONS" />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button size="small" @click="showModelDialog = false">Cancel</n-button>
          <n-button size="small" type="primary" @click="handleSaveModel">
            {{ editingModel.originalName ? 'Update' : 'Create' }}
          </n-button>
        </n-space>
      </template>
    </n-modal>
    <n-modal v-model:show="showPackagePreview" preset="card" title="Review Metadata Import" style="width:min(720px, 92vw)">
      <template v-if="packagePreview">
        <n-alert v-if="packagePreview.diff.some((item) => item.highRisk)" type="warning" style="margin-bottom:16px">
          This package contains executable scripts. Import only packages from a trusted source.
        </n-alert>
        <n-alert v-if="packagePreview.warnings?.length" type="warning" style="margin-bottom:16px">
          <div v-for="warning in packagePreview.warnings" :key="warning.path">{{ warning.message }}</div>
        </n-alert>
        <div class="package-summary">
          <strong>{{ packagePreview.package.scope.type === 'app' ? 'App' : 'Model' }}:</strong>
          {{ packagePreview.package.scope.app }}<template v-if="packagePreview.package.scope.type === 'model'"> / {{ packagePreview.package.scope.model }}</template>
          · {{ packagePreview.package.artifactCount }} artifacts
          · from v{{ packagePreview.package.frameworkVersion }}
        </div>
        <n-table size="small" :bordered="false" style="margin-top:16px;max-height:360px;overflow:auto">
          <thead><tr><th>Change</th><th>Kind</th><th>Name</th><th>Risk</th></tr></thead>
          <tbody><tr v-for="item in packagePreview.diff" :key="`${item.kind}:${item.name}`">
            <td><n-tag size="small" :type="item.op === 'create' ? 'success' : 'warning'">{{ item.op }}</n-tag></td>
            <td>{{ item.kind }}</td><td>{{ item.name }}</td><td>{{ item.highRisk ? 'High' : 'Normal' }}</td>
          </tr></tbody>
        </n-table>
      </template>
      <template #footer><n-space justify="end">
        <n-button @click="showPackagePreview=false">Cancel</n-button>
        <n-button type="primary" :loading="packageBusy" @click="commitPackage">Confirm Merge</n-button>
      </n-space></template>
    </n-modal>
    </div>
  </div>
</template>

<style scoped>
.designer-root {
  max-width: 880px;
  margin: 0 auto;
}
.mode-switch { max-width:920px; margin:0 auto 20px; display:flex; gap:8px; }
.package-summary { color:var(--emu-muted); font-size:13px; }

.designer-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.designer-toolbar-left {
  display: flex;
  align-items: baseline;
  gap: 16px;
}
.designer-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.3px;
}
.designer-stats {
  font-size: 13px;
  color: var(--n-text-color-3);
}
.designer-stats .stat-sep {
  margin: 0 6px;
  opacity: 0.5;
}

/* Breadcrumb */
.designer-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 13px;
}
.breadcrumb-link {
  background: none;
  border: none;
  color: var(--n-text-color-3);
  cursor: pointer;
  font-size: inherit;
  padding: 2px 4px;
  border-radius: 4px;
  transition: color 0.15s;
}
.breadcrumb-link:hover {
  color: var(--n-text-color);
}
.breadcrumb-sep {
  color: var(--n-text-color-3);
  opacity: 0.4;
}
.breadcrumb-current {
  font-weight: 500;
}

/* Sections */
.designer-section {
  margin-bottom: 20px;
}
.section-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--n-text-color-2);
}
.section-count {
  font-size: 12px;
  color: var(--n-text-color-3);
}
.section-hint {
  font-size: 12px;
  color: var(--n-text-color-3);
  font-style: italic;
}

/* Card Grid */
.card-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* App / Model Card */
.app-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--n-border-color);
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.15s ease, border-color 0.15s;
  background: var(--n-color);
}
.app-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  transform: translateY(-1px);
  border-color: var(--n-border-color-hover, var(--n-border-color));
}
.app-card-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  flex-shrink: 0;
}
.app-card-body {
  flex: 1;
  min-width: 0;
}
.app-card-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--n-text-color);
  line-height: 1.3;
}
.app-card-subtitle {
  font-size: 12px;
  color: var(--n-text-color-3);
  margin-top: 1px;
}
.app-card-meta {
  font-size: 12px;
  color: var(--n-text-color-3);
  margin-top: 4px;
}
.app-card-action {
  flex-shrink: 0;
}

/* Model dot */
.model-dot {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
}
.model-dot::after {
  content: '';
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: currentColor;
}
.model-dot.layer-sys { color: #adb5bd; }
.model-dot.layer-isv { color: #339af0; }
.model-dot.layer-loc { color: #845ef7; }
.model-dot.layer-dev { color: #f59f00; }
.model-dot.layer-cus { color: #20c997; }

/* Layer badge inline */
.layer-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 1px 5px;
  border-radius: 3px;
}
.layer-badge.layer-sys { color: #868e96; background: #f1f3f5; }
.layer-badge.layer-isv { color: #1864ab; background: #d0ebff; }
.layer-badge.layer-loc { color: #5f3dc4; background: #e5dbff; }
.layer-badge.layer-dev { color: #e67700; background: #fff3bf; }
.layer-badge.layer-cus { color: #087f5b; background: #c3fae8; }

/* Kebab button */
.kebab-btn {
  font-size: 18px;
  letter-spacing: 2px;
  opacity: 0.35;
  transition: opacity 0.15s;
}
.kebab-btn:hover { opacity: 0.7; }

/* Artifact Table */
.artifact-table :deep(td) {
  vertical-align: middle;
  padding: 8px 12px;
}
.artifact-row {
  cursor: pointer;
  transition: background 0.1s;
}
.artifact-row:hover {
  background: var(--n-td-color-hover, rgba(0,0,0,0.02));
}
.kind-icon {
  font-size: 12px;
  margin-right: 4px;
  opacity: 0.5;
}
.kind-label {
  font-size: 12px;
  color: var(--n-text-color-3);
}
.artifact-name {
  font-size: 13px;
  font-weight: 500;
}

/* Icon buttons */
.icon-btn {
  font-size: 14px;
  padding: 2px 6px;
  opacity: 0.4;
  transition: opacity 0.15s;
}
.icon-btn:hover { opacity: 0.8; }
.icon-btn-danger:hover { opacity: 1; color: var(--n-error-color); }

/* Dark mode adjustments */
:global(.n-theme--dark) .app-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}
@media(max-width:700px){.mode-switch{display:grid;grid-template-columns:1fr 1fr}.mode-switch :deep(.n-button){min-height:44px}.designer-toolbar{display:block}.designer-toolbar-left{display:block}.designer-stats{margin-top:5px;overflow-wrap:anywhere}.designer-toolbar>.n-space{display:grid!important;grid-template-columns:1fr 1fr;margin-top:12px}.designer-toolbar>.n-space :deep(.n-button){width:100%;min-height:44px}.designer-breadcrumb{overflow-x:auto;white-space:nowrap;padding-bottom:4px}.app-card{align-items:flex-start;padding:13px 12px}.artifact-table :deep(thead){display:none}.artifact-table :deep(table),.artifact-table :deep(tbody),.artifact-table :deep(tr),.artifact-table :deep(td){display:block;width:100%}.artifact-table :deep(tr){padding:13px;border:1px solid var(--emu-border);border-radius:10px}.artifact-table :deep(tr+tr){margin-top:9px}.artifact-table :deep(td){padding:4px!important;border:0}.artifact-table :deep(td:last-child .n-space){justify-content:flex-end!important}.artifact-table :deep(.n-button){min-width:44px;min-height:44px}.designer-section>.n-space{flex-wrap:wrap!important}.designer-section>.n-space :deep(.n-button){min-height:44px}.designer-root :deep(.n-modal){width:calc(100vw - 16px)!important}.designer-root :deep(.n-card__content){padding:14px}}
</style>
