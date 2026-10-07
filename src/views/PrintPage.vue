<script setup lang="ts">
import { computed, onUnmounted, ref, watchEffect } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { DownloadIcon, PrintIcon } from 'tdesign-icons-vue-next'
import { useLabelStore } from '../stores/labelStore'
import { useBatchStore } from '../stores/batchStore'
import LabelSheet from '../components/LabelSheet.vue'
import { exportPrintableHtml, exportTemplateConfig } from '../utils/exporters'
import type { PrintBatch } from '../types/label'

const store = useLabelStore()
const batchStore = useBatchStore()
const zoom = ref(0.7)

const statusMeta: Record<PrintBatch['status'], { label: string; theme: 'default' | 'primary' | 'success' | 'danger' | 'warning' }> = {
  queued: { label: '已预排', theme: 'warning' },
  printing: { label: '打印中', theme: 'primary' },
  done: { label: '已打完', theme: 'success' },
  invalid: { label: '已失效', theme: 'danger' },
}

/** 展示顺序：打完的在前（留住顺序），其次打印中、预排、失效。 */
const orderedBatches = computed(() => {
  const weight: Record<PrintBatch['status'], number> = { done: 0, printing: 1, queued: 2, invalid: 3 }
  return [...batchStore.batches].sort((a, b) => {
    if (weight[a.status] !== weight[b.status]) return weight[a.status] - weight[b.status]
    return a.batchNo - b.batchNo
  })
})

/** 用于导出的当前批次：打印中 → 预排 → 最近打完。 */
const exportBatch = computed(
  () =>
    batchStore.printingBatches[0] ??
    batchStore.queuedBatches[0] ??
    batchStore.doneBatches[0] ??
    null,
)

const exportLabels = computed(() => {
  if (exportBatch.value) return exportBatch.value.labels
  return batchStore.queue.map((specimen) => ({ specimen, serial: undefined }))
})
const exportTemplate = computed(() => exportBatch.value?.template ?? store.activeTemplate)

/** 正在打印的批次 id（打印样式只输出这一批）。 */
const printingBatchId = ref<string | null>(null)

/** 写入失败后的重试凭据。 */
const retryable = ref<{ message: string; action: () => void } | null>(null)

let pageStyle: HTMLStyleElement | null = null
watchEffect(() => {
  if (!pageStyle) {
    pageStyle = document.createElement('style')
    pageStyle.dataset.labelPrintPage = 'true'
    document.head.appendChild(pageStyle)
  }
  pageStyle.textContent = `@media print { @page { size: ${exportTemplate.value.paperWidthMm}mm ${exportTemplate.value.paperHeightMm}mm; margin: 0; } }`
})

onUnmounted(() => {
  pageStyle?.remove()
  pageStyle = null
})

function rangeOf(batch: PrintBatch) {
  const [from, to] = batchStore.serialRange(batch)
  return from === 0 ? '—' : `序号 ${from}–${to}`
}

function formatTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 触发浏览器打印，并在打印结束后把该批落账为已打完。 */
function triggerPrint(batch: PrintBatch, options: { markDone: boolean }) {
  printingBatchId.value = batch.id
  const afterPrint = () => {
    window.removeEventListener('afterprint', afterPrint)
    printingBatchId.value = null
    if (!options.markDone) return
    const result = batchStore.markDone(batch.id)
    if (!result.ok) {
      retryable.value = {
        message: '打印结果写入失败，原清单与批次顺序均保留，可重试落账。',
        action: () => {
          const retry = batchStore.markDone(batch.id)
          if (retry.ok) {
            retryable.value = null
            MessagePlugin.success(`第 ${batch.batchNo} 批已落账，顺序留住`)
          } else {
            MessagePlugin.error('写入仍失败，请稍后重试')
          }
        },
      }
      MessagePlugin.warning('打印结果写入失败，可重试落账')
      return
    }
    MessagePlugin.success(`第 ${batch.batchNo} 批已打完，序号 ${rangeOf(batch)} 已留住`)
  }
  window.addEventListener('afterprint', afterPrint)
  window.print()
}

