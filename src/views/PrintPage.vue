<script setup lang="ts">
import { computed, onUnmounted, ref, watchEffect } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import {
  CheckCircleIcon,
  DownloadIcon,
  PrintIcon,
  RefreshIcon,
  RollbackIcon,
} from 'tdesign-icons-vue-next'
import { useLabelStore } from '../stores/labelStore'
import { usePrintStore } from '../stores/printStore'
import LabelSheet from '../components/LabelSheet.vue'
import { exportPrintableHtml, exportTemplateConfig } from '../utils/exporters'
import { labelsPerPage } from '../utils/layout'
import type { PrintBatch, Specimen } from '../types/label'

const labelStore = useLabelStore()
const printStore = usePrintStore()

const zoom = ref(0.7)
const runDialogVisible = ref(false)
const runName = ref('')
const runScope = ref<'all' | 'selected' | 'valid'>('valid')
const busy = ref(false)
const stationEditor = ref(false)
const stationNameInput = ref(printStore.station.name)

const template = computed(() => labelStore.activeTemplate)
const capacity = computed(() => labelsPerPage(template.value))
const selectableSpecimens = computed(() =>
  labelStore.selectedSpecimenIds.length
    ? labelStore.specimens.filter((item) => labelStore.selectedSpecimenIds.includes(item.id))
    : [],
)
const validSpecimens = computed(() => {
  const errorIds = new Set(
    labelStore.issues.filter((issue) => issue.severity === 'error').map((issue) => issue.specimenId),
  )
  return labelStore.specimens.filter((item) => !errorIds.has(item.id))
})
const runSpecimens = computed<Specimen[]>(() => {
  if (runScope.value === 'selected') return selectableSpecimens.value
  if (runScope.value === 'all') return labelStore.specimens
  return validSpecimens.value
})
const plannedPageCount = computed(() =>
  Math.max(1, Math.ceil(runSpecimens.value.length / capacity.value)),
)
/** 本工位锁定中的批次；打印纸尺寸以它冻结的模板快照为准，开打后改模板也不变 */
const myPrintingBatch = computed(
  () =>
    printStore.activeBatches.find(
      (batch) => batch.status === 'printing' && batch.claimedBy === printStore.station.id,
    ) ?? null,
)
const printTemplate = computed(() => myPrintingBatch.value?.templateSnapshot ?? template.value)

let pageStyle: HTMLStyleElement | null = null
watchEffect(() => {
  if (!pageStyle) {
    pageStyle = document.createElement('style')
    pageStyle.dataset.labelPrintPage = 'true'
    document.head.appendChild(pageStyle)
  }
  pageStyle.textContent = `@media print { @page { size: ${printTemplate.value.paperWidthMm}mm ${printTemplate.value.paperHeightMm}mm; margin: 0; } }`
})
onUnmounted(() => {
  pageStyle?.remove()
  pageStyle = null
})

function batchEntries(batch: PrintBatch) {
  return batch.labels.map((label) => ({ specimen: label.specimenSnapshot, seqNo: label.seqNo }))
}

function rangeLabel(batch: PrintBatch) {
  if (batch.status === 'queued') return `待锁定 ${batch.labels.length} 张`
  const first = batch.labels[0]?.seqNo
  const last = batch.labels[batch.labels.length - 1]?.seqNo
  return first && last ? `${printStore.formatSeq(first)} – ${printStore.formatSeq(last)}` : `${batch.labels.length} 张`
}

function statusTheme(batch: PrintBatch) {
  if (batch.status === 'printed') return 'success'
  if (batch.status === 'printing') return 'warning'
  return 'default'
}
function statusText(batch: PrintBatch) {
  if (batch.status === 'printed') return '已打完'
  if (batch.status === 'printing') {
    return batch.claimedBy === printStore.station.id
      ? '本机开打中'
      : `${batch.claimedByName ?? '另一工位'} 开打中`
  }
  return '排队中'
}

function openRunDialog() {
  runName.value = `${template.value.name} · ${new Date().toLocaleDateString('zh-CN')}`
  runScope.value = selectableSpecimens.value.length ? 'selected' : 'valid'
  runDialogVisible.value = true
}

function createRun() {
  const specimens = runSpecimens.value
  if (!specimens.length) {
    MessagePlugin.warning('当前范围里没有可入队的标本记录')
    return
  }
  const run = printStore.enqueueRun(runName.value, specimens, template.value)
  runDialogVisible.value = false
  if (run) MessagePlugin.success(`已入队 ${specimens.length} 张，按每页 ${capacity.value} 张排成 ${plannedPageCount.value} 批`)
}

