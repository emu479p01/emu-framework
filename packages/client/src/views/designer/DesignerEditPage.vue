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
import { ApiError } from '../../api';
import FieldsEditor, { type EditableField } from './FieldsEditor.vue';
import IndexesEditor, { type EditableIndex } from './IndexesEditor.vue';
import MenuItemsEditor, { type EditableMenuItem } from './MenuItemsEditor.vue';
import ActionsEditor from './ActionsEditor.vue';
import ViewEditor from './ViewEditor.vue';
import ChartEditor from './ChartEditor.vue';
import FormChartsEditor from './FormChartsEditor.vue';
import type { FormAction } from '@emu/core';
import { ICON_OPTIONS } from '../../navigation';
import { appPrefix, deriveExtensionName, EXT_TARGET_FIELD } from './naming';

const props = defineProps<{ kind: string; name?: string }>();
const route = useRoute();
const router = useRouter();
const designer = useDesigner();
const message = useMessage();

const isNew = computed(() => props.name === undefined);
const isExtension = computed(() => props.kind.endsWith('Extension'));
const isSystemArtifact = computed(() => selectedApp.value === 'system' || artifact.value.app === 'system' || artifact.value.name.startsWith('FW_'));
const busy = ref(false);
const saveError = ref('');
const jsonText = ref('');
const activeTab = ref('design');

/** Kinds with a structured editor; others are edited as raw JSON. */
const DESIGN_KINDS = new Set([
  'table', 'enum', 'form', 'menu', 'script', 'function', 'app',
  'tableExtension', 'formExtension', 'menuExtension', 'enumExtension',
  'privilege', 'duty', 'role', 'view', 'chart',
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
      return { kind, name: '', label: '', tablePermissions: [], forms: [], views: [] };
    case 'privilegeExtension':
      return { kind, name: '', privilege: (route.query.target as string) ?? '', tablePermissions: [], forms: [], views: [] };
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
      return { kind, name: '', label: '', models: [] };
    case 'script':
      return { kind, name: '', label: '', code: '// register events, hooks, and actions\n// kernel.actions.set("MyAction", (ctx, args) => { ... });\n// kernel.events.on("MyTable", "onInserting", (e) => { ... });\n// kernel.hooks.register("MyTable", { validateWrite(rec) { ... } });\n' };
    case 'function':
      return { kind, name: '', label: '', executionMode: 'transactional', code: '// Function body — invoked as (ctx, args, kernel, services).\n// Choose Async integration mode to use await services.http or services.email.\n// return { ok: true, count: ctx.select("MyTable").count() };\n' };
    case 'view':
      return { kind, name: '', label: '', source: { table: '', alias: 't' }, joins: [], columns: [{ name: 'id', expression: { type: 'field', ref: 't.id' } }], parameters: [], filters: [], groupBy: [], orderBy: [] };
    case 'chart':
      return { kind, name: '', label: '', type: 'bar', view: '', dimension: '', measures: [{ field: '', label: '' }], legend: true, stacked: false };
    default:
      return { kind, name: '' };
  }
}