/** 开打新批次：抢占/建批成功后直接打印。 */
function startAndPrint() {
  const result = batchStore.startNextBatch()
  if (!result.ok) {
    if (result.reason === 'printing') {
      MessagePlugin.warning(`该批次已被 ${result.by || '其它馆员'} 开打，请稍候`)
    } else if (result.reason === 'empty') {
      MessagePlugin.info('待打印队列为空，没有可开打的标签')
    } else if (result.reason === 'write-failed') {
      retryable.value = {
        message: '批次写入失败，原清单与队列均保留，可重试开打。',
        action: () => startAndPrint(),
      }
      MessagePlugin.error('批次写入失败，可重试')
    }
    return
  }
  MessagePlugin.success(`第 ${result.batch.batchNo} 批已开打，${rangeOf(result.batch)}，共 ${result.batch.labels.length} 张`)
  triggerPrint(result.batch, { markDone: true })
}

/** 预排：把整个队列按当前模板容量切成若干已预排批次（序号按页容量定好）。 */
function planAll() {
  const result = batchStore.planBatches()
  if (!result.ok) {
    if (result.reason === 'empty') MessagePlugin.info('待打印队列为空，没有可预排的标签')
    else if (result.reason === 'write-failed') {
      retryable.value = {
        message: '预排写入失败，原清单与队列均保留，可重试。',
        action: () => planAll(),
      }
      MessagePlugin.error('预排写入失败，可重试')
    }
    return
  }
  MessagePlugin.success(`已预排 ${result.planned} 个批次，序号按每页 ${batchStore.currentCapacity} 张定好`)
}

/** 对已预排批次开打：抢占（先到先得）成功后打印。 */
function claimAndPrint(batch: PrintBatch) {
  const result = batchStore.claimBatch(batch.id)
  if (!result.ok) {
    if (result.reason === 'printing') {
      MessagePlugin.warning(`该批次已被 ${result.by || '其它馆员'} 开打`)
    } else if (result.reason === 'write-failed') {
      retryable.value = {
        message: '抢占写入失败，原清单与批次顺序均保留，可重试。',
        action: () => claimAndPrint(batch),
      }
      MessagePlugin.error('抢占写入失败，可重试')
    }
    return
  }
  MessagePlugin.success(`第 ${batch.batchNo} 批已开打，${rangeOf(batch)}`)
  triggerPrint(result.batch, { markDone: true })
}

function markDoneManually(batch: PrintBatch) {
  const result = batchStore.markDone(batch.id)
  if (!result.ok) {
    retryable.value = {
      message: '落账写入失败，原清单与批次顺序均保留，可重试。',
      action: () => markDoneManually(batch),
    }
    MessagePlugin.error('落账写入失败，可重试')
    return
  }
  MessagePlugin.success(`第 ${batch.batchNo} 批已打完，顺序留住`)
}

function releaseManually(batch: PrintBatch) {
  const result = batchStore.releaseBatch(batch.id)
  if (!result.ok) {
    MessagePlugin.error('释放失败，请重试')
    return
  }
  MessagePlugin.info(`第 ${batch.batchNo} 批已释放，回到已预排队列`)
}

/** 重新打印已打完的批次（不改状态）。 */
function reprint(batch: PrintBatch) {
  triggerPrint(batch, { markDone: false })
}

async function exportHtml() {
  await exportPrintableHtml(exportLabels.value, exportTemplate.value)
  MessagePlugin.success('可打印 HTML 已生成')
}
</script>

