<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NCheckbox, NInput, NSelect, NSpace, NTable } from 'naive-ui';
import type { Artifact } from '../../stores/designer';
import { useDesigner } from '../../stores/designer';
import { t } from '../../i18n';
import {
  appLabelKey, artifactLabelKey, enumLabelKey, enumValueLabelKey, formActionLabelKey, formGroupLabelKey,
  formLabelKey, formLineActionLabelKey, formLineLabelKey, menuItemLabelKey, menuLabelKey, modelLabelKey,
  normalizeLocale, reportElementTextKey, reportParameterLabelKey, tableFieldLabelKey, tableLabelKey,
} from '@emu/core/browser';

export interface TranslationRow {
  key: string;
  category: string;
  target: string;
  defaultText: string;
}

const props = defineProps<{ artifact: Artifact; app: string; model: string }>();
const designer = useDesigner();

const localeError = ref('');
const search = ref('');
const untranslatedOnly = ref(false);
const showKeys = ref(false);
const categoryFilter = ref<string | null>(null);
const /** working copy: key → edited value (empty string means "do not override") */
  values = ref<Record<string, string>>({});

const locale = computed(() => String(props.artifact.locale ?? ''));

watch(locale, () => {
  try { normalizeLocale(locale.value, 'locale'); localeError.value = ''; }
  catch (error) { localeError.value = (error as Error).message; }
}, { immediate: true });

function walkMenuItems(items: Array<Record<string, any>>, menuName: string, rows: TranslationRow[]): void {
  for (const item of items ?? []) {
    if (item.id) rows.push({ key: menuItemLabelKey(menuName, item.id), category: 'menu', target: `${menuName} › ${item.id}`, defaultText: String(item.label ?? item.id) });
    if (Array.isArray(item.items)) walkMenuItems(item.items, menuName, rows);
  }
}

/** Builds the editable key list from real catalog metadata using the same key
 * builders as the runtime resolver, so Designer and Server can never disagree. */