async function startNext() {
  if (busy.value) return
  busy.value = true
  try {
    // 两位馆员同时提交：仲裁窗口结束后只有先到的那批成立
    const result = await printStore.claimNextBatch()
    if (result.ok) {
      MessagePlugin.success(`本批序号已锁定 ${rangeLabel(result.batch)}，确认打印设置后可直接打印`)
    } else if (result.reason === 'lost') {
      MessagePlugin.warning(`手慢一步，这批已被 ${result.winner?.name ?? '另一位馆员'} 锁定开打`)
    } else {
      MessagePlugin.info('队列里没有排队中的批次了')
    }
  } finally {
    busy.value = false
  }
}

function printBatch(batch: PrintBatch) {
  if (batch.status !== 'printing' || batch.claimedBy !== printStore.station.id) return
  window.print()
}

function finishBatch(batch: PrintBatch) {
  printStore.confirmPrinted(batch.id)
  MessagePlugin.success(`第 ${batch.ordinal + 1} 批已确认打完，序号 ${rangeLabel(batch)} 留档`)
}

function releaseBatch(batch: PrintBatch) {
  printStore.releaseClaim(batch.id)
  MessagePlugin.info('已放回排队，序号将在下一位馆员开打时重新锁定')
}

async function exportBatchHtml(batch: PrintBatch) {
  await exportPrintableHtml(
    batch.labels.map((label) => label.specimenSnapshot),
    batch.templateSnapshot,
    batch.status === 'queued' ? undefined : (seqNo) => printStore.formatSeq(seqNo),
    batch.labels[0]?.seqNo || 1,
  )
  MessagePlugin.success('该批可打印 HTML 已生成')
}

function saveStationName() {
  printStore.setStationName(stationNameInput.value)
  stationEditor.value = false
  MessagePlugin.success('工位称呼已保存')
}

function retryWrite() {
  if (printStore.retryPersist()) MessagePlugin.success('写入成功，队列已同步')
  else MessagePlugin.error('仍然写入失败，原清单与批次仍保留，可继续重试')
}
</script>

