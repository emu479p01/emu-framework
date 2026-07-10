<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton,
  NAlert,
  NCard,
  NCheckbox,
  NForm,
  NFormItem,
  NInput,
  NSelect,
  NSpace,
  NTable,
  NTabs,
  NTabPane,
  useMessage,
} from 'naive-ui';
import { useDesigner, type Artifact } from '../../stores/designer';
import { useMeta } from '../../stores/meta';
import { ApiError } from '../../api';
import FieldsEditor, { type EditableField } from './FieldsEditor.vue';
import IndexesEditor, { type EditableIndex } from './IndexesEditor.vue';
import MenuItemsEditor, { type EditableMenuItem } from './MenuItemsEditor.vue';

const props = defineProps<{ kind: string; name?: string }>();
const route = useRoute();
const router = useRouter();
const designer = useDesigner();
const meta = useMeta();
const message = useMessage();

const isNew = computed(() => props.name === undefined);
const busy = ref(false);
const jsonText = ref('');
const activeTab = ref('design');

/** Kinds with a structured editor; others are edited as raw JSON. */
const DESIGN_KINDS = new Set([
  'table', 'enum', 'form', 'menu', 'script', 'app',
  'tableExtension', 'formExtension', 'menuExtension', 'enumExtension',
  'privilege', 'duty', 'role',
  'privilegeExtension', 'dutyExtension', 'roleExtension', 'scriptExtension',
]);

// Table creation conveniences
const selectedApp = ref('');
const selectedMenu = ref('');
const selectedLayer = ref('CUS');   // default for web-created artifacts
const selectedModel = ref('');
const autoForm = ref(true);

const artifact = ref<Artifact>({ kind: props.kind, name: '' });

function blank(kind: string): Artifact {
  switch (kind) {
    case 'table':
      return { kind, name: '', label: '', titleField: '', fields: [{ name: 'name', type: 'string', mandatory: true }] };
    case 'enum':
      return { kind, name: '', label: '', values: [{ name: '', value: 0 }] };
    case 'form':
      return { kind, name: '', label: '', table: '' };
    case 'menu':
      return { kind, name: '', label: '', items: [] };
    case 'tableExtension':
      return { kind, name: '', table: (route.query.target as string) ?? '', fields: [] };
    case 'formExtension':
      return { kind, name: '', form: (route.query.target as string) ?? '', listFields: [], groups: [] };
    case 'menuExtension':
      return { kind, name: '', menu: (route.query.target as string) ?? '', items: [] };
    case 'enumExtension':
      return { kind, name: '', enum: (route.query.target as string) ?? '', values: [] };
    case 'privilege':
      return { kind, name: '', label: '', tablePermissions: [], forms: [] };
    case 'privilegeExtension':
      return { kind, name: '', privilege: (route.query.target as string) ?? '', tablePermissions: [], forms: [] };
    case 'duty':
      return { kind, name: '', label: '', privileges: [] };
    case 'dutyExtension':
      return { kind, name: '', duty: (route.query.target as string) ?? '', privileges: [] };
    case 'role':
      return { kind, name: '', label: '', duties: [], privileges: [] };
    case 'roleExtension':
      return { kind, name: '', role: (route.query.target as string) ?? '', duties: [], privileges: [] };
    case 'scriptExtension':
      return { kind, name: '', script: (route.query.target as string) ?? '', code: '// extension script\n' };
    case 'app':
      return { kind, name: '', label: '' };
    case 'script':
      return { kind, name: '', label: '', code: '// register events, hooks, and actions\n// kernel.actions.set("MyAction", (ctx, args) => { ... });\n// kernel.events.on("MyTable", "onInserting", (e) => { ... });\n// kernel.hooks.register("MyTable", { validateWrite(rec) { ... } });\n' };
    default:
      return { kind, name: '' };
  }
}

