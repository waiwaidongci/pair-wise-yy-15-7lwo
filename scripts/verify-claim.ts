import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

// ---- 浏览器环境垫片（store 之外不依赖任何 DOM/UI 库）----
const memory = new Map<string, string>()
const makeStorage = () => ({
  getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
  setItem: (k: string, v: string) => void memory.set(k, String(v)),
  removeItem: (k: string) => void memory.delete(k),
})
// @ts-expect-error 注入测试用全局
globalThis.localStorage = makeStorage()
// @ts-expect-error
globalThis.sessionStorage = makeStorage()
// @ts-expect-error
globalThis.window = {
  addEventListener: () => {},
  setTimeout: (fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]) => setTimeout(fn, ms, ...args),
}
// Node 15+ 自带 BroadcastChannel，同一进程内多个实例互通，直接用

const { usePrintStore } = await import('../src/stores/printStore')

const tpl = {
  id: 'tpl-a4', name: 'A4 四栏', paperWidthMm: 210, paperHeightMm: 297,
  marginTopMm: 10, marginRightMm: 10, marginBottomMm: 10, marginLeftMm: 10,
  columns: 4, rowHeightMm: 25, columnGapMm: 2, rowGapMm: 2, lineHeightMm: 4.2,
  fontSizePt: 7, borderWidthMm: 0.2, borderStyle: 'solid', italicScientific: true,
  barcodeMode: 'qr', includeCollection: true, includeHabitat: false, includeNotes: false,
  updatedAt: '2026-01-01',
} as const

const specimens = Array.from({ length: 85 }, (_, i) => ({
  id: `s${i + 1}`, accessionNo: `ACC-${i + 1}`, taxonName: '科', scientificName: 'Genus sp',
  locality: '产地', collectedAt: '2026-01-01', collector: '某人', habitat: '', notes: '',
}))

// 两个工位 = 两个 pinia 实例；sessionStorage 需要每工位独立，直接改键
const piniaA = createPinia()
setActivePinia(piniaA)
// @ts-expect-error 给 A 独立工位身份
globalThis.sessionStorage = {
  getItem: (k: string) => (k.endsWith('station') ? JSON.stringify({ id: 'station-AAAA', name: '馆员甲' }) : null),
  setItem: () => {},
}
const storeA = usePrintStore()

const piniaB = createPinia()
setActivePinia(piniaB)
// @ts-expect-error 给 B 独立工位身份
globalThis.sessionStorage = {
  getItem: (k: string) => (k.endsWith('station') ? JSON.stringify({ id: 'station-BBBB', name: '馆员乙' }) : null),
  setItem: () => {},
}
const storeB = usePrintStore()

// 甲入队 85 张（每页 40 → 3 批）
storeA.setStationName('馆员甲')
storeB.setStationName('馆员乙')
const run = storeA.enqueueRun('并发测试任务', specimens, { ...tpl })
assert.ok(run)
await new Promise((r) => setTimeout(r, 60)) // 等 COMMIT 广播，乙看到同一队列
assert.equal(storeB.queuedBatches.length, 3, '乙通过广播看到甲入队的 3 个批次')
const batchId = storeA.queuedBatches[0].id
assert.equal(storeB.queuedBatches[0].id, batchId, '两人队列头部是同一批')

// 两位馆员同时点“开打队首批”（不 await，制造真正并发）
const [resultA, resultB] = await Promise.all([storeA.claimNextBatch(), storeB.claimNextBatch()])
const winners = [resultA, resultB].filter((r) => r.ok)
assert.equal(winners.length, 1, '同一批只能有一位馆员赢得仲裁')
const loser = resultA.ok ? resultB : resultA
assert.equal(loser.reason, 'lost', '落败方应收到 lost')
const winnerName = resultA.ok ? '馆员甲' : '馆员乙'
console.log(`✓ 同时开打：${winnerName} 赢得该批，另一方收到落败提示`)

// 胜方锁定序号 1..40，败方看到的状态是对方 printing
const winner = resultA.ok ? storeA : storeB
const winnerBatch = winner.batches.find((b) => b.id === batchId)!
assert.equal(winnerBatch.status, 'printing')
assert.deepEqual(winnerBatch.labels.map((l) => l.seqNo), Array.from({ length: 40 }, (_, i) => i + 1))
assert.ok(winnerBatch.labels.every((l) => l.seqNo > 0), '胜方序号已锁定')
const loserStore = resultA.ok ? storeB : storeA
const winnerStore = resultA.ok ? storeA : storeB
// 等待 CLAIM_WON 广播让败方视图收敛到胜方（仲裁落盘有先后，短暂收敛窗口是正常的）
for (let i = 0; i < 20; i += 1) {
  if (loserStore.batches.find((b) => b.id === batchId)?.claimedBy === winnerStore.station.id) break
  await new Promise((r) => setTimeout(r, 30))
}
const loserView = loserStore.batches.find((b) => b.id === batchId)!
assert.equal(loserView.status, 'printing', '败方视图中该批由对方开打')
assert.equal(loserView.claimedBy, winnerStore.station.id)
console.log('✓ 胜方锁定 #0001–#0040，败方看到“对方开打中”且不可抢')

// 败方不能确认 / 打印这批
loserStore.confirmPrinted(batchId)
assert.equal(loserStore.batches.find((b) => b.id === batchId)!.status, 'printing', '败方确认打完无效')
console.log('✓ 败方无法越权确认对方的批次')

// 胜方确认打完，顺序留档；败方收到广播
winnerStore.confirmPrinted(batchId)
await new Promise((r) => setTimeout(r, 60))
assert.equal(loserStore.batches.find((b) => b.id === batchId)!.status, 'printed', '败方同步为已打完')
assert.equal(winnerStore.printedLabelCount, 40)
// 已打完不可被任何后来写入打回
loserStore.releaseClaim(batchId)
assert.equal(winnerStore.batches.find((b) => b.id === batchId)!.status, 'printed', '已打完终态不可放回')
console.log('✓ 确认打完后顺序留档，任何工位都不能改回')

// 下一批开打：序号接 #0041
const second = await storeA.claimNextBatch()
assert.ok(second.ok)
assert.equal(second.batch!.labels[0].seqNo, 41)
assert.equal(second.batch!.labels[39].seqNo, 80)
console.log('✓ 下一批开打序号紧接 #0041–#0080')

console.log('\n双工位并发集成断言通过 ✅')
process.exit(0)
