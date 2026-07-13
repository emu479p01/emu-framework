<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { NInput, NInputNumber, NSwitch, NSelect, NDatePicker, NTooltip, type SelectOption } from 'naive-ui';
import { api, type Row } from '../api';
import { useMeta, type FieldMeta } from '../stores/meta';

const props = defineProps<{
  field: FieldMeta;
  modelValue: unknown;
  disabled?: boolean;
  createMode?: boolean;
  record?: Record<string, unknown>;
  recordTable?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: unknown]; 'update:related': [patch: Record<string, unknown>] }>();

const meta = useMeta();
const refOptions = ref<SelectOption[]>([]);

const isDisabled = computed(() => props.disabled || props.field.readOnly || (props.createMode ? props.field.allowEditOnCreate === false : props.field.allowEdit === false));

const enumOptions = computed<SelectOption[]>(() => {
  if (props.field.type !== 'enum' || !props.field.enumName) return [];
  const e = meta.enumOf(props.field.enumName);
  return (e?.values ?? []).map((v) => ({ label: v.label ?? v.name, value: v.value }));
});

let lookupRequest = 0;
async function loadReferenceOptions() {
  const request = ++lookupRequest;
  if (props.field.type === 'reference' && props.field.reference) {
    const refTable = meta.table(props.field.reference.table);
    const displays = props.field.reference.displayFields ?? [props.field.reference.displayField ?? refTable?.titleField ?? 'id'];
    const params: Record<string, string | number> = { limit: 500 };
    for (const filter of props.field.reference.filters ?? []) {
      let value: unknown = filter.value;
      if (typeof value === 'object' && value !== null && 'source' in value) {
        const dynamicValue = value as { source: 'record'; field: string } | { source: 'lookup'; field: string; lookupField: string };
        const selected = props.record?.[dynamicValue.field];
        if (selected === undefined || selected === null || selected === '') {
          if (request === lookupRequest) refOptions.value = [];
          return;
        }
        if (dynamicValue.source === 'record') value = selected;
        else {
          const sourceField = meta.field(props.recordTable ?? '', dynamicValue.field);
          if (sourceField?.type !== 'reference' || !sourceField.reference) {
            if (request === lookupRequest) refOptions.value = [];
            return;
          }
          const sourceRecord = await api.get<Row>(`/api/data/${sourceField.reference.table}/${selected}`);
          value = sourceRecord[dynamicValue.lookupField];
        }
      }
      params[`filter.${filter.field}.${filter.operator}`] = String(value ?? '');
    }
    const { data } = await api.list(props.field.reference.table, params);
    if (request !== lookupRequest) return;
    refOptions.value = data.map((row) => ({
      label: displays.map((field) => String(row[field] ?? '')).join(' | '),
      value: row.id,
    }));
  }
}
watch(
  [() => props.field, () => JSON.stringify(props.record ?? {})],
  loadReferenceOptions,
  { immediate: true, deep: true },
);

function update(value: unknown) {
  emit('update:modelValue', value);
}

async function onReferenceChange(value: unknown) {
  update(value);
  const copyFields = props.field.reference?.copyFields;
  if (copyFields && copyFields.length > 0 && value != null) {
    const rec = await api.get<Row>(`/api/data/${props.field.reference!.table}/${value}`);
    const patch: Record<string, unknown> = {};
    for (const cf of copyFields) patch[cf.to] = rec[cf.from];
    emit('update:related', patch);
  }
}

function renderLookupLabel(option: SelectOption) {
  const label = String(option.label ?? '');
  return h(NTooltip, null, { trigger: () => h('span', { class: 'lookup-label' }, label), default: () => label });
}
</script>

<template>
  <n-input
    v-if="field.type === 'string'"
    :type="field.name.toLowerCase().includes('password') ? 'password' : 'text'"
    :show-password-on="field.name.toLowerCase().includes('password') ? 'click' : undefined"
    :value="(modelValue as string | null)"
    :disabled="isDisabled"
    :maxlength="field.maxLength"
    @update:value="update"
  />
  <n-input-number
    v-else-if="field.type === 'int' || field.type === 'real'"
    :value="(modelValue as number | null)"
    :precision="field.type === 'int' ? 0 : undefined"
    :disabled="isDisabled"
    style="width: 100%"
    @update:value="update"
  />
  <n-switch
    v-else-if="field.type === 'boolean'"
    :value="Boolean(modelValue)"
    :disabled="isDisabled"
    @update:value="update"
  />
  <n-select
    v-else-if="field.type === 'enum'"
    :value="(modelValue as number | null)"
    :options="enumOptions"
    :disabled="isDisabled"
    @update:value="update"
  />
  <n-select
    v-else-if="field.type === 'reference'"
    :value="(modelValue as number | null)"
    :options="refOptions"
    :render-label="renderLookupLabel"
    filterable
    :disabled="isDisabled"
    @update:value="onReferenceChange"
  />
  <n-date-picker
    v-else-if="field.type === 'date'"
    :formatted-value="(modelValue as string | null)"
    value-format="yyyy-MM-dd"
    type="date"
    :disabled="isDisabled"
    style="width: 100%"
    clearable
    @update:formatted-value="update"
  />
  <n-date-picker
    v-else-if="field.type === 'datetime'"
    :formatted-value="(modelValue as string | null)"
    value-format="yyyy-MM-dd'T'HH:mm:ss"
    type="datetime"
    :disabled="isDisabled"
    style="width: 100%"
    clearable
    @update:formatted-value="update"
  />
  <n-input v-else :value="String(modelValue ?? '')" :disabled="isDisabled" @update:value="update" />
</template>

<style scoped>.lookup-label{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style>
