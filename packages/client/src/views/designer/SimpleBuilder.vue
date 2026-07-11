<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  NAlert, NButton, NCard, NCheckbox, NFormItem, NInput, NModal, NSelect, NSpace,
  NStep, NSteps, NTable, useMessage,
} from 'naive-ui';
import { ApiError } from '../../api';
import { useDesigner, type ChangeSetPreview } from '../../stores/designer';
import { ICON_OPTIONS } from '../../navigation';
import type { IconName } from '@emu/core';

const designer = useDesigner();
const router = useRouter();
const message = useMessage();
const step = ref(1);
const busy = ref(false);
const preview = ref<ChangeSetPreview | null>(null);
const showReview = ref(false);
const model = reactive({
  appName: '', appLabel: '', appIcon: 'app' as IconName, entityName: '', entityLabel: '', pageLabel: '', navigationLabel: '', navigationIcon: 'table' as IconName,
  fields: [{ name: 'name', label: 'Name', type: 'string', mandatory: true }],
});
const fieldTypes = ['string', 'int', 'real', 'boolean', 'date', 'datetime'].map((value) => ({ label: value, value }));
const prefix = computed(() => model.appName.trim().replace(/[^A-Za-z0-9]/g, '_').toUpperCase());
const entity = computed(() => model.entityName.trim().replace(/[^A-Za-z0-9_]/g, ''));
const ready = computed(() => model.appName.trim() && model.appLabel.trim() && model.entityName.trim() && model.entityLabel.trim() && model.fields.length > 0 && model.fields.every((field) => field.name.trim()));
function next() { if (step.value < 5) step.value += 1; else review(); }
function back() { if (step.value > 1) step.value -= 1; }
function addField() { model.fields.push({ name: '', label: '', type: 'string', mandatory: false }); }
function removeField(index: number) { if (model.fields.length > 1) model.fields.splice(index, 1); }

