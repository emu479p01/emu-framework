<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  NButton,
  NAlert,
  NCard,
  NCheckbox,
  NColorPicker,
  NInput,
  NInputNumber,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpace,
  NSwitch,
  NTabPane,
  NTabs,
  useDialog,
  useMessage,
} from 'naive-ui';
import { api, ApiError } from '../../api';
import { useDesigner } from '../../stores/designer';
import { useMeta, type FieldMeta } from '../../stores/meta';
import { useDraggableElement } from './useDraggableElement';

interface ReportElement {
  id: string;
  type: 'text' | 'field' | 'image' | 'line' | 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  field?: string;
  style?: { fontSize?: number; bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right'; color?: string; borderWidth?: number; fontFamily?: string };
}
type ReportBandKind = 'pageHeader' | 'header' | 'detail' | 'footer' | 'pageFooter';
interface ReportBand {
  kind: ReportBandKind;
  height: number;
  elements: ReportElement[];
}
interface ReportLineSource {
  table: string;
  refField: string;
  bands: ReportBand[];
}
interface ReportArtifact {
  kind: 'report';
  name: string;
  app?: string;
  model?: string;
  layer?: string;
  label?: string;
  defaultFont?: string;
  page?: { size?: 'A4' | 'Letter'; orientation?: 'portrait' | 'landscape'; margins?: [number, number, number, number] };
  dataSource: string;
  bands: ReportBand[];
  lineSources?: ReportLineSource[];
  parameters?: { field: string; operator?: 'eq' | 'from' | 'to'; label?: string; required?: boolean }[];
}

const props = defineProps<{ name?: string }>();
const route = useRoute();
const router = useRouter();
const designer = useDesigner();
const meta = useMeta();
const message = useMessage();
const dialog = useDialog();

const isNew = computed(() => props.name === undefined);
const busy = ref(false);
const activeTab = ref<'design' | 'json'>('design');
const jsonText = ref('');
const jsonResult = ref<{ valid: boolean; diagnostics: { path: string; code: string; message: string }[]; summary?: { bands: number; elements: number; lineSources: number; parameters: number } } | null>(null);

const BAND_KINDS: { kind: ReportBandKind; label: string }[] = [
  { kind: 'pageHeader', label: 'Page header' },
  { kind: 'header', label: 'Header' },
  { kind: 'detail', label: 'Detail (repeats per row)' },
  { kind: 'footer', label: 'Footer' },
  { kind: 'pageFooter', label: 'Page footer' },
];

function blank(): ReportArtifact {
  return {
    kind: 'report',
    name: '',
    label: '',
    dataSource: '',
    bands: [{ kind: 'header', height: 30, elements: [] }, { kind: 'detail', height: 20, elements: [] }],
    lineSources: [],
    parameters: [],
  };
}

const report = reactive<ReportArtifact>(blank());
const selectedApp = ref('');
const selectedModel = ref('');
const selectedLayer = ref('CUS');
const fontOptions = ref<{ label: string; value: string }[]>([{ label: 'Roboto', value: 'Roboto' }]);
const THAI_TEXT = /[\u0E00-\u0E7F]/;
const THAI_FONT = 'Noto Sans Thai';
const canvasWidth = computed(() => {
  const size = report.page?.size ?? 'A4';
  const orientation = report.page?.orientation ?? 'portrait';
  const dimensions = size === 'Letter' ? [612, 792] : [595, 842];
  const pageWidth = orientation === 'landscape' ? dimensions[1] : dimensions[0];
  const margins = report.page?.margins ?? [40, 40, 40, 40];
  return Math.max(240, pageWidth - margins[0] - margins[2]);
});
function previewFont(element: ReportElement): string {
  if (element.type === 'text' && THAI_TEXT.test(element.text ?? '')) return THAI_FONT;
  return element.style?.fontFamily ?? report.defaultFont ?? 'Roboto';
}

async function loadFonts() {
  const result = await api.get<{ defaultFont: string; fonts: { family: string; builtIn: boolean; variants?: Record<string, string> }[] }>('/api/fonts');
  fontOptions.value = result.fonts.map((font) => ({ label: font.family, value: font.family }));
  for (const font of result.fonts.filter((entry) => entry.family !== 'Roboto')) {
    const id = `emu-font-${font.family.replace(/\W/g, '-')}`;
    if (document.getElementById(id)) continue;
    const style = document.createElement('style'); style.id = id;
    style.textContent = `@font-face{font-family:${JSON.stringify(font.family)};src:url('/api/fonts/${encodeURIComponent(font.family)}/regular')}@font-face{font-family:${JSON.stringify(font.family)};src:url('/api/fonts/${encodeURIComponent(font.family)}/700');font-weight:700}`;
    document.head.appendChild(style);
  }
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `el${Date.now()}_${idCounter}`;
}

async function load() {
  if (!designer.loaded) await designer.load();
  await loadFonts();
  if (isNew.value) {
    Object.assign(report, blank());
    selectedApp.value = (route.params.appName as string) ?? (route.query.app as string) ?? selectedApp.value;
    selectedModel.value = (route.params.modelName as string) ?? (route.query.model as string) ?? selectedModel.value;
    const defaultApp = designer.apps.find((a) => a.name !== 'system');
    if (!selectedApp.value && defaultApp) selectedApp.value = defaultApp.name;
    const app = designer.apps.find((a) => a.name === selectedApp.value);
    if (!selectedModel.value) selectedModel.value = app?.models?.[0]?.name ?? '';
    selectedLayer.value = app?.models?.find((m) => m.name === selectedModel.value)?.layer ?? selectedLayer.value;
  } else {
    const entry = designer.get(props.name!);
    const art = entry ? (JSON.parse(JSON.stringify(entry.artifact)) as ReportArtifact) : blank();
    Object.assign(report, blank(), art);
    selectedApp.value = report.app ?? '';
    selectedModel.value = report.model ?? '';
    selectedLayer.value = report.layer ?? 'CUS';
  }
  selected.value = null;
  jsonText.value = JSON.stringify(report, null, 2);
  jsonResult.value = null;
}
watch(() => props.name, load, { immediate: true });

const appOptions = computed(() => designer.apps.map((a) => ({ label: a.label ?? a.name, value: a.name })));
const selectedAppEntry = computed(() => designer.apps.find((a) => a.name === selectedApp.value));
const modelOptions = computed(() => (selectedAppEntry.value?.models ?? []).map((m) => ({ label: `${m.label ?? m.name} (${m.layer})`, value: m.name })));
watch([selectedApp, selectedModel], () => {
  const model = selectedAppEntry.value?.models?.find((m) => m.name === selectedModel.value);
  if (model) selectedLayer.value = model.layer;
});

const tableOptions = computed(() => (meta.meta?.tables ?? []).map((t) => ({ label: t.label ?? t.name, value: t.name })));
const mainFields = computed<FieldMeta[]>(() => meta.table(report.dataSource)?.fields ?? []);
const mainFieldOptions = computed(() => mainFields.value.map((f) => ({ label: f.label ?? f.name, value: f.name })));

// ---- band management ----
function bandFor(kind: ReportBandKind): ReportBand | undefined {
  return report.bands.find((b) => b.kind === kind);
}
function hasBand(kind: ReportBandKind): boolean {
  return Boolean(bandFor(kind));
}
function toggleBand(kind: ReportBandKind, on: boolean) {
  if (on) {
    if (!hasBand(kind)) report.bands.push({ kind, height: 24, elements: [] });
  } else {
    report.bands = report.bands.filter((b) => b.kind !== kind);
  }
}

// ---- element selection ----
interface Selection { list: ReportElement[]; index: number; fieldOptions: { label: string; value: string }[] }
const selected = ref<Selection | null>(null);
const selectedElement = computed(() => (selected.value ? selected.value.list[selected.value.index] : null));

function addElement(list: ReportElement[], type: ReportElement['type'], fieldOptions: { label: string; value: string }[]) {
  const el: ReportElement = { id: nextId(), type, x: 4, y: 2, width: type === 'line' ? 100 : type === 'rect' ? 80 : 100, height: type === 'line' ? 1 : type === 'rect' ? 40 : 18 };
  if (type === 'text') el.text = 'Text';
  list.push(el);
  selected.value = { list, index: list.length - 1, fieldOptions };
}
function selectElement(list: ReportElement[], index: number, fieldOptions: { label: string; value: string }[]) {
  selected.value = { list, index, fieldOptions };
}
function removeSelected() {
  if (!selected.value) return;
  selected.value.list.splice(selected.value.index, 1);
  selected.value = null;
}

function dragHandlers(el: ReportElement) {
  return useDraggableElement(
    () => ({ x: el.x, y: el.y, width: el.width, height: el.height }),
    (r) => { el.x = r.x; el.y = r.y; el.width = r.width; el.height = r.height; },
  );
}

// ---- line sources ----
function addLineSource() {
  report.lineSources = report.lineSources ?? [];
  report.lineSources.push({ table: '', refField: '', bands: [{ kind: 'detail', height: 20, elements: [] }] });
}
function removeLineSource(idx: number) {
  report.lineSources?.splice(idx, 1);
}
function lineFieldOptions(table: string) {
  return (meta.table(table)?.fields ?? []).map((f) => ({ label: f.label ?? f.name, value: f.name }));
}
function refFieldOptions(table: string) {
  return (meta.table(table)?.fields ?? []).filter((f) => f.type === 'reference').map((f) => ({ label: f.label ?? f.name, value: f.name }));
}
function addParameter() { report.parameters = report.parameters ?? []; report.parameters.push({ field: '', operator: 'eq' }); }
function removeParameter(index: number) { report.parameters?.splice(index, 1); }
const parameterOperators = [{ label: 'Equals', value: 'eq' }, { label: 'From (>=)', value: 'from' }, { label: 'To (<=)', value: 'to' }];

// ---- save / preview ----
async function save() {
  if (!report.name) { message.error('Name is required'); return; }
  if (!report.dataSource) { message.error('Data source table is required'); return; }
  if (!selectedApp.value || !selectedModel.value) { message.error('App and model are required'); return; }
  busy.value = true;
  try {
    for (const band of [...report.bands, ...(report.lineSources ?? []).flatMap((line) => line.bands)]) {
      for (const element of band.elements) {
        element.y = Math.max(0, Math.min(element.y, Math.max(0, band.height - element.height)));
        element.height = Math.min(element.height, band.height);
      }
    }
    let name = report.name;
    if (isNew.value) {
      const prefix = selectedApp.value === 'system' ? 'FW' : selectedApp.value.replace(/[^a-z0-9]/gi, '').toUpperCase();
      if (!name.startsWith(`${prefix}_`)) name = `${prefix}_${name}`;
    }
    const artifact = { ...report, name, app: selectedApp.value, model: selectedModel.value, layer: selectedLayer.value };
    await designer.save(artifact as unknown as { kind: string; name: string; [k: string]: unknown });
    message.success('Report saved');
    if (isNew.value) router.replace(selectedApp.value && selectedModel.value ? `/designer/app/${encodeURIComponent(selectedApp.value)}/model/${encodeURIComponent(selectedModel.value)}/report/${encodeURIComponent(name)}` : `/designer/report/${encodeURIComponent(name)}`);
  } catch (err) {
    if (err instanceof ApiError) message.error(err.message);
    else throw err;
  } finally {
    busy.value = false;
  }
}

function previewUrl(): string {
  return `/api/report/${encodeURIComponent(report.name)}/pdf`;
}
function preview() {
  window.open(previewUrl(), '_blank', 'noopener');
}

function back() {
  if (window.history.length > 1) router.back();
  else router.push({ path: '/designer', query: { mode: 'advanced', app: selectedApp.value, model: selectedModel.value } });
}
function formatJson() {
  try { jsonText.value = JSON.stringify(JSON.parse(jsonText.value), null, 2); jsonResult.value = null; }
  catch (error) { message.error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}
async function validateJson() {
  jsonResult.value = null;
  let parsed: ReportArtifact;
  try { parsed = JSON.parse(jsonText.value) as ReportArtifact; }
  catch (error) { jsonResult.value = { valid: false, diagnostics: [{ path: '/', code: 'json', message: error instanceof Error ? error.message : String(error) }] }; return; }
  try { jsonResult.value = await api.post<NonNullable<typeof jsonResult.value>>('/api/designer/reports/validate', { artifact: parsed }); }
  catch (error) { message.error(error instanceof ApiError ? error.message : String(error)); }
}
function applyJson() {
  if (!jsonResult.value?.valid) return;
  const parsed = JSON.parse(jsonText.value) as ReportArtifact;
  dialog.warning({
    title: 'Replace report design?', content: 'This replaces the current report bands, elements, line sources, and parameters with the validated JSON.',
    positiveText: 'Replace design', negativeText: 'Cancel',
    onPositiveClick: () => {
      Object.assign(report, blank(), parsed);
      selectedApp.value = (route.params.appName as string) || parsed.app || selectedApp.value;
      selectedModel.value = (route.params.modelName as string) || parsed.model || selectedModel.value;
      selected.value = null; activeTab.value = 'design'; message.success('JSON applied to the designer');
    },
  });
}
function refreshJsonFromDesign() { jsonText.value = JSON.stringify({ ...report, app: selectedApp.value, model: selectedModel.value, layer: selectedLayer.value }, null, 2); jsonResult.value = null; }
</script>

<template>
  <div class="report-designer-page">
    <n-space class="report-page-heading" justify="space-between" style="margin-bottom: 16px">
      <h2 style="margin: 0">{{ isNew ? 'New report' : report.name }}</h2>
      <n-space>
        <n-button @click="back">Back</n-button>
        <n-button :disabled="isNew" @click="preview">Preview PDF</n-button>
        <n-button type="primary" :loading="busy" @click="save">Save</n-button>
      </n-space>
    </n-space>

    <n-tabs v-model:value="activeTab" type="line">
      <n-tab-pane name="design" tab="Design">
    <n-card size="small" class="report-settings" style="margin-bottom: 16px">
      <n-space vertical>
        <n-space align="center">
          <span style="width: 110px">Name</span>
          <n-input v-model:value="report.name" :disabled="!isNew" placeholder="CustListReport" style="width: 240px" />
          <span style="width: 90px">Label</span>
          <n-input v-model:value="report.label" placeholder="Customer list" style="width: 240px" />
        </n-space>
        <n-space align="center">
          <span style="width: 110px">Default font</span>
          <n-select v-model:value="report.defaultFont" :options="fontOptions" clearable placeholder="Roboto (system default)" style="width: 240px" />
        </n-space>
        <n-space align="start">
          <span style="width:110px">Parameters</span>
          <div class="report-parameters"><n-space v-for="(parameter, pi) in report.parameters ?? []" :key="pi" class="report-parameter" style="margin-bottom:6px">
            <n-select v-model:value="parameter.field" :options="mainFieldOptions" placeholder="Field" style="width:180px" />
            <n-select v-model:value="parameter.operator" :options="parameterOperators" style="width:120px" />
            <n-input v-model:value="parameter.label" placeholder="Label" style="width:160px" />
            <n-checkbox v-model:checked="parameter.required">Required</n-checkbox>
            <n-button size="tiny" quaternary type="error" @click="removeParameter(pi)">✕</n-button>
          </n-space><n-button size="tiny" @click="addParameter">+ Parameter</n-button></div>
        </n-space>
        <n-space align="center">
          <span style="width: 110px">App</span>
          <n-select v-model:value="selectedApp" :options="appOptions" style="width: 240px" />
          <span style="width: 90px">Model</span>
          <n-select v-model:value="selectedModel" :options="modelOptions" style="width: 240px" />
        </n-space>
        <n-space align="center">
          <span style="width: 110px">Data source</span>
          <n-select v-model:value="report.dataSource" :options="tableOptions" style="width: 240px" placeholder="Table this report reads from" />
        </n-space>
      </n-space>
    </n-card>

    <div class="report-workspace">
      <div class="report-design-main">
        <n-card v-for="bk in BAND_KINDS" :key="bk.kind" size="small" style="margin-bottom: 12px">
          <template #header>
            <n-space align="center">
              <n-checkbox :checked="hasBand(bk.kind)" @update:checked="(v: boolean) => toggleBand(bk.kind, v)">{{ bk.label }}</n-checkbox>
              <template v-if="hasBand(bk.kind)">
                <span>Height</span>
                <n-input-number v-model:value="bandFor(bk.kind)!.height" :min="8" size="small" style="width: 90px" />
                <n-button size="tiny" @click="addElement(bandFor(bk.kind)!.elements, 'text', mainFieldOptions)">+ Text</n-button>
                <n-button size="tiny" @click="addElement(bandFor(bk.kind)!.elements, 'field', mainFieldOptions)">+ Field</n-button>
                <n-button size="tiny" @click="addElement(bandFor(bk.kind)!.elements, 'line', mainFieldOptions)">+ Line</n-button>
                <n-button size="tiny" @click="addElement(bandFor(bk.kind)!.elements, 'rect', mainFieldOptions)">+ Box</n-button>
              </template>
            </n-space>
          </template>
          <div v-if="hasBand(bk.kind)" class="report-canvas-scroll"><div class="report-band" :style="{ height: bandFor(bk.kind)!.height + 'px', width: canvasWidth + 'px' }">
            <div
              v-for="(el, i) in bandFor(bk.kind)!.elements"
              :key="el.id"
              class="report-element"
              :class="{ selected: selected?.list === bandFor(bk.kind)!.elements && selected?.index === i }"
              :style="{ left: el.x + 'px', top: el.y + 'px', width: el.width + 'px', height: el.height + 'px', fontFamily: previewFont(el), fontSize: (el.style?.fontSize ?? 10) + 'px', fontWeight: el.style?.bold ? 'bold' : 'normal', fontStyle: el.style?.italic ? 'italic' : 'normal', textAlign: el.style?.align ?? 'left', color: el.style?.color ?? '#000' }"
              @pointerdown="(e) => { selectElement(bandFor(bk.kind)!.elements, i, mainFieldOptions); dragHandlers(el).onDragStart(e); }"
            >
              <span v-if="el.type === 'text'">{{ el.text }}</span>
              <span v-else-if="el.type === 'field'">[{{ el.field ?? '?' }}]</span>
              <div v-else-if="el.type === 'line'" class="report-line" />
              <div v-else-if="el.type === 'rect'" class="report-rect" />
              <div class="resize-handle" @pointerdown="(e) => dragHandlers(el).onResizeStart(e)" />
            </div>
          </div></div>
        </n-card>

        <n-card size="small" title="Line sources (repeating child rows, e.g. invoice lines)">
          <template #header-extra>
            <n-button size="tiny" @click="addLineSource">+ Add line source</n-button>
          </template>
          <div v-for="(line, li) in report.lineSources ?? []" :key="li" style="margin-bottom: 16px">
            <n-space class="line-source-controls" align="center" style="margin-bottom: 8px">
              <n-select v-model:value="line.table" :options="tableOptions" placeholder="Child table" style="width: 200px" />
              <n-select v-model:value="line.refField" :options="refFieldOptions(line.table)" placeholder="Reference field back to main record" style="width: 260px" />
              <n-button size="tiny" @click="addElement(line.bands[0].elements, 'text', lineFieldOptions(line.table))">+ Text</n-button>
              <n-button size="tiny" @click="addElement(line.bands[0].elements, 'field', lineFieldOptions(line.table))">+ Field</n-button>
              <n-button size="tiny" type="error" quaternary @click="removeLineSource(li)">Remove</n-button>
              <span>Height</span><n-input-number v-model:value="line.bands[0].height" :min="8" size="small" style="width:90px" />
            </n-space>
            <div class="report-canvas-scroll"><div class="report-band" :style="{ height: line.bands[0].height + 'px', width: canvasWidth + 'px' }">
              <div
                v-for="(el, i) in line.bands[0].elements"
                :key="el.id"
                class="report-element"
                :class="{ selected: selected?.list === line.bands[0].elements && selected?.index === i }"
                :style="{ left: el.x + 'px', top: el.y + 'px', width: el.width + 'px', height: el.height + 'px' }"
                @pointerdown="(e) => { selectElement(line.bands[0].elements, i, lineFieldOptions(line.table)); dragHandlers(el).onDragStart(e); }"
              >
                <span v-if="el.type === 'text'">{{ el.text }}</span>
                <span v-else-if="el.type === 'field'">[{{ el.field ?? '?' }}]</span>
                <div class="resize-handle" @pointerdown="(e) => dragHandlers(el).onResizeStart(e)" />
              </div>
            </div></div>
          </div>
        </n-card>
      </div>

      <n-card v-if="selectedElement" size="small" title="Element" class="report-property-panel">
        <n-space vertical>
          <div>Type: {{ selectedElement.type }}</div>
          <n-input v-if="selectedElement.type === 'text'" v-model:value="selectedElement.text" type="textarea" placeholder="Text" />
          <n-select
            v-if="selectedElement.type === 'field'"
            v-model:value="selectedElement.field"
            :options="selected?.fieldOptions ?? []"
            placeholder="Bound field"
          />
          <template v-if="selectedElement.type === 'text' || selectedElement.type === 'field'">
            <n-select
              :value="selectedElement.style?.fontFamily"
              :options="fontOptions"
              clearable
              :placeholder="`Report default (${report.defaultFont ?? 'Roboto'})`"
              @update:value="(v) => { selectedElement!.style = { ...selectedElement!.style, fontFamily: v || undefined }; }"
            />
            <n-space align="center">
              <span>Size</span>
              <n-input-number
                :value="selectedElement.style?.fontSize ?? 10"
                :min="6"
                :max="72"
                size="small"
                style="width: 90px"
                @update:value="(v) => { selectedElement!.style = { ...selectedElement!.style, fontSize: v ?? 10 }; }"
              />
            </n-space>
            <n-space align="center">
              <span>Bold</span>
              <n-switch
                :value="selectedElement.style?.bold ?? false"
                @update:value="(v) => { selectedElement!.style = { ...selectedElement!.style, bold: v }; }"
              />
              <span>Italic</span>
              <n-switch
                :value="selectedElement.style?.italic ?? false"
                @update:value="(v) => { selectedElement!.style = { ...selectedElement!.style, italic: v }; }"
              />
            </n-space>
            <n-radio-group
              :value="selectedElement.style?.align ?? 'left'"
              @update:value="(v) => { selectedElement!.style = { ...selectedElement!.style, align: v }; }"
            >
              <n-radio-button value="left">Left</n-radio-button>
              <n-radio-button value="center">Center</n-radio-button>
              <n-radio-button value="right">Right</n-radio-button>
            </n-radio-group>
            <n-color-picker
              :show-alpha="false"
              :value="selectedElement.style?.color ?? '#000000'"
              @update:value="(v) => { selectedElement!.style = { ...selectedElement!.style, color: v }; }"
            />
          </template>
          <n-space>
            <span>x</span><n-input-number v-model:value="selectedElement.x" size="small" style="width: 80px" />
            <span>y</span><n-input-number v-model:value="selectedElement.y" size="small" style="width: 80px" />
          </n-space>
          <n-space>
            <span>w</span><n-input-number v-model:value="selectedElement.width" size="small" style="width: 80px" />
            <span>h</span><n-input-number v-model:value="selectedElement.height" size="small" style="width: 80px" />
          </n-space>
          <n-button type="error" quaternary @click="removeSelected">Delete element</n-button>
        </n-space>
      </n-card>
    </div>
      </n-tab-pane>
      <n-tab-pane name="json" tab="JSON">
        <n-card size="small" title="Paste full report JSON">
          <p style="color:var(--emu-muted);margin-top:0">Validate the complete report artifact without saving. Apply is enabled only when schema and metadata references are valid.</p>
          <n-space style="margin-bottom:10px"><n-button size="small" @click="refreshJsonFromDesign">Refresh from Design</n-button><n-button size="small" @click="formatJson">Format JSON</n-button><n-button size="small" type="primary" @click="validateJson">Validate</n-button></n-space>
          <n-input v-model:value="jsonText" type="textarea" :autosize="{ minRows: 20, maxRows: 38 }" class="json-editor" @update:value="jsonResult = null" />
          <n-alert v-if="jsonResult?.valid" type="success" title="Report JSON is valid" style="margin-top:12px">{{ jsonResult.summary?.bands }} bands · {{ jsonResult.summary?.elements }} elements · {{ jsonResult.summary?.lineSources }} line sources · {{ jsonResult.summary?.parameters }} parameters</n-alert>
          <n-alert v-else-if="jsonResult" type="error" title="Report JSON has errors" style="margin-top:12px"><ul><li v-for="diagnostic in jsonResult.diagnostics" :key="`${diagnostic.path}:${diagnostic.message}`"><code>{{ diagnostic.path }}</code> — {{ diagnostic.message }}</li></ul></n-alert>
          <n-space justify="end" style="margin-top:12px"><n-button type="primary" :disabled="!jsonResult?.valid" @click="applyJson">Apply to Design</n-button></n-space>
        </n-card>
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<style scoped>
.report-workspace{display:flex;gap:16px;align-items:flex-start}.report-design-main{flex:1;min-width:0}.report-property-panel{width:280px;flex-shrink:0}.report-canvas-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain}
.report-band {
  position: relative;
  border: 1px dashed #ccc;
  background: #fafafa;
  overflow: hidden;
}
.json-editor :deep(textarea){font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.55}
.report-element {
  position: absolute;
  cursor: move;
  border: 1px solid transparent;
  white-space: nowrap;
  overflow: hidden;
  user-select: none;
}
.report-element.selected {
  border-color: #2080f0;
  background: rgba(32, 128, 240, 0.08);
}
.report-line {
  border-top: 1px solid #000;
  width: 100%;
  margin-top: 50%;
}
.report-rect {
  border: 1px solid #000;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}
.resize-handle {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 8px;
  height: 8px;
  background: #2080f0;
  cursor: nwse-resize;
}
@media(max-width:700px){.report-page-heading{display:block!important}.report-page-heading>h2{font-size:21px;overflow-wrap:anywhere}.report-page-heading>.n-space{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:12px}.report-page-heading>.n-space :deep(.n-button){width:100%;min-height:44px}.report-settings :deep(.n-space:not(.n-space--vertical)){display:grid!important;grid-template-columns:1fr;width:100%}.report-settings :deep(.n-space:not(.n-space--vertical)>*){width:100%!important}.report-settings :deep(.n-space:not(.n-space--vertical)>span){width:auto!important}.report-parameter{padding:12px;border:1px solid var(--emu-border);border-radius:10px}.report-workspace{display:block}.report-property-panel{width:100%;margin-top:14px}.report-designer-page :deep(.n-card-header){flex-wrap:wrap;gap:8px}.report-designer-page :deep(.n-card-header__extra){margin-left:0}.report-designer-page :deep(.n-card-header .n-space){flex-wrap:wrap!important}.line-source-controls{display:grid!important;grid-template-columns:1fr}.line-source-controls :deep(.n-base-selection),.line-source-controls :deep(.n-input-number){width:100%!important}.report-designer-page :deep(.n-button){min-height:40px}.report-canvas-scroll{border-radius:4px}}
</style>
