<script setup lang="ts">
import { NButton, NCard, NCheckbox, NColorPicker, NInput, NInputNumber, NSelect, NSpace } from 'naive-ui';

interface Column { field: string; label?: string; width?: number; align?: 'left' | 'center' | 'right'; format?: string }
interface Style { fontSize?: number; bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right'; color?: string; backgroundColor?: string; padding?: number; fontFamily?: string }
interface Tablix { columns: Column[]; headerHeight?: number; rowHeight?: number; headerStyle?: Style; rowStyle?: Style; border?: { width?: number; color?: string } }
const props = defineProps<{ tablix: Tablix; fieldOptions: { label: string; value: string }[]; fontOptions: { label: string; value: string }[] }>();
const alignOptions = [{ label: 'Left', value: 'left' }, { label: 'Center', value: 'center' }, { label: 'Right', value: 'right' }];
function addColumn() { props.tablix.columns.push({ field: '', label: '', width: 100, align: 'left' }); }
function removeColumn(index: number) { props.tablix.columns.splice(index, 1); }
function headerStyle(): Style { return props.tablix.headerStyle ??= { bold: true, backgroundColor: '#eeeeee', padding: 4 }; }
function rowStyle(): Style { return props.tablix.rowStyle ??= { padding: 4 }; }
function border() { return props.tablix.border ??= { width: 0.5, color: '#999999' }; }
</script>

<template>
  <n-space vertical>
    <n-card size="small" title="Columns">
      <div v-for="(column, index) in tablix.columns" :key="index" class="column-row">
        <n-select v-model:value="column.field" :options="fieldOptions" filterable placeholder="Field" />
        <n-input v-model:value="column.label" placeholder="Header label" />
        <n-input-number v-model:value="column.width" :min="20" placeholder="Width pt" />
        <n-select v-model:value="column.align" :options="alignOptions" />
        <n-input v-model:value="column.format" placeholder="#,##0.00 or dd/MM/yyyy" />
        <n-button quaternary type="error" @click="removeColumn(index)">Remove</n-button>
      </div>
      <n-button size="small" @click="addColumn">+ Column</n-button>
    </n-card>
    <n-card size="small" title="Header and row style">
      <div class="style-grid">
        <span>Header height</span><n-input-number v-model:value="tablix.headerHeight" :min="8" />
        <span>Row height</span><n-input-number v-model:value="tablix.rowHeight" :min="8" />
        <span>Header font</span><n-select :value="headerStyle().fontFamily" :options="fontOptions" clearable @update:value="(value) => headerStyle().fontFamily = value || undefined" />
        <span>Header size</span><n-input-number :value="headerStyle().fontSize" :min="1" @update:value="(value) => headerStyle().fontSize = value ?? undefined" />
        <span>Header colors</span><n-space><n-color-picker :value="headerStyle().color ?? '#000000'" @update:value="(value) => headerStyle().color = value" /><n-color-picker :value="headerStyle().backgroundColor ?? '#eeeeee'" @update:value="(value) => headerStyle().backgroundColor = value" /></n-space>
        <span>Header emphasis</span><n-space><n-checkbox :checked="headerStyle().bold" @update:checked="(value) => headerStyle().bold = value">Bold</n-checkbox><n-checkbox :checked="headerStyle().italic" @update:checked="(value) => headerStyle().italic = value">Italic</n-checkbox></n-space>
        <span>Row font</span><n-select :value="rowStyle().fontFamily" :options="fontOptions" clearable @update:value="(value) => rowStyle().fontFamily = value || undefined" />
        <span>Row size</span><n-input-number :value="rowStyle().fontSize" :min="1" @update:value="(value) => rowStyle().fontSize = value ?? undefined" />
        <span>Row colors</span><n-space><n-color-picker :value="rowStyle().color ?? '#000000'" @update:value="(value) => rowStyle().color = value" /><n-color-picker :value="rowStyle().backgroundColor ?? '#ffffff'" @update:value="(value) => rowStyle().backgroundColor = value" /></n-space>
        <span>Padding</span><n-space><n-input-number :value="headerStyle().padding" :min="0" @update:value="(value) => headerStyle().padding = value ?? undefined" /><n-input-number :value="rowStyle().padding" :min="0" @update:value="(value) => rowStyle().padding = value ?? undefined" /></n-space>
        <span>Border</span><n-space><n-input-number :value="border().width" :min="0" :step="0.5" @update:value="(value) => border().width = value ?? undefined" /><n-color-picker :value="border().color ?? '#999999'" @update:value="(value) => border().color = value" /></n-space>
      </div>
    </n-card>
  </n-space>
</template>

<style scoped>
.column-row{display:grid;grid-template-columns:minmax(150px,1.2fr) minmax(140px,1fr) 110px 120px minmax(180px,1fr) auto;gap:8px;margin-bottom:8px;align-items:center}.style-grid{display:grid;grid-template-columns:130px minmax(220px,1fr);gap:10px;align-items:center}@media(max-width:800px){.column-row,.style-grid{grid-template-columns:1fr}.column-row{padding-bottom:12px;border-bottom:1px solid var(--emu-border)}}
</style>