const rows = computed<TranslationRow[]>(() => {
  const app = props.app;
  if (!app) return [];
  const inScope = (entry: Artifact) => String((entry as any).app ?? '') === app && (!props.model || String((entry as any).model ?? '') === props.model || !(entry as any).model);
  const out: TranslationRow[] = [];
  const appEntry = designer.apps.find((entry) => entry.name === app);
  out.push({ key: appLabelKey(app), category: 'app', target: app, defaultText: appEntry?.label ?? app });
  for (const model of appEntry?.models ?? []) {
    if (props.model && model.name !== props.model) continue;
    out.push({ key: modelLabelKey(app, model.name), category: 'app', target: `${app} › ${model.name}`, defaultText: model.label ?? model.name });
  }
  for (const table of designer.catalog.tables.filter(inScope)) {
    out.push({ key: tableLabelKey(table.name), category: 'table', target: table.name, defaultText: String(table.label ?? table.name) });
    for (const field of (table as any).fields ?? []) {
      out.push({ key: tableFieldLabelKey(table.name, field.name), category: 'table', target: `${table.name} › ${field.name}`, defaultText: String(field.label ?? field.name) });
    }
  }
  for (const entry of designer.catalog.enums.filter(inScope)) {
    out.push({ key: enumLabelKey(entry.name), category: 'enum', target: entry.name, defaultText: String(entry.label ?? entry.name) });
    for (const value of (entry as any).values ?? []) {
      out.push({ key: enumValueLabelKey(entry.name, value.name), category: 'enum', target: `${entry.name} › ${value.name}`, defaultText: String(value.label ?? value.name) });
    }
  }
  for (const form of designer.catalog.forms.filter(inScope)) {
    out.push({ key: formLabelKey(form.name), category: 'form', target: form.name, defaultText: String(form.label ?? form.name) });
    for (const group of (form as any).groups ?? []) {
      if (group.id) out.push({ key: formGroupLabelKey(form.name, group.id), category: 'form', target: `${form.name} › ${group.label ?? group.id}`, defaultText: String(group.label ?? group.id) });
    }
    for (const action of (form as any).actions ?? []) {
      if (action.id) out.push({ key: formActionLabelKey(form.name, action.id), category: 'form', target: `${form.name} › ${action.label ?? action.id}`, defaultText: String(action.label ?? action.id) });
    }
    for (const line of (form as any).lines ?? []) {
      if (!line.id) continue;
      out.push({ key: formLineLabelKey(form.name, line.id), category: 'form', target: `${form.name} › ${line.label ?? line.id}`, defaultText: String(line.label ?? line.id) });
      for (const action of line.actions ?? []) {
        if (action.id) out.push({ key: formLineActionLabelKey(form.name, line.id, action.id), category: 'form', target: `${form.name} › ${line.label ?? line.id} › ${action.label ?? action.id}`, defaultText: String(action.label ?? action.id) });
      }
    }
  }
  for (const menu of designer.catalog.menus.filter(inScope)) {
    out.push({ key: menuLabelKey(menu.name), category: 'menu', target: menu.name, defaultText: String(menu.label ?? menu.name) });
    walkMenuItems((menu as any).items ?? [], menu.name, out);
  }
  for (const report of designer.catalog.reports.filter(inScope)) {
    out.push({ key: artifactLabelKey('report', report.name), category: 'report', target: report.name, defaultText: String(report.label ?? report.name) });
    for (const parameter of (report as any).parameters ?? []) {
      out.push({ key: reportParameterLabelKey(report.name, parameter.field), category: 'report', target: `${report.name} › ${parameter.field}`, defaultText: String(parameter.label ?? parameter.field) });
    }
    for (const band of [...((report as any).bands ?? []), ...((report as any).lineSources ?? []).flatMap((source: any) => source.bands ?? [])]) {
      for (const element of band.elements ?? []) {
        if (element.type === 'text') out.push({ key: reportElementTextKey(report.name, element.id), category: 'report', target: `${report.name} › ${element.id}`, defaultText: String(element.text ?? element.id) });
      }
    }
  }
  const simpleKinds: Array<{ list: string; kind: 'view' | 'chart' | 'privilege' | 'duty' | 'role' | 'dataEntity' }> = [
    { list: 'views', kind: 'view' }, { list: 'charts', kind: 'chart' }, { list: 'privileges', kind: 'privilege' },
    { list: 'duties', kind: 'duty' }, { list: 'roles', kind: 'role' }, { list: 'dataEntities', kind: 'dataEntity' },
  ];
  for (const { list, kind } of simpleKinds) {
    for (const entry of (designer.catalog as any)[list]?.filter(inScope) ?? []) {
      out.push({ key: artifactLabelKey(kind, entry.name), category: kind, target: entry.name, defaultText: String(entry.label ?? entry.name) });
    }
  }
  return out;
});

const rowByKey = computed(() => new Map(rows.value.map((row) => [row.key, row])));
/** Saved keys that no longer match a live target in this app/model. */
const staleKeys = computed(() => Object.keys(values.value).filter((key) => values.value[key] !== '' && !rowByKey.value.has(key)));
const categories = computed(() => [...new Set(rows.value.map((row) => row.category))].sort());
const filteredRows = computed(() => rows.value.filter((row) => {
  if (categoryFilter.value && row.category !== categoryFilter.value) return false;
  if (untranslatedOnly.value && values.value[row.key]) return false;
  if (search.value) {
    const needle = search.value.toLowerCase();
    if (!row.target.toLowerCase().includes(needle) && !row.defaultText.toLowerCase().includes(needle) && !row.key.toLowerCase().includes(needle)) return false;
  }
  return true;
}));
const translatedCount = computed(() => rows.value.filter((row) => values.value[row.key]).length);