<template>
  <div class="page-stack print-page">
    <section class="page-heading">
      <div>
        <h2>打印批次</h2>
        <p>开打瞬间按当页容量锁定每张标签序号；超出容量的标签自动排队到下一批。模板改动只重算未开打的批次。</p>
      </div>
      <t-space>
        <t-button variant="outline" @click="exportTemplateConfig(template)"><DownloadIcon />导出排版配置</t-button>
        <t-button theme="primary" :disabled="!printStore.queuedBatches.length" :loading="busy" @click="startNext">
          <PrintIcon />开打队首批
        </t-button>
      </t-space>
    </section>

    <t-alert
      v-if="printStore.dirty"
      class="dirty-alert"
      theme="error"
      :message="`批次写入本地失败：${printStore.persistError || '存储不可用'}。原清单与已排批次均保留在当前页面，修好后请重试。`"
    >
      <template #operation>
        <t-button size="small" theme="danger" variant="outline" @click="retryWrite"><RefreshIcon />重试写入</t-button>
      </template>
    </t-alert>

    <section class="metric-row">
      <article class="metric-card">
        <span>已排标签</span><strong>{{ printStore.totalLabels }}</strong><small>跨全部打印任务</small>
      </article>
      <article class="metric-card metric-card--amber">
        <span>排队批次</span><strong>{{ printStore.queuedBatches.length }}</strong><small>模板改动后自动重算</small>
      </article>
      <article class="metric-card metric-card--amber">
        <span>开打批次</span>
        <strong>{{ printStore.activeBatches.filter((b) => b.status === 'printing').length }}</strong>
        <small>序号已锁定不可改</small>
      </article>
      <article class="metric-card metric-card--green">
        <span>已打完</span><strong>{{ printStore.printedLabelCount }}</strong><small>张标签顺序已留档</small>
      </article>
    </section>

    <section class="batch-layout">
      <div class="batch-side">
        <div class="content-card side-card">
          <div class="section-heading">
            <div><strong>新建打印任务</strong><span>{{ template.name }}</span></div>
            <t-button size="small" theme="primary" @click="openRunDialog">入队开打</t-button>
          </div>
          <div class="side-meta">
            <span>当页容量 <strong>{{ capacity }} 张/页</strong></span>
            <span>当前模板 <strong>{{ template.columns }} 栏</strong></span>
            <span>已选标本 <strong>{{ selectableSpecimens.length || '未勾选' }}</strong></span>
            <span>校验无误 <strong>{{ validSpecimens.length }} 条</strong></span>
          </div>
        </div>

        <div class="content-card side-card">
          <div class="section-heading">
            <div>
              <strong>批次队列</strong>
              <span>{{ printStore.activeBatches.length }} 批进行中 · {{ printStore.printedBatches.length }} 批完成</span>
            </div>
          </div>
          <div class="station-line">
            <t-tag v-if="!stationEditor" size="small" theme="primary" variant="light" closable @close="stationEditor = true">
              本机工位：{{ printStore.station.name }}
            </t-tag>
            <t-input v-else v-model="stationNameInput" size="small" autofocus @blur="saveStationName" @enter="saveStationName" />
          </div>
          <div v-if="!printStore.activeBatches.length" class="empty-queue">
            还没有排队或开打的批次，先在上方“入队开打”选一批标本。
          </div>
          <div
            v-for="batch in printStore.activeBatches"
            :key="batch.id"
            class="batch-row"
            :class="{
              'batch-row--mine': batch.status === 'printing' && batch.claimedBy === printStore.station.id,
              'batch-row--locked': batch.status === 'printing' && batch.claimedBy !== printStore.station.id,
            }"
          >
            <div class="batch-row__head">
              <strong>第 {{ batch.ordinal + 1 }} 批</strong>
              <t-tag size="small" :theme="statusTheme(batch)" variant="light">{{ statusText(batch) }}</t-tag>
            </div>
            <div class="batch-row__meta">
              <span>{{ batch.templateName }}</span>
              <span>容量 {{ batch.pageCapacity }} · {{ rangeLabel(batch) }}</span>
              <span v-if="batch.rebuildCount" class="rebuild-hint">已失效重算 {{ batch.rebuildCount }} 次</span>
            </div>
            <div v-if="batch.status === 'printing' && batch.claimedBy === printStore.station.id" class="batch-row__actions">
              <t-button size="small" theme="primary" @click="printBatch(batch)"><PrintIcon />打印本批</t-button>
              <t-button size="small" theme="success" variant="outline" @click="finishBatch(batch)"><CheckCircleIcon />确认打完</t-button>
              <t-button size="small" variant="text" @click="releaseBatch(batch)"><RollbackIcon />放回队列</t-button>
              <t-button size="small" variant="text" @click="exportBatchHtml(batch)"><DownloadIcon />导出</t-button>
            </div>
            <div v-else-if="batch.status === 'printing'" class="batch-row__actions">
              <t-button size="small" variant="outline" disabled>等待对方打完确认</t-button>
            </div>
            <div v-else class="batch-row__actions">
              <t-button size="small" variant="text" @click="exportBatchHtml(batch)"><DownloadIcon />导出该批</t-button>
            </div>
          </div>
        </div>

        <div class="content-card side-card">
          <div class="section-heading"><div><strong>已打完顺序</strong><span>留档不可改</span></div></div>
          <div v-if="!printStore.printedBatches.length" class="empty-queue">打完并确认的批次会按完成顺序列在这里。</div>
          <div v-for="batch in printStore.printedBatches" :key="batch.id" class="history-row">
            <CheckCircleIcon class="history-icon" />
            <span>{{ batch.templateName }} · 第 {{ batch.ordinal + 1 }} 批</span>
            <strong>{{ rangeLabel(batch) }}</strong>
          </div>
        </div>
      </div>

      <div class="batch-stage content-card">
        <div class="print-toolbar">
          <div>
            <strong>{{ template.name }} · 毫米级预览</strong>
            <span>排队批显示占位，开打后序号（#0001…）会印在每张标签角上</span>
          </div>
          <div class="zoom-tools">
            <t-button size="small" variant="outline" @click="zoom = Math.max(.3, zoom - .07)">−</t-button>
            <span>{{ Math.round(zoom * 100) }}%</span>
            <t-button size="small" variant="outline" @click="zoom = Math.min(1.1, zoom + .07)">＋</t-button>
            <t-button size="small" variant="outline" @click="zoom = 1">实际大小</t-button>
          </div>
        </div>
        <div class="print-stage">
          <div class="print-pages">
            <div
              v-for="batch in printStore.activeBatches.slice(0, 6)"
              :key="batch.id"
              class="print-page-wrap"
              :class="{ 'print-page-wrap--mine': batch.status === 'printing' && batch.claimedBy === printStore.station.id }"
            >
              <span class="print-page-label">
                第 {{ batch.ordinal + 1 }} 批 · {{ batch.templateName }} · {{ statusText(batch) }} · {{ rangeLabel(batch) }}
              </span>
              <div :style="{ transform: `scale(${zoom})`, transformOrigin: 'top left' }">
                <LabelSheet
                  :template="batch.templateSnapshot"
                  :entries="batchEntries(batch)"
                  :show-seq="batch.status !== 'queued'"
                  :seq-formatter="printStore.formatSeq"
                />
              </div>
            </div>
            <div v-if="!printStore.activeBatches.length" class="stage-empty">队列为空，新建打印任务后这里会逐批显示纸张预览。</div>
          </div>
        </div>
        <div class="print-notes">
          <article>
            <strong>锁定时机</strong>
            <span>点“开打队首批”才按当页容量分页并锁定本批序号；未开打前改模板、换纸、改栏数，排队批全部重算页数。</span>
          </article>
          <article>
            <strong>两人抢一批</strong>
            <span>两位馆员同时点开打，先提交的工位赢得这批，后提交的会收到提示并看到对方“开打中”，不会重复出纸。</span>
          </article>
          <article>
            <strong>打印设置</strong>
            <span>对话框选“实际大小 / 100%”，关闭“适合页面”；卡纸可“放回队列”，打完点“确认打完”留档顺序。</span>
          </article>
        </div>
      </div>
    </section>

    <t-dialog
      v-model:visible="runDialogVisible"
      header="新建打印任务并入队"
      width="520px"
      :confirm-btn="{ content: '入队', theme: 'primary' }"
      @confirm="createRun"
    >
      <t-form label-align="left" label-width="96px">
        <t-form-item label="任务名称"><t-input v-model="runName" placeholder="便于在已打完记录里辨认" /></t-form-item>
        <t-form-item label="入队范围">
          <t-radio-group v-model="runScope" variant="default-filled">
            <t-radio-button value="valid">只排校验无误（{{ validSpecimens.length }}）</t-radio-button>
            <t-radio-button value="selected">仅勾选项（{{ selectableSpecimens.length }}）</t-radio-button>
            <t-radio-button value="all">全部清单（{{ labelStore.specimens.length }}）</t-radio-button>
          </t-radio-group>
        </t-form-item>
        <t-form-item label="当前容量">
          <span class="dialog-capacity">每页 {{ capacity }} 张 · {{ runSpecimens.length }} 张将排成 {{ plannedPageCount }} 批</span>
        </t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<style>
