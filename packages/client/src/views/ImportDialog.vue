<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  NAlert,
  NButton,
  NDataTable,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSpin,
  NUpload,
  NUploadDragger,
  NText,
  useMessage,
  type DataTableColumns,
  type UploadFileInfo,
} from 'naive-ui';
import { api, ApiError, type ImportPreview, type ImportResult } from '../api';
import { useMeta } from '../stores/meta';

const props = defineProps<{ show: boolean; tableName: string }>();
const emit = defineEmits<{ 'update:show': [boolean]; imported: [] }>();

const meta = useMeta();
const message = useMessage();

type Step = 'pick' | 'map' | 'result';
const step = ref<Step>('pick');
const file = ref<File | null>(null);
const loading = ref(false);
const preview = ref<ImportPreview | null>(null);
const mapping = ref<Record<string, string | null>>({});
const mode = ref<'insert' | 'upsert'>('insert');
const keyField = ref<string | null>(null);
const result = ref<ImportResult | null>(null);

const table = computed(() => meta.table(props.tableName));
const fieldOptions = computed(() =>
  (table.value?.fields ?? []).map((f) => ({ label: f.label ?? f.name, value: f.name })),
);

function reset() {
  step.value = 'pick';
  file.value = null;
  preview.value = null;
  mapping.value = {};
  mode.value = 'insert';
  keyField.value = null;
  result.value = null;
}

function close() {
  emit('update:show', false);
  reset();
}

function onFileChange(options: { fileList: UploadFileInfo[] }) {
  const info = options.fileList[options.fileList.length - 1];
  file.value = (info?.file as File) ?? null;
}

async function doPreview() {
  if (!file.value) return;
  loading.value = true;
  try {
    preview.value = await api.importPreview(props.tableName, file.value);
    mapping.value = Object.fromEntries(preview.value.suggestedMapping.map((m) => [m.column, m.field]));
    step.value = 'map';
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  } finally {
    loading.value = false;
  }
}

async function doCommit() {
  if (!file.value) return;
  if (mode.value === 'upsert' && !keyField.value) {
    message.error('Select a key column for upsert mode');
    return;
  }
  loading.value = true;
  try {
    const mapped = Object.fromEntries(
      Object.entries(mapping.value).filter((entry): entry is [string, string] => Boolean(entry[1])),
    );
    result.value = await api.importCommit(props.tableName, file.value, mapped, mode.value, keyField.value ?? undefined);
    step.value = 'result';
    emit('imported');
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  } finally {
    loading.value = false;
  }
}

const sampleColumns = computed<DataTableColumns<Record<string, unknown>>>(() =>
  (preview.value?.columns ?? []).map((c) => ({ title: c, key: c })),
);

const failedColumns: DataTableColumns<{ row: number; error: string }> = [
  { title: 'Row', key: 'row', width: 80 },
  { title: 'Error', key: 'error' },
];
</script>

<template>
  <n-modal :show="show" preset="card" title="Import data" class="import-modal" style="width:min(640px,calc(100vw - 24px))" @update:show="(v: boolean) => !v && close()">
    <n-spin :show="loading">
      <div v-if="step === 'pick'">
        <n-upload
          :max="1"
          :default-upload="false"
          accept=".csv,.xlsx,.xls"
          @change="onFileChange"
        >
          <n-upload-dragger>
            <div>Click or drag a CSV / Excel file here</div>
          </n-upload-dragger>
        </n-upload>
        <n-space justify="end" style="margin-top: 16px">
          <n-button @click="close">Cancel</n-button>
          <n-button type="primary" :disabled="!file" @click="doPreview">Next</n-button>
        </n-space>
      </div>

      <div v-else-if="step === 'map' && preview">
        <n-text depth="3">{{ preview.rowCount }} rows detected</n-text>
        <table class="mapping-table">
          <thead>
            <tr>
              <th style="text-align: left; padding: 4px 8px">Column</th>
              <th style="text-align: left; padding: 4px 8px">Maps to field</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="col in preview.columns" :key="col">
              <td style="padding: 4px 8px">{{ col }}</td>
              <td style="padding: 4px 8px">
                <n-select
                  v-model:value="mapping[col]"
                  :options="fieldOptions"
                  clearable
                  placeholder="(skip)"
                  size="small"
                />
              </td>
            </tr>
          </tbody>
        </table>

        <n-space vertical style="margin-top: 16px">
          <n-radio-group v-model:value="mode">
            <n-radio-button value="insert">Insert only</n-radio-button>
            <n-radio-button value="upsert">Upsert (update existing)</n-radio-button>
          </n-radio-group>
          <n-select
            v-if="mode === 'upsert'"
            v-model:value="keyField"
            :options="fieldOptions"
            placeholder="Key column to match existing rows"
          />
        </n-space>

        <div v-if="preview.sampleRows.length > 0" class="import-table-scroll"><n-data-table :columns="sampleColumns" :data="preview.sampleRows" size="small" max-height="200" /></div>

        <n-space justify="end" style="margin-top: 16px">
          <n-button @click="step = 'pick'">Back</n-button>
          <n-button type="primary" @click="doCommit">Import</n-button>
        </n-space>
      </div>

      <div v-else-if="step === 'result' && result">
        <n-alert :type="result.failed.length > 0 ? 'warning' : 'success'">
          Inserted {{ result.inserted }}, updated {{ result.updated }}, skipped {{ result.skipped }}.
        </n-alert>
        <div v-if="result.failed.length > 0" class="import-table-scroll"><n-data-table :columns="failedColumns" :data="result.failed" size="small" max-height="240" /></div>
        <n-space justify="end" style="margin-top: 16px">
          <n-button type="primary" @click="close">Done</n-button>
        </n-space>
      </div>
    </n-spin>
  </n-modal>
</template>

<style scoped>
.mapping-table{width:100%;margin-top:12px;border-collapse:collapse}.import-table-scroll{margin-top:16px;overflow-x:auto}.import-table-scroll :deep(.n-data-table){min-width:520px}
@media(max-width:700px){.import-modal{width:calc(100vw - 16px)!important}.mapping-table,.mapping-table tbody,.mapping-table tr,.mapping-table td{display:block}.mapping-table thead{display:none}.mapping-table tr{padding:12px;border:1px solid var(--emu-border);border-radius:10px}.mapping-table tr+tr{margin-top:8px}.mapping-table td{padding:0!important}.mapping-table td:first-child{font-weight:700;margin-bottom:7px;overflow-wrap:anywhere}.import-modal :deep(.n-upload-dragger){padding:20px 12px}.import-modal :deep(.n-button){min-height:44px}}
</style>
