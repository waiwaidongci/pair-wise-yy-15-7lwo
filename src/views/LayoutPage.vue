<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useLabelStore } from '../stores/labelStore'
import LabelSheet from '../components/LabelSheet.vue'
import type { BorderStyle } from '../types/label'
import { barcodeLabel, labelInnerWidth, labelsPerPage, rowsPerPage } from '../utils/layout'

const store = useLabelStore()
const zoom = ref(0.68)
const previewSpecimens = computed(() =>
  store.selectedSpecimenIds.length
    ? store.specimens.filter((item) => store.selectedSpecimenIds.includes(item.id))
    : store.specimens.slice(0, labelsPerPage(store.activeTemplate)),
)
const template = computed(() => store.activeTemplate)

watch(
  () => template.value.id,
  () => {
    const value = Number(localStorage.getItem(`label-zoom-${template.value.id}`))
    if (value >= 0.35 && value <= 1.2) zoom.value = value
  },
  { immediate: true },
)

function updateNumber(key: keyof typeof template.value, value: number | string) {
  store.updateTemplate({ [key]: Number(value) })
}

function updateBoolean(key: keyof typeof template.value, value: string | number | boolean) {
  store.updateTemplate({ [key]: Boolean(value) })
}

function setZoom(value: number) {
  zoom.value = Math.min(1.2, Math.max(0.35, value))
  localStorage.setItem(`label-zoom-${template.value.id}`, String(zoom.value))
}
</script>

