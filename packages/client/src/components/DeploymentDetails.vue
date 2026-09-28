<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MetadataPackagePreview } from '../api';
const props = defineProps<{ preview: MetadataPackagePreview }>();
const open = ref<string[]>([]);
watch(() => props.preview, () => { open.value = []; });
const groups = computed(() => {
  const apps = new Map<string, Map<string, Map<string, MetadataPackagePreview['diff']>>>();
  for (const item of props.preview.diff) {
    const place = item.after ?? item.before;
    const app = place?.app ?? props.preview.package.scope.app, model = place?.model ?? 'App metadata';
    if (!apps.has(app)) apps.set(app, new Map());
    const models = apps.get(app)!;
    if (!models.has(model)) models.set(model, new Map());
    const kinds = models.get(model)!;
    if (!kinds.has(item.kind)) kinds.set(item.kind, []);
    kinds.get(item.kind)!.push(item);
  }
  return [...apps].map(([app, models]) => ({ app, models: [...models].map(([model, kinds]) => ({ model, kinds: [...kinds].map(([kind, items]) => ({ kind, items })) })) }));
});
const keys = computed(() => groups.value.flatMap(a => [a.app, ...a.models.flatMap(m => [a.app + '/' + m.model, ...m.kinds.map(k => a.app + '/' + m.model + '/' + k.kind)])]));
function toggle(key: string) { open.value = open.value.includes(key) ? open.value.filter(value => value !== key) : [...open.value, key]; }
function counts(items: MetadataPackagePreview['diff']) { return ['create', 'update', 'delete'].map(op => `${op}: ${items.filter(i => i.op === op).length}`).join(' · '); }
</script>
<template>
  <p>{{ counts(preview.diff) }} · High risk: {{ preview.diff.filter(item => item.highRisk).length }}</p>
  <div class="tools"><button @click="open = keys">Expand all</button><button @click="open = []">Collapse all</button></div>
  <div class="details-scroll">
    <section v-for="app in groups" :key="app.app">
      <button class="group" :aria-expanded="open.includes(app.app)" @click="toggle(app.app)">{{ open.includes(app.app) ? '▾' : '▸' }} {{ app.app }}</button>
      <div v-if="open.includes(app.app)" class="nested">
        <section v-for="model in app.models" :key="model.model">
          <button class="group" :aria-expanded="open.includes(app.app+'/'+model.model)" @click="toggle(app.app+'/'+model.model)">{{ open.includes(app.app+'/'+model.model) ? '▾' : '▸' }} {{ model.model }} — {{ counts(model.kinds.flatMap(kind => kind.items)) }}</button>
          <div v-if="open.includes(app.app+'/'+model.model)" class="nested">
            <section v-for="kind in model.kinds" :key="kind.kind">
              <button class="group" :aria-expanded="open.includes(app.app+'/'+model.model+'/'+kind.kind)" @click="toggle(app.app+'/'+model.model+'/'+kind.kind)">{{ kind.kind }} ({{ kind.items.length }}) — {{ counts(kind.items) }}</button>
              <ul v-if="open.includes(app.app+'/'+model.model+'/'+kind.kind)"><li v-for="item in kind.items" :key="item.name"><b>{{ item.op }}</b> {{ item.name }} <strong v-if="item.highRisk">· High risk</strong><small v-if="item.before && item.after && (item.before.model !== item.after.model || item.before.app !== item.after.app)">Moved from {{ item.before.app }}/{{ item.before.model }}</small></li></ul>
            </section>
          </div>
        </section>
      </div>
    </section>
    <details v-if="preview.schemaEffects?.length"><summary>Schema details ({{ preview.schemaEffects.length }})</summary><p v-for="effect in preview.schemaEffects" :key="effect.type+effect.target">{{ effect.type }}: {{ effect.target }}</p></details>
  </div>
</template>
<style scoped>
.details-scroll{max-height:42vh;overflow:auto;overflow-wrap:anywhere}.tools{display:flex;gap:8px;margin:10px 0}.group{display:block;width:100%;padding:10px;border:0;background:var(--emu-surface,#f4f5fa);text-align:left;cursor:pointer}.nested{padding-left:12px}li{padding:6px 0}small{display:block}.tools button{padding:7px;cursor:pointer}strong{color:#ad5300}
</style>