async function load() {
  if (!designer.loaded) await designer.load();
  if (isNew.value) {
    artifact.value = blank(props.kind);
  } else {
    const entry = designer.get(props.name!);
    artifact.value = entry ? JSON.parse(JSON.stringify(entry.artifact)) : blank(props.kind);
  }
  selectedApp.value = (artifact.value.app as string) || (route.params.appName as string) || (route.query.app as string) || selectedApp.value;
  selectedModel.value = (artifact.value.model as string) || (route.params.modelName as string) || (route.query.model as string) || selectedModel.value;
  selectedLayer.value = ((artifact.value.layer as string) || selectedLayer.value) as string;
  jsonText.value = JSON.stringify(artifact.value, null, 2);
  activeTab.value = DESIGN_KINDS.has(props.kind) ? 'design' : 'json';

  // Select the first business App only as a UI convenience; no Model is inferred.
  if (isNew.value) {
    const defaultApp = designer.apps.find((a) => a.name !== 'system');
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

// Extensions never get a user-chosen name: it is derived from the selected
// base object as <AppPrefix>_<BaseName>_Extension. If that extension already
// exists, open it instead of silently overwriting on save.
watch(
  [selectedApp, selectedModel, () => (EXT_TARGET_FIELD[props.kind] ? artifact.value[EXT_TARGET_FIELD[props.kind]] : undefined)],
  ([app, , target]) => {
    if (!isNew.value || !isExtension.value) return;
    if (!app || !target) { artifact.value.name = ''; return; }
    const derived = deriveExtensionName(app as string, selectedModel.value, target as string);
    artifact.value.name = derived;
    if (designer.get(derived)) {
      message.info('An extension for this object already exists — opening it');
      router.replace(`/designer/${props.kind}/${encodeURIComponent(derived)}`);
    }
  },
  { immediate: true },
);

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
  const menus = designer.catalog.menus.filter((menu) => menu.app === selectedApp.value);
  return [
    ...menus.map((m) => ({ label: `${m.label ?? m.name} (${selectedApp.value})`, value: m.name })),
    { label: `(new menu for ${selectedApp.value})`, value: '!new' },
  ];
});
const allMenuOptions = computed(() =>
  designer.catalog.menus.map((menu) => ({ label: `${String(menu.label ?? menu.name)} (${String(menu.app ?? '')})`, value: menu.name })),
);

const LAYER_ORDER = ['SYS', 'ISV', 'LOC', 'DEV', 'CUS'];
function canExtendTarget(target: { app?: string; layer?: string }): boolean {
  const source = LAYER_ORDER.indexOf(selectedLayer.value);
  const targetLayer = LAYER_ORDER.indexOf(target.layer ?? 'SYS');
  if (source <= targetLayer) return false;
  if (!target.app || target.app === selectedApp.value) return true;
  const visit = (appName: string, seen = new Set<string>()): boolean => {
    if (seen.has(appName)) return false; seen.add(appName);
    const app = designer.apps.find((entry) => entry.name === appName);
    return (app?.dependsOn ?? []).some((dependency) => dependency === target.app || visit(dependency, seen));
  };
  return visit(selectedApp.value);
}
function extensionOptions(items: { name: string; label?: string; app?: string; layer?: string }[]) {
  return items.filter(canExtendTarget).map((item) => ({ label: item.label ?? item.name, value: item.name }));
}
const extensionTableOptions = computed(() => extensionOptions(designer.catalog.tables as any));
const extensionFormOptions = computed(() => extensionOptions(designer.catalog.forms as any));
const extensionMenuOptions = computed(() => extensionOptions(designer.catalog.menus as any));
const extensionEnumOptions = computed(() => extensionOptions(designer.catalog.enums as any));
const extensionPrivilegeOptions = computed(() => extensionOptions(designer.catalog.privileges as any));
const extensionDutyOptions = computed(() => extensionOptions(designer.catalog.duties as any));
const extensionRoleOptions = computed(() => extensionOptions(designer.catalog.roles as any));
const extensionScriptOptions = computed(() => extensionOptions(designer.artifacts.filter((entry) => entry.kind === 'script').map((entry) => entry.artifact as any)));
const legacyExtensionWarning = computed(() => {
  if (!isExtension.value || isNew.value) return '';
  const target = artifact.value[EXT_TARGET_FIELD[props.kind]] as string | undefined;
  const expected = deriveExtensionName(selectedApp.value, selectedModel.value, target ?? '');
  return expected && artifact.value.name !== expected ? `Legacy extension name. New objects use '${expected}'. This object remains supported and is not renamed automatically.` : '';
});