<template>
  <div class="page-stack print-page">
    <section class="page-heading">
      <div>
        <h2>打印预览</h2>
        <p>模板、标本清单与打印批次已接通：开打时按当页容量定序号，超量标签排队到下一批。</p>
      </div>
      <t-space>
        <t-button variant="outline" @click="exportTemplateConfig(store.activeTemplate)"><DownloadIcon />导出排版配置</t-button>
        <t-button variant="outline" @click="exportHtml"><DownloadIcon />导出可打印文件</t-button>
        <t-button variant="outline" @click="planAll">预排批次</t-button>
        <t-button theme="primary" @click="startAndPrint"><PrintIcon />开打新批次</t-button>
      </t-space>
    </section>

    <section class="batch-toolbar">
      <div class="batch-summary">
        <div class="batch-summary__item">
          <span>待打印队列</span>
          <strong>{{ batchStore.queue.length }}</strong><small>张</small>
        </div>
        <div class="batch-summary__item">
          <span>当前模板每页</span>
          <strong>{{ batchStore.currentCapacity }}</strong><small>张</small>
        </div>
        <div class="batch-summary__item">
          <span>剩余约需</span>
          <strong>{{ batchStore.queuedPages }}</strong><small>页（批）</small>
        </div>
        <div class="batch-summary__item">
          <span>下一张序号</span>
          <strong>№ {{ batchStore.nextSerial }}</strong>
        </div>
        <div class="batch-summary__item">
          <span>已预排批次</span>
          <strong>{{ batchStore.queuedBatches.length }}</strong><small>批</small>
        </div>
        <div class="batch-summary__item">
          <span>本馆馆员</span>
          <strong>{{ batchStore.librarianId }}</strong>
        </div>
      </div>
      <div class="zoom-tools">
        <t-button size="small" variant="outline" @click="zoom = Math.max(.3, zoom - .07)">−</t-button>
        <span>{{ Math.round(zoom * 100) }}%</span>
        <t-button size="small" variant="outline" @click="zoom = Math.min(1.1, zoom + .07)">＋</t-button>
        <t-button size="small" variant="outline" @click="zoom = 1">实际大小</t-button>
      </div>
    </section>

    <section v-if="retryable" class="retry-banner">
      <span>{{ retryable.message }}</span>
      <t-button size="small" theme="primary" @click="retryable.action()">重试</t-button>
    </section>

    <section v-if="!batchStore.batches.length" class="empty-batches">
      <p>还没有打印批次。点击右上角「开打新批次」，系统会按当前模板容量从队列取标签、定下序号并冻结模板。</p>
    </section>

    <section class="batch-list">
      <article
        v-for="batch in orderedBatches"
        :key="batch.id"
        class="batch-card"
        :class="{ 'batch-card--printing': batch.status === 'printing' }"
        :data-printing="printingBatchId === batch.id"
      >
        <div class="batch-card__head">
          <div class="batch-card__title">
            <strong>第 {{ batch.batchNo }} 批</strong>
            <t-tag :theme="statusMeta[batch.status].theme" variant="light">{{ statusMeta[batch.status].label }}</t-tag>
            <span class="batch-card__range">{{ rangeOf(batch) }}</span>
            <span class="batch-card__count">{{ batch.labels.length }} 张 / 每页 {{ batch.capacity }}</span>
          </div>
          <div class="batch-card__actions">
            <t-button
              v-if="batch.status === 'queued'"
              size="small"
              theme="primary"
              @click="claimAndPrint(batch)"
            >
              <PrintIcon />开打打印
            </t-button>
            <template v-if="batch.status === 'printing'">
              <t-button size="small" theme="primary" @click="triggerPrint(batch, { markDone: true })">
                <PrintIcon />继续打印
              </t-button>
              <t-button size="small" variant="outline" @click="markDoneManually(batch)">完成打印</t-button>
              <t-button size="small" variant="text" @click="releaseManually(batch)">取消并释放</t-button>
            </template>
            <t-button v-if="batch.status === 'done'" size="small" variant="outline" @click="reprint(batch)">
              重新打印
            </t-button>
          </div>
        </div>

        <div class="batch-card__meta">
          <span>模板：{{ batch.template.name }}（{{ batch.template.paperWidthMm }}×{{ batch.template.paperHeightMm }}mm · {{ batch.template.columns }} 栏 · {{ batch.template.fontSizePt }}pt）</span>
          <span v-if="batch.claimedBy">开打馆员：{{ batch.claimedBy }}</span>
          <span v-if="batch.finishedAt">打完时间：{{ formatTime(batch.finishedAt) }}</span>
          <span v-if="batch.invalidReason" class="batch-card__invalid">失效原因：{{ batch.invalidReason }}，标签已回到队列</span>
        </div>

        <div class="batch-card__preview">
          <div class="batch-sheet-scaler" :style="{ transform: `scale(${zoom})`, transformOrigin: 'top left' }">
            <LabelSheet :labels="batch.labels" :template="batch.template" />
          </div>
        </div>
      </article>
    </section>

    <section class="print-notes">
      <article>
        <strong>批次与序号</strong>
        <span>开打时按当前模板容量定下每张标签的序号，超出容量的标签留在队列；序号全局连续，打完的批次顺序永久留住。</span>
      </article>
      <article>
        <strong>并发抢占</strong>
        <span>两位馆员同时开打同一批时，先抢占的批次成立，后到的会看到“已被开打”，不会重复出批。</span>
      </article>
      <article>
        <strong>模板变更</strong>
        <span>模板或栏数一改动，未开打的批次立即失效并重算页数；已开打和已打完的批次保留冻结模板与序号。</span>
      </article>
      <article>
        <strong>写入失败</strong>
        <span>批次写入失败时原清单与队列不动，页面提供重试；落账失败也可重试，顺序不丢。</span>
      </article>
    </section>
  </div>
