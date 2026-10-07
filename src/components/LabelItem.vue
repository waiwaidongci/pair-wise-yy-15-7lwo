<script setup lang="ts">
import { computed } from 'vue'
import type { LabelTemplate, Specimen } from '../types/label'
import { formatDate, scientificFontScale } from '../utils/layout'
import BarcodeMark from './BarcodeMark.vue'

const props = defineProps<{
  specimen: Specimen
  template: LabelTemplate
  seqLabel?: string
}>()

const scale = computed(() => scientificFontScale(props.specimen.scientificName, props.template))
const style = computed(() => ({
  borderWidth: `${props.template.borderWidthMm}mm`,
  borderStyle: props.template.borderStyle,
  fontSize: `${props.template.fontSizePt}pt`,
  lineHeight: `${props.template.lineHeightMm}mm`,
  gridTemplateColumns:
    props.template.barcodeMode === 'none' ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) 14mm',
}))
</script>

<template>
  <article class="label-item" :style="style">
    <div class="label-item__main">
      <div class="label-item__top">
        <strong>{{ specimen.taxonName || '待鉴定类群' }}</strong>
        <span>{{ specimen.accessionNo || '编号待补' }}</span>
      </div>
      <div
        class="label-item__scientific"
        :style="{
          fontSize: `${template.fontSizePt * scale}pt`,
          fontStyle: template.italicScientific ? 'italic' : 'normal',
        }"
      >
        {{ specimen.scientificName || '学名待补' }}
      </div>
      <div v-if="template.includeCollection" class="label-item__line">{{ specimen.locality || '采集地待补' }}</div>
      <div v-if="template.includeCollection" class="label-item__line">
        {{ formatDate(specimen.collectedAt) }} · {{ specimen.collector || '采集人待补' }}
        <template v-if="template.includeHabitat && specimen.habitat"> · {{ specimen.habitat }}</template>
      </div>
      <div v-if="template.includeNotes && specimen.notes" class="label-item__line">
        {{ specimen.notes }}
      </div>
    </div>
    <div class="label-item__mark" v-if="template.barcodeMode !== 'none'">
      <BarcodeMark :value="specimen.accessionNo" :mode="template.barcodeMode" />
    </div>
    <span v-if="seqLabel" class="label-item__seq">{{ seqLabel }}</span>
  </article>
</template>

<style scoped>
.label-item {
  display: grid;
  position: relative;
  min-width: 0;
  min-height: 0;
  padding: 1.3mm 1.5mm;
  gap: 1mm;
  overflow: hidden;
  border-color: #222;
  color: #141414;
  font-family: "Songti SC", "SimSun", serif;
}
.label-item__main { min-width: 0; overflow: hidden; }
.label-item__top { display: flex; justify-content: space-between; gap: .8mm; white-space: nowrap; }
.label-item__top strong { overflow: hidden; text-overflow: ellipsis; }
.label-item__top span { font-family: Menlo, monospace; font-size: .78em; }
.label-item__scientific {
  min-height: 3.5mm;
  font-family: "Times New Roman", serif;
  line-height: 3.5mm;
  white-space: normal;
  overflow-wrap: anywhere;
}
.label-item__line { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.label-item__mark { display: grid; min-width: 0; place-items: center; }
.label-item__mark :deep(.barcode-mark) { display: block; width: 100%; height: 15mm; object-fit: contain; }
.label-item__seq {
  position: absolute;
  left: .9mm;
  bottom: .3mm;
  padding: 0 1mm;
  border-radius: 1mm;
  background: rgba(34, 34, 34, .82);
  color: #fff;
  font-family: Menlo, monospace;
  font-size: 2.6mm;
  line-height: 3.6mm;
}
</style>
