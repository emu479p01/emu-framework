<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NCard, NInput, NSelect, NSpace } from 'naive-ui';
import type { Artifact } from '../../stores/designer';
const props = defineProps<{ artifact: Artifact; charts: Artifact[]; fields: { label: string; value: string }[]; views: Artifact[] }>();
const embeds = computed(() => { if (!props.artifact.charts) props.artifact.charts = []; return props.artifact.charts as any[]; });
const chartOptions = computed(() => props.charts.map((chart) => ({ label: String(chart.label ?? chart.name), value: chart.name })));
function parametersFor(embed: any) { const chart = props.charts.find((entry) => entry.name === embed.chart); const view = props.views.find((entry) => entry.name === chart?.view); return ((view?.parameters ?? []) as any[]).map((parameter) => ({ label: parameter.name, value: parameter.name })); }
function bindings(embed: any) { if (!embed.parameterBindings) embed.parameterBindings = []; return embed.parameterBindings as any[]; }
function setLiteral(embed: any, binding: any, raw: string) {
  const chart = props.charts.find((entry) => entry.name === embed.chart);
  const view = props.views.find((entry) => entry.name === chart?.view);
  const type = String(((view?.parameters ?? []) as any[]).find((parameter) => parameter.name === binding.parameter)?.type ?? 'string');
  if (type === 'int') binding.value = Number.parseInt(raw, 10);
  else if (type === 'real') binding.value = Number(raw);
  else if (type === 'boolean') binding.value = ['true', '1', 'yes'].includes(raw.trim().toLowerCase());
  else binding.value = raw;
}
</script>
<template><n-space vertical><n-card v-for="(embed,i) in embeds" :key="i" size="small"><n-space><n-select v-model:value="embed.chart" :options="chartOptions" filterable style="width:260px"/><n-select v-model:value="embed.width" :options="[{label:'Half width',value:'half'},{label:'Full width',value:'full'}]" style="width:150px"/><n-button quaternary type="error" @click="embeds.splice(i,1)">Remove</n-button></n-space><n-space v-for="(binding,bi) in bindings(embed)" :key="bi" style="margin-top:8px"><n-select v-model:value="binding.parameter" :options="parametersFor(embed)" placeholder="parameter" style="width:180px"/><n-select v-model:value="binding.source" :options="[{label:'Record field',value:'record'},{label:'Literal',value:'literal'}]" style="width:150px"/><n-select v-if="binding.source==='record'" v-model:value="binding.field" :options="fields" style="width:180px"/><n-input v-else :value="String(binding.value ?? '')" placeholder="literal" style="width:180px" @update:value="(value:string)=>setLiteral(embed,binding,value)"/><n-button quaternary @click="bindings(embed).splice(bi,1)">×</n-button></n-space><n-button size="small" style="margin-top:8px" @click="bindings(embed).push({parameter:'',source:'record',field:''})">+ Parameter binding</n-button></n-card><n-button size="small" @click="embeds.push({chart:'',width:'full',parameterBindings:[]})">+ Embedded chart</n-button></n-space></template>
