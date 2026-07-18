<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { NAlert, NCard, NSpin } from 'naive-ui';
import * as echarts from 'echarts';
import type { FormChartMeta } from '@emu/core';
import { api, ApiError } from '../api';
import { useMeta } from '../stores/meta';

const props = defineProps<{ embed: FormChartMeta; record: Record<string, unknown>; isNew: boolean }>();
const meta = useMeta();
const element = ref<HTMLElement | null>(null);
const loading = ref(false);
const error = ref('');
const saveFirst = ref(false);
let instance: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;
const chart = computed(() => meta.chart(props.embed.chart));

function queryString(): string | null {
  const view = chart.value ? meta.view(chart.value.view) : undefined;
  if (!view) return '';
  const query = new URLSearchParams({ limit: '10000' });
  const values = new Map<string, unknown>();
  for (const binding of props.embed.parameterBindings ?? []) values.set(binding.parameter, binding.source === 'record' ? props.record[binding.field ?? ''] : binding.value);
  for (const parameter of view.parameters ?? []) {
    const value = values.get(parameter.name);
    if (parameter.required && (value === undefined || value === null || value === '')) { saveFirst.value = props.isNew; return null; }
    if (value !== undefined && value !== null && value !== '') query.set(`param.${parameter.name}`, String(value));
  }
  saveFirst.value = false;
  return query.toString();
}

function optionFor(rows: Record<string, unknown>[]): echarts.EChartsOption {
  const definition = chart.value!;
  const dimension = definition.dimension ?? '';
  if (definition.type === 'kpi') {
    const measure = definition.measures[0]!;
    return { title: { text: String(rows[0]?.[measure.field] ?? '—'), subtext: measure.label ?? definition.label ?? definition.name, left: 'center', top: '32%', textStyle: { fontSize: 38, fontWeight: 700 } } };
  }
  if (definition.type === 'pie' || definition.type === 'donut') {
    const measure = definition.measures[0]!;
    return { tooltip: { trigger: 'item' }, legend: { show: definition.legend !== false, bottom: 0 }, series: [{ type: 'pie', radius: definition.type === 'donut' ? ['42%', '68%'] : '68%', data: rows.map((row) => ({ name: String(row[dimension] ?? ''), value: Number(row[measure.field] ?? 0), itemStyle: measure.color ? { color: measure.color } : undefined })) }] };
  }
  return {
    tooltip: { trigger: 'axis' }, legend: { show: definition.legend !== false, bottom: 0 },
    grid: { left: 44, right: 24, top: 24, bottom: 58, containLabel: true },
    xAxis: { type: 'category', data: rows.map((row) => String(row[dimension] ?? '')) }, yAxis: { type: 'value' },
    series: definition.measures.map((measure) => ({ name: measure.label ?? measure.field, type: definition.type === 'line' ? 'line' as const : 'bar' as const, stack: definition.stacked ? 'total' : undefined, data: rows.map((row) => Number(row[measure.field] ?? 0)), itemStyle: measure.color ? { color: measure.color } : undefined })),
  };
}

async function render() {
  error.value = '';
  if (!chart.value) { error.value = 'Chart metadata is unavailable.'; return; }
  const query = queryString();
  if (query === null) { instance?.clear(); return; }
  loading.value = true;
  try {
    const result = await api.get<{ data: Record<string, unknown>[] }>(`/api/views/${encodeURIComponent(chart.value.view)}/data?${query}`);
    await nextTick();
    if (!element.value) return;
    instance ??= echarts.init(element.value);
    instance.setOption(optionFor(result.data), true);
    resizeObserver ??= new ResizeObserver(() => instance?.resize());
    resizeObserver.observe(element.value);
  } catch (err) { error.value = err instanceof ApiError ? err.message : 'Chart data could not be loaded.'; }
  finally { loading.value = false; }
}
watch(() => [props.embed, props.record, props.isNew, chart.value], render, { immediate: true, deep: true });
onBeforeUnmount(() => { resizeObserver?.disconnect(); instance?.dispose(); instance = null; });
</script>

<template><n-card :title="chart?.label ?? chart?.name ?? embed.chart" size="small" class="embedded-chart">
  <n-alert v-if="saveFirst" type="info">Save this record before the chart can load its required parameters.</n-alert>
  <n-alert v-else-if="error" type="warning">{{ error }}</n-alert>
  <n-spin v-else :show="loading"><div ref="element" class="chart-canvas" role="img" :aria-label="chart?.label ?? embed.chart"></div></n-spin>
</n-card></template>

<style scoped>.chart-canvas{width:100%;height:340px;min-height:240px}.embedded-chart{height:100%}.embedded-chart :deep(.n-spin-container),.embedded-chart :deep(.n-spin-content){height:100%}</style>
