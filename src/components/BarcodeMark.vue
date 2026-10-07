<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import JsBarcode from 'jsbarcode'
import type { BarcodeMode } from '../types/label'

const props = defineProps<{
  value: string
  mode: BarcodeMode
}>()

const svgRef = ref<SVGSVGElement>()
const qrData = ref('')

async function render() {
  if (!props.value || props.mode === 'none') {
    qrData.value = ''
    return
  }
  if (props.mode === 'qr') {
    qrData.value = await QRCode.toDataURL(props.value, {
      margin: 0,
      width: 160,
      errorCorrectionLevel: 'M',
      color: { dark: '#151515', light: '#ffffff' },
    })
    return
  }
  if (svgRef.value) {
    JsBarcode(svgRef.value, props.value, {
      format: 'CODE128',
      width: 1,
      height: 38,
      displayValue: false,
      margin: 0,
      background: '#ffffff',
      lineColor: '#151515',
    })
  }
}

onMounted(render)
watch(() => [props.value, props.mode], render)
</script>

<template>
  <img v-if="mode === 'qr' && qrData" class="barcode-mark" :src="qrData" :alt="value" />
  <svg v-else-if="mode === 'code128'" ref="svgRef" class="barcode-mark" />
</template>