function loadValues() {
  values.value = { ...((props.artifact.resources as Record<string, string>) ?? {}) };
}
watch(() => props.artifact.name, loadValues, { immediate: true });
watch(values, () => {
  // Empty cells mean "do not override": such keys are dropped from resources.
  const resources: Record<string, string> = {};
  for (const [key, value] of Object.entries(values.value)) {
    if (value !== '') resources[key] = value;
  }
  props.artifact.resources = resources;
}, { deep: true });

function autoFillUntranslated() {
  for (const row of rows.value) {
    if (!values.value[row.key]) values.value[row.key] = row.defaultText;
  }
}
</script>

<template>
  <n-space vertical :size="12">
    <n-alert v-if="localeError" type="error" :show-icon="true">{{ localeError }}</n-alert>
    <n-alert v-if="staleKeys.length" type="warning" :title="t('ui.designer.translation.staleKeys')" :show-icon="true">
      <div v-for="key in staleKeys" :key="key" class="stale-key">
        <span class="key-text">{{ key }}</span>
        <n-button size="tiny" quaternary type="error" @click="values[key] = ''">{{ t('ui.common.delete') }}</n-button>
      </div>
    </n-alert>
    <n-space align="center" wrap>
      <n-input v-model:value="search" :placeholder="t('ui.common.search')" clearable style="width: 240px" />
      <n-select v-model:value="categoryFilter" :options="categories.map((category) => ({ label: category, value: category }))" clearable :placeholder="t('ui.designer.translation.allCategories')" style="width: 180px" />
      <n-checkbox v-model:checked="untranslatedOnly">{{ t('ui.designer.translation.showUntranslated') }}</n-checkbox>
      <n-checkbox v-model:checked="showKeys">{{ t('ui.designer.translation.resourceKey') }}</n-checkbox>
      <span class="counter">{{ translatedCount }}/{{ rows.length }}</span>
      <n-button size="small" @click="autoFillUntranslated">{{ t('ui.designer.translation.copyDefaults') }}</n-button>
    </n-space>
    <div v-if="!rows.length" class="empty">{{ t('ui.designer.translation.empty') }}</div>
    <n-table v-else size="small" :bordered="false" class="translation-table">
      <thead>
        <tr>
          <th style="min-width:220px">{{ t('ui.designer.translation.target') }}</th>
          <th style="min-width:180px">{{ t('ui.designer.translation.defaultText') }}</th>
          <th style="min-width:220px">{{ t('ui.designer.translation.translation') }}</th>
          <th style="width:110px">{{ t('ui.designer.translation.status') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="row.key" data-testid="translation-row">
          <td>
            <div class="target-text">{{ row.target }}</div>
            <div v-if="showKeys" class="key-text">{{ row.key }}</div>
          </td>
          <td class="default-text">{{ row.defaultText }}</td>
          <td><n-input v-model:value="values[row.key]" size="small" :placeholder="row.defaultText" :data-testid="`translation-input-${row.key}`" /></td>
          <td>
            <span v-if="values[row.key]" class="status translated">{{ t('ui.designer.translation.translated') }}</span>
            <span v-else class="status">{{ t('ui.designer.translation.untranslated') }}</span>
          </td>
        </tr>
      </tbody>
    </n-table>
  </n-space>
</template>

<style scoped>
.translation-table :deep(.n-table-th) { background: #f8fafc; }
.target-text{font-weight:600;overflow-wrap:anywhere}
.default-text{color:var(--emu-muted)}
.key-text{color:var(--emu-muted);font:11px/1.4 ui-monospace,monospace;overflow-wrap:anywhere;margin-top:3px}
.stale-key{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:3px 0}
.status{font-size:12px;color:var(--emu-muted)}
.status.translated{color:var(--emu-primary);font-weight:700}
.counter{color:var(--emu-muted);font-size:13px}
.empty{color:var(--emu-muted);padding:16px 0}
@media (max-width:700px){.translation-table :deep(table){min-width:560px}.translation-table{display:block;overflow-x:auto}}
</style>
