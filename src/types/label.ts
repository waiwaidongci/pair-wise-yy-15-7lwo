export type BarcodeMode = 'none' | 'qr' | 'code128'
export type BorderStyle = 'solid' | 'dashed' | 'dotted'

export interface Specimen {
  id: string
  accessionNo: string
  taxonName: string
  scientificName: string
  locality: string
  collectedAt: string
  collector: string
  habitat: string
  notes: string
}

export interface LabelTemplate {
  id: string
  name: string
  paperWidthMm: number
  paperHeightMm: number
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
  columns: number
  rowHeightMm: number
  columnGapMm: number
  rowGapMm: number
  lineHeightMm: number
  fontSizePt: number
  borderWidthMm: number
  borderStyle: BorderStyle
  italicScientific: boolean
  barcodeMode: BarcodeMode
  includeCollection: boolean
  includeHabitat: boolean
  includeNotes: boolean
  updatedAt: string
}

export interface ValidationIssue {
  id: string
  specimenId: string
  field: keyof Specimen
  severity: 'error' | 'warning'
  message: string
}

export interface ImportResult {
  specimens: Specimen[]
  issues: ValidationIssue[]
  ignoredRows: number
}

/**
 * 打印批次状态：
 * - queued   已预排、未开打（模板冻结、序号已定，模板一改即失效）
 * - printing 已被某位馆员开打抢占（先到先得）
 * - done     已打完（顺序与序号永久留住，不再重算）
 * - invalid  模板/栏数变更后作废（标本回到队列，序号释放）
 */
export type BatchStatus = 'queued' | 'printing' | 'done' | 'invalid'

export interface BatchLabel {
  specimen: Specimen
  /** 开打时按当页容量定下的全局连续序号，批次生命周期内不变；旧清单映射时可缺省 */
  serial?: number
}

export interface PrintBatch {
  id: string
  /** 批次序号（第几批），连续递增 */
  batchNo: number
  status: BatchStatus
  /** 开打时冻结的模板快照，之后模板再改也不影响本批 */
  template: LabelTemplate
  /** 本批标签（≤ 当页容量），含冻结的标本快照与固定序号 */
  labels: BatchLabel[]
  /** 开打时的每页容量（labelsPerPage） */
  capacity: number
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  /** 抢占开打的馆员标识 */
  claimedBy: string | null
  claimedAt: string | null
  invalidReason: string | null
}

export type BatchStartResult =
  | { ok: true; batch: PrintBatch }
  | { ok: false; reason: 'empty' | 'printing' | 'write-failed'; by?: string }