const tableOptions = computed(() =>
  designer.catalog.tables.map((t) => ({ label: String(t.label ?? t.name), value: t.name })),
);
const formTableName = computed(() => {
  if (artifact.value.table) return artifact.value.table as string;
  const form = designer.catalog.forms.find((entry) => entry.name === (artifact.value.form as string));
  return String(form?.table ?? '');
});
const fieldOptionsForFormTable = computed(() => {
  const table = designer.catalog.tables.find((entry) => entry.name === formTableName.value);
  return ((table?.fields ?? []) as any[]).map((field) => ({ label: field.name, value: field.name }));
});
function fieldOptionsFor(tableName: string) {
  const table = designer.catalog.tables.find((entry) => entry.name === tableName);
  return ((table?.fields ?? []) as any[]).map((field) => ({ label: field.name, value: field.name }));
}
function numericFieldOptionsFor(tableName: string) {
  const table = designer.catalog.tables.find((entry) => entry.name === tableName);
  return ((table?.fields ?? []) as any[])
    .filter((f) => f.type === 'int' || f.type === 'real')
    .map((f) => ({ label: f.name, value: f.name }));
}
function referenceFieldOptionsFor(tableName: string) {
  const table = designer.catalog.tables.find((entry) => entry.name === tableName);
  return ((table?.fields ?? []) as any[])
    .filter((f) => f.type === 'reference')
    .map((f) => ({ label: f.name, value: f.name }));
}
function displayFieldOptionsFor(line: EditableLine) {
  return fieldOptionsFor(line.table).filter((o) => o.value !== line.refField);
}
function onLineRefFieldChange(line: EditableLine) {
  line.fields = line.fields.filter((f) => f !== line.refField);
}
function actionsForLine(line: EditableLine): FormAction[] { if (!line.actions) line.actions = []; return line.actions; }
const formOptions = computed(() =>
  designer.catalog.forms.map((f) => ({ label: String(f.label ?? f.name), value: f.name })),
);
const enumOptions = computed(() =>
  designer.catalog.enums.map((e) => ({ label: String(e.label ?? e.name), value: e.name })),
);
const privilegeOptions = computed(() =>
  designer.catalog.privileges.map((p) => ({ label: String(p.label ?? p.name), value: p.name })),
);
const dutyOptions = computed(() =>
  designer.catalog.duties.map((d) => ({ label: String(d.label ?? d.name), value: d.name })),
);
const roleOptions = computed(() =>
  designer.catalog.roles.map((r) => ({ label: String(r.label ?? r.name), value: r.name })),
);
const scriptOptions = computed(() =>
  designer.artifacts.filter((a) => a.kind === 'script').map((s) => ({ label: s.name, value: s.name })),
);
const reportOptions = computed(() => designer.catalog.reports.map((report) => ({ label: String(report.label ?? report.name), value: report.name })));
const viewOptions = computed(() => designer.catalog.views.map((view) => ({ label: String(view.label ?? view.name), value: view.name })));
const functionOptions = computed(() => designer.catalog.functions.map((item) => ({ label: String(item.label ?? item.name), value: item.name })));