</template>

<style>
.batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  background: #fff;
  border: 1px solid #e3e8e5;
  border-radius: 12px;
}
.batch-summary { display: flex; flex-wrap: wrap; gap: 22px; }
.batch-summary__item { display: flex; align-items: baseline; gap: 6px; }
.batch-summary__item span { color: #6b7672; font-size: 13px; }
.batch-summary__item strong { font-size: 20px; color: #1f3a2e; }
.batch-summary__item small { color: #8a948f; }

.retry-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #fff7e6;
  border: 1px solid #ffd591;
  border-radius: 10px;
  color: #874d00;
}

.empty-batches {
  padding: 28px;
  text-align: center;
  color: #6b7672;
  background: #fff;
  border: 1px dashed #cfd8d3;
  border-radius: 12px;
}

.batch-list { display: flex; flex-direction: column; gap: 18px; }
.batch-card {
  background: #fff;
  border: 1px solid #e3e8e5;
  border-radius: 12px;
  overflow: hidden;
}
.batch-card--printing { border-color: #2c7a52; box-shadow: 0 0 0 2px rgba(44, 122, 82, 0.12); }
.batch-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #eef1ef;
}
.batch-card__title { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.batch-card__title strong { font-size: 16px; }
.batch-card__range { font-family: Menlo, monospace; font-size: 13px; color: #2c7a52; }
.batch-card__count { font-size: 13px; color: #6b7672; }
.batch-card__actions { display: flex; gap: 8px; }
.batch-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 8px 16px;
  font-size: 12.5px;
  color: #6b7672;
}
.batch-card__invalid { color: #c0392b; }
.batch-card__preview {
  padding: 18px;
  background: #f4f6f5;
  overflow: auto;
}
.batch-sheet-scaler { display: inline-block; }

@media print {
  @page { margin: 0; }
  body { background: #fff !important; }
  .app-sider, .app-header, .page-heading, .batch-toolbar, .retry-banner,
  .batch-card__head, .batch-card__meta, .batch-card__actions,
  .zoom-tools, .print-notes, .empty-batches { display: none !important; }
  .app-shell, .app-workspace, .app-content, .batch-list, .batch-card,
  .batch-card__preview { display: block !important; width: auto !important; height: auto !important; overflow: visible !important; padding: 0 !important; margin: 0 !important; background: #fff !important; box-shadow: none !important; border: none !important; }
  .batch-card { display: none !important; break-after: page; }
  .batch-card[data-printing="true"] { display: block !important; }
  .batch-sheet-scaler { transform: none !important; display: block !important; }
  .label-sheet { box-shadow: none !important; }
}
</style>
