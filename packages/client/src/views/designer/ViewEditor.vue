<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NCard, NFormItem, NInput, NSelect, NSpace, NTable } from 'naive-ui';
import type { Artifact } from '../../stores/designer';

const props = defineProps<{ artifact: Artifact; tables: Artifact[] }>();
const tableOptions = computed(() => props.tables.map((table) => ({ label: String(table.label ?? table.name), value: table.name })));
const aliases = computed(() => [props.artifact.source as any, ...((props.artifact.joins ?? []) as any[])].filter(Boolean));
const refOptions = computed(() => aliases.value.flatMap((source: any) => {
  const table = props.tables.find((entry) => entry.name === source.table);
  const fields = ['id', ...(((table?.fields ?? []) as any[]).map((field) => field.name))];
  return fields.map((field) => ({ label: `${source.alias}.${field}`, value: `${source.alias}.${field}` }));
}));
const outputOptions = computed(() => ((props.artifact.columns ?? []) as any[]).map((column) => ({ label: column.name, value: column.name })));
const parameterOptions = computed(() => ((props.artifact.parameters ?? []) as any[]).map((parameter) => ({ label: parameter.name, value: parameter.name })));
function array(name: string): any[] { if (!props.artifact[name]) props.artifact[name] = []; return props.artifact[name] as any[]; }
function addJoin() { array('joins').push({ type: 'left', table: '', alias: `j${array('joins').length + 1}`, on: [{ left: '', right: '' }] }); }
function addColumn() { array('columns').push({ name: '', expression: { type: 'field', ref: '' } }); }
function addParameter() { array('parameters').push({ name: '', type: 'string', required: false }); }
function addFilter() { array('filters').push({ ref: '', operator: 'eq', value: '' }); }
function addOrder() { array('orderBy').push({ column: '', direction: 'asc' }); }
function setExpressionType(column: any, type: string) { column.expression = type === 'field' ? { type, ref: '' } : { type, fn: 'count' }; }
function parameterValue(filter: any) { return typeof filter.value === 'object' && filter.value && !Array.isArray(filter.value) ? filter.value.parameter : null; }
function setParameter(filter: any, value: string | null) { filter.value = value ? { parameter: value } : ''; }
function filterType(filter: any): string {
  const [alias, field] = String(filter.ref ?? '').split('.');
  if (field === 'id') return 'int';
  const source = aliases.value.find((entry: any) => entry.alias === alias);
  const table = props.tables.find((entry) => entry.name === source?.table);
  return String(((table?.fields ?? []) as any[]).find((entry) => entry.name === field)?.type ?? 'string');
}
function literalText(filter: any): string { return Array.isArray(filter.value) ? filter.value.join(', ') : String(filter.value ?? ''); }
function setLiteral(filter: any, raw: string) {
  const type = filterType(filter);
  const convert = (value: string): string | number | boolean => {
    const trimmed = value.trim();
    if (type === 'int' || type === 'reference' || type === 'enum') return Number.parseInt(trimmed, 10);
    if (type === 'real') return Number(trimmed);
    if (type === 'boolean') return ['true', '1', 'yes'].includes(trimmed.toLowerCase());
    return trimmed;
  };
  filter.value = filter.operator === 'in' ? raw.split(',').map(convert) : convert(raw);
}
</script>