async function load() {
  if (!designer.loaded) await designer.load();
  if (isNew.value) {
    artifact.value = blank(props.kind);
    if (props.kind === 'tableExtension' && artifact.value.table) {
      artifact.value.name = `${artifact.value.table}_Extension`;
    }
  } else {
    const entry = designer.get(props.name!);
    artifact.value = entry ? JSON.parse(JSON.stringify(entry.artifact)) : blank(props.kind);
  }
  selectedApp.value = (artifact.value.app as string) || (route.query.app as string) || selectedApp.value;
  selectedModel.value = (artifact.value.model as string) || (route.query.model as string) || selectedModel.value;
  selectedLayer.value = ((artifact.value.layer as string) || selectedLayer.value) as string;
  jsonText.value = JSON.stringify(artifact.value, null, 2);
  activeTab.value = DESIGN_KINDS.has(props.kind) ? 'design' : 'json';

  // Set default app for new tables: first non-system, non-web file app
  if (isNew.value) {
    const defaultApp = designer.apps.find((a) => a.name !== 'system' && a.name !== 'web' && !a.name.startsWith('_web'));
    if (!selectedApp.value && defaultApp) selectedApp.value = defaultApp.name;
    const app = designer.apps.find((a) => a.name === selectedApp.value);
    if (!selectedModel.value) selectedModel.value = app?.models?.[0]?.name ?? '';
    selectedLayer.value = app?.models?.find((m) => m.name === selectedModel.value)?.layer ?? selectedLayer.value;
  }
}

watch(() => [props.kind, props.name], load, { immediate: true });

// keep JSON tab in sync
watch(activeTab, (tab) => {
  if (tab === 'json') jsonText.value = JSON.stringify(artifact.value, null, 2);
  else {
    try { artifact.value = JSON.parse(jsonText.value); } catch { /* keep design state */ }
  }
});

// Watchers to auto-set form/menu names when table name changes
watch(() => artifact.value.name, (n) => {
  if (props.kind === 'app') {
    artifact.value.name = (n as string).toLowerCase().replace(/[^a-z0-9-]/g, '');
  }
});

const LAYERS = [
  { value: 'SYS', label: 'SYS — System (base)' },
  { value: 'ISV', label: 'ISV — Third-party' },
  { value: 'LOC', label: 'LOC — Localization' },
  { value: 'DEV', label: 'DEV — Development' },
  { value: 'CUS', label: 'CUS — Customer (highest)' },
];

const appOptions = computed(() =>
  designer.apps
    .map((a) => ({ label: a.label ?? a.name, value: a.name })),
);

const selectedAppEntry = computed(() => designer.apps.find((a) => a.name === selectedApp.value));
const modelOptions = computed(() =>
  (selectedAppEntry.value?.models ?? []).map((m) => ({ label: `${m.label ?? m.name} (${m.layer})`, value: m.name })),
);

watch(selectedAppEntry, (app) => {
  if (!app) return;
  if (!app.models?.some((m) => m.name === selectedModel.value)) {
    selectedModel.value = app.models?.[0]?.name ?? '';
  }
});

watch([selectedApp, selectedModel], () => {
  const model = selectedAppEntry.value?.models?.find((m) => m.name === selectedModel.value);
  if (model) selectedLayer.value = model.layer;
});

const menuOptions = computed(() => {
  if (!selectedApp.value) return [];
  const appEntry = meta.apps.find((a) => a.name === selectedApp.value);
  const menus = appEntry?.menus ?? [];
  return [
    ...menus.map((m) => ({ label: `${m.label ?? m.name} (${selectedApp.value})`, value: m.name })),
    { label: `(new menu for ${selectedApp.value})`, value: '!new' },
  ];
});
const allMenuOptions = computed(() =>
  (meta.meta?.apps ?? []).flatMap((a) => a.menus.map((m) => ({ label: `${m.label ?? m.name} (${a.name})`, value: m.name }))),
);

