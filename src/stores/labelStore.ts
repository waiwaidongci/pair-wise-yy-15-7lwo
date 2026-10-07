import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { createMockSpecimens, DEFAULT_TEMPLATE } from '../data/mockSpecimens'
import type { ImportResult, LabelTemplate, Specimen, ValidationIssue } from '../types/label'
import { validateSpecimens } from '../utils/csv'
import { usePrintStore } from './printStore'

const STORAGE_KEY = 'pair-wise-yy-15-label-studio'

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as {
      specimens: Specimen[]
      templates: LabelTemplate[]
      activeTemplateId: string
    }
  } catch {
    return null
  }
}

export const useLabelStore = defineStore('label-studio', () => {
  const persisted = loadPersisted()
  const specimens = ref<Specimen[]>(persisted?.specimens ?? createMockSpecimens())
  const templates = ref<LabelTemplate[]>(
    persisted?.templates?.length ? persisted.templates : [{ ...DEFAULT_TEMPLATE }],
  )
  const activeTemplateId = ref(
    persisted?.activeTemplateId && templates.value.some((item) => item.id === persisted.activeTemplateId)
      ? persisted.activeTemplateId
      : templates.value[0].id,
  )
  const selectedSpecimenIds = ref<string[]>([])
  const activeTemplate = computed(
    () => templates.value.find((item) => item.id === activeTemplateId.value) ?? templates.value[0],
  )
  const issues = computed(() => validateSpecimens(specimens.value, true))
  const errorCount = computed(() => issues.value.filter((item) => item.severity === 'error').length)
  const warningCount = computed(() => issues.value.filter((item) => item.severity === 'warning').length)

  function persist() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        specimens: specimens.value,
        templates: templates.value,
        activeTemplateId: activeTemplateId.value,
      }),
    )
  }

  function updateTemplate(patch: Partial<LabelTemplate>) {
    const index = templates.value.findIndex((item) => item.id === activeTemplateId.value)
    if (index < 0) return
    templates.value[index] = {
      ...templates.value[index],
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    persist()
    // 模板或栏数一改动：引用它的未开打批次立即失效并按新容量重算页数，
    // 已开打 / 已打完的批次冻结原快照，不受影响。
    usePrintStore().rebuildQueuedBatches(templates.value[index].id, templates.value[index])
  }

  function saveAsTemplate(name: string) {
    const template: LabelTemplate = {
      ...activeTemplate.value,
      id: crypto.randomUUID(),
      name: name.trim() || `标签模板 ${templates.value.length + 1}`,
      updatedAt: new Date().toISOString(),
    }
    templates.value.push(template)
    activeTemplateId.value = template.id
    persist()
  }

  function activateTemplate(id: string) {
    if (!templates.value.some((item) => item.id === id)) return
    activeTemplateId.value = id
    persist()
  }

  function duplicateTemplate(id: string) {
    const source = templates.value.find((item) => item.id === id)
    if (!source) return
    const copy = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} 副本`,
      updatedAt: new Date().toISOString(),
    }
    templates.value.push(copy)
    activeTemplateId.value = copy.id
    persist()
  }

  function removeTemplate(id: string) {
    if (templates.value.length <= 1) return
    templates.value = templates.value.filter((item) => item.id !== id)
    if (activeTemplateId.value === id) activeTemplateId.value = templates.value[0].id
    persist()
    // 排队批次不能悬挂在已删除模板上：迁移到保留下来的在用模板并重算
    usePrintStore().rebaseQueuedBatches(id, templates.value[0])
  }

  function importResult(result: ImportResult) {
    specimens.value = [...result.specimens, ...specimens.value]
    const ids = new Set(result.specimens.map((item) => item.id))
    selectedSpecimenIds.value = [...ids]
    persist()
  }

  function updateSpecimen(id: string, patch: Partial<Specimen>) {
    const index = specimens.value.findIndex((item) => item.id === id)
    if (index < 0) return
    specimens.value[index] = { ...specimens.value[index], ...patch }
    persist()
  }

  function removeSpecimens(ids: string[]) {
    const targets = new Set(ids)
    specimens.value = specimens.value.filter((item) => !targets.has(item.id))
    selectedSpecimenIds.value = selectedSpecimenIds.value.filter((id) => !targets.has(id))
    persist()
  }

  function setSelection(ids: string[]) {
    selectedSpecimenIds.value = ids
  }

  function removeIssues(ids: string[]) {
    const records = specimens.value.filter((specimen) =>
      validateSpecimens([specimen], true).some((issue) => ids.includes(issue.id)),
    )
    removeSpecimens(records.map((item) => item.id))
  }

  function resetMockData() {
    specimens.value = createMockSpecimens()
    selectedSpecimenIds.value = []
    persist()
  }

  function getIssueById(id: string): ValidationIssue | undefined {
    return issues.value.find((issue) => issue.id === id)
  }

  return {
    specimens,
    templates,
    activeTemplate,
    activeTemplateId,
    selectedSpecimenIds,
    issues,
    errorCount,
    warningCount,
    updateTemplate,
    saveAsTemplate,
    activateTemplate,
    duplicateTemplate,
    removeTemplate,
    importResult,
    updateSpecimen,
    removeSpecimens,
    setSelection,
    removeIssues,
    resetMockData,
    getIssueById,
    persist,
  }
})
