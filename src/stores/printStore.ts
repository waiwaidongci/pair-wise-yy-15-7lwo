import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LabelTemplate, PrintBatch, PrintRun, Specimen, Station } from '../types/label'
import { assignRunSequence, buildQueuedBatches, recomputeQueuedBatches } from '../utils/batches'

const STORAGE_KEY = 'pair-wise-yy-15-print-batches'
const STATION_KEY = 'pair-wise-yy-15-station'
const CHANNEL_NAME = 'pair-wise-yy-15-print-queue'
/** 跨标签页抢同一批时的仲裁窗口，先到者在窗口结束后胜出 */
const CLAIM_ARBITER_MS = 200

interface PersistState {
  version: 2
  runs: PrintRun[]
  batches: PrintBatch[]
}

type ClaimResult =
  | { ok: true; batch: PrintBatch }
  | { ok: false; reason: 'none' | 'lost'; winner?: Station; batch?: PrintBatch }

interface ClaimMessage {
  type: 'CLAIM' | 'CLAIM_WON' | 'CLAIM_RELEASE' | 'COMMIT'
  batchId?: string
  runId?: string
  station?: Station
  at?: string
}

function uuid() {
  return crypto.randomUUID()
}

function nowIso() {
  return new Date().toISOString()
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function readStorage(): PersistState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistState>
    if (!Array.isArray(parsed.runs) || !Array.isArray(parsed.batches)) return null
    return { version: 2, runs: parsed.runs, batches: parsed.batches }
  } catch {
    return null
  }
}

function loadStation(): Station {
  try {
    const raw = sessionStorage.getItem(STATION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Station
      if (parsed.id && parsed.name) return parsed
    }
  } catch {
    /* fall through and create */
  }
  const station: Station = {
    id: `station-${uuid().slice(0, 8)}`,
    // 用随机号给个默认称呼，馆员可在打印页改成自己的名字
    name: `馆员${Math.floor(Math.random() * 89 + 10)}`,
  }
  sessionStorage.setItem(STATION_KEY, JSON.stringify(station))
  return station
}

const STATUS_RANK: Record<PrintBatch['status'], number> = { queued: 0, printing: 1, printed: 2 }

/**
 * 两个标签页先后写回同一条批次时合并（参数顺序无关）：
 * - printed 是终态，任何后来写入都不能把它打回去；
 * - forceLocal 集合里的批次（仲裁胜负、卡纸放回等本工位最终决定）无条件保留；
 * - 其余只允许状态前进（queued → printing → printed），同状态下 updatedAt 更新者胜。
 */
function pickBatch(a: PrintBatch, b: PrintBatch, forceLocal: Set<string>): PrintBatch {
  if (a.status === 'printed' && b.status !== 'printed') return a
  if (b.status === 'printed' && a.status !== 'printed') return b
  if (forceLocal.has(a.id)) return a
  if (forceLocal.has(b.id)) return b
  if (a.status === b.status) return (a.updatedAt ?? 0) >= (b.updatedAt ?? 0) ? a : b
  return STATUS_RANK[a.status] > STATUS_RANK[b.status] ? a : b
}

function mergeState(local: PersistState, remote: PersistState | null, forceLocal: Set<string>): PersistState {
  if (!remote) return local
  const runs = new Map<string, PrintRun>()
  ;[...remote.runs, ...local.runs].forEach((run) => runs.set(run.id, run))
  const batches = new Map<string, PrintBatch>()
  ;[...remote.batches, ...local.batches].forEach((batch) => {
    const existing = batches.get(batch.id)
    batches.set(batch.id, existing ? pickBatch(existing, batch, forceLocal) : batch)
  })
  return { version: 2, runs: [...runs.values()], batches: [...batches.values()] }
}

function sortBatches(batches: PrintBatch[], runs: PrintRun[] = []) {
  // 任务先后：优先用任务创建时间；任务记录缺失时退回到批次在数组中的首次出现位置
  const runCreated = new Map(runs.map((run) => [run.id, run.createdAt]))
  const runPosition = new Map<string, number>()
  batches.forEach((batch, index) => {
    if (!runPosition.has(batch.runId)) runPosition.set(batch.runId, index)
  })
  return [...batches].sort((a, b) => {
    const runA = runCreated.get(a.runId)
    const runB = runCreated.get(b.runId)
    if (runA && runB) {
      const byTime = runA.localeCompare(runB)
      if (byTime) return byTime
    } else if (runA !== runB) {
      return runA ? -1 : 1
    }
    const byPosition = (runPosition.get(a.runId) ?? 0) - (runPosition.get(b.runId) ?? 0)
    if (byPosition) return byPosition
    return a.ordinal - b.ordinal || a.createdAt.localeCompare(b.createdAt)
  })
}

