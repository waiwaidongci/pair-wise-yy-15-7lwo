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

/** 批次状态：排队待打 / 已锁定开打中 / 已打完确认 */
export type BatchStatus = 'queued' | 'printing' | 'printed'

/**
 * 一张标签在批次锁定时的快照。开打即冻结标本与序号，
 * 之后清单修改、删除都不会影响已经排队 / 打出的标签。
 */
export interface BatchLabel {
  specimenId: string
  accessionNo: string
  /** 任务内连续序号，开打瞬间按当页容量锁定，重算只动未开打的批次 */
  seqNo: number
  specimenSnapshot: Specimen
}

/**
 * 打印批次 = 一张纸（一页）。容量、模板、序号在锁定时冻结；
 * queued 批次会在模板改动后失效重算，printing / printed 批次永久留档。
 */
export interface PrintBatch {
  id: string
  runId: string
  /** 批次在任务内的顺序，0 起；重算后重新编号 */
  ordinal: number
  status: BatchStatus
  templateId: string
  templateName: string
  templateSnapshot: LabelTemplate
  /** 决定每页容量的布局指纹，用于判断是否需要重算页数 */
  layoutFp: string
  /** 锁定时的当页容量（张/页） */
  pageCapacity: number
  labels: BatchLabel[]
  createdAt: string
  /** 最近一次状态/内容写入的时间戳（毫秒），多标签页合并时新写入优先 */
  updatedAt: number
  /** 该批次经历过的失效重算次数 */
  rebuildCount: number
  claimedAt?: string
  claimedBy?: string
  claimedByName?: string
  printedAt?: string
}

/** 一次"开打"提交产生一个打印任务，任务内序号全局连续 */
export interface PrintRun {
  id: string
  name: string
  createdAt: string
  createdBy: string
}

export interface Station {
  id: string
  name: string
}
