import assert from 'node:assert/strict'
import type { LabelTemplate, PrintBatch, Specimen } from '../src/types/label'
import { buildQueuedBatches, recomputeQueuedBatches, assignRunSequence } from '../src/utils/batches'
import { labelsPerPage } from '../src/utils/layout'

let counter = 0
const createId = () => `batch-${++counter}`

function makeTemplate(over: Partial<LabelTemplate> = {}): LabelTemplate {
  return {
    id: 'tpl',
    name: '测试模板',
    paperWidthMm: 210,
    paperHeightMm: 297,
    marginTopMm: 10,
    marginRightMm: 10,
    marginBottomMm: 10,
    marginLeftMm: 10,
    columns: 4,
    rowHeightMm: 25,
    columnGapMm: 2,
    rowGapMm: 2,
    lineHeightMm: 4.2,
    fontSizePt: 7,
    borderWidthMm: 0.2,
    borderStyle: 'solid',
    italicScientific: true,
    barcodeMode: 'qr',
    includeCollection: true,
    includeHabitat: false,
    includeNotes: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function makeSpecimens(n: number): Specimen[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    accessionNo: `ACC-${i + 1}`,
    taxonName: '科',
    scientificName: 'Genus species',
    locality: '产地',
    collectedAt: '2026-01-01',
    collector: '采集人',
    habitat: '',
    notes: '',
  }))
}

// 1) 按当页容量分页，超出容量排队到下一批
{
  const tpl = makeTemplate({})
  const cap = labelsPerPage(tpl)
  assert.equal(cap, 40, 'A4 默认模板每页应为 40 张')
  const batches = buildQueuedBatches('run-1', makeSpecimens(85), tpl, { createId })
  assert.equal(batches.length, 3, '85 张应排 3 批')
  assert.deepEqual(batches.map((b) => b.labels.length), [40, 40, 5])
  assert.deepEqual(batches.map((b) => b.ordinal), [0, 1, 2])
  assert.ok(batches.every((b) => b.status === 'queued'))
  assert.ok(batches.every((b) => b.labels.every((l) => l.seqNo === 0)), '排队时不分配序号')
  console.log('✓ 按当页容量分页，超出排队下一批')
}

// 2) 开打瞬间锁定序号，任务内连续
{
  const tpl = makeTemplate({})
  const batches = buildQueuedBatches('run-2', makeSpecimens(85), tpl, { createId })
  // 第一批开打
  batches[0].status = 'printing'
  assignRunSequence(batches, batches[0])
  assert.deepEqual(batches[0].labels.map((l) => l.seqNo), Array.from({ length: 40 }, (_, i) => i + 1))
  // 打完第一批
  batches[0].status = 'printed'
  // 第二批开打：序号接着 #0041
  batches[1].status = 'printing'
  assignRunSequence(batches, batches[1])
  assert.equal(batches[1].labels[0].seqNo, 41)
  assert.equal(batches[1].labels[39].seqNo, 80)
  // 第三批
  batches[1].status = 'printed'
  batches[2].status = 'printing'
  assignRunSequence(batches, batches[2])
  assert.deepEqual(batches[2].labels.map((l) => l.seqNo), [81, 82, 83, 84, 85])
  console.log('✓ 开打瞬间锁定连续序号，逐批相接')
}

// 3) 改栏数：未开打批次失效重算页数，开打/打完批次保留
{
  const tpl4 = makeTemplate({ columns: 4 })
  const batches = buildQueuedBatches('run-3', makeSpecimens(85), tpl4, { createId })
  // 第一批开打 + 打完（保留它冻结的四栏快照）
  batches[0].status = 'printed'
  assignRunSequence(batches, batches[0])
  batches[0].printedAt = '2026-01-02T00:00:00.000Z'

  // 改成两栏：每页容量减半（20），剩余 45 张应重排成 3 批
  const tpl2 = makeTemplate({ columns: 2 })
  assert.equal(labelsPerPage(tpl2), 20)
  const rebuilt = recomputeQueuedBatches(batches, tpl2, createId)
  const printed = rebuilt.filter((b) => b.status === 'printed')
  const queued = rebuilt.filter((b) => b.status === 'queued')
  assert.equal(printed.length, 1, '已打完批次保留')
  assert.equal(printed[0].pageCapacity, 40, '已打完批次冻结旧容量')
  assert.equal(printed[0].templateSnapshot.columns, 4, '已打完批次冻结旧模板快照')
  assert.equal(queued.length, 3, '剩余 45 张按每页 20 张重排为 3 批')
  assert.deepEqual(queued.map((b) => b.labels.length), [20, 20, 5])
  assert.deepEqual(queued.map((b) => b.ordinal), [1, 2, 3], '重算后序号位接在打完批次之后')
  assert.ok(queued.every((b) => b.pageCapacity === 20))
  assert.ok(queued.every((b) => b.rebuildCount === 1), '记录重算次数')
  // 排队顺序保留：重排后第 2 批第一张是原第 41 张
  assert.equal(queued[0].labels[0].specimenId, 's41')
  assert.equal(queued[2].labels[4].specimenId, 's85')
  console.log('✓ 栏数改动后未开打批次重算页数，打完批次冻结保留')
}

// 4) 改字号（不影响容量）不会触发重算——由 layoutFingerprint 表达；这里验证指纹在字号变化时不变
{
  const a = makeTemplate({ fontSizePt: 7 })
  const b = makeTemplate({ fontSizePt: 10 })
  const { layoutFingerprint } = await import('../src/utils/layout')
  assert.equal(layoutFingerprint(a), layoutFingerprint(b), '字号不影响布局指纹')
  console.log('✓ 字号不改变当页容量（不参与容量指纹）')
}

// 5) 容量变大后批次合并，锁定批次之后的标签顺序仍与原清单一致
{
  const tpl2 = makeTemplate({ columns: 2 }) // 20/页
  const batches = buildQueuedBatches('run-4', makeSpecimens(45), tpl2, { createId })
  batches[0].status = 'printed'
  assignRunSequence(batches, batches[0])
  const tpl4 = makeTemplate({ columns: 4 }) // 40/页
  const rebuilt = recomputeQueuedBatches(batches, tpl4, createId)
  const queued = rebuilt.filter((b) => b.status === 'queued')
  assert.equal(queued.length, 1, '剩余 25 张在更大容量下合并为 1 批')
  assert.equal(queued[0].labels.length, 25)
  assert.deepEqual(queued[0].labels.map((l) => l.specimenId), makeSpecimens(45).slice(20).map((s) => s.id))
  console.log('✓ 容量变大后排队批次合并，顺序不丢不乱')
}

// 6) 打印批次冻结快照，后续标本清单改动不影响已排批次
{
  const tpl = makeTemplate({})
  const specimens = makeSpecimens(3)
  const batches = buildQueuedBatches('run-5', specimens, tpl, { createId })
  const mutated = specimens[0]
  mutated.scientificName = 'CHANGED LATER'
  assert.equal(batches[0].labels[0].specimenSnapshot.scientificName, 'Genus species', '快照不受后续修改影响')
  console.log('✓ 入队即冻结标本快照，清单后续修改不波及已排批次')
}

console.log('\n全部批次逻辑断言通过 ✅')
