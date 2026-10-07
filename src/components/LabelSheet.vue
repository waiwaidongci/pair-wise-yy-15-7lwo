<script setup lang="ts">
import { computed } from 'vue'
import type { BatchLabel, LabelTemplate, Specimen } from '../types/label'
import { labelInnerWidth, labelsPerPage, rowsPerPage } from '../utils/layout'
import LabelItem from './LabelItem.vue'

const props = defineProps<{
  specimens?: Specimen[]
  /** 打印批次的标签（含固定序号）；提供时优先于 specimens */
  labels?: BatchLabel[]
  template: LabelTemplate
  pageIndex?: number
}>()

const pageItems = computed<BatchLabel[]>(() => {
  if (props.labels) return props.labels
  const perPage = labelsPerPage(props.template)
  const page = props.pageIndex || 0
  return (props.specimens ?? []).slice(page * perPage, page * perPage + perPage).map((specimen) => ({
    specimen,
    serial: undefined,
  }))
})

const sheetStyle = computed(() => ({
  width: `${props.template.paperWidthMm}mm`,
  height: `${props.template.paperHeightMm}mm`,
  paddingTop: `${props.template.marginTopMm}mm`,
  paddingRight: `${props.template.marginRightMm}mm`,
  paddingBottom: `${props.template.marginBottomMm}mm`,
  paddingLeft: `${props.template.marginLeftMm}mm`,
  gridTemplateColumns: `repeat(${props.template.columns}, ${labelInnerWidth(props.template)}mm)`,
  gridAutoRows: `${props.template.rowHeightMm}mm`,
  columnGap: `${props.template.columnGapMm}mm`,
  rowGap: `${props.template.rowGapMm}mm`,
}))
</script>

<template>
  <section class="label-sheet" :style="sheetStyle">
    <LabelItem
      v-for="item in pageItems"
      :key="item.specimen.id"
      :specimen="item.specimen"
      :template="template"
      :serial="item.serial"
    />
    <div
      v-for="index in Math.max(0, labelsPerPage(template) - pageItems.length)"
      :key="`empty-${index}`"
      class="empty-label"
      :style="{ height: `${template.rowHeightMm}mm` }"
    />
    <div class="sheet-rule" :style="{ top: `${rowsPerPage(template) * (template.rowHeightMm + template.rowGapMm)}mm` }" />
  </section>
</template>

<style scoped>
.label-sheet {
  display: grid;
  position: relative;
  flex: 0 0 auto;
  align-content: start;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 12px 35px rgba(23, 45, 34, .14);
}
.empty-label { opacity: 0; }
.sheet-rule {
  position: absolute;
  right: 0;
  left: 0;
  display: none;
  border-top: 1px dashed rgba(33, 67, 52, .18);
}
</style>