<template><n-space vertical :size="12">
  <n-card title="Source" size="small"><n-space><n-form-item label="Table" required><n-select v-model:value="(artifact.source as any).table" :options="tableOptions" filterable style="min-width:260px" /></n-form-item><n-form-item label="Alias" required><n-input v-model:value="(artifact.source as any).alias" style="width:140px" /></n-form-item></n-space></n-card>
  <n-card title="Joins" size="small"><n-card v-for="(join, ji) in (artifact.joins as any[] ?? [])" :key="ji" size="small" style="margin-bottom:8px"><n-space><n-select v-model:value="join.type" :options="[{label:'Inner',value:'inner'},{label:'Left',value:'left'}]" style="width:110px"/><n-select v-model:value="join.table" :options="tableOptions" filterable style="width:240px"/><n-input v-model:value="join.alias" placeholder="alias" style="width:110px"/><n-button type="error" quaternary @click="(artifact.joins as any[]).splice(ji,1)">Remove</n-button></n-space><n-space v-for="(condition, ci) in join.on" :key="ci" style="margin-top:8px"><n-select v-model:value="condition.left" :options="refOptions" filterable style="width:230px"/><span>=</span><n-select v-model:value="condition.right" :options="refOptions" filterable style="width:230px"/><n-button quaternary @click="join.on.splice(ci,1)">×</n-button></n-space><n-button size="small" style="margin-top:8px" @click="join.on.push({left:'',right:''})">+ Join condition</n-button></n-card><n-button size="small" @click="addJoin">+ Join</n-button></n-card>
  <n-card title="Parameters" size="small"><n-space v-for="(parameter, i) in (artifact.parameters as any[] ?? [])" :key="i"><n-input v-model:value="parameter.name" placeholder="name"/><n-select v-model:value="parameter.type" :options="['string','int','real','boolean','date','datetime'].map(value=>({label:value,value}))" style="width:140px"/><label><input v-model="parameter.required" type="checkbox"/> Required</label><n-button quaternary type="error" @click="(artifact.parameters as any[]).splice(i,1)">×</n-button></n-space><n-button size="small" style="margin-top:8px" @click="addParameter">+ Parameter</n-button></n-card>
  <n-card title="Output columns" size="small"><div class="table-scroll"><n-table size="small"><thead><tr><th>Name</th><th>Label</th><th>Expression</th><th>Field / Function</th><th></th></tr></thead><tbody><tr v-for="(column, i) in (artifact.columns as any[] ?? [])" :key="i"><td><n-input v-model:value="column.name"/></td><td><n-input v-model:value="column.label"/></td><td><n-select :value="column.expression.type" :options="[{label:'Field',value:'field'},{label:'Aggregate',value:'aggregate'}]" @update:value="(v:string)=>setExpressionType(column,v)"/></td><td><n-space v-if="column.expression.type==='field'"><n-select v-model:value="column.expression.ref" :options="refOptions" filterable style="min-width:220px"/></n-space><n-space v-else><n-select v-model:value="column.expression.fn" :options="['count','sum','avg','min','max'].map(value=>({label:value,value}))" style="width:100px"/><n-select v-model:value="column.expression.ref" :options="refOptions" clearable filterable style="min-width:200px"/></n-space></td><td><n-button quaternary type="error" @click="(artifact.columns as any[]).splice(i,1)">×</n-button></td></tr></tbody></n-table></div><n-button size="small" style="margin-top:8px" @click="addColumn">+ Column</n-button></n-card>
  <n-card title="Filters and grouping" size="small"><n-space v-for="(filter, i) in (artifact.filters as any[] ?? [])" :key="i"><n-select v-model:value="filter.ref" :options="refOptions" filterable style="width:210px"/><n-select v-model:value="filter.operator" :options="['eq','ne','gt','gte','lt','lte','contains','in'].map(value=>({label:value,value}))" style="width:110px"/><n-select :value="parameterValue(filter)" :options="parameterOptions" clearable placeholder="parameter" style="width:150px" @update:value="(v:string|null)=>setParameter(filter,v)"/><n-input v-if="!parameterValue(filter)" :value="literalText(filter)" :placeholder="filter.operator === 'in' ? 'comma-separated literals' : 'literal value'" style="width:180px" @update:value="(value:string)=>setLiteral(filter,value)"/><n-button quaternary type="error" @click="(artifact.filters as any[]).splice(i,1)">×</n-button></n-space><n-button size="small" style="margin:8px 0" @click="addFilter">+ Filter</n-button><n-form-item label="Group by"><n-select v-model:value="(artifact.groupBy as string[])" :options="refOptions" multiple filterable /></n-form-item></n-card>
  <n-card title="Sort" size="small"><n-space v-for="(order, i) in (artifact.orderBy as any[] ?? [])" :key="i"><n-select v-model:value="order.column" :options="outputOptions" style="width:220px"/><n-select v-model:value="order.direction" :options="[{label:'Ascending',value:'asc'},{label:'Descending',value:'desc'}]" style="width:140px"/><n-button quaternary type="error" @click="(artifact.orderBy as any[]).splice(i,1)">×</n-button></n-space><n-button size="small" style="margin-top:8px" @click="addOrder">+ Sort</n-button></n-card>
</n-space></template>

<style scoped>.table-scroll{overflow:auto}.table-scroll table{min-width:760px}</style>