const tableOptions = computed(() =>
  (meta.meta?.tables ?? []).map((t) => ({ label: t.name, value: t.name })),
);
const formTableName = computed(() => {
  if (artifact.value.table) return artifact.value.table as string;
  const form = meta.form((artifact.value.form as string) ?? '');
  return form?.table ?? '';
});
const fieldOptionsForFormTable = computed(() => {
  const t = meta.table(formTableName.value);
  return (t?.fields ?? []).map((f) => ({ label: f.name, value: f.name }));
});
function fieldOptionsFor(tableName: string) {
  return (meta.table(tableName)?.fields ?? []).map((f) => ({ label: f.name, value: f.name }));
}
function numericFieldOptionsFor(tableName: string) {
  return (meta.table(tableName)?.fields ?? [])
    .filter((f) => f.type === 'int' || f.type === 'real')
    .map((f) => ({ label: f.name, value: f.name }));
}
function referenceFieldOptionsFor(tableName: string) {
  return (meta.table(tableName)?.fields ?? [])
    .filter((f) => f.type === 'reference')
    .map((f) => ({ label: f.name, value: f.name }));
}
function displayFieldOptionsFor(line: EditableLine) {
  return fieldOptionsFor(line.table).filter((o) => o.value !== line.refField);
}
function onLineRefFieldChange(line: EditableLine) {
  line.fields = line.fields.filter((f) => f !== line.refField);
}
const formOptions = computed(() =>
  (meta.meta?.forms ?? []).map((f) => ({ label: f.name, value: f.name })),
);
const enumOptions = computed(() =>
  (meta.meta?.enums ?? []).map((e) => ({ label: e.name, value: e.name })),
);
const privilegeOptions = computed(() =>
  (meta.meta?.privileges ?? []).map((p) => ({ label: p.name, value: p.name })),
);
const dutyOptions = computed(() =>
  (meta.meta?.duties ?? []).map((d) => ({ label: d.name, value: d.name })),
);
const roleOptions = computed(() =>
  (meta.meta?.roles ?? []).map((r) => ({ label: r.name, value: r.name })),
);
const scriptOptions = computed(() =>
  designer.artifacts.filter((a) => a.kind === 'script').map((s) => ({ label: s.name, value: s.name })),
);

async function save() {
  busy.value = true;
  try {
    let art = artifact.value;
    if (activeTab.value === 'json') {
      art = JSON.parse(jsonText.value);
      art.kind = props.kind;
    }
    if (!art.name) { message.error('Name is required'); return; }

    // Attach app/layer/model properties
    if (props.kind !== 'app') {
      if (!selectedApp.value) { message.error('App is required'); return; }
      if (!selectedModel.value) { message.error('Model is required'); return; }
      (art as any).app = selectedApp.value;
      (art as any).layer = selectedLayer.value;
      (art as any).model = selectedModel.value;
    }

    // Auto-prefix artifact name with app prefix
    if (props.kind !== 'app' && isNew.value && selectedApp.value) {
      const prefix =
        selectedApp.value === 'system'
          ? 'FW'
          : selectedApp.value.startsWith('erp')
            ? 'ERP'
            : selectedApp.value.replace(/[^a-z0-9]/gi, '').toUpperCase();
      if (!art.name.startsWith(`${prefix}_`)) {
        art.name = `${prefix}_${art.name}`;
      }
    }
    if (props.kind.endsWith('Extension') && !art.name.endsWith('_Extension')) {
      art.name = `${art.name}_Extension`;
    }

    // App kind validation
    if (props.kind === 'app') {
      if (art.name.includes(' ') || art.name !== art.name.toLowerCase()) {
        message.error('App name must be lowercase, no spaces (use dots for extensions: erp.credit)');
        return;
      }
    }

    const saved = await designer.save(art);
    if (saved === false) return;

    // convenience: new table → create form + menuExtension
    if (props.kind === 'table' && isNew.value) {
      const formName = `${art.name}Form`;
      const tableArt = art as any;
      if (autoForm.value) {
        const formArt: any = { kind: 'form', name: formName, label: (art.label as string) || art.name, table: art.name };
        if (tableArt.app) formArt.app = tableArt.app;
        formArt.model = tableArt.model;
        formArt.layer = tableArt.layer;
        await designer.save(formArt);
      }

      if (autoForm.value && selectedMenu.value) {
        if (selectedMenu.value === '!new') {
          // Create a new menu for this app
          const menuPrefix = selectedApp.value === 'system' ? 'FW' : selectedApp.value.startsWith('erp') ? 'ERP' : selectedApp.value.replace(/[^a-z0-9]/gi, '').toUpperCase();
          const menuName = `${menuPrefix}_MainMenu`;
          const existingMenu = designer.get(menuName);
          const items = existingMenu
            ? [...(existingMenu.artifact.items as { label?: string; form: string }[])]
            : [];
          if (!items.some((i) => i.form === formName)) {
            items.push({ label: (art.label as string) || art.name, form: formName });
          }
          const menuArt: any = { kind: 'menu', name: menuName, label: meta.apps.find((a) => a.name === selectedApp.value)?.label ?? selectedApp.value, items };
          if (selectedApp.value && selectedApp.value !== 'web') menuArt.app = selectedApp.value;
          menuArt.model = selectedModel.value;
          menuArt.layer = selectedLayer.value;
          await designer.save(menuArt);
        } else {
          // Append to existing menu via menuExtension
          const extName = `${selectedMenu.value}_Extension`;
          const existingExt = designer.get(extName);
          const items = existingExt
            ? [...(existingExt.artifact.items as { label?: string; form: string }[])]
            : [];
          if (!items.some((i) => i.form === formName)) {
            items.push({ label: (art.label as string) || art.name, form: formName });
          }
          await designer.save({
            kind: 'menuExtension',
            name: extName.endsWith('_Extension') ? extName : `${extName}_Extension`,
            app: selectedApp.value,
            model: selectedModel.value,
            layer: selectedLayer.value,
            menu: selectedMenu.value,
            items,
          } as any);
        }
      }
    }

    // convenience: table extension → surface new fields on existing forms
    if (props.kind === 'tableExtension') {
      const fieldNames = ((art.fields as { name: string }[]) ?? []).map((f) => f.name).filter(Boolean);
      if (fieldNames.length > 0) {
        const targetForms = (meta.meta?.forms ?? []).filter(
          (f) => f.table === art.table && (f.groups?.length ?? 0) > 0,
        );
        for (const f of targetForms) {
          await designer.save({
            kind: 'formExtension',
            name: `${f.name}_Extension`,
            app: selectedApp.value,
            model: selectedModel.value,
            layer: selectedLayer.value,
            form: f.name,
            listFields: fieldNames,
            groups: [{ label: 'Custom fields', fields: fieldNames }],
          });
        }
      }
    }

    message.success('Saved — changes are live');
    router.push('/designer');
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else if (err instanceof SyntaxError) message.error(`Invalid JSON: ${err.message}`);
    else throw err;
  } finally {
    busy.value = false;
  }
}