async function save() {
  busy.value = true;
  saveError.value = '';
  try {
    let art = artifact.value;
    if (activeTab.value === 'json') {
      art = JSON.parse(jsonText.value);
      art.kind = props.kind;
    }
    if (isExtension.value && isNew.value) {
      const target = art[EXT_TARGET_FIELD[props.kind]] as string | undefined;
      if (!target) { message.error('Select the object to extend'); return; }
      art.name = deriveExtensionName(selectedApp.value, selectedModel.value, target);
    }
    if (!art.name) { message.error(isExtension.value ? 'Select the object to extend' : 'Name is required'); return; }

    // Attach app/layer/model properties
    if (props.kind !== 'app') {
      if (!selectedApp.value) { message.error('App is required'); return; }
      if (!selectedModel.value) { message.error('Model is required'); return; }
      (art as any).app = selectedApp.value;
      (art as any).layer = selectedLayer.value;
      (art as any).model = selectedModel.value;
    }

    // Auto-prefix artifact name with app prefix (extension names are fully derived above)
    if (props.kind !== 'app' && !isExtension.value && isNew.value && selectedApp.value) {
      const prefix = appPrefix(selectedApp.value);
      if (!art.name.startsWith(`${prefix}_`)) {
        art.name = `${prefix}_${art.name}`;
      }
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
          const menuName = `${appPrefix(selectedApp.value)}_MainMenu`;
          const existingMenu = designer.get(menuName);
          const items = existingMenu
            ? [...(existingMenu.artifact.items as { label?: string; form: string }[])]
            : [];
          if (!items.some((i) => i.form === formName)) {
            items.push({ label: (art.label as string) || art.name, form: formName });
          }
          const menuArt: any = { kind: 'menu', name: menuName, label: designer.apps.find((a) => a.name === selectedApp.value)?.label ?? selectedApp.value, items };
          menuArt.app = selectedApp.value;
          menuArt.model = selectedModel.value;
          menuArt.layer = selectedLayer.value;
          await designer.save(menuArt);
        } else {
          // Append to existing menu via menuExtension
          const extName = deriveExtensionName(selectedApp.value, selectedModel.value, selectedMenu.value);
          const existingExt = designer.get(extName);
          const items = existingExt
            ? [...(existingExt.artifact.items as { label?: string; form: string }[])]
            : [];
          if (!items.some((i) => i.form === formName)) {
            items.push({ label: (art.label as string) || art.name, form: formName });
          }
          await designer.save({
            kind: 'menuExtension',
            name: extName,
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
        const targetForms = designer.catalog.forms.filter(
          (f) => f.table === art.table && Array.isArray(f.groups) && f.groups.length > 0,
        );
        for (const f of targetForms) {
          const extName = deriveExtensionName(selectedApp.value, selectedModel.value, f.name);
          const existingExt = designer.get(extName)?.artifact as { listFields?: string[]; groups?: { label?: string; fields: string[] }[] } | undefined;
          const listFields = [...new Set([...(existingExt?.listFields ?? []), ...fieldNames])];
          await designer.save({
            kind: 'formExtension',
            name: extName,
            app: selectedApp.value,
            model: selectedModel.value,
            layer: selectedLayer.value,
            form: f.name,
            listFields,
            groups: [{ label: 'Custom fields', fields: listFields }],
          });
        }
      }
    }

    message.success('Saved — changes are live');
    router.push(selectedApp.value && selectedModel.value ? `/designer/app/${encodeURIComponent(selectedApp.value)}/model/${encodeURIComponent(selectedModel.value)}?mode=advanced` : '/designer?mode=advanced');
  } catch (err) {
    if (err instanceof ApiError) { saveError.value = err.message; message.error('Object could not be saved. Review the details shown on the page.'); }
    else if (err instanceof SyntaxError) { saveError.value = `Invalid JSON: ${err.message}`; message.error(saveError.value); }
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
interface EditableLine { table: string; refField: string; fields: string[]; aggregates?: EditableAggregate[]; actions?: FormAction[] }
const formLines = computed(() => {
  if (!artifact.value.lines) artifact.value.lines = [];
  return artifact.value.lines as EditableLine[];
});
const formActions = computed(() => {
  if (!artifact.value.actions) artifact.value.actions = [];
  return artifact.value.actions as FormAction[];
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
const selectedViews = computed({
  get: () => (artifact.value.views ?? []) as string[],
  set: (value: string[]) => { artifact.value.views = value; },
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
function back() { window.history.length > 1 ? router.back() : router.push({ path: '/designer', query: { mode: 'advanced', app: selectedApp.value, model: selectedModel.value } }); }
</script>

<template>
  <div class="designer-edit">
    <n-space class="designer-edit-heading" justify="space-between" style="margin-bottom: 16px">
      <h2 style="margin: 0">{{ isNew ? `New ${kind}` : `${kind}: ${name}` }}</h2>
      <n-space>
        <n-button @click="back">Back</n-button>
        <n-button type="primary" :loading="busy" :disabled="isSystemArtifact" data-testid="designer-save" @click="save">Save</n-button>
      </n-space>
    </n-space>

    <n-alert v-if="saveError" type="error" title="Object could not be saved" closable style="margin-bottom:16px;white-space:pre-line" @close="saveError=''">{{ saveError }}</n-alert>
    <n-alert v-if="legacyExtensionWarning" type="warning" title="Legacy extension name" style="margin-bottom:16px">{{ legacyExtensionWarning }}</n-alert>
    <n-alert v-if="isSystemArtifact" type="info" title="Framework — Read-only" style="margin-bottom:16px">System metadata can be inspected by a System Administrator, but cannot be edited, deleted, imported, exported, or extended.</n-alert>
    <n-tabs v-model:value="activeTab" type="line">
      <n-tab-pane v-if="DESIGN_KINDS.has(kind)" name="design" tab="Design">
        <n-form label-placement="top" style="max-width: 960px">
          <n-space vertical :size="12">
            <!-- Header: name, label, app selector -->
            <n-card size="small">
              <n-space :size="24" align="start">
                <n-form-item v-if="!isExtension" label="Name" required style="min-width: 240px">
                  <n-input v-model:value="(artifact.name as string)" :disabled="kind === 'app' ? !isNew : !isNew" placeholder="PascalCase" data-testid="artifact-name" />
                </n-form-item>
                <n-form-item v-else label="Name (automatic)" style="min-width: 240px">
                  <n-input :value="(artifact.name as string)" disabled placeholder="Select the object to extend" data-testid="artifact-name" />
                </n-form-item>
                <n-form-item v-if="!isExtension" label="Label" style="min-width: 240px">
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
                  <n-select v-model:value="(artifact.table as string)" :options="extensionTableOptions"
                    :disabled="kind === 'tableExtension' && !isNew" style="min-width: 220px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'formExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Form" required>
                  <n-select v-model:value="(artifact.form as string)" :options="extensionFormOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'menuExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Menu" required>
                  <n-select v-model:value="(artifact.menu as string)" :options="extensionMenuOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'enumExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Enum" required>
                  <n-select v-model:value="(artifact.enum as string)" :options="extensionEnumOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'privilegeExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Privilege" required>
                  <n-select v-model:value="(artifact.privilege as string)" :options="extensionPrivilegeOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'dutyExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Duty" required>
                  <n-select v-model:value="(artifact.duty as string)" :options="extensionDutyOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'roleExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Role" required>
                  <n-select v-model:value="(artifact.role as string)" :options="extensionRoleOptions" style="min-width: 260px" filterable />
                </n-form-item>
              </n-space>
              <n-space v-if="kind === 'scriptExtension'" :size="24" style="margin-top: 8px">
                <n-form-item label="Script" required>
                  <n-select v-model:value="(artifact.script as string)" :options="extensionScriptOptions" style="min-width: 260px" filterable />
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

            <!-- Function editor -->
            <n-card v-if="kind === 'function'" size="small" title="Function">
              <n-space vertical>
                <n-alert type="warning" title="High-risk executable code">
                  Functions run on the server. AI and MCP change sets cannot create or update functions.
                </n-alert>
                <n-form-item>
                  <p style="color: var(--n-text-color-3); font-size: 13px; margin: 0">
                    Write the function body. It receives <b>ctx</b>, <b>args</b>, <b>kernel</b>, and <b>services</b>,
                    registered as an action under this artifact's name, and callable from form/menu
                    Function targets or <b>POST /api/action/&lt;name&gt;</b>. The return value becomes the response.
                  </p>
                </n-form-item>
                <n-form-item label="Execution mode">
                  <n-select v-model:value="(artifact.executionMode as string)" :options="[
                    { label: 'Transactional — synchronous and atomic', value: 'transactional' },
                    { label: 'Async integration — supports await, HTTP and email', value: 'async' },
                  ]" />
                </n-form-item>
                <n-alert v-if="artifact.executionMode === 'async'" type="info">
                  Async functions do not keep one database transaction open while waiting for the network.
                </n-alert>
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
                <n-form-item label="App icon">
                  <n-select v-model:value="(artifact.icon as string)" :options="ICON_OPTIONS" clearable placeholder="Automatic monogram" />
                </n-form-item>
                <n-form-item>
                  <p style="color: var(--n-text-color-3); font-size: 13px; margin: 0">
                    After saving, create tables/forms/menus under this app to build its domain.
                    The app will appear as its own group in the sidebar.
                  </p>
                </n-form-item>
              </n-space>
            </n-card>

            <n-card v-if="kind === 'view'" size="small" title="Declarative query">
              <n-alert type="info" style="margin-bottom:12px">Views use validated metadata, equality joins, bound parameters, filters and aggregates. Raw SQL is not accepted.</n-alert>
              <ViewEditor :artifact="artifact" :tables="designer.catalog.tables" />
            </n-card>

            <n-card v-if="kind === 'chart'" size="small" title="Chart definition">
              <ChartEditor :artifact="artifact" :views="designer.catalog.views" />
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
              <n-card size="small" title="Filter columns (blank = list page columns)">
                <n-select v-model:value="(artifact.filterFields as string[])" :options="fieldOptionsForFormTable" multiple placeholder="list page columns" />
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

              <n-card size="small" title="Form header actions">
                <p style="color:var(--n-text-color-3);font-size:13px;margin-top:0">Reusable Function, Report, or Record Picker buttons shown at the top of the form.</p>
                <ActionsEditor :actions="formActions" :record-table="formTableName" />
              </n-card>

              <n-card size="small" title="Embedded charts">
                <FormChartsEditor :artifact="artifact" :charts="designer.catalog.charts" :views="designer.catalog.views" :fields="fieldOptionsForFormTable" />
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
                    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--emu-border)">
                      <h4 style="margin:0 0 8px">Line actions</h4>
                      <ActionsEditor :actions="actionsForLine(line)" :record-table="formTableName" :line-table="line.table" />
                    </div>
                  </n-card>
                </n-space>
                <n-button size="small" style="margin-top: 8px" @click="addLine">+ Add line grid</n-button>
              </n-card>
            </template>

            <!-- Menu items -->
            <n-card v-if="kind === 'menu' || kind === 'menuExtension'" size="small" title="Menu items">
              <p style="color: var(--n-text-color-3); font-size: 13px; margin: 0 0 8px">
                Choose Group, Form, Function, or Report for each item. Use "+ Sub-item" to build nested menus.
              </p>
              <MenuItemsEditor :items="menuItems" :form-options="formOptions" :report-options="reportOptions" :function-options="functionOptions" />
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
              <n-form-item label="Views">
                <n-select v-model:value="selectedViews" :options="viewOptions" multiple filterable />
              </n-form-item>
            </n-card>

            <n-card v-if="kind === 'duty' || kind === 'dutyExtension'" size="small" title="Privileges">
              <n-select v-model:value="selectedPrivileges" :options="privilegeOptions" multiple filterable />
            </n-card>

            <n-card v-if="kind === 'role' || kind === 'roleExtension'" size="small" title="Role grants">
              <n-alert v-if="artifact.name === 'FW_SystemAdminRole' || artifact.role === 'FW_SystemAdminRole'" type="warning" style="margin-bottom:12px">
                System administrators bypass all App Access, menu, form, data, Function, and Report restrictions.
              </n-alert>
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

<style scoped>
@media(max-width:700px){.designer-edit-heading{display:block!important}.designer-edit-heading h2{font-size:21px;overflow-wrap:anywhere}.designer-edit-heading>.n-space{display:grid!important;grid-template-columns:1fr 1fr;margin-top:12px}.designer-edit-heading :deep(.n-button){width:100%;min-height:44px}.designer-edit :deep(.n-card__content){padding:14px}.designer-edit :deep(.n-space:not(.n-space--vertical)){flex-wrap:wrap!important;width:100%}.designer-edit :deep(.n-form-item){width:100%!important;min-width:0!important}.designer-edit :deep(.n-select),.designer-edit :deep(.n-input),.designer-edit :deep(.n-input-number){width:100%!important;min-width:0!important;max-width:100%}.designer-edit :deep(.n-table){display:block;max-width:100%;overflow-x:auto}.designer-edit :deep(.n-table table){min-width:560px}.designer-edit :deep(.n-button){min-height:40px}.designer-edit :deep(.n-card-header){flex-wrap:wrap}}
</style>
