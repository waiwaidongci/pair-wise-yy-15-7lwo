<script setup lang="ts">
import { computed, onUnmounted, ref, watchEffect } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { DownloadIcon, PrintIcon } from 'tdesign-icons-vue-next'
import { useLabelStore } from '../stores/labelStore'
import LabelSheet from '../components/LabelSheet.vue'
import { exportPrintableHtml, exportTemplateConfig } from '../utils/exporters'
import { labelsPerPage } from '../utils/layout'

const store = useLabelStore()
const zoom = ref(0.7)
const pages = computed(() =>
  Math.max(1, Math.ceil(store.specimens.length / labelsPerPage(store.activeTemplate))),
)
const pageIndexes = computed(() => Array.from({ length: pages.value }, (_, index) => index))
let pageStyle: HTMLStyleElement | null = null

watchEffect(() => {
  if (!pageStyle) {
    pageStyle = document.createElement('style')
    pageStyle.dataset.labelPrintPage = 'true'
    document.head.appendChild(pageStyle)
  }
  pageStyle.textContent = `@media print { @page { size: ${store.activeTemplate.paperWidthMm}mm ${store.activeTemplate.paperHeightMm}mm; margin: 0; } }`
})

onUnmounted(() => {
  pageStyle?.remove()
  pageStyle = null
})

function printNow() {
  window.print()
}

async function exportHtml() {
  await exportPrintableHtml(store.specimens, store.activeTemplate)
  MessagePlugin.success('可打印 HTML 已生成')
}
</script>

<template>
  <div class="page-stack print-page">
    <section class="page-heading">
      <div>
        <h2>打印预览</h2>
        <p>屏幕预览、浏览器打印和导出文件使用同一套毫米坐标与分页模型。</p>
      </div>
      <t-space>
        <t-button variant="outline" @click="exportTemplateConfig(store.activeTemplate)"><DownloadIcon />导出排版配置</t-button>
        <t-button variant="outline" @click="exportHtml"><DownloadIcon />导出可打印文件</t-button>
        <t-button theme="primary" @click="printNow"><PrintIcon />打印标签</t-button>
      </t-space>
    </section>

    <section class="print-toolbar">
      <div>
        <strong>{{ store.activeTemplate.name }}</strong>
        <span>{{ store.activeTemplate.paperWidthMm }} × {{ store.activeTemplate.paperHeightMm }} mm · {{ store.activeTemplate.columns }} 栏 · 共 {{ store.specimens.length }} 张</span>
      </div>
      <div class="zoom-tools">
        <t-button size="small" variant="outline" @click="zoom = Math.max(.3, zoom - .07)">−</t-button>
        <span>{{ Math.round(zoom * 100) }}%</span>
        <t-button size="small" variant="outline" @click="zoom = Math.min(1.1, zoom + .07)">＋</t-button>
        <t-button size="small" variant="outline" @click="zoom = 1">实际大小</t-button>
      </div>
    </section>

    <section class="print-stage">
      <div class="print-pages">
        <div
          v-for="pageIndex in pageIndexes"
          :key="pageIndex"
          class="print-page-wrap"
        >
          <span class="print-page-label">第 {{ pageIndex + 1 }} / {{ pages }} 页</span>
          <div :style="{ transform: `scale(${zoom})`, transformOrigin: 'top left' }">
            <LabelSheet
              :specimens="store.specimens"
              :template="store.activeTemplate"
              :page-index="pageIndex"
            />
          </div>
        </div>
      </div>
    </section>

    <section class="print-notes">
      <article>
        <strong>分页模型</strong>
        <span>每页 {{ labelsPerPage(store.activeTemplate) }} 张，页间硬分页，不使用浏览器自动折行。</span>
      </article>
      <article>
        <strong>打印设置</strong>
        <span>打印对话框中选择“实际大小 / 100%”，关闭“适合页面”缩放。</span>
      </article>
      <article>
        <strong>成品文件</strong>
        <span>导出的 HTML 保留纸张、边距、边框、字体与识别码，可直接再次打印。</span>
      </article>
    </section>
  </div>
</template>

<style>
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  body { background: #fff !important; }
  .app-sider, .app-header, .print-toolbar, .print-notes, .page-heading, .print-page-label { display: none !important; }
  .app-shell, .app-workspace, .app-content, .print-stage, .print-pages { display: block !important; width: auto !important; height: auto !important; overflow: visible !important; padding: 0 !important; background: #fff !important; }
  .print-page-wrap { margin: 0 !important; break-after: page; }
  .print-page-wrap > div { transform: none !important; }
  .label-sheet { box-shadow: none !important; }
}
</style>