// typed views over the artifact for the template
const enumValues = computed(() => (artifact.value.values ?? []) as { name: string; value: number; label?: string }[]);
const formGroups = computed(() => (artifact.value.groups ?? []) as { label?: string; fields: string[] }[]);
const menuItems = computed(() => {
  if (!artifact.value.items) artifact.value.items = [];
  return artifact.value.items as EditableMenuItem[];
});
const tableFields = computed(() => (artifact.value.fields ?? []) as EditableField[]);
interface EditableAggregate { fn: 'count' | 'sum' | 'avg'; field?: string; label?: string }
interface EditableLine { table: string; refField: string; fields: string[]; aggregates?: EditableAggregate[] }
const formLines = computed(() => {
  if (!artifact.value.lines) artifact.value.lines = [];
  return artifact.value.lines as EditableLine[];
});
const AGGREGATE_FN_OPTIONS = [
  { label: 'count', value: 'count' },
  { label: 'sum', value: 'sum' },
  { label: 'avg', value: 'avg' },
];
const tableIndexes = computed(() => {
  if (!artifact.value.indexes) artifact.value.indexes = [];
  return artifact.value.indexes as EditableIndex[];
});
const tablePermissions = computed(() => (artifact.value.tablePermissions ?? []) as {
  table: string;
  read?: boolean;
  create?: boolean;
  update?: boolean;
  delete?: boolean;
}[]);
const selectedForms = computed({
  get: () => (artifact.value.forms ?? []) as string[],
  set: (v: string[]) => { artifact.value.forms = v; },
});
const selectedPrivileges = computed({
  get: () => (artifact.value.privileges ?? []) as string[],
  set: (v: string[]) => { artifact.value.privileges = v; },
});
const selectedDuties = computed({
  get: () => (artifact.value.duties ?? []) as string[],
  set: (v: string[]) => { artifact.value.duties = v; },
});

// ---- enum helpers ----
function addEnumValue() { const values = artifact.value.values as { name: string; value: number }[]; values.push({ name: '', value: values.length > 0 ? values[values.length - 1].value + 1 : 0 }); }
function removeEnumValue(i: number) { (artifact.value.values as unknown[]).splice(i, 1); }
// ---- form group helpers ----
function addGroup() { if (!artifact.value.groups) artifact.value.groups = []; (artifact.value.groups as unknown[]).push({ label: '', fields: [] }); }
function removeGroup(i: number) { (artifact.value.groups as unknown[]).splice(i, 1); }
// ---- form line grid helpers ----
function addLine() { formLines.value.push({ table: '', refField: '', fields: [] }); }
function removeLine(i: number) { formLines.value.splice(i, 1); }
function addAggregate(line: EditableLine) { if (!line.aggregates) line.aggregates = []; line.aggregates.push({ fn: 'count' }); }
function removeAggregate(line: EditableLine, i: number) { line.aggregates!.splice(i, 1); }
// ---- security helpers ----
function addTablePermission() {
  if (!artifact.value.tablePermissions) artifact.value.tablePermissions = [];
  (artifact.value.tablePermissions as unknown[]).push({ table: '', read: true });
}
function removeTablePermission(i: number) { (artifact.value.tablePermissions as unknown[]).splice(i, 1); }
</script>

