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
