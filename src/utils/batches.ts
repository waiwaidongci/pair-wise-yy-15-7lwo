import type { LabelTemplate, PrintBatch, Specimen } from '../types/label'
import { labelsPerPage, layoutFingerprint } from './layout'

/** 从当前时间派生唯一 id：测试环境可注入计数器保证确定 */
export type IdFactory = () => string

export function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size))
  }
  return pages.length ? pages : [[]]
}

/**
 * 开打前按当页容量把标本切成排队批次（一张纸 = 一批）。
 * 此阶段只冻结标本快照与页内顺序，seqNo 全部留 0，待开打瞬间锁定。
 */
export function buildQueuedBatches(
  runId: string,
  specimens: Specimen[],
  template: LabelTemplate,
  options: {
    startOrdinal?: number
    rebuildCount?: number
    createId: IdFactory
    clock?: () => { iso: string; ms: number }
  },
): PrintBatch[] {
  const capacity = labelsPerPage(template)
  const fp = layoutFingerprint(template)
  const base = options.clock?.() ?? { iso: new Date().toISOString(), ms: Date.now() }
  const startOrdinal = options.startOrdinal ?? 0
  const rebuildCount = options.rebuildCount ?? 0
  return chunk(specimens, capacity).map((pageSpecimens, index) => ({
    id: options.createId(),
    runId,
    ordinal: startOrdinal + index,
    status: 'queued' as const,
    templateId: template.id,
    templateName: template.name,
    templateSnapshot: { ...template },
    layoutFp: fp,
    pageCapacity: capacity,
    labels: pageSpecimens.map((specimen) => ({
      specimenId: specimen.id,
      accessionNo: specimen.accessionNo,
      seqNo: 0,
      // 入队即冻结：拷贝标本，之后清单修改 / 删除都不影响已排批次
      specimenSnapshot: { ...specimen },
    })),
    createdAt: base.iso,
    updatedAt: base.ms + index,
    rebuildCount,
  }))
}

/**
 * 模板或栏数改动后重算：锁定中 / 已打完的批次原样保留并占住前序序号，
 * 排队批次按原有先后顺序拿出快照，用新容量重新分页。
 */
export function recomputeQueuedBatches(
  all: PrintBatch[],
  template: LabelTemplate,
  createId: IdFactory,
  clock?: () => { iso: string; ms: number },
): PrintBatch[] {
  const runIds = new Set(
    all.filter((batch) => batch.status === 'queued' && batch.templateId === template.id)
      .map((batch) => batch.runId),
  )
  if (!runIds.size) return all

  const locked = all.filter((batch) => batch.status !== 'queued')
  const result: PrintBatch[] = [...locked]
  runIds.forEach((runId) => {
    const runBatches = all.filter((batch) => batch.runId === runId)
    const lockedInRun = runBatches.filter((batch) => batch.status !== 'queued')
    // 锁定批次只保留属于同一任务的；其余任务的锁定批次已在上面统一保留
    void lockedInRun
    const startOrdinal = lockedInRun.length
    const rebuildCount =
      1 + Math.max(0, ...runBatches.filter((b) => b.status === 'queued').map((b) => b.rebuildCount))
    const remaining = runBatches
      .filter((batch) => batch.status === 'queued')
      .sort((a, b) => a.ordinal - b.ordinal)
      .flatMap((batch) => batch.labels.map((label) => label.specimenSnapshot))
    if (remaining.length) {
      result.push(...buildQueuedBatches(runId, remaining, template, {
        startOrdinal,
        rebuildCount,
        createId,
        clock,
      }))
    }
  })
  return result
}

/**
 * 开打瞬间锁定序号：任务内接在所有已锁定标签之后连续编号。
 * 直接修改传入批次并返回它。
 */
export function assignRunSequence(all: PrintBatch[], claimed: PrintBatch): PrintBatch {
  const lockedCount = all
    .filter((item) => item.runId === claimed.runId && item.status !== 'queued' && item.id !== claimed.id)
    .reduce((sum, item) => sum + item.labels.length, 0)
  claimed.labels.forEach((label, index) => {
    label.seqNo = lockedCount + index + 1
  })
  return claimed
}
