<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { NInput, NInputNumber, NSwitch, NSelect, NDatePicker, type SelectOption } from 'naive-ui';
import { api, type Row } from '../api';
import { useMeta, type FieldMeta } from '../stores/meta';

const props = defineProps<{
  field: FieldMeta;
  modelValue: unknown;
  disabled?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: unknown]; 'update:related': [patch: Record<string, unknown>] }>();

const meta = useMeta();
const refOptions = ref<SelectOption[]>([]);

const isDisabled = computed(() => props.disabled || props.field.readOnly);

const enumOptions = computed<SelectOption[]>(() => {
  if (props.field.type !== 'enum' || !props.field.enumName) return [];
  const e = meta.enumOf(props.field.enumName);
  return (e?.values ?? []).map((v) => ({ label: v.label ?? v.name, value: v.value }));
});

onMounted(async () => {
  if (props.field.type === 'reference' && props.field.reference) {
    const refTable = meta.table(props.field.reference.table);
    const display = props.field.reference.displayField ?? refTable?.titleField ?? 'id';
    const { data } = await api.list(props.field.reference.table, { limit: 500 });
    refOptions.value = data.map((row) => ({
      label: String(row[display] ?? row.id),
      value: row.id,
    }));
  }
});

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
</script>

<template>
  <n-input
    v-if="field.type === 'string'"
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
