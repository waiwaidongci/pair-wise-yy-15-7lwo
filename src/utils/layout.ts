import type { BarcodeMode, LabelTemplate, Specimen } from '../types/label'

export function rowsPerPage(template: LabelTemplate) {
  const contentHeight =
    template.paperHeightMm - template.marginTopMm - template.marginBottomMm
  return Math.max(1, Math.floor((contentHeight + template.rowGapMm) / (template.rowHeightMm + template.rowGapMm)))
}

export function labelsPerPage(template: LabelTemplate) {
  return Math.max(1, template.columns * rowsPerPage(template))
}

export function paginateSpecimens(specimens: Specimen[], template: LabelTemplate) {
  const perPage = labelsPerPage(template)
  const pages: Specimen[][] = []
  for (let index = 0; index < specimens.length; index += perPage) {
    pages.push(specimens.slice(index, index + perPage))
  }
  return pages.length ? pages : [[]]
}

export function formatDate(value: string) {
  if (!value) return '日期待补'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

export function scientificFontScale(name: string, template: LabelTemplate) {
  const availableMm = labelInnerWidth(template) - 4
  const estimatedWidth = name.length * template.fontSizePt * 0.19
  if (estimatedWidth <= availableMm) return 1
  return Math.max(0.74, availableMm / estimatedWidth)
}

export function labelInnerWidth(template: LabelTemplate) {
  const contentWidth =
    template.paperWidthMm - template.marginLeftMm - template.marginRightMm
  return (
    contentWidth -
    (template.columns - 1) * template.columnGapMm
  ) / template.columns
}

export function barcodeLabel(mode: BarcodeMode) {
  if (mode === 'qr') return '二维码'
  if (mode === 'code128') return 'Code 128'
  return '不打印'
}

export function safeFilePart(value: string) {
  return value.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').replace(/-+/g, '-')
}
