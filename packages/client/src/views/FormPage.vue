<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  NButton,
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

const props = defineProps<{ formName: string; id: string; appName?: string }>();
const router = useRouter();
const meta = useMeta();
const message = useMessage();
const dialog = useDialog();

const record = ref<Record<string, unknown>>({});
const busy = ref(false);

const isNew = computed(() => props.id === 'new');
const appPrefix = computed(() => props.appName ? `/app/${props.appName}` : '');
const form = computed(() => meta.form(props.formName));
const table = computed(() => (form.value ? meta.table(form.value.table) : undefined));

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
}

watch(() => [props.formName, props.id], load, { immediate: true });

async function save() {
  if (!table.value) return;
  busy.value = true;
  try {
    if (isNew.value) {
      const created = await api.post<Row>(`/api/data/${table.value.name}`, record.value);
      message.success('Created');
      router.replace(`${appPrefix.value}/form/${props.formName}/${created.id}`);
    } else {
      record.value = await api.patch<Row>(
        `/api/data/${table.value.name}/${props.id}`,
        record.value,
      );
      message.success('Saved');
    }
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  } finally {
    busy.value = false;
  }
}

async function runAction(action: string) {
  busy.value = true;
  try {
    await api.post(`/api/action/${action}`, { id: Number(props.id) });
    message.success(`${action} completed`);
    await load();
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  } finally {
    busy.value = false;
  }
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
  <div v-if="form && table">
    <n-space justify="space-between" style="margin-bottom: 16px">
      <h2 style="margin: 0">
        {{ form.label ?? form.name }} — {{ isNew ? 'New' : `#${id}` }}
      </h2>
      <n-space>
        <n-button
          v-for="act in isNew ? [] : (form.actions ?? [])"
          :key="act.action"
          :loading="busy"
          :data-testid="`action-${act.action}`"
          @click="runAction(act.action)"
        >
          {{ act.label }}
        </n-button>
        <n-button v-if="!isNew" quaternary type="error" data-testid="delete-record" @click="remove">
          Delete
        </n-button>
        <n-button @click="router.push(`${appPrefix}/form/${formName}`)">Back</n-button>
        <n-button type="primary" :loading="busy" data-testid="save-record" @click="save">
          Save
        </n-button>
      </n-space>
    </n-space>

    <n-form label-placement="top">
      <n-space vertical :size="16">
        <n-card v-for="(group, gi) in groups" :key="gi" :title="group.label" size="small">
          <n-grid :cols="2" :x-gap="24">
            <n-grid-item v-for="field in group.fields" :key="field.name">
              <n-form-item :label="field.label ?? field.name" :required="field.mandatory">
                <FieldControl
                  :field="field"
                  :model-value="record[field.name]"
                  @update:model-value="(v) => (record[field.name] = v)"
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
          />
        </template>
      </n-space>
    </n-form>
  </div>
</template>
