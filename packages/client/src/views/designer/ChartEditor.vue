<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NCheckbox, NFormItem, NInput, NSelect, NSpace } from 'naive-ui';
import type { Artifact } from '../../stores/designer';
const props = defineProps<{ artifact: Artifact; views: Artifact[] }>();
const viewOptions = computed(() => props.views.map((view) => ({ label: String(view.label ?? view.name), value: view.name })));
const selectedView = computed(() => props.views.find((view) => view.name === props.artifact.view));
const columnOptions = computed(() => ((selectedView.value?.columns ?? []) as any[]).map((column) => ({ label: column.label ?? column.name, value: column.name })));
function measures(): any[] { if (!props.artifact.measures) props.artifact.measures = []; return props.artifact.measures as any[]; }
</script>
<template><n-space vertical>
  <n-form-item label="View" required><n-select v-model:value="(artifact.view as string)" :options="viewOptions" filterable /></n-form-item>
  <n-form-item label="Chart type" required><n-select v-model:value="(artifact.type as string)" :options="['bar','line','pie','donut','kpi'].map(value=>({label:value,value}))" /></n-form-item>
  <n-form-item v-if="artifact.type!=='kpi'" label="Dimension" required><n-select v-model:value="(artifact.dimension as string)" :options="columnOptions" /></n-form-item>
  <n-form-item label="Measures" required><n-space vertical style="width:100%"><n-space v-for="(measure,i) in measures()" :key="i"><n-select v-model:value="measure.field" :options="columnOptions" style="width:220px"/><n-input v-model:value="measure.label" placeholder="Label" style="width:180px"/><n-input v-model:value="measure.color" placeholder="#4f46e5" style="width:130px"/><n-button quaternary type="error" @click="measures().splice(i,1)">×</n-button></n-space><n-button size="small" @click="measures().push({field:''})">+ Measure</n-button></n-space></n-form-item>
  <n-space><n-checkbox v-model:checked="(artifact.legend as boolean)">Show legend</n-checkbox><n-checkbox v-if="artifact.type==='bar'||artifact.type==='line'" v-model:checked="(artifact.stacked as boolean)">Stack measures</n-checkbox></n-space>
</n-space></template>
