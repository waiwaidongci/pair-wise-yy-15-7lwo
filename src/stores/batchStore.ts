import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useLabelStore } from './labelStore'
import type { BatchStartResult, PrintBatch } from '../types/label'
import { labelsPerPage } from '../utils/layout'

const STORAGE_KEY = 'label-studio-print-batches'
const LIBRARIAN_KEY = 'label-studio-librarian'

function nowIso() {
  return new Date().toISOString()
}

function loadPersisted(): PrintBatch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed?.batches) ? (parsed.batches as PrintBatch[]) : []
  } catch {
    return []
  }
}

function loadLibrarian(): string {
  try {
    const existing = localStorage.getItem(LIBRARIAN_KEY)
    if (existing) return existing
  } catch {
    /* 隐私模式等场景忽略 */
  }
  const id = `馆员-${Math.random().toString(36).slice(2, 6)}`
  try {
    localStorage.setItem(LIBRARIAN_KEY, id)
  } catch {
    /* 写入失败也不影响使用，仅内存态 */
  }
  return id
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useBatchStore = defineStore('label-batches', () => {
  const labelStore = useLabelStore()
  const batches = ref<PrintBatch[]>(loadPersisted())
  const librarianId = ref(loadLibrarian())

  /**
   * 提交写入：先把草稿落到 batches，再写 localStorage。
   * 写入失败（配额/隐私模式等）时回滚到写入前的状态，原清单与队列不动，
   * 调用方拿到 write-failed 后可重试。
   */
  function save(draft: PrintBatch[]): boolean {
    const snapshot = JSON.stringify(batches.value)
    try {
      batches.value = draft
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ batches: draft, librarianId: librarianId.value }),
      )
      return true
    } catch {
      batches.value = JSON.parse(snapshot)
      return false
    }
  }

  /** 重新读取持久化的最新批次，能看到其它标签页刚抢占的结果（跨客户端原子比较）。 */
  function readFresh(): PrintBatch[] {
    return loadPersisted()
  }

  // ---- 派生状态 ----
  const activeBatches = computed(() => batches.value.filter((batch) => batch.status !== 'invalid'))
  const queuedBatches = computed(() => batches.value.filter((batch) => batch.status === 'queued'))
  const printingBatches = computed(() => batches.value.filter((batch) => batch.status === 'printing'))
  const doneBatches = computed(() => batches.value.filter((batch) => batch.status === 'done'))
  const invalidBatches = computed(() => batches.value.filter((batch) => batch.status === 'invalid'))

  /** 已被批次占用（未作废）的标本 id —— 原清单本身不移除。 */
  const batchedSpecimenIds = computed(() => {
    const ids = new Set<string>()
    activeBatches.value.forEach((batch) =>
      batch.labels.forEach((label) => ids.add(label.specimen.id)),
    )
    return ids
  })

  /** 待打印队列：原清单中未被任何有效批次占用的标本，顺序与清单一致。 */
  const queue = computed(() =>
    labelStore.specimens.filter((specimen) => !batchedSpecimenIds.value.has(specimen.id)),
  )

  /** 下一张标签的全局连续序号：有效批次（含已打完）的最大序号 + 1。 */
  const nextSerial = computed(() => {
    let max = 0
    activeBatches.value.forEach((batch) =>
      batch.labels.forEach((label) => {
        const serial = label.serial ?? 0
        if (serial > max) max = serial
      }),
    )
    return max + 1
  })

  const currentCapacity = computed(() => labelsPerPage(labelStore.activeTemplate))

  /** 剩余队列按当前模板容量估算的页数（批数），模板一改即重算。 */
  const queuedPages = computed(() =>
    Math.max(0, Math.ceil(queue.value.length / currentCapacity.value)),
  )

  function serialRange(batch: PrintBatch): [number, number] {
    if (!batch.labels.length) return [0, 0]
    return [batch.labels[0].serial ?? 0, batch.labels[batch.labels.length - 1].serial ?? 0]
  }

  // ---- 动作 ----

  /**
   * 开打新批次（或抢占已预排的批次）。
   * 同步完成“读最新状态 → 抢占/建批 → 写库”，JS 单线程内不可重入，
   * 两位馆员同时开打同一批时先到的成立，后到的拿到 printing/already-claimed。
   */
  function startNextBatch(): BatchStartResult {
    const draft = readFresh()

    const printing = draft.find((batch) => batch.status === 'printing')
    if (printing) {
      return { ok: false, reason: 'printing', by: printing.claimedBy ?? '' }
    }

    const queued = draft.find((batch) => batch.status === 'queued')
    if (queued) {
      const target = draft.find((batch) => batch.id === queued.id)!
      target.status = 'printing'
      target.claimedBy = librarianId.value
      target.claimedAt = nowIso()
      target.startedAt = nowIso()
      if (!save(draft)) return { ok: false, reason: 'write-failed' }
      return { ok: true, batch: target }
    }

    // 没有预排批次：按当前模板容量从队列取前若干张，超出容量的留在下一批。
    const capacity = labelsPerPage(labelStore.activeTemplate)
    const occupied = new Set(
      draft
        .filter((batch) => batch.status !== 'invalid')
        .flatMap((batch) => batch.labels.map((label) => label.specimen.id)),
    )
    const taken = labelStore.specimens
      .filter((specimen) => !occupied.has(specimen.id))
      .slice(0, capacity)
    if (!taken.length) return { ok: false, reason: 'empty' }

    const serialStart = draft
      .filter((batch) => batch.status !== 'invalid')
      .reduce(
        (max, batch) => Math.max(max, ...batch.labels.map((label) => label.serial ?? 0)),
        0,
      ) + 1

    const batch: PrintBatch = {
      id: crypto.randomUUID(),
      batchNo: draft.length + 1,
      status: 'printing',
      template: clone(labelStore.activeTemplate),
      labels: taken.map((specimen, index) => ({
        specimen: clone(specimen),
        serial: serialStart + index,
      })),
      capacity,
      createdAt: nowIso(),
      startedAt: nowIso(),
      finishedAt: null,
      claimedBy: librarianId.value,
      claimedAt: nowIso(),
      invalidReason: null,
    }
    draft.push(batch)
    if (!save(draft)) return { ok: false, reason: 'write-failed' }
    return { ok: true, batch }
  }

  /**
   * 预排批次：把整个待打印队列按当前模板容量切成若干 queued 批次（每张 ≤ 当页容量），
   * 序号在预排时按页容量连续定好。预排后尚未开打，模板或栏数一旦改动即失效。
   */
  function planBatches(): { ok: boolean; planned?: number; reason?: string } {
    const draft = readFresh()
    const capacity = labelsPerPage(labelStore.activeTemplate)
    const occupied = new Set(
      draft
        .filter((batch) => batch.status !== 'invalid')
        .flatMap((batch) => batch.labels.map((label) => label.specimen.id)),
    )
    const queuedSpecimens = labelStore.specimens.filter((specimen) => !occupied.has(specimen.id))
    if (!queuedSpecimens.length) return { ok: false, reason: 'empty' }

    const serialStart = draft
      .filter((batch) => batch.status !== 'invalid')
      .reduce(
        (max, batch) => Math.max(max, ...batch.labels.map((label) => label.serial ?? 0)),
        0,
      ) + 1

    let created = 0
    let cursor = 0
    let serialCursor = serialStart
    while (cursor < queuedSpecimens.length) {
      const taken = queuedSpecimens.slice(cursor, cursor + capacity)
      draft.push({
        id: crypto.randomUUID(),
        batchNo: draft.length + 1,
        status: 'queued',
        template: clone(labelStore.activeTemplate),
        labels: taken.map((specimen, index) => ({
          specimen: clone(specimen),
          serial: serialCursor + index,
        })),
        capacity,
        createdAt: nowIso(),
        startedAt: null,
        finishedAt: null,
        claimedBy: null,
        claimedAt: null,
        invalidReason: null,
      })
      cursor += capacity
      serialCursor += taken.length
      created += 1
    }
    if (!save(draft)) return { ok: false, reason: 'write-failed' }
    return { ok: true, planned: created }
  }

  /** 抢占某个已预排的批次；只有 queued 能被抢占，先到先得。 */
  function claimBatch(batchId: string): BatchStartResult {
    const draft = readFresh()
    const target = draft.find((batch) => batch.id === batchId)
    if (!target) return { ok: false, reason: 'empty' }
    if (target.status === 'printing') {
      return { ok: false, reason: 'printing', by: target.claimedBy ?? '' }
    }
    if (target.status !== 'queued') return { ok: false, reason: 'empty' }
    target.status = 'printing'
    target.claimedBy = librarianId.value
    target.claimedAt = nowIso()
    target.startedAt = nowIso()
    if (!save(draft)) return { ok: false, reason: 'write-failed' }
    return { ok: true, batch: target }
  }

  /** 打完落账：顺序与序号永久留住，模板再变也不动。 */
  function markDone(batchId: string): BatchStartResult {
    const draft = readFresh()
    const target = draft.find((batch) => batch.id === batchId)
    if (!target || target.status !== 'printing') return { ok: false, reason: 'empty' }
    target.status = 'done'
    target.finishedAt = nowIso()
    if (!save(draft)) return { ok: false, reason: 'write-failed' }
    return { ok: true, batch: target }
  }

  /** 取消打印并释放抢占，批次回到 queued 供他人开打。 */
  function releaseBatch(batchId: string): BatchStartResult {
    const draft = readFresh()
    const target = draft.find((batch) => batch.id === batchId)
    if (!target || target.status !== 'printing') return { ok: false, reason: 'empty' }
    target.status = 'queued'
    target.claimedBy = null
    target.claimedAt = null
    target.startedAt = null
    if (!save(draft)) return { ok: false, reason: 'write-failed' }
    return { ok: true, batch: target }
  }

  /**
   * 作废所有未开打（queued）的批次。
   * 已开打（printing）与已打完（done）的批次不动 —— 它们的模板快照与序号已留住。
   */
  function invalidateQueuedBatches(reason: string): { ok: boolean; changed?: boolean; reason?: string } {
    const draft = readFresh()
    let changed = false
    draft.forEach((batch) => {
      if (batch.status === 'queued') {
        batch.status = 'invalid'
        batch.invalidReason = reason
        changed = true
      }
    })
    if (changed) {
      if (!save(draft)) return { ok: false, reason: 'write-failed' }
    }
    return { ok: true, changed }
  }

  function removeBatch(batchId: string): { ok: boolean; reason?: string } {
    const draft = readFresh().filter((batch) => batch.id !== batchId)
    if (!save(draft)) return { ok: false, reason: 'write-failed' }
    return { ok: true }
  }

  // 模板或栏数一改动 → 未开打的批次失效并重算页数；已打完的顺序留住。
  // 标本清单被移除/重置（数量减少）→ 预排批次引用的标本可能已不在，同样作废。
  watch(
    () =>
      [
        labelStore.activeTemplateId,
        JSON.stringify(labelStore.activeTemplate),
        labelStore.specimens.length,
      ] as const,
    ([id, signature, count], [oldId, oldSignature, oldCount]) => {
      if (signature !== oldSignature || id !== oldId) {
        invalidateQueuedBatches('模板或栏数已调整，未开打批次已失效')
      } else if (count < oldCount) {
        invalidateQueuedBatches('标本清单已变更，未开打批次已失效')
      }
    },
  )

  // 跨标签页同步其它馆员的抢占/落账结果
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY) batches.value = loadPersisted()
    })
  }

  return {
    batches,
    librarianId,
    activeBatches,
    queuedBatches,
    printingBatches,
    doneBatches,
    invalidBatches,
    queue,
    nextSerial,
    currentCapacity,
    queuedPages,
    serialRange,
    startNextBatch,
    planBatches,
    claimBatch,
    markDone,
    releaseBatch,
    invalidateQueuedBatches,
    removeBatch,
  }
})