<template>
  <div class="page-grid layout-page">
    <section class="control-panel">
      <div class="panel-heading">
        <div>
          <span>模板参数</span>
          <strong>{{ template.name }}</strong>
        </div>
        <t-button size="small" variant="outline" @click="store.saveAsTemplate(`标签模板 ${store.templates.length + 1}`); MessagePlugin.success('已另存为新模板')">
          另存模板
        </t-button>
      </div>
      <t-form label-align="left" label-width="92px" size="small">
        <t-form-item label="纸张宽 mm">
          <t-input-number
            :model-value="template.paperWidthMm"
            :min="50"
            :max="600"
            :step="1"
            theme="column"
            @change="(value: any) => updateNumber('paperWidthMm', value as number)"
          />
        </t-form-item>
        <t-form-item label="纸张高 mm">
          <t-input-number
            :model-value="template.paperHeightMm"
            :min="50"
            :max="600"
            :step="1"
            theme="column"
            @change="(value: any) => updateNumber('paperHeightMm', value as number)"
          />
        </t-form-item>
        <div class="field-caption">边距（毫米）</div>
        <div class="two-column">
          <t-input-number
            label="上"
            :model-value="template.marginTopMm"
            :min="0"
            :max="50"
            :step="0.5"
            @change="(value: any) => updateNumber('marginTopMm', value as number)"
          />
          <t-input-number
            label="右"
            :model-value="template.marginRightMm"
            :min="0"
            :max="50"
            :step="0.5"
            @change="(value: any) => updateNumber('marginRightMm', value as number)"
          />
          <t-input-number
            label="下"
            :model-value="template.marginBottomMm"
            :min="0"
            :max="50"
            :step="0.5"
            @change="(value: any) => updateNumber('marginBottomMm', value as number)"
          />
          <t-input-number
            label="左"
            :model-value="template.marginLeftMm"
            :min="0"
            :max="50"
            :step="0.5"
            @change="(value: any) => updateNumber('marginLeftMm', value as number)"
          />
        </div>
        <div class="two-column">
          <t-input-number
            label="栏数"
            :model-value="template.columns"
            :min="1"
            :max="8"
            :step="1"
            @change="(value: any) => updateNumber('columns', value as number)"
          />
          <t-input-number
            label="行高 mm"
            :model-value="template.rowHeightMm"
            :min="10"
            :max="80"
            :step="0.5"
            @change="(value: any) => updateNumber('rowHeightMm', value as number)"
          />
          <t-input-number
            label="栏间距"
            :model-value="template.columnGapMm"
            :min="0"
            :max="20"
            :step="0.5"
            @change="(value: any) => updateNumber('columnGapMm', value as number)"
          />
          <t-input-number
            label="行间距"
            :model-value="template.rowGapMm"
            :min="0"
            :max="20"
            :step="0.5"
            @change="(value: any) => updateNumber('rowGapMm', value as number)"
          />
          <t-input-number
            label="行距 mm"
            :model-value="template.lineHeightMm"
            :min="2"
            :max="12"
            :step="0.1"
            @change="(value: any) => updateNumber('lineHeightMm', value as number)"
          />
          <t-input-number
            label="字号 pt"
            :model-value="template.fontSizePt"
            :min="4"
            :max="18"
            :step="0.5"
            @change="(value: any) => updateNumber('fontSizePt', value as number)"
          />
        </div>
        <div class="two-column">
          <t-input-number
            label="边框 mm"
            :model-value="template.borderWidthMm"
            :min="0"
            :max="2"
            :step="0.1"
            @change="(value: any) => updateNumber('borderWidthMm', value as number)"
          />
          <t-select
            :model-value="template.borderStyle"
            @change="(value: any) => store.updateTemplate({ borderStyle: value as BorderStyle })"
          >
            <t-option value="solid" label="实线" />
            <t-option value="dashed" label="虚线" />
            <t-option value="dotted" label="点线" />
          </t-select>
        </div>
        <t-form-item label="标签识别">
          <t-radio-group
            :model-value="template.barcodeMode"
            variant="default-filled"
            @change="(value: any) => store.updateTemplate({ barcodeMode: value as typeof template.barcodeMode })"
          >
            <t-radio-button value="qr">二维码</t-radio-button>
            <t-radio-button value="code128">条码</t-radio-button>
            <t-radio-button value="none">不打印</t-radio-button>
          </t-radio-group>
        </t-form-item>
        <div class="switch-row">
          <t-checkbox
            :checked="template.italicScientific"
            @change="(value: any) => updateBoolean('italicScientific', value)"
          >
            拉丁学名斜体
          </t-checkbox>
          <t-checkbox
            :checked="template.includeCollection"
            @change="(value: any) => updateBoolean('includeCollection', value)"
          >
            采集信息
          </t-checkbox>
          <t-checkbox
            :checked="template.includeHabitat"
            @change="(value: any) => updateBoolean('includeHabitat', value)"
          >
            生境
          </t-checkbox>
          <t-checkbox
            :checked="template.includeNotes"
            @change="(value: any) => updateBoolean('includeNotes', value)"
          >
            备注
          </t-checkbox>
        </div>
      </t-form>
      <div class="layout-summary">
        <span>单张标签宽 <strong>{{ labelInnerWidth(template).toFixed(1) }} mm</strong></span>
        <span>每页行数 <strong>{{ rowsPerPage(template) }}</strong></span>
        <span>每页容量 <strong>{{ labelsPerPage(template) }}</strong></span>
        <span>识别方式 <strong>{{ barcodeLabel(template.barcodeMode) }}</strong></span>
      </div>
    </section>

    <section class="preview-panel">
      <div class="preview-toolbar">
        <div>
          <strong>实时版面预览</strong>
          <span>纸张与标签均按真实毫米尺寸渲染</span>
        </div>
        <div class="zoom-tools">
          <t-button size="small" variant="outline" @click="setZoom(zoom - 0.08)">−</t-button>
          <span>{{ Math.round(zoom * 100) }}%</span>
          <t-button size="small" variant="outline" @click="setZoom(zoom + 0.08)">＋</t-button>
          <t-button size="small" variant="outline" @click="setZoom(1)">100%</t-button>
        </div>
      </div>
      <div class="preview-stage">
        <div class="preview-scaler" :style="{ transform: `scale(${zoom})` }">
          <LabelSheet :specimens="previewSpecimens" :template="template" />
        </div>
      </div>
      <div class="preview-footnote">
        预览第 1 页，共 {{ Math.max(1, Math.ceil(previewSpecimens.length / labelsPerPage(template))) }} 页
      </div>
    </section>
  </div>
</template>