export const usePrintStore = defineStore('print-batches', () => {
  const persisted = readStorage()
  const runs = ref<PrintRun[]>(persisted?.runs ?? [])
  const batches = ref<PrintBatch[]>(sortBatches(persisted?.batches ?? []))
  const station = ref<Station>(loadStation())

  const dirty = ref(false)
  const persistError = ref('')
  /** 本工位正在仲裁中的批次，仲裁期间不接受其他标签页的状态回灌 */
  const pendingClaims = new Set<string>()
  /** 本次 persist 必须以本地版本为准的批次（仲裁胜负、放回队列等最终决定） */
  let forceLocal = new Set<string>()
  const claimants = new Map<string, Station[]>()
  const claimTimestamps = new Map<string, Map<string, string>>()

  let channel: BroadcastChannel | null = null
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<ClaimMessage>) => handleChannelMessage(event.data)
  }
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && !dirty.value && pendingClaims.size === 0) hydrateFromStorage()
  })
  // 切回本标签页时补拉一次，防止漏消息导致看到旧队列
  window.addEventListener('focus', () => {
    if (!dirty.value && pendingClaims.size === 0) hydrateFromStorage()
  })

  const queuedBatches = computed(() =>
    sortBatches(batches.value, runs.value).filter((batch) => batch.status === 'queued'),
  )
  const activeBatches = computed(() =>
    sortBatches(batches.value, runs.value).filter((batch) => batch.status !== 'printed'),
  )
  const printedBatches = computed(() =>
    sortBatches(batches.value, runs.value).filter((batch) => batch.status === 'printed'),
  )
  const totalLabels = computed(() => batches.value.reduce((sum, batch) => sum + batch.labels.length, 0))
  const printedLabelCount = computed(() =>
    batches.value
      .filter((batch) => batch.status === 'printed')
      .reduce((sum, batch) => sum + batch.labels.length, 0),
  )

  function hydrateFromStorage() {
    const remote = readStorage()
    if (!remote) return
    runs.value = remote.runs
    batches.value = sortBatches(remote.batches, remote.runs)
  }

  function post(message: ClaimMessage) {
    channel?.postMessage(message)
  }

  /**
   * 唯一写入口：先读其他标签页的最新提交做前进式合并，再整体落盘。
   * 落盘失败时只置脏、保留内存数据，不回滚、不清空，等馆员点重试。
   */
  function persist() {
    const local: PersistState = { version: 2, runs: runs.value, batches: batches.value }
    const merged = mergeState(local, readStorage(), forceLocal)
    runs.value = merged.runs
    batches.value = sortBatches(merged.batches, merged.runs)
    forceLocal = new Set()
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
      dirty.value = false
      persistError.value = ''
      post({ type: 'COMMIT' })
    } catch (error) {
      // 原清单 / 批次原样留在内存里，可点“重试写入”
      dirty.value = true
      persistError.value = error instanceof Error ? error.message : String(error)
    }
  }

  function retryPersist(): boolean {
    persist()
    return !dirty.value
  }

  function setStationName(name: string) {
    station.value = { ...station.value, name: name.trim() || station.value.name }
    sessionStorage.setItem(STATION_KEY, JSON.stringify(station.value))
  }

  let idCounter = 0
  function createBatchId() {
    idCounter += 1
    return `${uuid()}-${idCounter}`
  }
  function buildBatches(
    runId: string,
    specimens: Specimen[],
    tpl: LabelTemplate,
    startOrdinal: number,
    rebuildCount: number,
  ): PrintBatch[] {
    return buildQueuedBatches(runId, specimens, tpl, {
      startOrdinal,
      rebuildCount,
      createId: createBatchId,
    })
  }

  /**
   * 生成打印任务：开打前按当页容量切页，超出容量的标签排队到后续批次。
   * 排队批次只冻结顺序与快照，序号留到开打瞬间锁定。
   */
  function enqueueRun(name: string, specimens: Specimen[], template: LabelTemplate): PrintRun | null {
    if (!specimens.length) return null
    const run: PrintRun = {
      id: uuid(),
      name: name.trim() || `打印任务 ${runs.value.length + 1}`,
      createdAt: nowIso(),
      createdBy: station.value.name,
    }
    const newBatches = buildBatches(run.id, specimens, template, 0, 0)
    runs.value = [...runs.value, run]
    batches.value = [...batches.value, ...newBatches]
    persist()
    return run
  }

  /**
   * 模板（含栏数）改动后：该模板所有未开打的批次失效，按新模板快照与
   * 新容量重算页数；开打中和已打完的批次原样留住，顺序不动。
   */
  function rebuildQueuedBatches(templateId: string, template: LabelTemplate) {
    const hasAffected = batches.value.some(
      (batch) => batch.status === 'queued' && batch.templateId === templateId,
    )
    if (!hasAffected) return
    batches.value = recomputeQueuedBatches(batches.value, template, createBatchId)
    persist()
  }

  /** 删除模板时，把引用它的排队批次迁移到当前在用模板后重算 */
  function rebaseQueuedBatches(removedTemplateId: string, fallback: LabelTemplate) {
    if (!batches.value.some((batch) => batch.status === 'queued' && batch.templateId === removedTemplateId)) return
    batches.value.forEach((batch) => {
      if (batch.status === 'queued' && batch.templateId === removedTemplateId) {
        batch.templateId = fallback.id
        batch.templateName = fallback.name
      }
    })
    rebuildQueuedBatches(fallback.id, fallback)
  }

  function nextQueuedBatch(): PrintBatch | undefined {
    return queuedBatches.value[0]
  }

  /** 开打队首批次（两位馆员同时提交时只让先到的那批成立） */
  async function claimNextBatch(): Promise<ClaimResult> {
    const batch = nextQueuedBatch()
    if (!batch) return { ok: false, reason: 'none' }
    return claimBatch(batch.id)
  }

  async function claimBatch(batchId: string): Promise<ClaimResult> {
    const target = batches.value.find((item) => item.id === batchId)
    if (!target || target.status !== 'queued') {
      return { ok: false, reason: 'none', batch: target }
    }

    // 乐观锁定：本工位先标记 printing 并落盘（合并允许 queued→printing 前进）
    const claimedAt = nowIso()
    target.status = 'printing'
    target.claimedAt = claimedAt
    target.claimedBy = station.value.id
    target.claimedByName = station.value.name
    target.updatedAt = Date.now()
    assignRunSequence(batches.value, target)
    pendingClaims.add(batchId)
    claimants.set(batchId, [{ ...station.value }])
    persist()
    post({ type: 'CLAIM', batchId, runId: target.runId, station: { ...station.value }, at: claimedAt })

    await delay(CLAIM_ARBITER_MS)

    const rivals = (claimants.get(batchId) ?? []).filter((item) => item.id !== station.value.id)
    const earlierRival = rivals.some((item) => {
      const rivalClaim = claimTimestamps.get(batchId)?.get(item.id) ?? ''
      return rivalClaim < claimedAt || (rivalClaim === claimedAt && item.id < station.value.id)
    })

    let result: ClaimResult
    if (earlierRival) {
      const winner = rivals.find((item) => item.id !== station.value.id) ?? rivals[0]
      // 仲裁落败：不回写本地回滚，直接以先到者已落盘的 printing 状态为准
      pendingClaims.delete(batchId)
      claimants.delete(batchId)
      hydrateFromStorage()
      result = { ok: false, reason: 'lost', winner }
    } else {
      // 胜出前再复核落盘归属：对方 CLAIM 若恰好晚到，存储里会是更早的先到者
      const stored = readStorage()?.batches.find((item) => item.id === batchId)
      const stolenByOther =
        stored &&
        stored.status === 'printing' &&
        stored.claimedBy !== station.value.id &&
        (stored.claimedAt ?? '') < claimedAt
      if (stolenByOther) {
        const winnerStation = rivals.find((item) => item.id === stored.claimedBy)
        pendingClaims.delete(batchId)
        claimants.delete(batchId)
        hydrateFromStorage()
        result = {
          ok: false,
          reason: 'lost',
          winner: winnerStation ?? { id: stored.claimedBy!, name: stored.claimedByName ?? '另一工位' },
        }
      } else {
        // 仲裁胜出：最终决定强制以本地 printing 版本落盘，防止落败者晚写覆盖
        target.updatedAt = Date.now()
        forceLocal.add(batchId)
        pendingClaims.delete(batchId)
        claimants.delete(batchId)
        persist()
        post({ type: 'CLAIM_WON', batchId, runId: target.runId, station: { ...station.value }, at: claimedAt })
        result = { ok: true, batch: target }
      }
    }
    return result
  }

  function handleChannelMessage(message: ClaimMessage) {
    if (message.type === 'COMMIT') {
      if (!dirty.value && pendingClaims.size === 0) hydrateFromStorage()
      return
    }
    if (!message.batchId || !message.station || message.station.id === station.value.id) return

    const batch = batches.value.find((item) => item.id === message.batchId)
    if (!batch) return

    if (message.type === 'CLAIM') {
      const list = claimants.get(message.batchId) ?? []
      if (!list.some((item) => item.id === message.station!.id)) list.push(message.station)
      claimants.set(message.batchId, list)
      const perBatch = claimTimestamps.get(message.batchId) ?? new Map<string, string>()
      perBatch.set(message.station.id, message.at ?? nowIso())
      claimTimestamps.set(message.batchId, perBatch)
      // 我已经先锁定，广播胜出现状，让对方退出仲裁
      if (batch.status === 'printing' && batch.claimedBy === station.value.id) {
        post({
          type: 'CLAIM_WON',
          batchId: batch.id,
          runId: batch.runId,
          station: { ...station.value },
          at: batch.claimedAt,
        })
      }
    } else if (message.type === 'CLAIM_WON') {
      if (batch.status !== 'printed' && batch.claimedBy !== message.station.id) {
        batch.status = 'printing'
        batch.claimedBy = message.station.id
        batch.claimedByName = message.station.name
        batch.claimedAt = message.at ?? batch.claimedAt ?? nowIso()
        batch.updatedAt = Date.now()
        if (!pendingClaims.has(batch.id)) persist()
      }
    } else if (message.type === 'CLAIM_RELEASE') {
      if (batch.status === 'printing' && batch.claimedBy === message.station.id) {
        batch.status = 'queued'
        batch.claimedAt = undefined
        batch.claimedBy = undefined
        batch.claimedByName = undefined
        batch.updatedAt = Date.now()
        batch.labels.forEach((label) => { label.seqNo = 0 })
        forceLocal.add(batch.id)
        persist()
      }
    }
  }

  function confirmPrinted(batchId: string) {
    const batch = batches.value.find((item) => item.id === batchId)
    // 只有锁定该批的工位才能确认打完，落败方 / 旁观工位不能越权
    if (!batch || batch.status !== 'printing' || batch.claimedBy !== station.value.id) return
    batch.status = 'printed'
    batch.printedAt = nowIso()
    batch.updatedAt = Date.now()
    forceLocal.add(batchId)
    persist()
  }

  /** 打印机卡纸 / 取消：本工位把锁定中的批次放回队列，序号重新留待开打 */
  function releaseClaim(batchId: string) {
    const batch = batches.value.find((item) => item.id === batchId)
    if (!batch || batch.status !== 'printing' || batch.claimedBy !== station.value.id) return
    batch.status = 'queued'
    batch.claimedAt = undefined
    batch.claimedBy = undefined
    batch.claimedByName = undefined
    batch.updatedAt = Date.now()
    batch.labels.forEach((label) => { label.seqNo = 0 })
    forceLocal.add(batchId)
    persist()
    post({ type: 'CLAIM_RELEASE', batchId: batch.id, station: { ...station.value } })
  }

  function removeRun(runId: string) {
    const locked = batches.value.some((batch) => batch.runId === runId && batch.status !== 'queued')
    if (locked) return
    runs.value = runs.value.filter((run) => run.id !== runId)
    batches.value = batches.value.filter((batch) => batch.runId !== runId)
    persist()
  }

  function resetAll() {
    runs.value = []
    batches.value = []
    dirty.value = false
    persistError.value = ''
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    post({ type: 'COMMIT' })
  }

  function formatSeq(seqNo: number) {
    return `#${String(seqNo).padStart(4, '0')}`
  }

  return {
    runs,
    batches,
    station,
    dirty,
    persistError,
    queuedBatches,
    activeBatches,
    printedBatches,
    totalLabels,
    printedLabelCount,
    enqueueRun,
    rebuildQueuedBatches,
    rebaseQueuedBatches,
    claimNextBatch,
    claimBatch,
    confirmPrinted,
    releaseClaim,
    removeRun,
    resetAll,
    retryPersist,
    setStationName,
    formatSeq,
  }
})