function artifacts() {
  const tableName = `${prefix.value}_${entity.value}`;
  const formName = `${tableName}Form`;
  const menuName = `${prefix.value}_MainMenu`;
  const common = { app: model.appName, model: 'Customizations', layer: 'CUS' };
  return [
    { kind: 'app', name: model.appName, label: model.appLabel, icon: model.appIcon, models: [{ name: 'Customizations', label: 'Customizations', layer: 'CUS' }] },
    { kind: 'table', name: tableName, ...common, label: model.entityLabel, titleField: model.fields[0].name, fields: model.fields.map((field) => ({ name: field.name, label: field.label || field.name, type: field.type, mandatory: field.mandatory || undefined })) },
    { kind: 'form', name: formName, ...common, label: model.pageLabel || model.entityLabel, table: tableName, listFields: model.fields.map((field) => field.name), groups: [{ label: 'Details', fields: model.fields.map((field) => field.name) }] },
    { kind: 'menu', name: menuName, ...common, label: 'Navigation', items: [{ label: model.navigationLabel || model.entityLabel, icon: model.navigationIcon, form: formName }] },
  ];
}
async function review() {
  if (!ready.value) { message.warning('Complete the required information before reviewing.'); return; }
  busy.value = true;
  try {
    const snapshot = await designer.snapshot();
    const items = artifacts();
    preview.value = await designer.validateChangeSet({
      version: 1, baseRevision: snapshot.revision, source: 'designer',
      description: `Create ${model.appLabel} with ${model.entityLabel}`,
      operations: items.map((artifact) => ({ op: 'upsert', kind: artifact.kind, name: artifact.name, artifact })),
    });
    showReview.value = true;
  } catch (error) {
    message.error(error instanceof ApiError ? error.message : 'The app could not be validated. Review names and fields, then try again.');
  } finally { busy.value = false; }
}
async function apply() {
  if (!preview.value) return;
  busy.value = true;
  try {
    await designer.applyChangeSet(preview.value.previewId, preview.value.diff.some((item) => item.highRisk));
    message.success(`${model.appLabel} is ready to use.`);
    showReview.value = false;
    router.push(`/app/${model.appName}/form/${prefix.value}_${entity.value}Form`);
  } catch (error) { message.error(error instanceof ApiError ? error.message : 'The change could not be applied. Validate it again.'); }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="simple-builder" data-testid="simple-builder">
    <div class="builder-heading"><div><h1>Build an app</h1><p>Describe the business data you need. EmuFramework creates the page and navigation for you.</p></div></div>
    <n-card>
      <n-steps :current="step" size="small" class="steps">
        <n-step title="App" /><n-step title="Entity" /><n-step title="Fields" /><n-step title="Page" /><n-step title="Navigation" />
      </n-steps>
      <div class="step-body">
        <template v-if="step === 1">
          <h2>Name your app</h2><p class="help">Use a short internal name and a friendly name people will recognize.</p>
          <div class="two-col"><n-form-item label="Internal name" required><n-input v-model:value="model.appName" placeholder="service" data-testid="builder-app-name" /></n-form-item><n-form-item label="Display name" required><n-input v-model:value="model.appLabel" placeholder="Service Management" /></n-form-item><n-form-item label="App icon"><n-select v-model:value="model.appIcon" :options="ICON_OPTIONS" /></n-form-item></div>
        </template>
        <template v-else-if="step === 2">
          <h2>What do you want to manage?</h2><p class="help">An entity is a business concept such as Customer, Asset, or Work Order.</p>
          <div class="two-col"><n-form-item label="Entity name" required><n-input v-model:value="model.entityName" placeholder="WorkOrder" /></n-form-item><n-form-item label="Display name" required><n-input v-model:value="model.entityLabel" placeholder="Work orders" /></n-form-item></div>
        </template>
        <template v-else-if="step === 3">
          <h2>Add the information people will enter</h2><p class="help">The first field is used to identify records in lookups.</p>
          <div class="field-list" v-for="(field, index) in model.fields" :key="index">
            <n-input v-model:value="field.name" placeholder="fieldName" /><n-input v-model:value="field.label" placeholder="Label" />
            <n-select v-model:value="field.type" :options="fieldTypes" /><n-checkbox v-model:checked="field.mandatory">Required</n-checkbox>
            <n-button quaternary type="error" :disabled="model.fields.length === 1" @click="removeField(index)" :aria-label="`Remove field ${index + 1}`">×</n-button>
          </div><n-button secondary @click="addField">+ Add field</n-button>
        </template>
        <template v-else-if="step === 4">
          <h2>Name the page</h2><p class="help">The page includes a searchable list and a create/edit form.</p>
          <n-form-item label="Page title"><n-input v-model:value="model.pageLabel" :placeholder="model.entityLabel || 'Work orders'" /></n-form-item>
        </template>
        <template v-else>
          <h2>Add it to navigation</h2><p class="help">This is the label people select in the sidebar.</p>
          <div class="two-col"><n-form-item label="Navigation label"><n-input v-model:value="model.navigationLabel" :placeholder="model.entityLabel || 'Work orders'" /></n-form-item><n-form-item label="Navigation icon"><n-select v-model:value="model.navigationIcon" :options="ICON_OPTIONS" /></n-form-item></div>
          <n-alert type="info">The app will use safe Customizations defaults. Technical settings remain available in Advanced mode.</n-alert>
        </template>
      </div>
      <n-space justify="space-between"><n-button :disabled="step === 1" @click="back">Back</n-button><n-button type="primary" :loading="busy" @click="next">{{ step === 5 ? 'Review app' : 'Continue' }}</n-button></n-space>
    </n-card>
    <n-modal v-model:show="showReview" preset="card" title="Review changes" style="width:min(680px,calc(100vw - 32px))">
      <n-alert type="success" style="margin-bottom:16px">Validation passed. Nothing changes until you confirm.</n-alert>
      <n-table size="small"><thead><tr><th>Change</th><th>Type</th><th>Name</th></tr></thead><tbody><tr v-for="item in preview?.diff" :key="item.name"><td>{{ item.op }}</td><td>{{ item.kind }}</td><td>{{ item.name }}</td></tr></tbody></n-table>
      <template #footer><n-space justify="end"><n-button @click="showReview=false">Keep editing</n-button><n-button type="primary" :loading="busy" data-testid="apply-builder" @click="apply">Create app</n-button></n-space></template>
    </n-modal>
  </div>
</template>

<style scoped>
.simple-builder{max-width:920px;margin:0 auto}.builder-heading h1{margin:0;font-size:28px}.builder-heading p,.help{color:var(--emu-muted)}.builder-heading{margin-bottom:20px}.steps{margin-bottom:30px}.step-body{min-height:260px;padding:8px 0 24px}.step-body h2{margin:0 0 6px}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.field-list{display:grid;grid-template-columns:1.1fr 1.2fr .8fr auto auto;gap:10px;align-items:center;margin:12px 0}@media(max-width:700px){.two-col{grid-template-columns:1fr}.field-list{grid-template-columns:1fr 1fr}.field-list>*:nth-child(n+3){margin-top:2px}}
</style>
