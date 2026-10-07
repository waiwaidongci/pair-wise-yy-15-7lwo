import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

// 可控失败的 localStorage + 空 BroadcastChannel 垫片
let failWrites = true
let stored = ''
// @ts-expect-error 全局垫片
globalThis.localStorage = {
  getItem: () => stored,
  setItem: (_k: string, v: string) => {
    if (failWrites) throw new Error('QuotaExceededError: 存储空间不足')
    stored = v
  },
  removeItem: () => { stored = '' },
}
// @ts-expect-error
globalThis.sessionStorage = {
  getItem: (k: string) => (k.endsWith('station') ? JSON.stringify({ id: 'station-SELF', name: '馆员丙' }) : null),
  setItem: () => {},
}
// @ts-expect-error
globalThis.BroadcastChannel = class {
  postMessage() {}
}
// @ts-expect-error
globalThis.window = { addEventListener: () => {}, setTimeout: globalThis.setTimeout }

const { usePrintStore } = await import('../src/stores/printStore')
setActivePinia(createPinia())
const store = usePrintStore()

const tpl = {
  id: 't', name: 't', paperWidthMm: 210, paperHeightMm: 297,
  marginTopMm: 10, marginRightMm: 10, marginBottomMm: 10, marginLeftMm: 10,
  columns: 4, rowHeightMm: 25, columnGapMm: 2, rowGapMm: 2, lineHeightMm: 4.2,
  fontSizePt: 7, borderWidthMm: 0.2, borderStyle: 'solid', italicScientific: true,
  barcodeMode: 'qr', includeCollection: true, includeHabitat: false, includeNotes: false,
  updatedAt: '',
} as const
const specimens = Array.from({ length: 85 }, (_, i) => ({
  id: `s${i + 1}`, accessionNo: `A${i}`, taxonName: '', scientificName: 'g s',
  locality: 'l', collectedAt: 'd', collector: 'c', habitat: '', notes: '',
}))

// 存储损坏：入队写入失败，但内存里的批次必须原样留住
store.enqueueRun('失败重试任务', specimens, { ...tpl })
assert.equal(store.dirty, true, '应标记为写入失败/待重试')
assert.match(store.persistError, /存储空间不足/)
assert.equal(store.totalLabels, 85, '原清单 85 张全部留在内存，一张不丢')
assert.equal(store.queuedBatches.length, 3, '排好的 3 个批次仍在，可继续操作')
console.log('✓ 写入失败：清单与已排批次原样保留并置脏提示')

// 失败期间仍可开打、锁定序号（操作只改内存）
const claim = await store.claimNextBatch()
assert.ok(claim.ok)
assert.equal(claim.batch!.labels[39].seqNo, 40, '失败期间锁定的序号仍正确')
assert.equal(store.dirty, true)
console.log('✓ 失败期间业务不中断，开打锁定照常工作')

// 馆员腾出空间后点“重试写入”：落盘成功，脏标记清除
failWrites = false
const retried = store.retryPersist()
assert.equal(retried, true)
assert.equal(store.dirty, false)
assert.equal(store.persistError, '')
const persisted = JSON.parse(stored)
assert.equal(persisted.batches.length, 3)
assert.equal(persisted.batches.find((b: { status: string }) => b.status === 'printing').labels.length, 40)
console.log('✓ 重试写入成功，队列（含锁定中批次）完整落盘')

// 全新 store 冷启动能读回
stored = stored // 已落盘
setActivePinia(createPinia())
const reopened = usePrintStore()
assert.equal(reopened.totalLabels, 85)
assert.equal(reopened.activeBatches.filter((b) => b.status === 'printing').length, 1)
console.log('✓ 重开页面后队列与锁定状态正确恢复')

console.log('\n写入失败重试断言通过 ✅')
process.exit(0)
