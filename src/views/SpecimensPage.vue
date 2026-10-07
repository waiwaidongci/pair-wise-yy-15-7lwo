<script setup lang="ts">
import { computed, ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { FileAddIcon, RefreshIcon, SearchIcon } from 'tdesign-icons-vue-next'
import { useLabelStore } from '../stores/labelStore'
import { SAMPLE_CSV } from '../data/mockSpecimens'
import { parseSpecimenCsv, validateSpecimens } from '../utils/csv'
import type { Specimen, ValidationIssue } from '../types/label'

const store = useLabelStore()
const search = ref('')
const importOpen = ref(false)
const importText = ref('')
const lastImport = ref({ total: 0, error: 0, warning: 0, ignored: 0 })
const editOpen = ref(false)
const editing = ref<Specimen | null>(null)
const activeIssue = ref<ValidationIssue | null>(null)
const editForm = ref<Specimen | null>(null)
const fileInput = ref<HTMLInputElement>()

const filteredSpecimens = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return store.specimens
  return store.specimens.filter((specimen) =>
    [specimen.accessionNo, specimen.scientificName, specimen.locality, specimen.collector]
      .some((value) => value.toLowerCase().includes(keyword)),
  )
})
const visibleIssues = computed(() => {
  const ids = new Set(filteredSpecimens.value.map((item) => item.id))
  return store.issues.filter((issue) => ids.has(issue.specimenId))
})

function loadCsv(content: string) {
  const result = parseSpecimenCsv(content)
  if (!result.specimens.length) {
    MessagePlugin.error('没有解析到标本记录，请检查表头和内容')
    return
  }
  store.importResult(result)
  lastImport.value = {
    total: result.specimens.length,
    error: result.issues.filter((item) => item.severity === 'error').length,
    warning: result.issues.filter((item) => item.severity === 'warning').length,
    ignored: result.ignoredRows,
  }
  importOpen.value = false
  importText.value = ''
  MessagePlugin.success(`已导入 ${result.specimens.length} 条标本记录`)
}

function openRecordFile() {
  fileInput.value?.click()
}

async function handleFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  loadCsv(await file.text())
  ;(event.target as HTMLInputElement).value = ''
}

function editIssue(issue: ValidationIssue) {
  const specimen = store.specimens.find((item) => item.id === issue.specimenId)
  if (!specimen) return
  activeIssue.value = issue
  editing.value = specimen
  editForm.value = { ...specimen }
  editOpen.value = true
}

function saveEdit() {
  if (!editForm.value || !editing.value) return
  store.updateSpecimen(editing.value.id, editForm.value)
  editOpen.value = false
  MessagePlugin.success('标本字段已更新')
}
</script>