<template>
  <div>
    <n-space justify="space-between" style="margin-bottom: 16px">
      <h2 style="margin: 0">{{ isNew ? `New ${kind}` : `${kind}: ${name}` }}</h2>
      <n-space>
        <n-button @click="router.push('/designer')">Back</n-button>
        <n-button type="primary" :loading="busy" data-testid="designer-save" @click="save">Save</n-button>
      </n-space>
    </n-space>

    <n-tabs v-model:value="activeTab" type="line">
      <n-tab-pane v-if="DESIGN_KINDS.has(kind)" name="design" tab="Design">
        <n-form label-placement="top" style="max-width: 960px">
          <n-space vertical :size="12">
            <!-- Header: name, label, app selector -->
            <n-card size="small">
              <n-space :size="24" align="start">
                <n-form-item label="Name" required style="min-width: 240px">
                  <n-input v-model:value="(artifact.name as string)" :disabled="kind === 'app' ? !isNew : !isNew" placeholder="PascalCase" data-testid="artifact-name" />
                </n-form-item>
                <n-form-item label="Label" style="min-width: 240px">
                  <n-input v-model:value="(artifact.label as string)" data-testid="artifact-label" />
                </n-form-item>
                <n-form-item v-if="kind === 'table'" label="Title field (lookup)">
                  <n-input v-model:value="(artifact.titleField as string)" placeholder="name" style="min-width: 160px" />
                </n-form-item>
                <n-form-item v-if="kind !== 'app'" label="App" required>
                  <n-select v-model:value="selectedApp" :options="appOptions" style="min-width: 220px" data-testid="artifact-app-select" />
                </n-form-item>
                <n-form-item v-if="kind !== 'app'" label="Model" required>
                  <n-select v-model:value="selectedModel" :options="modelOptions" style="min-width: 260px" data-testid="artifact-model-select" />
                </n-form-item>
                <n-form-item v-if="kind !== 'app'" label="Layer">
                  <n-select v-model:value="selectedLayer" :options="LAYERS" disabled style="min-width: 180px" data-testid="artifact-layer-select" />
                </n-form-item>
              </n-space>

              <!-- App + Menu selectors for new tables -->
              <n-space v-if="kind === 'table' && isNew" :size="24" style="margin-top: 12px">
                <n-form-item label="Menu destination">
                  <n-select v-model:value="selectedMenu" :options="menuOptions" style="min-width: 280px" data-testid="table-menu-select" />
                </n-form-item>
                <n-form-item label=" ">
                  <n-checkbox v-model:checked="autoForm">Create form</n-checkbox>
                </n-form-item>
              </n-space>

              <!-- Form/Extension target selectors -->
              <n-space v-if="kind === 'form' || kind === 'tableExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Table" :required="true">
                  <n-select v-model:value="(artifact.table as string)" :options="tableOptions"
                    :disabled="kind === 'tableExtension' && !isNew" style="min-width: 220px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'formExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Form" required>
                  <n-select v-model:value="(artifact.form as string)" :options="formOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'menuExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Menu" required>
                  <n-select v-model:value="(artifact.menu as string)" :options="allMenuOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'enumExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Enum" required>
                  <n-select v-model:value="(artifact.enum as string)" :options="enumOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'privilegeExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Privilege" required>
                  <n-select v-model:value="(artifact.privilege as string)" :options="privilegeOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'dutyExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Duty" required>
                  <n-select v-model:value="(artifact.duty as string)" :options="dutyOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'roleExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Role" required>
                  <n-select v-model:value="(artifact.role as string)" :options="roleOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'scriptExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Script" required>
                  <n-select v-model:value="(artifact.script as string)" :options="scriptOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
            </n-card>

            <!-- Script editor -->
            <n-card v-if="kind === 'script' || kind === 'scriptExtension'" size="small" title="Business Logic Script">
              <n-space vertical>
                <n-alert type="warning" title="High-risk executable code">
                  Saving a script requires separate confirmation. AI and MCP change sets cannot create or update scripts.
                </n-alert>
                <n-form-item>
                  <p style="color: var(--n-text-color-3); font-size: 13px; margin: 0">
                    Write JavaScript code that registers events, hooks, and actions.
                    Available globals: <b>kernel</b>, <b>ValidationError</b>, <b>DataEventCancelled</b>.
                  </p>
                </n-form-item>
                <n-form-item label="Code">
                  <n-input
                    v-model:value="(artifact.code as string)"
                    type="textarea"
                    :autosize="{ minRows: 16, maxRows: 40 }"
                    style="font-family: monospace; font-size: 13px"
                    data-testid="artifact-code"
                  />
                </n-form-item>
              </n-space>
            </n-card>

            <!-- App specific editor (simple form) -->
            <n-card v-if="kind === 'app'" size="small" title="App settings">
              <n-space vertical>
                <n-form-item label="Description">
                  <n-input v-model:value="(artifact.label as string)" placeholder="Display name for this app" />
                </n-form-item>
                <n-form-item>
                  <p style="color: var(--n-text-color-3); font-size: 13px; margin: 0">
                    After saving, create tables/forms/menus under this app to build its domain.
                    The app will appear as its own group in the sidebar.
                  </p>
                </n-form-item>
              </n-space>
            </n-card>

            <!-- Fields (table / tableExtension) -->
            <n-card v-if="kind === 'table' || kind === 'tableExtension'" size="small" title="Fields">
              <FieldsEditor :fields="tableFields" />
            </n-card>

            <!-- Indexes (table / tableExtension) -->
            <n-card v-if="kind === 'table' || kind === 'tableExtension'" size="small" title="Indexes">
              <IndexesEditor :indexes="tableIndexes" :fields="tableFields" />
            </n-card>

            <!-- Enum values -->
            <n-card v-if="kind === 'enum' || kind === 'enumExtension'" size="small" title="Values">
              <n-table size="small" :bordered="false">
                <thead><tr><th>Name</th><th style="width: 120px">Code</th><th>Label</th><th style="width: 60px"></th></tr></thead>
                <tbody>
                  <tr v-for="(v, i) in enumValues" :key="i">
                    <td><n-input v-model:value="v.name" size="small" /></td>
                    <td><n-input :value="String(v.value)" size="small" @update:value="(x: string) => (v.value = Number(x) || 0)" /></td>
                    <td><n-input v-model:value="v.label" size="small" placeholder="(optional)" /></td>
                    <td><n-button size="tiny" quaternary type="error" @click="removeEnumValue(i)">✕</n-button></td>
                  </tr>
                </tbody>
              </n-table>
              <n-button size="small" style="margin-top: 8px" @click="addEnumValue">+ Add value</n-button>
            </n-card>

            <!-- Form groups -->
            <template v-if="kind === 'form' || kind === 'formExtension'">
              <n-card size="small" title="List page columns (blank = all fields)">
                <n-select v-model:value="(artifact.listFields as string[])" :options="fieldOptionsForFormTable" multiple placeholder="all fields" />
              </n-card>
              <n-card size="small" title="Groups (detail layout)">
                <n-space vertical :size="8">
                  <n-space v-for="(g, i) in formGroups" :key="i" align="center">
                    <n-input v-model:value="g.label" size="small" placeholder="Group label" style="width: 180px" />
                    <n-select v-model:value="g.fields" :options="fieldOptionsForFormTable" multiple size="small" style="min-width: 380px" />
                    <n-button size="tiny" quaternary type="error" @click="removeGroup(i)">✕</n-button>
                  </n-space>
                </n-space>
                <n-button size="small" style="margin-top: 8px" @click="addGroup">+ Add group</n-button>
              </n-card>

              <!-- Line grids (master-detail) -->
              <n-card v-if="kind === 'form'" size="small" title="Line grids">
                <n-space vertical :size="16">
                  <n-card v-for="(line, li) in formLines" :key="li" size="small" :bordered="true">
                    <n-space :size="16" align="start" style="margin-bottom: 8px">
                      <n-form-item label="Line table">
                        <n-select v-model:value="line.table" :options="tableOptions" size="small" style="min-width: 200px" filterable />
                      </n-form-item>
                      <n-form-item label="Ref field (on line table)">
                        <n-select
                          v-model:value="line.refField"
                          :options="referenceFieldOptionsFor(line.table)"
                          size="small"
                          style="min-width: 200px"
                          filterable
                          @update:value="onLineRefFieldChange(line)"
                        />
                      </n-form-item>
                      <n-form-item label="Display fields">
                        <n-select v-model:value="line.fields" :options="displayFieldOptionsFor(line)" multiple size="small" style="min-width: 260px" />
                      </n-form-item>
                      <n-button size="tiny" quaternary type="error" @click="removeLine(li)">✕ Remove line</n-button>
                    </n-space>

                    <p style="color: var(--n-text-color-3); font-size: 13px; margin: 0 0 8px">Aggregates shown on the header (e.g. line count, sum of amount)</p>
                    <n-space v-for="(agg, ai) in line.aggregates ?? []" :key="ai" align="center" style="margin-bottom: 4px">
                      <n-select v-model:value="agg.fn" :options="AGGREGATE_FN_OPTIONS" size="small" style="width: 100px" />
                      <n-select
                        v-if="agg.fn !== 'count'"
                        v-model:value="agg.field"
                        :options="numericFieldOptionsFor(line.table)"
                        placeholder="numeric field"
                        size="small"
                        style="min-width: 160px"
                      />
                      <n-input v-model:value="agg.label" placeholder="Label (optional)" size="small" style="width: 160px" />
                      <n-button size="tiny" quaternary type="error" @click="removeAggregate(line, ai)">✕</n-button>
                    </n-space>
                    <n-button size="small" style="margin-top: 4px" @click="addAggregate(line)">+ Add aggregate</n-button>
                  </n-card>
                </n-space>
                <n-button size="small" style="margin-top: 8px" @click="addLine">+ Add line grid</n-button>
              </n-card>
            </template>

            <!-- Menu items -->
            <n-card v-if="kind === 'menu' || kind === 'menuExtension'" size="small" title="Menu items">
              <p style="color: var(--n-text-color-3); font-size: 13px; margin: 0 0 8px">
                Add a form to make an item navigable, or leave it blank to use as a submenu group. Use "+ Sub-item" to nest items.
              </p>
              <MenuItemsEditor :items="menuItems" :form-options="formOptions" />
            </n-card>

            <!-- Security objects -->
            <n-card v-if="kind === 'privilege' || kind === 'privilegeExtension'" size="small" title="Table permissions">
              <n-table size="small" :bordered="false">
                <thead>
                  <tr><th>Table</th><th>Read</th><th>Create</th><th>Update</th><th>Delete</th><th style="width: 60px"></th></tr>
                </thead>
                <tbody>
                  <tr v-for="(p, i) in tablePermissions" :key="i">
                    <td><n-select v-model:value="p.table" :options="tableOptions" size="small" filterable /></td>
                    <td><n-checkbox v-model:checked="p.read" /></td>
                    <td><n-checkbox v-model:checked="p.create" /></td>
                    <td><n-checkbox v-model:checked="p.update" /></td>
                    <td><n-checkbox v-model:checked="p.delete" /></td>
                    <td><n-button size="tiny" quaternary type="error" @click="removeTablePermission(i)">✕</n-button></td>
                  </tr>
                </tbody>
              </n-table>
              <n-button size="small" style="margin-top: 8px" @click="addTablePermission">+ Add table</n-button>
              <n-form-item label="Forms" style="margin-top: 12px">
                <n-select v-model:value="selectedForms" :options="formOptions" multiple filterable />
              </n-form-item>
            </n-card>

            <n-card v-if="kind === 'duty' || kind === 'dutyExtension'" size="small" title="Privileges">
              <n-select v-model:value="selectedPrivileges" :options="privilegeOptions" multiple filterable />
            </n-card>

            <n-card v-if="kind === 'role' || kind === 'roleExtension'" size="small" title="Role grants">
              <n-form-item label="Duties">
                <n-select v-model:value="selectedDuties" :options="dutyOptions" multiple filterable />
              </n-form-item>
              <n-form-item label="Direct privileges">
                <n-select v-model:value="selectedPrivileges" :options="privilegeOptions" multiple filterable />
              </n-form-item>
            </n-card>
          </n-space>
        </n-form>
      </n-tab-pane>

      <n-tab-pane name="json" tab="JSON">
        <n-input v-model:value="jsonText" type="textarea" :autosize="{ minRows: 16, maxRows: 40 }"
          style="font-family: monospace" data-testid="artifact-json" />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>
