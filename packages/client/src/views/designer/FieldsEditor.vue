<script setup lang="ts">
import { NAlert, NButton, NCard, NCheckbox, NFormItem, NInput, NSelect, NSpace } from 'naive-ui';
import { computed } from 'vue';
import { useMeta } from '../../stores/meta';

export interface EditableField {
  name: string;
  type: string;
  label?: string;
  mandatory?: boolean;
  readOnly?: boolean;
  allowEdit?: boolean;
  allowEditOnCreate?: boolean;
  enumName?: string;
  reference?: { table: string; displayField?: string; displayFields?: string[]; onDelete?: 'restrict' | 'cascade' | 'setNull'; filters?: { field: string; operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains'; value: string }[]; copyFields?: { from: string; to: string }[] };
}

const props = defineProps<{ fields: EditableField[] }>();
const meta = useMeta();

function fieldOptionsFor(tableName: string) {
  return (meta.table(tableName)?.fields ?? []).map((f) => ({ label: f.name, value: f.name }));
}
function addCopyField(field: EditableField) {
  if (!field.reference) return;
  if (!field.reference.copyFields) field.reference.copyFields = [];
  field.reference.copyFields.push({ from: '', to: '' });
}
function removeCopyField(field: EditableField, i: number) {
  field.reference?.copyFields?.splice(i, 1);
}
function addFilter(field: EditableField) { field.reference?.filters?.push({ field: '', operator: 'eq', value: '' }) ?? (field.reference!.filters = [{ field: '', operator: 'eq', value: '' }]); }
const DELETE_OPTIONS = ['restrict', 'cascade', 'setNull'].map((value) => ({ label: value, value }));
const FILTER_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'].map((value) => ({ label: value, value }));

const TYPE_OPTIONS = ['string', 'int', 'real', 'boolean', 'date', 'datetime', 'enum', 'reference'].map(
  (t) => ({ label: t, value: t }),
);

const enumOptions = computed(() =>
  (meta.meta?.enums ?? []).map((e) => ({ label: e.name, value: e.name })),
);
const tableOptions = computed(() =>
  (meta.meta?.tables ?? []).map((t) => ({ label: t.name, value: t.name })),
);

function addField() {
  props.fields.push({ name: '', type: 'string' });
}

function removeField(i: number) {
  props.fields.splice(i, 1);
}

function onTypeChange(field: EditableField) {
  if (field.type !== 'enum') delete field.enumName;
  if (field.type !== 'reference') delete field.reference;
  if (field.type === 'reference' && !field.reference) field.reference = { table: '' };
}

function fieldIssues(field: EditableField): string[] {
  const issues: string[] = [];
  if (!field.name.trim()) issues.push('Field name is required.');
  if (field.type === 'enum' && !field.enumName) issues.push('Select an enum.');
  if (field.type === 'reference' && !field.reference?.table) issues.push('Select the related table.');
  if (field.mandatory && field.reference?.onDelete === 'setNull') issues.push('Required references cannot use Set null.');
  return issues;
}
</script>

<template>
  <n-space vertical :size="14">
    <n-card v-for="(field, i) in fields" :key="i" size="small" class="field-card">
      <template #header><span>Field {{ i + 1 }} <small v-if="field.name">— {{ field.name }}</small></span></template>
      <template #header-extra><n-button size="tiny" quaternary type="error" @click="removeField(i)">Remove</n-button></template>
      <div class="field-main-grid">
        <n-form-item label="Field name" required><n-input v-model:value="field.name" placeholder="fieldName" /></n-form-item>
        <n-form-item label="Type" required><n-select v-model:value="field.type" :options="TYPE_OPTIONS" @update:value="onTypeChange(field)" /></n-form-item>
        <n-form-item label="Display label"><n-input v-model:value="field.label" placeholder="Optional label" /></n-form-item>
      </div>

      <div class="field-options">
        <div><n-checkbox :checked="field.mandatory === true" @update:checked="(v: boolean) => (field.mandatory = v || undefined)">Required</n-checkbox><small>Value cannot be empty.</small></div>
        <div><n-checkbox :checked="field.readOnly === true" @update:checked="(v: boolean) => (field.readOnly = v || undefined)">Read only</n-checkbox><small>Blocks editing during create and update.</small></div>
        <div><n-checkbox :checked="!field.readOnly && field.allowEdit !== false" :disabled="field.readOnly" @update:checked="(v: boolean) => (field.allowEdit = v ? undefined : false)">Allow edit</n-checkbox><small>User may change an existing record.</small></div>
        <div><n-checkbox :checked="!field.readOnly && field.allowEditOnCreate !== false" :disabled="field.readOnly" @update:checked="(v: boolean) => (field.allowEditOnCreate = v ? undefined : false)">Allow edit on create</n-checkbox><small>User may enter a value on a new record.</small></div>
      </div>

      <n-form-item v-if="field.type === 'enum'" label="Enum" required class="special-setting">
        <n-select v-model:value="field.enumName" :options="enumOptions" placeholder="Select enum" filterable />
      </n-form-item>

      <n-card v-if="field.type === 'reference' && field.reference" size="small" class="relation-card" title="Relation settings">
        <p class="help">This field stores the selected record ID. Configure what users see, which records are selectable, and what happens when the related record is deleted.</p>
        <div class="relation-grid">
          <n-form-item label="Related table" required><n-select v-model:value="field.reference.table" :options="tableOptions" placeholder="Select table" filterable /></n-form-item>
          <n-form-item label="Display fields"><n-select v-model:value="field.reference.displayFields" :options="fieldOptionsFor(field.reference.table)" multiple clearable placeholder="Fields shown in lookup" /></n-form-item>
          <n-form-item label="On delete"><n-select v-model:value="field.reference.onDelete" :options="DELETE_OPTIONS.map((o) => ({ ...o, disabled: o.value === 'setNull' && field.mandatory }))" placeholder="Restrict (default)" clearable /></n-form-item>
        </div>
        <p class="on-delete-help"><b>Restrict:</b> block deletion · <b>Cascade:</b> delete child records · <b>Set null:</b> clear this field</p>
        <h4>Lookup filters</h4>
        <div v-for="(filter, fi) in field.reference.filters ?? []" :key="`filter-${fi}`" class="setting-row">
          <n-select v-model:value="filter.field" :options="fieldOptionsFor(field.reference.table)" placeholder="Field" filterable />
          <n-select v-model:value="filter.operator" :options="FILTER_OPERATORS" style="width:110px" />
          <n-input v-model:value="filter.value" placeholder="Value" />
          <n-button quaternary type="error" @click="field.reference.filters!.splice(fi, 1)">Remove</n-button>
        </div>
        <n-button size="small" @click="addFilter(field)">+ Lookup filter</n-button>
        <h4>Copy fields after selection</h4>
        <div v-for="(cf, ci) in field.reference.copyFields ?? []" :key="ci" class="setting-row">
          <n-select v-model:value="cf.from" :options="fieldOptionsFor(field.reference.table)" placeholder="Source field" filterable />
          <span>→</span>
          <n-select v-model:value="cf.to" :options="fields.map((f) => ({ label: f.name, value: f.name }))" placeholder="Destination field" filterable />
          <n-button quaternary type="error" @click="removeCopyField(field, ci)">Remove</n-button>
        </div>
        <n-button size="small" @click="addCopyField(field)">+ Copy field</n-button>
      </n-card>
      <n-alert v-if="fieldIssues(field).length" type="warning" title="Check this field" style="margin-top:12px">{{ fieldIssues(field).join(' ') }}</n-alert>
    </n-card>
  </n-space>
  <n-button size="small" style="margin-top: 8px" data-testid="add-field" @click="addField">
    + Add field
  </n-button>
</template>

<style scoped>
.field-card{border:1px solid var(--emu-border)}.field-card small{color:var(--emu-muted);font-weight:400}.field-main-grid,.relation-grid{display:grid;grid-template-columns:1.1fr .8fr 1.1fr;gap:16px}.field-options{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:12px;padding:14px 16px;margin:0 0 16px;background:#f8fafc;border:1px solid var(--emu-border);border-radius:10px}.field-options small{display:block;margin:4px 0 0 24px;line-height:1.35}.relation-card{margin-top:8px;background:#fbfdff}.help,.on-delete-help{color:var(--emu-muted);font-size:13px;line-height:1.5;margin:0 0 14px}.relation-card h4{margin:16px 0 8px}.setting-row{display:grid;grid-template-columns:minmax(150px,1fr) 110px minmax(150px,1fr) auto;align-items:center;gap:8px;margin-bottom:8px}.special-setting{max-width:420px}@media(max-width:850px){.field-main-grid,.relation-grid,.field-options{grid-template-columns:1fr 1fr}.setting-row{grid-template-columns:1fr 1fr}.setting-row>span{display:none}}@media(max-width:560px){.field-main-grid,.relation-grid,.field-options,.setting-row{grid-template-columns:1fr}}
</style>
