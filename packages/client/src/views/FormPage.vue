<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRouter } from 'vue-router';
import {
  NButton,
  NAlert,
  NCard,
  NForm,
  NFormItem,
  NGrid,
  NGridItem,
  NSpace,
  useDialog,
  useMessage,
} from 'naive-ui';
import { api, ApiError, type Row } from '../api';
import { useMeta } from '../stores/meta';
import FieldControl from '../components/FieldControl.vue';
import LineGrid from '../components/LineGrid.vue';
import { applyIfBlank } from '../utils/applyDefaults';
import ActionDialog from '../components/ActionDialog.vue';
import type { FormAction } from '@emu/core';

const props = defineProps<{ formName: string; id: string; appName?: string }>();
const router = useRouter();
const meta = useMeta();
const message = useMessage();
const dialog = useDialog();

const record = ref<Record<string, unknown>>({});
const original = ref('');
const busy = ref(false);
const validationErrors = ref<string[]>([]);
const selectedAction = ref<FormAction | null>(null);
const actionDialogOpen = ref(false);

const isNew = computed(() => props.id === 'new');
const appPrefix = computed(() => props.appName ? `/app/${props.appName}` : '');
const form = computed(() => meta.form(props.formName));
const table = computed(() => (form.value ? meta.table(form.value.table) : undefined));
const dirty = computed(() => JSON.stringify(record.value) !== original.value);

const groups = computed(() => {
  if (!form.value || !table.value) return [];
  return (
    form.value.groups ?? [{ label: undefined, fields: table.value.fields.map((f) => f.name) }]
  ).map((g) => ({
    label: g.label,
    fields: g.fields
      .map((n) => table.value!.fields.find((f) => f.name === n))
      .filter((f): f is NonNullable<typeof f> => f !== undefined),
  }));
});

async function load() {
  if (!table.value) return;
  record.value = isNew.value
    ? {}
    : await api.get<Row>(`/api/data/${table.value.name}/${props.id}`);
  original.value = JSON.stringify(record.value);
  validationErrors.value = [];
}

watch(() => [props.formName, props.id], load, { immediate: true });

async function save() {
  if (!table.value) return;
  validationErrors.value = table.value.fields
    .filter((field) => field.mandatory && (record.value[field.name] === undefined || record.value[field.name] === null || record.value[field.name] === ''))
    .map((field) => `${field.label ?? field.name} is required.`);
  if (validationErrors.value.length) return;
  busy.value = true;
  try {
    if (isNew.value) {
      const created = await api.post<Row>(`/api/data/${table.value.name}`, record.value);
      message.success('Created');
      record.value = created;
      original.value = JSON.stringify(created);
      router.replace(`${appPrefix.value}/form/${props.formName}/${created.id}`);
    } else {
      record.value = await api.patch<Row>(
        `/api/data/${table.value.name}/${props.id}`,
        record.value,
      );
      message.success('Saved');
    }
    original.value = JSON.stringify(record.value);
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  } finally {
    busy.value = false;
  }
}

function goBack() { window.history.length > 1 ? router.back() : router.push(`${appPrefix.value}/form/${props.formName}`); }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value) event.preventDefault(); }
onMounted(() => window.addEventListener('beforeunload', beforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload));
onBeforeRouteLeave(() => !dirty.value || window.confirm('You have unsaved changes. Leave without saving?'));

function runAction(action: FormAction) { selectedAction.value = action; actionDialogOpen.value = true; }

function applyRelated(patch: Record<string, unknown>) {
  applyIfBlank(record.value, patch);
}

function remove() {
  dialog.warning({
    title: 'Delete record',
    content: 'Delete this record?',
    positiveText: 'Delete',
    negativeText: 'Cancel',
    onPositiveClick: async () => {
      try {
        await api.delete(`/api/data/${table.value!.name}/${props.id}`);
        message.success('Deleted');
        router.push(`${appPrefix.value}/form/${props.formName}`);
      } catch (err) {
        if (err instanceof ApiError) message.error(err.message);
        else throw err;
      }
    },
  });
}
</script>

<template>
  <div v-if="form && table" class="form-page">
    <div class="form-actionbar">
      <div><h1>
        {{ form.label ?? form.name }} — {{ isNew ? 'New' : `#${id}` }}
      </h1><p>{{ dirty ? 'Unsaved changes' : 'All changes saved' }}</p></div>
      <n-space>
        <n-button
          v-for="act in (form.actions ?? []).filter((action) => !isNew || action.showOnCreate)"
          :key="act.target ?? act.action"
          :loading="busy"
          :disabled="act.disabled"
          :data-testid="`action-${act.target ?? act.action}`"
          @click="runAction(act)"
        >
          {{ act.label }}
        </n-button>
        <n-button v-if="!isNew" quaternary type="error" data-testid="delete-record" @click="remove">
          Delete
        </n-button>
        <n-button @click="goBack">Back</n-button>
        <n-button type="primary" :loading="busy" data-testid="save-record" @click="save">
          Save
        </n-button>
      </n-space>
    </div>

    <n-alert v-if="validationErrors.length" type="error" title="Check the highlighted information" style="margin-bottom:16px">
      <ul class="error-list"><li v-for="error in validationErrors" :key="error">{{ error }}</li></ul>
    </n-alert>

    <n-form label-placement="top">
      <n-space vertical :size="16">
        <n-card v-for="(group, gi) in groups" :key="gi" :title="group.label" size="small">
          <n-grid cols="1 700:2" responsive="self" :x-gap="24">
            <n-grid-item v-for="field in group.fields" :key="field.name">
              <n-form-item :label="field.label ?? field.name" :required="field.mandatory">
                <FieldControl
                  :field="field"
                  :create-mode="isNew"
                  :record="record"
                  :record-table="table.name"
                  :model-value="record[field.name]"
                  @update:model-value="(v) => (record[field.name] = v)"
                  @update:related="applyRelated"
                />
              </n-form-item>
            </n-grid-item>
          </n-grid>
        </n-card>

        <template v-if="!isNew">
          <LineGrid
            v-for="line in form.lines ?? []"
            :key="line.table"
            :line="line"
            :header-id="Number(id)"
            :header-record="record"
          />
        </template>
      </n-space>
    </n-form>
    <ActionDialog v-model:show="actionDialogOpen" :action="selectedAction" :record-id="isNew ? undefined : Number(id)" :record="record" @completed="load" />
  </div>
</template>

<style scoped>
.form-page{max-width:1440px;margin:0 auto}.form-actionbar{position:sticky;top:12px;z-index:4;display:flex;justify-content:space-between;align-items:center;gap:20px;margin:0 0 24px;padding:18px 20px;background:rgba(255,255,255,.96);backdrop-filter:blur(8px);border:1px solid var(--emu-border);border-radius:12px;box-shadow:var(--emu-shadow-sm)}.form-actionbar h1{font-size:25px;margin:0}.form-actionbar p{margin:5px 0 0;color:var(--emu-muted);font-size:12px}.form-page :deep(.n-card__content){padding:20px}.form-page :deep(.n-form-item){margin-bottom:18px}.error-list{margin:4px 0;padding-left:20px}@media(max-width:700px){.form-actionbar{position:static;display:block;margin:0 0 16px;padding:16px}.form-actionbar>.n-space{margin-top:14px;flex-wrap:wrap!important}.form-page :deep(.n-card__content){padding:16px}}
</style>
