<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import type { FormAction } from '@emu/core';
import ActionDialog from '../components/ActionDialog.vue';
const props = defineProps<{ name: string }>(); const router = useRouter(); const show = ref(true);
const action: FormAction = { label: 'Report', type: 'report', target: props.name };
function close(value: boolean) { show.value = value; if (!value) window.history.length > 1 ? router.back() : router.push('/'); }
</script>
<template><div><ActionDialog :show="show" :action="action" @update:show="close" /></div></template>