@media print {
  body { background: #fff !important; }
  .app-sider, .app-header, .page-heading, .metric-row, .batch-side, .print-toolbar,
  .print-notes, .dirty-alert, .zoom-tools, .print-page-label { display: none !important; }
  .app-shell, .app-workspace, .app-content, .batch-layout, .batch-stage {
    display: block !important; width: auto !important; height: auto !important;
    overflow: visible !important; padding: 0 !important; margin: 0 !important;
    border: 0 !important; box-shadow: none !important; background: #fff !important;
  }
  .print-stage { padding: 0 !important; background: #fff !important; overflow: visible !important; }
  .print-pages { gap: 0 !important; display: block !important; }
  /* 只印本工位锁定中的那一批，其余批次不进打印队列 */
  .print-page-wrap { display: none !important; margin: 0 !important; }
  .print-page-wrap--mine { display: block !important; break-after: page; }
  .print-page-wrap > div { transform: none !important; }
  .label-sheet { box-shadow: none !important; }
}
</style>

<style scoped>
.dirty-alert { margin-top: -2px; }
.batch-layout {
  display: grid;
  grid-template-columns: 350px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.batch-side { display: grid; gap: 16px; }
.side-card { padding-bottom: 12px; }
.side-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; padding: 12px 14px; }
.side-meta span { color: #77887c; font-size: 10px; }
.side-meta strong { display: block; margin-top: 2px; color: #31533b; font-size: 12px; }
.station-line { padding: 0 14px 10px; }
.station-line .t-input { width: 100%; }
.empty-queue { padding: 4px 14px 12px; color: #93a296; font-size: 11px; line-height: 1.7; }
.batch-row {
  margin: 0 10px 8px;
  padding: 10px 11px;
  border: 1px solid #e3e9e1;
  border-radius: 8px;
  background: #fbfdfb;
}
.batch-row--mine { border-color: #cfe0d2; background: #f3f9f2; box-shadow: inset 3px 0 #4c9a6c; }
.batch-row--locked { border-style: dashed; background: #fbf8f0; }
.batch-row__head { display: flex; align-items: center; justify-content: space-between; }
.batch-row__head strong { color: #2d4433; font-size: 12px; }
.batch-row__meta { display: grid; gap: 3px; margin: 7px 0 8px; color: #829085; font-size: 10px; }
.rebuild-hint { color: #b17b22; }
.batch-row__actions { display: flex; flex-wrap: wrap; gap: 4px; }
.history-row { display: flex; align-items: center; gap: 8px; padding: 7px 14px; color: #7c8d80; font-size: 11px; }
.history-row .history-icon { color: #3b9f6c; font-size: 15px; }
.history-row span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-row strong { color: #31533b; font-family: Menlo, monospace; font-size: 11px; }
.batch-stage { overflow: hidden; }
.stage-empty { padding: 60px 20px; color: #93a296; font-size: 12px; text-align: center; }
.dialog-capacity { color: #5d7464; font-size: 12px; }
</style>