<template>
  <div class="page-stack">
    <section class="page-heading">
      <div>
        <h2>标本清单校验</h2>
        <p>导入前检查必填字段、编号重复和超长内容，问题记录可直接修正或移除。</p>
      </div>
      <t-space>
        <input ref="fileInput" class="hidden-input" type="file" accept=".csv,text/csv" @change="handleFile" />
        <t-button variant="outline" @click="importOpen = true"><FileAddIcon />粘贴清单</t-button>
        <t-button theme="primary" @click="openRecordFile"><FileAddIcon />导入 CSV</t-button>
      </t-space>
    </section>

    <section class="metric-row">
      <article class="metric-card metric-card--green">
        <span>清单记录</span><strong>{{ store.specimens.length }}</strong><small>当前已载入标本</small>
      </article>
      <article class="metric-card metric-card--red">
        <span>必须修正</span><strong>{{ store.errorCount }}</strong><small>缺少字段或编号重复</small>
      </article>
      <article class="metric-card metric-card--amber">
        <span>排版提醒</span><strong>{{ store.warningCount }}</strong><small>超长内容将自动缩小</small>
      </article>
      <article class="metric-card">
        <span>最近导入</span><strong>{{ lastImport.total }}</strong><small>{{ lastImport.ignored }} 行空记录已忽略</small>
      </article>
    </section>

    <section class="content-card">
      <div class="card-toolbar">
        <div class="search-box">
          <SearchIcon />
          <input v-model="search" placeholder="搜索编号、学名、采集地或采集人" />
        </div>
        <t-space>
          <t-button size="small" variant="outline" @click="openRecordFile">追加 CSV</t-button>
          <t-button size="small" variant="outline" @click="loadCsv(SAMPLE_CSV); lastImport = { total: 5, error: 1, warning: 1, ignored: 0 }">载入示例</t-button>
          <t-button size="small" variant="outline" @click="store.resetMockData(); MessagePlugin.success('已恢复内置清单')"><RefreshIcon />恢复内置</t-button>
        </t-space>
      </div>
      <t-table
        row-key="id"
        hover
        size="small"
        :data="filteredSpecimens"
        :columns="[
          { colKey: 'accessionNo', title: '标本编号', width: 155 },
          { colKey: 'taxonName', title: '类群', width: 105 },
          { colKey: 'scientificName', title: '拉丁学名', width: 265, ellipsis: true },
          { colKey: 'locality', title: '采集地', width: 220, ellipsis: true },
          { colKey: 'collectedAt', title: '日期', width: 115 },
          { colKey: 'collector', title: '采集人', width: 90 },
        ]"
        :pagination="{ pageSize: 20, showJumper: true }"
      />
    </section>

    <section class="content-card">
      <div class="section-heading">
        <div><strong>校验问题</strong><span>{{ visibleIssues.length }} 条</span></div>
        <t-button
          size="small"
          theme="danger"
          variant="outline"
          :disabled="!visibleIssues.some((item) => item.severity === 'error')"
          @click="store.removeIssues(visibleIssues.filter((item) => item.severity === 'error').map((item) => item.id)); MessagePlugin.success('有错误的记录已移除')"
        >
          移除全部错误记录
        </t-button>
      </div>
      <t-table
        row-key="id"
        size="small"
        :data="visibleIssues"
        :columns="[
          { colKey: 'severity', title: '级别', width: 90 },
          { colKey: 'specimenId', title: '标本记录', width: 145 },
          { colKey: 'field', title: '字段', width: 145 },
          { colKey: 'message', title: '问题说明' },
          { colKey: 'operation', title: '操作', width: 100 },
        ]"
        :pagination="{ pageSize: 10 }"
      >
        <template #severity="{ row }">
          <t-tag :theme="row.severity === 'error' ? 'danger' : 'warning'" variant="light">
            {{ row.severity === 'error' ? '错误' : '警告' }}
          </t-tag>
        </template>
        <template #operation="{ row }">
          <t-link theme="primary" @click="editIssue(row)">修正</t-link>
        </template>
      </t-table>
    </section>

    <t-dialog
      v-model:visible="importOpen"
      header="导入标本清单"
      width="720px"
      :confirm-btn="{ content: '开始校验', theme: 'primary' }"
      @confirm="loadCsv(importText)"
    >
      <t-alert theme="info" message="支持 CSV 表头：编号、学名、采集地、采集日期、采集人、生境、备注。" />
      <t-textarea
        v-model="importText"
        class="import-textarea"
        :autosize="{ minRows: 11, maxRows: 16 }"
        placeholder="粘贴 CSV 内容，第一行必须是表头"
      />
    </t-dialog>

    <t-dialog
      v-model:visible="editOpen"
      header="修正标本字段"
      width="620px"
      :confirm-btn="{ content: '保存修正', theme: 'primary' }"
      @confirm="saveEdit"
    >
      <t-alert v-if="activeIssue" theme="warning" :message="activeIssue.message" class="dialog-alert" />
      <t-form v-if="editForm" label-align="left" label-width="90px">
        <t-form-item label="标本编号"><t-input v-model="editForm.accessionNo" /></t-form-item>
        <t-form-item label="类群"><t-input v-model="editForm.taxonName" /></t-form-item>
        <t-form-item label="拉丁学名"><t-input v-model="editForm.scientificName" /></t-form-item>
        <t-form-item label="采集地"><t-input v-model="editForm.locality" /></t-form-item>
        <t-form-item label="采集日期"><t-input v-model="editForm.collectedAt" /></t-form-item>
        <t-form-item label="采集人"><t-input v-model="editForm.collector" /></t-form-item>
        <t-form-item label="生境"><t-input v-model="editForm.habitat" /></t-form-item>
        <t-form-item label="备注"><t-input v-model="editForm.notes" /></t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>
