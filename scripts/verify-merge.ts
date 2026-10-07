import assert from 'node:assert/strict'
import type { PrintBatch } from '../src/types/label'

// 与 printStore 中 pickBatch 相同的规则，单独抽出做纯函数验证
const RANK = { queued: 0, printing: 1, printed: 2 } as const
function pick(a: PrintBatch, b: PrintBatch, force: Set<string>): PrintBatch {
  if (a.status === 'printed' && b.status !== 'printed') return a
  if (b.status === 'printed' && a.status !== 'printed') return b
  if (force.has(a.id)) return a
  if (force.has(b.id)) return b
  if (a.status === b.status) return a.updatedAt >= b.updatedAt ? a : b
  return RANK[a.status] > RANK[b.status] ? a : b
}

let ts = 1
function makeBatch(over: Partial<PrintBatch> = {}): PrintBatch {
  return {
    id: 'b1',
    runId: 'r1',
    ordinal: 0,
    status: 'queued',
    templateId: 't',
    templateName: 't',
    templateSnapshot: {} as PrintBatch['templateSnapshot'],
    layoutFp: 'fp',
    pageCapacity: 40,
    labels: [],
    createdAt: '2026-01-01',
    updatedAt: ts++,
    rebuildCount: 0,
    ...over,
  }
}

// 后来者不能把别人已锁定的批次覆盖回排队
{
  const locked = makeBatch({ id: 'x', status: 'printing', claimedBy: 'A', updatedAt: 10 })
  const staleQueued = makeBatch({ id: 'x', status: 'queued', updatedAt: 99 })
  assert.equal(pick(locked, staleQueued, new Set()).status, 'printing')
  assert.equal(pick(staleQueued, locked, new Set()).status, 'printing', '参数顺序无关')
  console.log('✓ 旧标签页的 queued 回灌不能覆盖已锁定批次')
}

// 仲裁胜出方最终落盘强制以本地 printing 为准（即便落败方写入时间更新）
{
  const winner = makeBatch({ id: 'x', status: 'printing', claimedBy: 'A', updatedAt: 10 })
  const loserPrinting = makeBatch({ id: 'x', status: 'printing', claimedBy: 'B', updatedAt: 11 })
  assert.equal(pick(winner, loserPrinting, new Set(['x'])).claimedBy, 'A')
  console.log('✓ 仲裁胜出方最终决定不被落败方晚写覆盖')
}

// printed 是终态：放回队列也不能把已打完批次打回
{
  const printed = makeBatch({ id: 'x', status: 'printed', updatedAt: 10 })
  const release = makeBatch({ id: 'x', status: 'queued', updatedAt: 99 })
  assert.equal(pick(printed, release, new Set(['x'])).status, 'printed')
  console.log('✓ 已打完是终态，任何写入都不能打回排队')
}

// 卡纸放回：先正常落盘的 queued 比 printing 旧，但允许主动降级
{
  const release = makeBatch({ id: 'x', status: 'queued', updatedAt: 50 })
  const oldPrinting = makeBatch({ id: 'x', status: 'printing', updatedAt: 10 })
  const picked = pick(release, oldPrinting, new Set(['x']))
  assert.equal(picked.status, 'queued')
  console.log('✓ 本工位卡纸放回队列可以显式降级')
}

console.log('\n并发合并规则断言通过 ✅')
